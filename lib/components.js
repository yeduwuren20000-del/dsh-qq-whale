/** Optional local components, installed only after the user selects them. */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { dataDir, getSettings, setSettings } from './store.js'
import { findNapcat } from './qq-login.js'
import { findBreeze } from './breeze.js'
import { findExecutable, install as installBrowser } from './chromium.js'
import { componentFetch } from './component-network.js'
import { CREATIVE_PLATFORMS } from './creative-platforms.js'
import { AUTO_EDITOR, autoEditorPath } from './auto-editor.js'
import { editingStatus } from './media-edit.js'

const state = globalThis[Symbol.for('dsh-qq-whale.components')] ||= { job: null }
const BASE = () => path.join(dataDir(), 'runtime')
const DOWNLOADS = () => path.join(dataDir(), 'component-downloads')
export const COMPONENTS = [
  { id: 'qq', name: 'QQ 登录', tool: 'NapCat + 独立便携 QQ', size: '约 0.5 GB 下载 / 1.5 GB 磁盘', detail: '直接显示二维码，自动设置本机连接，后台运行。', source: 'https://github.com/NapNeko/NapCatQQ', recommended: true },
  { id: 'browser', name: '网站操作', tool: 'Playwright + Chrome for Testing', size: '约 200 MB', detail: '独立浏览器档案；抖音、B站、小红书和创作网站需分别登录。', source: 'https://googlechromelabs.github.io/chrome-for-testing/', recommended: true },
  { id: 'vision', name: '图片和表情包理解', tool: 'Ollama + Qwen3-VL 2B', size: '约 2 GB 模型，另需 Ollama', detail: '只在自己的电脑识别图片；首次准备需要下载模型。', source: 'https://ollama.com/library/qwen3-vl', recommended: false },
  { id: 'memory', name: '语义记忆', tool: 'Ollama + BGE-M3', size: '约 1.2 GB 模型', detail: '让不同说法也能找到相关记忆；未选时保留关键词记忆。', source: 'https://ollama.com/library/bge-m3', recommended: false },
  { id: 'asr', name: '听 QQ 语音', tool: 'SenseVoice Small INT8 + sherpa-onnx', size: 'INT8 模型约 240 MB，完整下载包可能更大', detail: '本机转写；可与说话功能分开选择。', source: 'https://github.com/k2-fsa/sherpa-onnx', recommended: false },
  { id: 'tts', name: '发 QQ 语音', tool: 'Breeze-TTS-2（GGUF + Vulkan）', size: '模型约 3.4 GB，另需 Vulkan 显卡', detail: '本机 GPU 合成中文语音，音色可按描述定制；文字只在本机处理。', source: 'https://github.com/HoppouAI/Breeze-TTS-2.cpp', recommended: false },
  { id: 'editing', name: '本地剪辑', tool: 'FFmpeg + FFprobe', size: '约 100 MB 下载', detail: '裁剪、拼接、加字幕、配乐、封面和音轨处理。', source: 'https://www.gyan.dev/ffmpeg/builds/', recommended: false },
  { id: 'autoCut', name: '自动视频粗剪', tool: 'Auto-Editor 31.7.2', size: '约 45 MB 下载，另需剪辑组件', detail: '按音量自动去静音、保留说话片段，本机运行，不额外调用模型。', source: 'https://github.com/WyattBlue/auto-editor', recommended: false },
  { id: 'animation', name: 'HTML 动画与视频', tool: 'Anime.js 4.5.0 + 浏览器 + FFmpeg', size: '动画引擎已内置，导出复用浏览器与剪辑组件', detail: '用简短分镜生成离线HTML动画，或本机渲染为MP4，复用已有成品。', source: 'https://github.com/juliangarnier/anime', recommended: false },
]

