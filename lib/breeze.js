/** 本机 Breeze-TTS-2 语音后端（GGUF + Vulkan）。只在本机起服务，不向外部发送文字。 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dataDir, getSettings } from './store.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = () => path.join(dataDir(), 'runtime')

export function breezeConfig() {
  const cfg = getSettings().breeze || {}
  const custom = String(cfg.dir || process.env.DSH_MENTOR_BREEZE_DIR || '').trim()
  return {
    enabled: cfg.enabled !== false,
    dir: custom,
    exe: String(cfg.exe || process.env.DSH_MENTOR_BREEZE_EXE || '').trim(),
    model: String(cfg.model || process.env.DSH_MENTOR_BREEZE_MODEL || '').trim(),
    port: Math.max(1024, Math.min(Number(cfg.port) || 28376, 65535)),
  }
}

function searchExe(dir, name, depth = 4) {
  if (!fs.existsSync(dir) || depth < 0) return null
  for (const row of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, row.name)
    if (row.isFile() && row.name === name) return file
    if (row.isDirectory()) { const found = searchExe(file, name, depth - 1); if (found) return found }
  }
  return null
}

function searchModel(dir, depth = 4) {
  if (!fs.existsSync(dir) || depth < 0) return null
  const gguf = []
  for (const row of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, row.name)
    if (row.isFile() && row.name.toLowerCase().endsWith('.gguf')) gguf.push(file)
    else if (row.isDirectory()) { const found = searchModel(file, depth - 1); if (found) gguf.push(found) }
  }
  if (!gguf.length) return null
  const bytes = (file) => { try { return fs.statSync(file).size } catch { return 0 } }
  gguf.sort((a, b) => (a.toLowerCase().includes('q8_0') ? 0 : 1) - (b.toLowerCase().includes('q8_0') ? 0 : 1) || bytes(b) - bytes(a))
  return gguf[0]
}

const LAYOUT = '下载 Breeze-TTS-2 的 Windows Vulkan 包和 .gguf 模型，放到任意目录，再把目录填到「高级设置 > 语音后端」；或放到插件 runtime/breeze 下。'

/** 查找本机可用的 Breeze 后端；找不到返回 null。 */
export function findBreeze() {
  const cfg = breezeConfig()
  const candidates = []
  if (cfg.dir) candidates.push(cfg.dir)
  if (cfg.model) candidates.push(path.dirname(cfg.model))
  candidates.push(path.join(ROOT, 'runtime', 'breeze'), path.join(BASE(), 'breeze'))
  // 本机已有安装的常见位置（不写入任何配置，仅探测）。
  candidates.push('E:\\Tools\\breeze-tts')
  for (const dir of candidates) {
    if (!dir || !fs.existsSync(dir)) continue
    const exe = cfg.exe || searchExe(dir, 'breeze-server.exe') || searchExe(path.join(dir, 'breeze-tts-2-v0.1.3-windows-x64-vulkan'), 'breeze-server.exe')
    const model = cfg.model || searchModel(dir)
    if (exe && model) return { dir, exe, model, port: cfg.port, layout: LAYOUT }
  }
  return null
}

export function breezeBase(port = breezeConfig().port) {
  return `http://127.0.0.1:${port}`
}

async function healthy(base) {
  try {
    const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1200) })
    return response.ok
  } catch { return false }
}

let own = null
async function waitHealthy(base, child) {
  let died = null
  child.once('exit', (code) => { died = code ?? -1 })
  for (let i = 0; i < 180; i++) {
    if (died !== null) throw new Error(`Breeze 语音服务启动后立即退出（${died}）`)
    if (await healthy(base)) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Breeze 语音服务 90 秒内没有就绪（可能显存不足或模型路径不对）')
}

/** 确保本机 Breeze 服务在跑；返回可用的 base URL。找不到安装时抛错并给出指引。 */
export async function ensureBreeze() {
  const cfg = breezeConfig()
  const base = breezeBase(cfg.port)
  if (await healthy(base)) return base
  if (!cfg.enabled) throw new Error('语音后端已在设置里关闭')
  const found = findBreeze()
  if (!found) throw new Error(`没找到本机 Breeze-TTS-2 语音后端。${LAYOUT}`)
  const child = spawn(found.exe, [found.model, '--host', '127.0.0.1', '--port', String(cfg.port), '--ws-port', '-1'], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], cwd: path.dirname(found.exe),
  })
  let error = ''
  child.stdout.on('data', () => {})
  child.stderr.on('data', (chunk) => { error = (error + chunk).slice(-1200) })
  child.once('error', () => {})
  own = { child, base }
  try {
    await waitHealthy(base, child)
  } catch (failure) {
    child.kill()
    own = null
    throw new Error(`${failure.message}${error ? `：${error.slice(-300)}` : ''}`)
  }
  return base
}

export function stopBreeze() {
  if (!own) return
  const { child } = own
  own = null
  try { child.kill() } catch { /* already gone */ }
}

/** 状态：是否装了、服务是否在跑；供 UI 与工具展示。 */
export async function breezeStatus() {
  const cfg = breezeConfig()
  const found = findBreeze()
  const base = breezeBase(cfg.port)
  return {
    available: Boolean(found),
    running: await healthy(base),
    port: cfg.port,
    dir: found?.dir || cfg.dir || '',
    model: found ? path.basename(found.model) : '',
    exe: found ? path.basename(found.exe) : '',
    layout: found ? '' : LAYOUT,
  }
}
