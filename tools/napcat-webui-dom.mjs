/** 检查 NapCat WebUI 登录页 DOM 并尝试 Enter 提交。 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.env.DSH_MENTOR_DATA = path.join(ROOT, 'preview', '.data')
const browser = await import('../lib/browser.js')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await browser.act('open', { url: 'http://127.0.0.1:6099/webui', headless: true })
await browser.act('viewport', { width: 1000, height: 900 })
await sleep(2500)

const dom = await browser.act('eval', {
  script: `(() => {
    const inputs = [...document.querySelectorAll('input')].map((i) => ({ type: i.type, placeholder: i.placeholder, id: i.id }))
    const buttons = [...document.querySelectorAll('button, [role=button], a')].map((b) => ({ tag: b.tagName, text: (b.innerText || '').trim().slice(0, 20) }))
    return JSON.stringify({ inputs, buttons: buttons.filter((b) => b.text) })
  })()`,
})
console.log('DOM:', dom.text.slice(0, 800))

await browser.act('fill', { selector: 'input', text: '74828115937b' })
await browser.act('press', { key: 'Enter' })
await sleep(4000)
const url = await browser.act('eval', { script: 'location.href' })
console.log('Enter 后 URL:', url.text)
await browser.act('close', {})
