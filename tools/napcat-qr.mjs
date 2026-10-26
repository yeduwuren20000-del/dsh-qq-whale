/**
 * 从 NapCat WebUI 里把登录二维码抓出来存成 PNG。
 *   node tools/napcat-qr.mjs [token]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'preview')
process.env.DSH_MENTOR_DATA = path.join(OUT, '.data')

const token = process.argv[2] || '74828115937b'
const browser = await import('../lib/browser.js')

await browser.act('open', { url: `http://127.0.0.1:6099/webui/qq_login?token=${token}`, headless: true })
await browser.act('viewport', { width: 1000, height: 900 })
await browser.act('wait', { ms: 2000 })

const clicked = await browser.act('click', { text: '扫码登录' })
console.log('点击扫码登录:', clicked.ok, String(clicked.text).slice(0, 80))
await browser.act('wait', { ms: 2500 })

const probe = await browser.act('eval', {
  script: `(() => {
    const imgs = [...document.querySelectorAll('img')].map((i) => i.src)
    const canvases = [...document.querySelectorAll('canvas')].map((c) => { try { return c.toDataURL('image/png') } catch (e) { return '' } })
    const qrImg = imgs.find((s) => s.startsWith('data:image') || /qrcode|qr/i.test(s))
    const qrCanvas = canvases.find((s) => s && s.length > 500)
    return JSON.stringify({ qrImg: qrImg || '', qrCanvas: qrCanvas || '', text: document.body.innerText.slice(0, 400) })
  })()`,
})

let payload
try {
  payload = JSON.parse(probe.text)
} catch {
  payload = { text: String(probe.text).slice(0, 400) }
}
console.log('页面文字:', String(payload.text || '').replace(/\s+/g, ' ').slice(0, 300))

fs.mkdirSync(OUT, { recursive: true })
const dataUrl = payload.qrImg || payload.qrCanvas || ''
if (dataUrl.startsWith('data:image')) {
  const base64 = dataUrl.split(',')[1]
  const file = path.join(OUT, 'napcat-qr.png')
  fs.writeFileSync(file, Buffer.from(base64, 'base64'))
  console.log('二维码已保存:', file, Math.round(fs.statSync(file).size / 1024) + 'KB')
} else {
  const shot = await browser.act('shot', {})
  const src = browser.shotPath(shot.shot)
  const file = path.join(OUT, 'napcat-qr.png')
  fs.copyFileSync(src, file)
  console.log('没找到二维码元素，整页截图存到:', file)
}

await browser.act('close', {})
