import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { chromium } from 'playwright-core'
import { resolveExecutable } from '../lib/chromium.js'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'verification-data', 'scroll-preview')
fs.mkdirSync(output, { recursive: true })
const code = fs.readFileSync(path.join(root, 'client/client.js'), 'utf8')
const rows = (prefix) => Array.from({ length: 55 }, (_, i) => ({ id: `${prefix}-${i}`, role: i % 2 ? 'assistant' : 'user', text: `${prefix} 第${i + 1}条：这是一段用来检查聊天记录位置的内容。`, at: Date.now() + i * 60000 }))
const sessions = { A: rows('A'), B: rows('B') }
let delayA = 0
const json = (res, value) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/react.js' || url.pathname === '/react-dom.js') {
    res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(process.env.DSH_TEST_REACT_DIR || path.join(root, 'node_modules'), url.pathname === '/react.js' ? 'react/umd/react.development.js' : 'react-dom/umd/react-dom.development.js'))); return
  }
  if (url.pathname === '/client.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(code); return }
  if (url.pathname.startsWith('/dsh-mentor/assets/')) {
    const file = path.join(root, 'assets', path.basename(url.pathname))
    if (fs.existsSync(file)) { res.setHeader('Content-Type', file.endsWith('.svg') ? 'image/svg+xml' : 'image/png'); res.end(fs.readFileSync(file)); return }
  }
  if (url.pathname.startsWith('/dsh-mentor/api/')) {
    const endpoint = url.pathname.slice('/dsh-mentor/api/'.length)
    if (endpoint === 'sessions') return json(res, { sessions: Object.entries(sessions).map(([id, messages]) => ({ id, title: `会话${id}`, mode: 'chat', count: messages.length })) })
    if (endpoint.startsWith('sessions/')) {
      const id = endpoint.split('/')[1]
      if (id === 'A' && delayA) await new Promise((r) => setTimeout(r, delayA))
      return json(res, { session: { id, messages: sessions[id] } })
    }
    if (endpoint === 'setup') return json(res, { setup: { done: true } })
    if (endpoint === 'persona') return json(res, { persona: { name: '大肥鱼', dims: {} }, presets: [] })
    if (endpoint === 'health') return json(res, { ok: true, persona: { name: '大肥鱼' }, initializationError: '' })
    if (endpoint === 'components') return json(res, { dismissed: true, components: [], job: null })
    return json(res, { ok: true, entries: [], diary: [], journal: [], stats: {}, mood: { label: '平静', face: '🐟' } })
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}*{box-sizing:border-box}#fixture{height:100%;display:flex;flex-direction:column}.sample{min-height:60px;flex-shrink:0}</style><div id="root"></div>
    <script src="/react.js"></script><script src="/react-dom.js"></script><script>window.__ModuleLoader__={load(d){window.design=d.factory(()=>React).__design}};</script><script src="/client.js"></script><script>
    const h=React.createElement, style=document.createElement('style');style.textContent=design.CSS;document.head.append(style);
    const root=ReactDOM.createRoot(document.getElementById('root'));
    function Fixture(){
      const [state,set]=React.useState({n:60,session:'A',jump:0,mounted:true,hidden:false,growth:0}); window.update=(changes)=>set(s=>({...s,...changes}));
      return h('div',{id:'fixture',className:'dm-shell',style:{display:state.hidden?'none':'flex'}},state.mounted?h(design.MessageViewport,{sessionId:state.session,jump:state.jump},
        Array.from({length:state.n},(_,i)=>h('div',{className:'sample',key:i},'消息 '+i)),h('div',{id:'last',style:{height:state.growth,flexShrink:0}},'最新记录')):null);
    }
    const params=new URLSearchParams(location.search), stats={source:'mixed',todayStat:{prompt:110,completion:7,turns:2,cacheRead:20,bySource:{host:{prompt:100,completion:5},estimate:{prompt:10,completion:2}},byMode:{growth:{prompt:110,completion:7}}},series:[{date:'2026-10-27',prompt:110,completion:7,turns:2}]};
    root.render(params.has('tokens')?h('div',{className:'dm-shell dm-panel'},h(design.TokenDrawer,{stats,onClose(){}})):h(params.has('page')?design.MentorPage:Fixture));</script>`)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const browser = await chromium.launch({ executablePath: resolveExecutable(), headless: true })
const errors = []
let checks = 0
const pass = (name) => { checks++; console.log('PASS', name) }
try {
  const page = await browser.newPage({ viewport: { width: 1120, height: 800 } })
  page.on('pageerror', (e) => errors.push(e.message))
  const base = `http://127.0.0.1:${server.address().port}`
  const bottom = () => page.waitForFunction(() => { const e = document.querySelector('.dm-scroll'); return e && e.scrollHeight - e.scrollTop - e.clientHeight < 2 })
  const update = (value) => page.evaluate((changes) => window.update(changes), value)
  const up = async () => { await page.locator('.dm-scroll').hover(); await page.mouse.wheel(0, -10000); await page.waitForFunction(() => document.querySelector('.dm-scroll').scrollTop < 300); await page.waitForTimeout(80) }
  for (const width of [1120, 390]) {
    await page.setViewportSize({ width, height: 800 }); await page.goto(base); await bottom()
    pass(`Mount opens at latest message (${width}px)`)
    await update({ n: 80, growth: 900 }); await bottom(); pass('Large new messages keep following the bottom')
    await up(); await update({ n: 81, growth: 1300 }); await page.waitForTimeout(100)
    assert.ok(await page.locator('.dm-scroll').evaluate((e) => e.scrollTop < 300)); pass('New content respects manual history reading')
    await update({ jump: 1 }); await bottom(); pass('Explicit reopen of the same session jumps to latest')
    await up(); await update({ session: 'B' }); await bottom(); pass('Switching conversations jumps to latest')
    await up(); await update({ hidden: true }); await page.waitForTimeout(80); await update({ hidden: false }); await bottom(); pass('Re-entering a cached hidden panel jumps to latest')
    await up(); await update({ mounted: false }); await page.waitForTimeout(40); await update({ mounted: true }); await bottom(); pass('Reopening an overlay jumps to latest with unchanged messages')
    await update({ growth: 1900 }); await bottom(); pass('Delayed content resizing keeps the last message visible')
  }
  await page.setViewportSize({ width: 1120, height: 800 }); await page.goto(`${base}/?page`)
  await page.getByText('A 第55条：这是一段用来检查聊天记录位置的内容。', { exact: true }).waitFor(); await bottom()
  await up(); await page.locator('.dm-rail-list').getByText('会话A', { exact: true }).click(); await bottom()
  pass('Real plugin page reopens the selected conversation at its latest message')
  delayA = 450
  await page.locator('.dm-rail-list').getByText('会话A', { exact: true }).click()
  await page.locator('.dm-rail-list').getByText('会话B', { exact: true }).click()
  await page.getByText('B 第55条：这是一段用来检查聊天记录位置的内容。', { exact: true }).waitFor()
  await page.waitForTimeout(550)
  assert.equal(await page.locator('.dm-scroll').getByText('A 第55条：这是一段用来检查聊天记录位置的内容。', { exact: true }).count(), 0)
  pass('A slow previous response cannot overwrite the newly selected conversation')
  await bottom(); await page.screenshot({ path: path.join(output, 'latest-desktop.png') })
  await page.setViewportSize({ width: 390, height: 800 }); await bottom()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: path.join(output, 'latest-narrow.png') })
  await page.goto(`${base}/?tokens`)
  await page.getByText('宿主回传：105 token', { exact: true }).waitFor()
  await page.getByText('本地估算：12 token', { exact: true }).waitFor()
  await page.getByText('性格整理', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: path.join(output, 'tokens-narrow.png') })
  pass('Usage drawer distinguishes actual and estimated totals and labels background work')
  assert.deepEqual(errors, [])
  pass('Real page renders at desktop and narrow widths without errors or horizontal overflow')
  console.log(`VERIFIED ${checks} browser checks; screenshots: ${output}`)
} finally { await browser.close(); server.close() }
