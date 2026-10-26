import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
fs.mkdirSync(path.join(root, 'verification-data'), { recursive: true })
process.env.DSH_MENTOR_DATA = fs.mkdtempSync(path.join(root, 'verification-data', 'qzone-login-'))
const social = await import('../lib/social.js')
const contexts = await import('../lib/browser-context.js')
const context = await contexts.getBrowserContext()
let visits = 0, signedIn = false
await context.route('**/*', (route) => {
  if (new URL(route.request().url()).hostname !== 'user.qzone.qq.com') return route.abort()
  visits++
  const body = signedIn
    ? '<div id="editor" contenteditable="true"></div><button onclick="document.body.dataset.sent=1">发表</button>'
    : '<p>请先扫码登录空间</p><img id="qrlogin_img" style="width:128px;height:128px" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=">'
  return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<html><body>${body}</body></html>` })
})
try {
  const first = await social.qzoneStatus('77777', { open: true })
  assert.equal(first.logged, false); assert.equal(first.needsLogin, true)
  assert.ok(first.shot); const before = visits
  await social.qzoneStatus('77777', { open: true, refresh: true })
  assert.equal(visits, before + 1)
  console.log('PASS Explicit space login reloads the login page instead of reusing an expired QR')
  const draft = social.makePostDraft('只在隔离测试中使用的草稿')
  const blocked = await social.publishQzone(draft.id, '77777')
  assert.equal(blocked.ok, false); assert.equal(blocked.needsLogin, true)
  const retained = social.socialState().posts.find((p) => p.id === draft.id)
  assert.equal(retained.status, 'draft'); assert.equal(retained.text, draft.text)
  assert.match(retained.error, /QQ聊天.*空间/)
  assert.equal(retained.attemptedAt, undefined)
  console.log('PASS Missing space login preserves the draft and records a clear reason without attempting publication')
  await context.addCookies([
    { name: 'p_uin', value: 'o099999', domain: '.qzone.qq.com', path: '/' },
    { name: 'p_skey', value: 'offline-fixture-only', domain: '.qzone.qq.com', path: '/' },
  ])
  assert.equal((await social.publishQzone(draft.id, '77777')).accountMismatch, true)
  console.log('PASS A different space account remains blocked')
  await context.addCookies([{ name: 'p_uin', value: 'o077777', domain: '.qzone.qq.com', path: '/' }])
  signedIn = true
  const page = context.pages().find((p) => p.url().startsWith('https://user.qzone.qq.com/'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  const ready = await social.qzoneStatus('77777')
  assert.equal(ready.logged, true); assert.equal(ready.needsLogin, false)
  assert.equal(await page.locator('#editor').isVisible(), true)
  assert.equal(await page.locator('body').getAttribute('data-sent'), null)
  console.log('PASS Login polling recognizes the correct space account without pressing Publish')
} finally { await contexts.closeContext() }