function tool(exe, args, timeout = 600000) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
    let output = '', error = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('组件准备超时，可以重新尝试')) }, timeout)
    child.stdout.on('data', (b) => { output = (output + b).slice(-100000) })
    child.stderr.on('data', (b) => { error = (error + b).slice(-1000) })
    child.once('error', (e) => { clearTimeout(timer); reject(e) })
    child.once('close', (code) => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(`组件准备失败（${code}）：${error}`)) })
  })
}
async function remoteJSON(url, options = {}) {
  const r = await componentFetch(url, { headers: { 'User-Agent': 'dsh-qq-whale', ...options.headers }, signal: AbortSignal.timeout(30000), ...options })
  if (!r.ok) throw new Error(`无法读取官方组件信息（HTTP ${r.status}）`)
  return r.json()
}
async function download(url, name, { sha256, maxBytes = 1500000000 } = {}) {
  if (new URL(url).protocol !== 'https:') throw new Error('组件下载必须使用 HTTPS')
  fs.mkdirSync(DOWNLOADS(), { recursive: true })
  const file = path.join(DOWNLOADS(), name)
  const verify = async () => {
    if (!sha256) return true
    const hash = createHash('sha256'); for await (const b of fs.createReadStream(file)) hash.update(b)
    return hash.digest('hex') === sha256
  }
  if (fs.existsSync(file) && fs.statSync(file).size > 0 && sha256 && await verify()) return file
  const r = await componentFetch(url, { signal: AbortSignal.timeout(900000), headers: { 'User-Agent': 'dsh-qq-whale' } })
  if (!r.ok || !r.body) throw new Error(`组件下载失败（HTTP ${r.status}）`)
  let bytes = 0
  if (Number(r.headers.get('content-length')) > maxBytes) { await r.body.cancel(); throw new Error('组件大小超过下载上限') }
  const temp = `${file}.part`
  try {
    const stream = Readable.fromWeb(r.body)
    stream.on('data', (b) => { bytes += b.length; if (bytes > maxBytes) stream.destroy(new Error('组件大小超过下载上限')) })
    await pipeline(stream, fs.createWriteStream(temp))
    fs.renameSync(temp, file)
    if (!await verify()) { fs.rmSync(file, { force: true }); throw new Error('官方组件 SHA-256 校验失败，请重新准备') }
  } catch (e) { fs.rmSync(temp, { force: true }); throw e }
  return file
}
async function archive(url, name, out, options) {
  const file = await download(url, name, options)
  fs.mkdirSync(out, { recursive: true })
  await unpack(file, out)
  return out
}
async function unpack(file, out) {
  await tool('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(import.meta.dirname, 'component-unzip.ps1'), '-Archive', file, '-Destination', path.resolve(out)])
}
function findFile(root, name, depth = 5) {
  if (!fs.existsSync(root) || depth < 0) return null
  for (const row of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, row.name)
    if (row.isFile() && row.name === name) return file
    if (row.isDirectory()) { const found = findFile(file, name, depth - 1); if (found) return found }
  }
  return null
}
async function releaseAsset(name) {
  const r = await remoteJSON('https://api.github.com/repos/NapNeko/NapCatQQ/releases/tags/v4.18.41')
  const asset = r.assets?.find((a) => a.name === name)
  if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')) throw new Error('官方组件没有可验证的下载信息')
  return { url: asset.browser_download_url, sha256: asset.digest.slice(7) }
}

export async function prepareAutoEditor() {
  const file = await download(AUTO_EDITOR.url, `auto-editor-${AUTO_EDITOR.version}.exe`, { sha256: AUTO_EDITOR.sha256, maxBytes: 60000000 })
  fs.mkdirSync(BASE(), { recursive: true })
  fs.copyFileSync(file, path.join(BASE(), 'auto-editor.exe'))
}

