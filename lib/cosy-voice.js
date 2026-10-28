/** Local JSONL worker: model and voice references never leave this computer. */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath } from 'node:url'
import { getSettings } from './store.js'

export function cosyConfig() {
  const cfg = getSettings().cosyVoice || {}
  return { python: String(cfg.python || ''), repo: String(cfg.repo || ''), model: String(cfg.model || ''), device: cfg.device === 'cpu' ? 'cpu' : 'auto' }
}

export function createCosyClient({ config = cosyConfig, spawnProcess = spawn, workerFile = fileURLToPath(new URL('./cosy_worker.py', import.meta.url)), idleMs = 15 * 60 * 1000, timeoutMs = 180000 } = {}) {
  let child, activeKey, ready = false, nextId = 0, idle, errors = ''
  const pending = new Map()
  function stop(reason = '本地 CosyVoice 已停止') {
    clearTimeout(idle)
    const previous = child; child = undefined; ready = false
    previous?.kill()
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(reason)) }
    pending.clear()
  }
  function status() {
    const cfg = config()
    const available = [cfg.python, path.join(cfg.repo || '.', 'cosyvoice/cli/cosyvoice.py'), path.join(cfg.model || '.', 'cosyvoice3.yaml'), path.join(cfg.model || '.', 'llm.pt'), path.join(cfg.model || '.', 'flow.pt')].every(file => file && fs.existsSync(file))
    return { available, running: Boolean(child && ready), model: 'CosyVoice 3 · 本机固定音色', localOnly: true }
  }
  function start() {
    const cfg = config(), key = JSON.stringify(cfg)
    if (child && key !== activeKey) stop('语音配置已变化，请重新生成')
    if (child) return
    if (!cfg.python || !cfg.repo || !cfg.model) throw new Error('请先配置本机 CosyVoice 的运行环境、程序和模型目录')
    const sender = spawnProcess(cfg.python, ['-u', workerFile, '--repo', cfg.repo, '--model', cfg.model, '--device', cfg.device], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], cwd: cfg.repo,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', TOKENIZERS_PARALLELISM: 'false' },
    })
    child = sender; activeKey = key; errors = ''
    const decoder = new StringDecoder('utf8'); let buffer = ''
    sender.stdout.on('data', chunk => {
      if (child !== sender) return
      buffer += decoder.write(chunk)
      if (buffer.length > 1024 * 1024) { stop('语音进程返回了异常数据'); return }
      for (;;) {
        const at = buffer.indexOf('\n'); if (at < 0) break
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1)
        let result; try { result = JSON.parse(line) } catch { continue }
        const request = pending.get(result.id); if (!request) continue
        pending.delete(result.id); clearTimeout(request.timer)
        if (result.ok) { ready = true; request.resolve(result) }
        else request.reject(new Error(result.error || '本地语音生成失败'))
      }
    })
    sender.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(-2000) })
    const failed = message => { if (child === sender) stop(message) }
    sender.on('error', error => failed(error.message))
    sender.stdin.on('error', error => failed(error.message))
    sender.on('exit', code => failed(`本地 CosyVoice 已退出（${code}）：${errors.slice(-300)}`))
  }
  async function request(job) {
    clearTimeout(idle); start()
    const sender = child, id = ++nextId
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { if (child === sender) stop('语音生成超时，已释放本次语音进程') }, timeoutMs)
        pending.set(id, { resolve, reject, timer })
        sender.stdin.write(`${JSON.stringify({ ...job, id })}\n`, error => { if (error && child === sender) stop(`语音进程无法接收请求：${error.message}`) })
      })
    } finally {
      if (!pending.size && child === sender) { idle = setTimeout(() => stop(), idleMs); idle.unref?.() }
    }
  }
  async function release() {
    while (pending.size) await new Promise(resolve => setTimeout(resolve, 100))
    stop()
  }
  return { request, stop, status, release }
}

const client = createCosyClient()
export const cosyRequest = client.request
export const stopCosy = client.stop
export const cosyStatus = client.status
export const releaseCosy = client.release
