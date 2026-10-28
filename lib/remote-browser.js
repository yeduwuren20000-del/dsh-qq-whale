import { spawn } from 'node:child_process'
import net from 'node:net'
import { remoteMediaConfig, remoteMediaRequest } from './remote-media.js'
let browser, tunnel, opening, context, touchedAt = 0
export const remoteBrowserEnabled = () => remoteMediaConfig().enabled && remoteMediaConfig().browser
function port() { return new Promise((resolve, reject) => { const server = net.createServer(); server.on('error', reject); server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve(value)) }) }) }
export async function getRemoteBrowserContext() {
  if (context && browser?.isConnected()) {
    if (Date.now() - touchedAt > 30000) { await remoteMediaRequest({ action: 'browser_start' }); touchedAt = Date.now() }
    return context
  }
  if (opening) return opening
  opening = (async () => {
    tunnel?.kill()
    const remote = await remoteMediaRequest({ action: 'browser_start' }), localPort = await port(), cfg = remoteMediaConfig()
    if (!Number.isInteger(remote.port) || remote.port < 1024 || remote.port > 65535) throw new Error('远端浏览器端口无效')
    const child = tunnel = spawn('ssh', ['-T', '-N', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-L', `127.0.0.1:${localPort}:127.0.0.1:${remote.port}`, cfg.host], { windowsHide: true, stdio: 'ignore' })
    let failed
    child.on('error', error => { failed = error }); child.on('exit', () => { if (tunnel === child) { failed ||= new Error('远端浏览器连接已关闭'); context = undefined } })
    try {
      const endpoint = `http://127.0.0.1:${localPort}`
      for (let i = 0; i < 60; i++) {
        if (failed) throw failed
        try { const result = await fetch(endpoint + '/json/version', { signal: AbortSignal.timeout(500) }); if (result.ok) break } catch {}
        if (i === 59) throw new Error('远端浏览器连接超时')
        await new Promise(resolve => setTimeout(resolve, 150))
      }
      const { chromium } = await import('playwright-core')
      browser = await chromium.connectOverCDP(endpoint)
      context = browser.contexts()[0]; if (!context) throw new Error('远端浏览器未提供持久档案')
      const connected = browser
      connected.on('disconnected', () => { if (browser === connected) { context = undefined; browser = undefined; child.kill() } })
      touchedAt = Date.now(); return context
    } catch (error) { child.kill(); throw error }
  })().finally(() => { opening = undefined })
  return opening
}
export async function closeRemoteBrowser() {
  try { await browser?.close() } finally { browser = context = undefined; tunnel?.kill(); tunnel = undefined; if (remoteBrowserEnabled()) await remoteMediaRequest({ action: 'browser_stop' }) }
}
export async function downloadRemotePage(page, button) {
  const session = await page.context().newCDPSession(page), root = remoteMediaConfig().root
  let guid, name, timer
  try {
    await session.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: root+'/jobs/browser-downloads', eventsEnabled: true })
    const done = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('远端网页下载超时')), 120000)
      session.on('Browser.downloadWillBegin', event => { if (!guid) { guid = event.guid; name = event.suggestedFilename } })
      session.on('Browser.downloadProgress', event => {
        if (event.guid !== guid) return
        if (event.receivedBytes > 48*1024*1024) { void session.send('Browser.cancelDownload', { guid }).catch(() => {}); reject(new Error('远端交付最多48MB，请先分段')) }
        else if (event.state === 'completed') resolve()
        else if (event.state === 'canceled') reject(new Error('网页取消了下载'))
      })
    })
    // Attach failure handling before the click, so no rejected promise is lost.
    await Promise.all([done, button.click()])
    const ext = String(name || '').match(/\.(png|jpe?g|webp|avif|gif|mp4|webm|mov)$/i)?.[0]?.toLowerCase()
    if (!ext) throw new Error('只接收生成的图片或视频')
    return { ...(await remoteMediaRequest({ action: 'browser_download', guid, ext })), suggested: name }
  } finally { clearTimeout(timer); await session.detach().catch(() => {}) }
}
