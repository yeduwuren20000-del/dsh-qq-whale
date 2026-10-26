/** 登录 NapCat WebUI：填 token → 点登录 → 打印结果。 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.env.DSH_MENTOR_DATA = path.join(ROOT, 'preview', '.data')
const browser = await import('../lib/browser.js')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const token = process.argv[2] || '74828115937b'

await browser.act('open', { url: 'http://127.0.0.1:6099/webui?token=' + token, headless: true })
await browser.act('viewport', { width: 1000, height: 900 })
await sleep(2500)
await browser.act('fill', { selector: 'input', text: token })
const val = await browser.act('eval', { script: "document.querySelector('input') ? document.querySelector('input').value : 'none'" })
console.log('输入框值:', val.text)

await browser.act('eval', {
  script: "(() => { const btns = [...document.querySelectorAll('button')]; const b = btns.find((x) => x.innerText.trim() === '登录'); if (b) { b.click(); return 'clicked' } return 'no button' })()",
})
await sleep(5000)
const url = await browser.act('eval', { script: 'location.href' })
console.log('URL:', url.text)
const read = await browser.act('read', {})
console.log('页面:', String(read.text).replace(/\s+/g, ' ').slice(0, 220))
await browser.act('close', {})
