/** Explicit SSH backend. Personal media is sent only to the configured account. */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { getSettings } from './store.js'
import { readVoiceProfile } from './voice-profile.js'
const children = new Set()
export function remoteMediaConfig() {
  const cfg = getSettings().remoteMedia || {}
  return { enabled: cfg.enabled === true, host: String(cfg.host || ''), root: String(cfg.root || ''), browser: cfg.browser === true }
}
export function stopRemoteMedia() { for (const child of children) child.kill(); children.clear() }
export function remoteVoiceAnchor(voiceId) {
  const profile = readVoiceProfile({ id: voiceId })
  if (!profile) return { voiceId }
  let data
  try { data = fs.readFileSync(profile.file) } catch (error) { if (error.code === 'ENOENT') return { voiceId }; throw error }
  return { voiceId, referenceAudio: data.toString('base64'), referenceSha256: createHash('sha256').update(data).digest('hex'), referenceText: profile.text }
}
let statusCache
export async function remoteMediaStatus() {
  const cfg = remoteMediaConfig(), key = JSON.stringify(cfg)
  if (!cfg.enabled) return { ready: false }
  if (!statusCache || statusCache.key !== key || Date.now() - statusCache.at > 20000) statusCache = { key, at: Date.now(), value: remoteMediaRequest({ action: 'status' }, { timeout: 15000 }).catch(error => ({ ready: false, error: error.message })) }
  return statusCache.value
}
export function remoteMediaRequest(job, { timeout = job.action === 'song' || job.action === 'sing' ? 1100000 : 240000 } = {}) {
  const cfg = remoteMediaConfig()
  if (!cfg.enabled || !/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/.test(cfg.host) || !/^\/[a-zA-Z0-9_./-]+$/.test(cfg.root) || cfg.root.split('/').includes('..')) throw new Error('请先配置自己的 SSH 媒体处理环境')
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', cfg.host, `python3 -u '${cfg.root}/source/resource_worker.py'`], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    children.add(child)
    const chunks = []; let size = 0, errors = '', settled = false
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); children.delete(child); error ? reject(error) : resolve(result) }
    const timer = setTimeout(() => { child.kill(); finish(new Error('远端媒体处理超时，已停止本次请求')) }, timeout)
    child.stdout.on('data', data => { size += data.length; if (size > 96 * 1024 * 1024) { child.kill(); finish(new Error('远端媒体返回内容过大')); return }; chunks.push(data) })
    child.stderr.on('data', data => { errors = (errors + data.toString()).slice(-2000) })
    child.on('error', error => finish(error))
    child.stdin.on('error', error => finish(error))
    child.on('close', code => {
      if (settled) return
      try {
        const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!result.ok) throw new Error(result.error || '远端媒体未完成')
        if (code !== 0) throw new Error(`远端进程退出：${code}`)
        if (result.audio) {
          result.buffer = Buffer.from(result.audio, 'base64'); delete result.audio
          if (createHash('sha256').update(result.buffer).digest('hex') !== result.sha256) throw new Error('远端音频传输校验失败')
        }
        finish(null, result)
      } catch (error) { finish(new Error(errors ? `${error.message}：${errors.slice(-400)}` : error.message)) }
    })
    child.stdin.end(JSON.stringify(job))
  })
}
