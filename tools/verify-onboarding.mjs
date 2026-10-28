import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
const root = path.resolve(import.meta.dirname, '..'), output = path.join(root, 'verification-data/onboarding')
fs.mkdirSync(output, { recursive: true })
process.env.DSH_MENTOR_DATA = fs.mkdtempSync(path.join(output, 'fresh-'))
const { resolveExecutable } = await import('../lib/chromium.js')
const { getSetup, getSettings, listSessions } = await import('../lib/store.js')
const { diaryStats } = await import('../lib/diary.js')
const { stats } = await import('../lib/memory.js')
assert.equal(getSetup().done, false); assert.equal(diaryStats().total, 0); assert.equal(stats().total, 0)
assert.equal(listSessions().length, 0); assert.equal(getSettings().qq?.ownerId, undefined)
console.log('PASS fresh installation has no diary, memory, session, QQ or completed setup')
const reactDir = process.env.DSH_TEST_REACT_DIR || path.join(root, 'node_modules')
const server = http.createServer((request, response) => {
  const p = new URL(request.url, 'http://localhost').pathname
  if (['/react.js', '/react-dom.js', '/client.js'].includes(p)) {
    response.setHeader('Content-Type', 'text/javascript')
    response.end(fs.readFileSync(p === '/client.js' ? path.join(root, 'client/client.js') : path.join(reactDir, p === '/react.js' ? 'react/umd/react.development.js' : 'react-dom/umd/react-dom.development.js'))); return
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}*{box-sizing:border-box}</style><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script>window.__ModuleLoader__={load(d){window.design=d.factory(()=>React).__design}}</script><script src="/client.js"></script><script>
  const h=React.createElement;const style=document.createElement('style');style.textContent=design.CSS;document.head.append(style);window.opened=[];
  ReactDOM.createRoot(document.getElementById('root')).render(h('div',{className:'dm-page dm-shell'},h('div',{className:'dm-panel'},location.search.includes('wizard')?h(design.SetupWizard,{state:{presets:[{id:'fixture',label:'测试初始性格',hint:'只用于隔离测试'}]},onPick:async()=>{throw Error('保存失败，请重试')}}):h(design.GettingStarted,{state:{setup:{done:true}},onOpen:p=>opened.push(p),onClose(){}}))));</script>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ executablePath: resolveExecutable(), headless: true })
try {
  const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message))
  for (const width of [1100, 390]) {
    await page.setViewportSize({ width, height: 820 }); await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.getByText('数据保存在本机', { exact: true }).waitFor()
    assert.ok((await page.locator('.dm-dbody').innerText()).includes('升级、重装会继续读取'))
    await page.getByRole('button', { name: '打开 QQ 设置', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => opened), ['qq'])
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: path.join(output, `guide-${width}.png`) })
  }
  await page.goto(`http://127.0.0.1:${server.address().port}/?wizard`)
  await page.getByRole('button', { name: '开始设置', exact: true }).click()
  await page.getByRole('button', { name: '测试初始性格' }).click()
  await page.getByRole('alert').filter({ hasText: '保存失败，请重试' }).waitFor()
  assert.equal(await page.locator('.dm-setup').count(), 1)
  assert.deepEqual(errors, [])
  console.log('PASS responsive guide, local archive explanation, working shortcuts and recoverable setup failure')
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