async function prepareQQ() {
  if (findNapcat()) return
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('自动准备 QQ 暂支持 Windows x64，其他平台请在高级设置连接自己的 OneBot 网关')
  const stage = path.join(DOWNLOADS(), `qq-stage-${randomUUID()}`)
  fs.mkdirSync(stage, { recursive: true })
  const boot = await releaseAsset('NapCat.Shell.Windows.OneKey.zip')
  await archive(boot.url, 'napcat-onekey-v4.18.41.zip', path.join(stage, 'boot'), boot)
  const shell = await releaseAsset('NapCat.Shell.zip')
  const shellZip = await download(shell.url, 'napcat-shell-v4.18.41.zip', shell)
  const pc = await remoteJSON('https://cdn-go.cn/qq-web/im.qq.com_new/latest/rainbow/pcConfig.json')
  let url = pc.Windows?.ntDownloadX64Url
  if (!url || !['qqdl.gtimg.cn', 'dldir1.qq.com'].includes(new URL(url).hostname)) throw new Error('腾讯官方 QQ 下载地址已变化，请稍后重试')
  if (new URL(url).hostname === 'qqdl.gtimg.cn') {
    const signed = await remoteJSON('https://im.qq.com/http2rpc/gotrpc/noauth/trpc.qqntv2.urlsign.UrlSign/GetSign', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://im.qq.com', Referer: 'https://im.qq.com/index/', 'x-oidb': '{"uint32_command":"0x9b8e","uint32_service_type":1}' }, body: JSON.stringify({ url }) })
    if (signed.retcode !== 0 || !signed.data?.url) throw new Error('腾讯下载签名暂不可用，请稍后重试')
    url = signed.data.url
    if (!['qqdl.gtimg.cn', 'dldir1.qq.com'].includes(new URL(url).hostname)) throw new Error('腾讯下载地址未通过检查')
  }
  const installer = await download(url, 'qq-official.exe')
  const seven = findFile(path.join(stage, 'boot'), '7z.exe')
  if (!seven) throw new Error('官方组件缺少解包工具')
  const listing = await tool(seven, ['l', '-t#', '-sccUTF-8', installer])
  const payloads = [...listing.matchAll(/^.*?\s(\d+)\s+\d+\s+(\d+\.7z)\s*$/gm)].sort((a, b) => Number(b[1]) - Number(a[1]))
  if (!payloads.length) throw new Error('QQ 安装包结构已变化，未运行安装程序')
  const payload = payloads[0][2]
  await tool(seven, ['e', '-t#', '-y', '-bso0', '-bsp0', `-o${path.join(stage, 'carve')}`, installer, payload])
  await tool(seven, ['x', '-y', '-bso0', '-bsp0', `-o${path.join(stage, 'out')}`, path.join(stage, 'carve', payload)])
  const files = path.join(stage, 'out', 'Files'), root = path.join(dataDir(), 'qq-runtime')
  if (!fs.existsSync(path.join(files, 'QQ.exe'))) throw new Error('官方 QQ 解包后缺少 QQ.exe')
  const version = JSON.parse(fs.readFileSync(path.join(files, 'versions', 'config.json'), 'utf8')).curVersion
  if (!/^[\d.]+-\d+$/.test(version)) throw new Error('QQ 版本信息格式已变化')
  const app = path.join(files, 'versions', version, 'resources', 'app'), napcat = path.join(app, 'napcat')
  await unpack(shellZip, napcat)
  const pkg = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')); pkg.main = './napcat/napcat.mjs'
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify(pkg, null, 2))
  for (const name of ['NapCatWinBootMain.exe', 'NapCatWinBootHook.dll']) {
    const file = findFile(path.join(stage, 'boot'), name)
    if (!file) throw new Error('官方 QQ 启动组件不完整')
    fs.copyFileSync(file, path.join(files, name))
  }
  fs.mkdirSync(path.join(napcat, 'config'), { recursive: true })
  fs.writeFileSync(path.join(napcat, 'config', 'webui.json'), JSON.stringify({ host: '127.0.0.1', port: 6099, token: randomBytes(24).toString('hex'), disableWebUI: false }))
  if (fs.existsSync(root)) throw new Error('已有 QQ 组件目录，已保留，请检查后重试')
  fs.renameSync(files, root)
  // Remove only this operation's temporary extraction directory.
  if (path.dirname(stage) === DOWNLOADS() && path.basename(stage).startsWith('qq-stage-')) fs.rmSync(stage, { recursive: true, force: true })
}

