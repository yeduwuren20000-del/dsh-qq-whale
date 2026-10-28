import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { resolveExecutable } from '../lib/chromium.js'
const root = path.resolve(import.meta.dirname, '..'), output = path.join(root, 'verification-data/social-ui')
fs.mkdirSync(output, { recursive: true })
const requests = [], config = { enabled: true, chance: { shout: .08, reply: .15, proactive: .4, browse: .15, like: .25 }, maxPerDayByKind: { shout: 3, reply: 4, proactive: 10, browse: 4, like: 4 } }
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/react.js' || url.pathname === '/react-dom.js') {
    res.setHeader('Content-Type', 'text/javascript')
    const name = url.pathname === '/react.js' ? 'react/umd/react.development.js' : 'react-dom/umd/react-dom.development.js'
    res.end(fs.readFileSync(path.join(process.env.DSH_TEST_REACT_DIR || path.join(root, 'node_modules'), name))); return
  }
  if (url.pathname === '/client.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(root, 'client/client.js'))); return }
  if (url.pathname.endsWith('/autonomy')) {
    if (req.method === 'POST') {
      let text = ''; for await (const b of req) text += b
      const body = JSON.parse(text); requests.push(body)
      if (body.chance) Object.assign(config.chance, body.chance)
      if (body.maxPerDayByKind) Object.assign(config.maxPerDayByKind, body.maxPerDayByKind)
    }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, config, history: [] })); return
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}*{box-sizing:border-box}</style><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script>window.__ModuleLoader__={load(d){window.design=d.factory(()=>React).__design}};</script><script src="/client.js"></script><script>const h=React.createElement;const style=document.createElement('style');style.textContent=design.CSS;document.head.append(style);const state={qq:{config:{enabled:false},status:{status:'disabled'},shout:{enabled:false,mode:'qzone',autoPublish:false,quiet:[0,8]},recent:[],social:{posts:[]}},loadQQ:async()=>{},saveQQ:async()=>{},testQQ:async()=>{}};ReactDOM.createRoot(document.getElementById('root')).render(h('div',{className:'dm-page dm-shell'},h('div',{className:'dm-panel'},h(design.QQPanel,{state,onClose(){}}))));</script>`)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const browser = await chromium.launch({ executablePath: resolveExecutable(), headless: true })
let checks = 0
try {
  const page = await browser.newPage(), errors = []; page.on('pageerror', (e) => errors.push(e.message))
  for (const width of [1100, 390]) {
    config.chance.like = .25; config.maxPerDayByKind.like = 4
    await page.setViewportSize({ width, height: 820 }); await page.goto(`http://127.0.0.1:${server.address().port}`)
    const row = page.getByText('按兴趣点赞', { exact: true }).locator('..')
    await row.scrollIntoViewIfNeeded()
    const inputs = row.locator('input[type=number]'); assert.equal(await inputs.count(), 2)
    assert.equal(await inputs.first().getAttribute('min'), '0')
    await page.waitForFunction(() => [...document.querySelectorAll('label')].find(l => l.textContent.startsWith('按兴趣点赞'))?.querySelectorAll('input')[1]?.value === '25')
    assert.equal(await inputs.first().inputValue(), '4')
    const before = requests.length
    await inputs.first().fill('0'); await inputs.first().blur()
    await page.waitForFunction(() => !document.querySelector('.dm-qq-notice')?.textContent?.includes('正在'))
    await inputs.last().fill('0'); await inputs.last().blur()
    await page.waitForTimeout(100)
    assert.ok(requests.slice(before).some((r) => r.maxPerDayByKind?.like === 0))
    assert.ok(requests.slice(before).some((r) => r.chance?.like === 0))
    const box = await row.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: path.join(output, `social-${width}.png`) })
    console.log(`PASS Social controls render within ${width}px and accept zero without enabling publication`); checks++
  }
  assert.deepEqual(errors, [])
  console.log(`VERIFIED ${checks} social UI checks; fake local API, no account operations`)
} finally { await browser.close(); server.close() }
