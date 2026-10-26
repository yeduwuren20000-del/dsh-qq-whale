/**
 * 让 NapCat 重新登录：先试快速登录，不行就把二维码抓下来。
 *   node tools/napcat-login.mjs [token]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'preview')
process.env.DSH_MENTOR_DATA = path.join(OUT, '.data')

const token = process.argv[2] || '74828115937b'
const browser = await import('../lib/browser.js')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await browser.act('open', { url: `http://127.0.0.1:6099/webui/qq_login?token=${token}`, headless: true })
await browser.act('viewport', { width: 1000, height: 900 })
await browser.act('wait', { ms: 1500 })

// 1) 试快速登录
await browser.act('click', { text: '快速登录' })
await sleep(1200)
let text = String((await browser.act('read', {})).text || '').replace(/\s+/g, ' ')
console.log('快速登录页:', text.slice(0, 200))

// 有账号就点登录
if (/2694006689|请选择QQ/.test(text)) {
  const clicked = await browser.act('click', { text: '登录' })
  console.log('点了登录:', clicked.ok)
  await sleep(5000)
  text = String((await browser.act('read', {})).text || '').replace(/\s+/g, ' ')
  console.log('登录后:', text.slice(0, 200))
}

const portUp = await fetch('http://127.0.0.1:3010', { signal: AbortSignal.timeout(1500) })
  .then(() => true)
  .catch(() => false)
console.log('3010 起来了吗:', portUp)

// 2) 没登上就抓二维码
if (!portUp) {
  await browser.act('click', { text: '扫码登录' })
  await sleep(2000)
  const shot = await browser.act('shot', {})
  fs.copyFileSync(browser.shotPath(shot.shot), path.join(OUT, 'napcat-qr.png'))
  console.log('已截图到 preview/napcat-qr.png')
}

await browser.act('close', {})
