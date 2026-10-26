/** Respect the user's download proxy. Never used for personal media or localhost. */
import { execFileSync } from 'node:child_process'
import { fetch, ProxyAgent } from 'undici'

let dispatcher, initialized = false
function downloadProxy() {
  if (initialized) return dispatcher
  initialized = true
  let proxy = process.env.DSH_QQ_WHALE_DOWNLOAD_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
  if (!proxy && process.platform === 'win32') {
    try {
      const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', String.raw`$p=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'; @{enabled=[bool]$p.ProxyEnable;server=$p.ProxyServer}|ConvertTo-Json -Compress`], { windowsHide: true, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
      const settings = JSON.parse(output.trim())
      if (settings.enabled && settings.server) {
        const parts = String(settings.server).split(';'), https = parts.find((p) => p.startsWith('https='))
        proxy = https ? https.slice(6) : parts.find((p) => !p.includes('='))
      }
    } catch { /* An unavailable registry leaves direct HTTPS available. */ }
  }
  if (proxy) {
    const url = new URL(proxy.includes('://') ? proxy : `http://${proxy}`)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('工具下载代理须为 HTTP 或 HTTPS 地址')
    dispatcher = new ProxyAgent(url.href)
  }
  return dispatcher
}
export async function componentFetch(url, options = {}) {
  const target = new URL(url)
  if (target.protocol !== 'https:') throw new Error('工具只通过 HTTPS 从官方来源下载')
  const proxy = downloadProxy()
  let lastError
  for (let i = 0; i < 3; i++) {
    try { return await fetch(url, { ...options, ...(proxy ? { dispatcher: proxy } : {}) }) }
    catch (error) { lastError = error; if (options.signal?.aborted) break; if (i < 2) await new Promise((r) => setTimeout(r, 600 * (i + 1))) }
  }
  throw new Error(`连接官方下载地址失败：${lastError?.cause?.code || lastError?.message || '请检查网络后重试'}`)
}
