/** 抓 NapCat 登录二维码：打开 WebUI → 扫码登录 tab → 等二维码渲染 → 截图。 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'preview')
process.env.DSH_MENTOR_DATA = path.join(OUT, '.data')

const token = process.argv[2] || '74828115937b'
const browser = await import('../lib/browser.js')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 先访问根路径让 WebUI 完成 token 初始化，再进登录页
await browser.act('open', { url: `http://127.0.0.1:6099/webui?token=${token}`, headless: true })
await browser.act('viewport', { width: 1000, height: 900 })
await sleep(2500)
console.log('当前:', (await browser.act('eval', { script: 'location.href' })).text)

await browser.act('click', { text: '扫码登录' })
await sleep(8000)

// 页面文本 + 截图
const text = String((await browser.act('read', {})).text || '').replace(/\s+/g, ' ')
console.log('页面:', text.slice(0, 160))
const shot = await browser.act('shot', {})
fs.copyFileSync(browser.shotPath(shot.shot), path.join(OUT, 'napcat-qr.png'))
console.log('截图: preview/napcat-qr.png')
await browser.act('close', {})