async function preparePython() {
  const root = BASE(), python = path.join(root, 'python', 'Scripts', 'python.exe')
  if (!fs.existsSync(python)) {
    const uvDir = await archive('https://github.com/astral-sh/uv/releases/download/0.9.5/uv-x86_64-pc-windows-msvc.zip', 'uv-0.9.5.zip', path.join(root, 'uv'))
    const uv = findFile(uvDir, 'uv.exe')
    if (!uv) throw new Error('Python 环境准备工具未解包成功')
    await tool(uv, ['venv', '--python', '3.11', '--managed-python', path.join(root, 'python')])
  }
  const uv = findFile(path.join(root, 'uv'), 'uv.exe')
  if (!uv) throw new Error('本地 Python 管理工具缺失')
  await tool(uv, ['pip', 'install', '--python', python, 'sherpa-onnx==1.13.4', 'av==18.0.0', 'numpy==2.4.3'])
  setSettings({ perception: { ...getSettings().perception, python } })
}
async function prepareSpeech() {
  await preparePython()
  const name = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17'
  const url = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${name}.tar.bz2`
  const file = await download(url, `${name}.tar.bz2`), models = path.join(BASE(), 'models')
  fs.mkdirSync(models, { recursive: true })
  await tool('tar.exe', ['-xf', file, '-C', models])
  const original = path.join(models, name), dest = path.join(models, 'sensevoice')
  if (!fs.existsSync(dest)) fs.renameSync(original, dest)
}
async function prepareBreeze() {
  if (findBreeze()) return
  throw new Error('Breeze 语音需要 Windows Vulkan 程序包和 .gguf 模型（约 3.4 GB），不会自动下载。请从 https://github.com/HoppouAI/Breeze-TTS-2.cpp/releases 下载后放进插件 runtime/breeze 目录，或在高级设置里填写已安装的 Breeze 目录。')
}
async function prepareOllama(model) {
  const origin = 'http://127.0.0.1:11434'
  let online = false
  try { online = (await fetch(`${origin}/api/version`, { signal: AbortSignal.timeout(1500) })).ok } catch {}
  if (!online) {
    let exe = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe')
    if (!fs.existsSync(exe)) {
      const dir = await archive('https://github.com/ollama/ollama/releases/download/v0.18.0/ollama-windows-amd64.zip', 'ollama-windows-v0.18.0.zip', path.join(BASE(), 'ollama'), { maxBytes: 3000000000 })
      exe = findFile(dir, 'ollama.exe')
    }
    if (!exe) throw new Error('Ollama 未解包成功')
    const child = spawn(exe, ['serve'], { detached: true, windowsHide: true, stdio: 'ignore', env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434' } }); child.on('error', () => {}); child.unref()
    setSettings({ perception: { ...getSettings().perception, ollama: exe } })
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500))
      try { if ((await fetch(`${origin}/api/version`, { signal: AbortSignal.timeout(1000) })).ok) { online = true; break } } catch {}
    }
    if (!online) throw new Error('Ollama 还未启动，请稍后重试')
  }
  const response = await fetch(`${origin}/api/pull`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: true }), signal: AbortSignal.timeout(1800000) })
  if (!response.ok || !response.body) throw new Error('本机模型下载未能开始')
  let buffer = '', success = false
  for await (const chunk of response.body) {
    buffer += Buffer.from(chunk).toString('utf8')
    for (;;) { const at = buffer.indexOf('\n'); if (at < 0) break; const line = buffer.slice(0, at); buffer = buffer.slice(at + 1); if (!line) continue; const row = JSON.parse(line); if (row.error) throw new Error(row.error); if (row.status === 'success') success = true }
  }
  if (!success) throw new Error('本机模型下载尚未完成，请重试')
}
async function prepareEditing() {
  const dir = await archive('https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip', 'ffmpeg-essentials.zip', path.join(DOWNLOADS(), 'ffmpeg'))
  fs.mkdirSync(BASE(), { recursive: true })
  for (const name of ['ffmpeg.exe', 'ffprobe.exe', 'LICENSE']) {
    const file = findFile(dir, name)
    if (!file && name !== 'LICENSE') throw new Error('FFmpeg 官方包缺少可执行文件')
    if (file) fs.copyFileSync(file, path.join(BASE(), name === 'LICENSE' ? 'FFmpeg-LICENSE.txt' : name))
  }
}

export async function componentStatus() {
  const installed = new Set()
  if (fs.existsSync(autoEditorPath())) installed.add('autoCut')
  if (editingStatus().ready) installed.add('editing')
  if (findExecutable() && editingStatus().ready && fs.existsSync(path.resolve(import.meta.dirname, '../assets/anime/anime.umd.min.js'))) installed.add('animation')
  if (findNapcat()) installed.add('qq')
  if (findExecutable()) installed.add('browser')
  const runtimes = [BASE(), path.resolve(import.meta.dirname, '..', 'runtime')]
  for (const root of runtimes) {
    if (fs.existsSync(path.join(root, 'models', 'sensevoice', 'model.int8.onnx'))) installed.add('asr')
    if (fs.existsSync(path.join(root, 'ffmpeg.exe')) && fs.existsSync(path.join(root, 'ffprobe.exe'))) installed.add('editing')
  }
  if (findBreeze()) installed.add('tts')
  try {
    const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1000), redirect: 'error' }), j = await r.json()
    if (j.models?.some((m) => m.name === 'qwen3-vl:2b')) installed.add('vision')
    if (j.models?.some((m) => m.name === 'bge-m3:latest')) installed.add('memory')
  } catch {}
  const cfg = getSettings().components || {}
  return {
    ok: true,
    components: COMPONENTS.map((c) => ({ ...c, ready: installed.has(c.id) })),
    websites: CREATIVE_PLATFORMS,
    selected: Array.isArray(cfg.selected) ? cfg.selected : null,
    // 用户已经手动关过「工具准备」，就别再每次打开都弹。
    dismissed: Boolean(cfg.dismissed),
    job: state.job,
  }
}
export function dismissComponents() {
  setSettings({ components: { ...(getSettings().components || {}), dismissed: true } })
  return { ok: true, dismissed: true }
}
export function startComponents(selected) {
  if (!Array.isArray(selected) || !selected.length || selected.some((id) => !COMPONENTS.some((c) => c.id === id))) return { ok: false, error: '请至少选择一项支持的工具' }
  if (process.platform !== 'win32' || process.arch !== 'x64') return { ok: false, error: '自动准备工具暂支持 Windows x64，其他平台可自行准备对应工具' }
  if (state.job?.running) return { ok: true, job: state.job }
  const ids = [...new Set(selected)], job = state.job = { id: randomUUID(), running: true, selected: ids, current: '', complete: [], errors: [], at: Date.now() }
  setSettings({ components: { ...getSettings().components, selected: ids } })
  void (async () => {
    for (const id of ids) {
      job.current = id
      try {
        if (id === 'qq') await prepareQQ()
        if (id === 'browser' && !findExecutable()) await installBrowser()
        if (id === 'asr') await prepareSpeech()
        if (id === 'tts') await prepareBreeze()
        if (id === 'vision' || id === 'memory') await prepareOllama(id === 'vision' ? 'qwen3-vl:2b' : 'bge-m3:latest')
        if (id === 'editing') await prepareEditing()
        if (id === 'autoCut') {
          if (!editingStatus().ready) await prepareEditing()
          await prepareAutoEditor()
        }
        if (id === 'animation') {
          if (!findExecutable()) await installBrowser()
          if (!editingStatus().ready) await prepareEditing()
        }
        job.complete.push(id)
        setSettings({ components: { ...getSettings().components, installed: [...new Set([...(getSettings().components?.installed || []), id])] } })
      } catch (error) { job.errors.push({ id, error: error.message }) }
    }
    job.running = false; job.current = ''; job.finished = Date.now()
  })()
  return { ok: true, job }
}
