import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
fs.mkdirSync(path.join(root, 'verification-data'), { recursive: true })
const scratch = fs.mkdtempSync(path.join(root, 'verification-data', 'upgrade-'))
process.env.DSH_MENTOR_DATA = scratch
process.env.DSH_MENTOR_JEV_URL = 'http://127.0.0.1:9'
process.env.DSH_MENTOR_NAPCAT_DIR = path.join(scratch, 'no-gateway')
process.env.TZ = 'America/New_York'
const memory = await import('../lib/memory.js')
const clock = await import('../lib/clock.js')
const mood = await import('../lib/mood.js')
const store = await import('../lib/store.js')
const social = await import('../lib/social.js')
const perception = await import('../lib/perception.js')
const bridgeLib = await import('../lib/qq.js')
const { timeReply } = await import('../lib/time-reply.js')
let count = 0
async function test(name, run) { await run(); count++; console.log('PASS', name) }

await test('Beijing date and hour survive a different process timezone', () => {
  const p = clock.clockParts(Date.parse('2026-10-25T16:30:00Z'))
  assert.equal(p.date, '2026-10-26'); assert.equal(p.hourNumber, 0)
  assert.match(clock.clockBlock(Date.parse('2026-10-25T16:30:00Z')), /星期一/)
})
await test('Clock questions read the clock without intercepting plans or class times', () => {
  assert.match(timeReply('你那边现在几点？', Date.parse('2026-10-25T16:30:00Z')), /00:30:00/)
  assert.match(timeReply('今天星期几？', Date.parse('2026-10-25T16:30:00Z')), /星期一/)
  assert.match(timeReply('[用户语音转文字：现在几点了？]', Date.parse('2026-10-25T16:30:00Z')), /00:30:00/)
  assert.equal(timeReply('今天几点上课？'), null)
  assert.equal(timeReply('提醒我明天三点开会'), null)
})
await test('Unrelated queries do not retrieve or reinforce memories', () => {
  memory.add({ text: '用户喜欢喝红茶', tags: ['饮食'], weight: 4, diary: false })
  assert.deepEqual(memory.relevant('调试数据库连接失败'), [])
  const before = memory.list({})[0].recalls
  memory.buildMemoryBlock('喜欢红茶'); memory.buildMemoryBlock('喜欢红茶')
  assert.equal(memory.list({})[0].recalls, before)
})
await test('Half life, spaced recall, and explicit corrections', () => {
  const at = Date.now() - 100 * 86400000
  assert.equal(memory.retention({ at, stabilityDays: 100 }, at + 100 * 86400000), 0.5)
  const old = memory.add({ text: '用户住在甲地', kind: 'fact', slot: 'user.city', diary: false })
  const replacement = memory.add({ text: '用户搬到乙地', kind: 'fact', slot: 'user.city', replaces: old.id, evidence: '我已经搬到乙地', diary: false })
  assert.equal(memory.list({}).some((r) => r.id === old.id), false)
  assert.equal(memory.relevant('住在甲地').some((r) => r.id === old.id), false)
  const initial = replacement.stabilityDays
  memory.recall(replacement.id, replacement.at + 10 * 86400000)
  assert.ok(replacement.stabilityDays > initial)
  const strengthened = replacement.stabilityDays
  memory.recall(replacement.id, replacement.at + 10 * 86400000 + 100)
  assert.equal(replacement.stabilityDays, strengthened)
})
await test('Capacity archives old memories while preserving important facts', () => {
  const important = memory.add({ text: '很重要的生日约定', weight: 5, diary: false })
  for (let i = 0; i < 505; i++) memory.add({ text: `普通片段-${i}`, weight: 1, diary: false })
  assert.ok(memory.stats().archived > 0)
  assert.ok(memory.list({ limit: 1000 }).some((r) => r.id === important.id))
  assert.equal(memory.list({ limit: 1000 }).length, 508)
})
await test('The user talking about being insulted is not scolding the fish', () => {
  assert.equal(mood.readTone('别人说我是废物'), null)
  assert.equal(mood.readTone('我真是太笨了'), null)
  assert.equal(mood.readTone('你怎么这么没用'), 'scold')
  assert.equal(mood.readTone('谢谢你，辛苦了'), 'praise')
  const t = Date.parse('2026-10-26T06:00:00Z')
  assert.equal(mood.refresh({ ...mood.defaultMood(t), mood: 'annoyed' }, t + 3600000).mood, 'calm')
})
await test('Media processing refuses remote endpoints', () => {
  assert.throws(() => perception.localEndpoint('http://192.0.2.16:11434'))
  assert.throws(() => perception.localEndpoint('http://example.com'))
  assert.throws(() => perception.localEndpoint('http://127.0.0.1.example.com'))
  assert.equal(perception.localEndpoint('http://127.0.0.1:11434'), 'http://127.0.0.1:11434')
})
await test('QQ image collection includes market stickers and missing-URL images', () => {
  assert.equal(bridgeLib.collectImages([{ type: 'mface', data: { url: 'https://example.com/m.gif', summary: '动画表情' } }])[0].sticker, true)
  assert.equal(bridgeLib.collectImages([{ type: 'image', data: { file: 'gateway-file', sub_type: 1 } }]).length, 1)
})
await test('Qzone drafts are distinct from published posts; duplicate drafts are reused', () => {
  const draft = social.makePostDraft('今天先慢慢来。')
  assert.equal(draft.status, 'draft')
  assert.equal(social.makePostDraft(draft.text).id, draft.id)
  social.updatePost(draft.id, { status: 'uncertain' })
  assert.equal(social.socialState().posts[0].status, 'uncertain')
  assert.equal(social.validDouyinVideo('https://www.douyin.com/video/123456'), true)
  assert.equal(social.validDouyinVideo('https://www.douyin.com.evil.example/video/123456'), false)
})

store.setSettings({ qq: { enabled: false }, autonomy: { enabled: false } })
const listeners = new Set(), disposers = [], sections = [], variables = new Map(), tools = new Map()
let route, modelCalls = 0
const toolContext = {
  tools: { register(def) { assert.ok(def.output && typeof def.output.render === 'function', `Tool ${def.name} must declare an output schema and renderer`); tools.set(def.name, def); return () => {} } },
  get(name) { if (name === 'tools') return toolContext.tools; if (name === 'systemPrompt') return { section: (s) => sections.push(s), variable: (name, fn) => variables.set(name, fn) } },
}
const ctx = {
  tools: toolContext.tools,
  get(name) { if (name === 'agents') return ctx.agents },
  on(event, listener) { if (event === 'agent/assistant-stream') listeners.add(listener); return () => listeners.delete(listener) },
  inject(_deps, fn) { fn({ webServer: { register(entry) { route = entry; return () => {} } }, effect: (fn) => fn() }) },
  effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d) },
  agents: { async create(options) {
    options.setup?.(toolContext)
    const agent = { followup() { modelCalls++; for (const listener of listeners) listener({ agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: '本鲸在。' } } }) }, async whenIdle() {}, cancel() {} }
    return { agent, async dispose() {} }
  } },
}
const plugin = await import('../index.js'); plugin.apply(ctx)
function req(method, url, body) {
  const request = new EventEmitter(); request.method = method; request.url = url; request.headers = {}
  request[Symbol.asyncIterator] = async function* () { if (body !== undefined) yield Buffer.from(JSON.stringify(body)) }
  return request
}
async function call(method, suffix, body) {
  const response = new EventEmitter(); response.body = ''; response.statusCode = 0
  response.writeHead = (code) => { response.statusCode = code; response.headersSent = true }
  response.write = (chunk) => { response.body += chunk; return true }
  response.end = (chunk) => { if (chunk) response.body += chunk }
  await route.handler(req(method, `/dsh-mentor/api/${suffix}`, body), response)
  return response
}
try {
  await test('Plugin loads and exposes Beijing clock without connecting QQ', async () => {
    assert.ok(route); const response = await call('GET', 'clock'); assert.equal(response.statusCode, 200)
    assert.equal(JSON.parse(response.body).timeZone, 'Asia/Shanghai')
  })
  await test('Every tool satisfies the real DSH registration contract and QQ initializes completely', async () => {
    assert.ok(tools.has('sticker'))
    const response = await call('GET', 'qq')
    assert.equal(response.statusCode, 200)
    assert.equal(JSON.parse(response.body).ok, true)
    const health = JSON.parse((await call('GET', 'health')).body)
    assert.equal(health.initializationError, '')
  })
  await test('Real chat setup registers clock, voice, creation and editing capabilities', async () => {
    const session = store.createSession({ title: 'test', mode: 'chat' })
    const response = await call('POST', 'turn', { sessionId: session.id, text: '你好', mode: 'chat' })
    assert.equal(response.statusCode, 200); assert.match(response.body, /本鲸在/)
    assert.ok(sections.some((r) => r.name === 'mentor:clock'))
    assert.match(variables.get('mentor_clock')(), /北京时间/)
    assert.ok(tools.has('companion')); assert.ok(tools.has('mediaEdit'))
    assert.ok(tools.get('browser').parameters.properties.action.enum.includes('download'))
    assert.ok(tools.get('browser').parameters.properties.action.enum.includes('inspect'))
  })
  await test('Public posting remains gated until exact approval or enabled automation', async () => {
    const result = await tools.get('companion').execute({ action: 'qzonePublish', id: 'not-published' })
    assert.equal(result.ok, false); assert.match(result.text, /确认|自动发表/)
  })
  await test('Exact clock replies do not call the chat model', async () => {
    const session = store.createSession({ title: 'clock test', mode: 'chat' }), before = modelCalls
    const response = await call('POST', 'turn', { sessionId: session.id, text: '现在几点了？' })
    assert.match(response.body, /北京时间/); assert.equal(modelCalls, before)
  })
  await test('An uncertain post can return to draft only after checking the space', async () => {
    const post = social.makePostDraft('恢复草稿测试')
    social.updatePost(post.id, { status: 'uncertain' })
    assert.equal((await call('POST', 'social', { action: 'restore-draft', id: post.id })).statusCode, 400)
    const response = await call('POST', 'social', { action: 'restore-draft', id: post.id, checkedUnpublished: true })
    assert.equal(JSON.parse(response.body).post.status, 'draft')
  })
  await test('New creation platforms have official browser-login entries', async () => {
    const response = await call('GET', 'logins'); const data = JSON.parse(response.body)
    for (const id of ['doubao', 'jimeng', 'kling', 'hailuo', 'vidu', 'wan', 'capcut']) assert.ok(data.platforms.some((p) => p.id === id && p.browserLogin && p.url.startsWith('https://')))
  })
} finally { for (const dispose of disposers.reverse()) dispose(); store.flush() }

if (process.argv.includes('--integration')) {
  const browser = await import('../lib/browser.js')
  const contexts = await import('../lib/browser-context.js')
  const logins = await import('../lib/logins.js')
  await test('Browser actions and login use a shared persistent context', async () => {
    logins.setCookie('bilibili', 'SESSDATA=upgrade-test')
    const context = await contexts.getBrowserContext()
    assert.ok((await context.cookies('https://www.bilibili.com')).some((c) => c.name === 'SESSDATA'))
    const html = '<html><title>Fixture</title><textarea id="text"></textarea><button onclick="document.body.dataset.clicked=1">按钮</button></html>'
    await browser.act('open', { url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}`, headless: true })
    await browser.act('fill', { selector: '#text', text: '中文输入' })
    await browser.act('click', { text: '按钮' })
    const value = await browser.act('eval', { script: 'JSON.stringify({text:document.querySelector("#text").value,clicked:document.body.dataset.clicked})' })
    assert.deepEqual(JSON.parse(value.text), { text: '中文输入', clicked: '1' })
    logins.clearCookie('bilibili'); await contexts.clearPlatformCookies('bilibili')
    assert.equal((await context.cookies('https://www.bilibili.com')).some((c) => c.name === 'SESSDATA'), false)
    await browser.act('close')
  })
  await test('Restarting the browser preserves cookie domains and paths', async () => {
    let context = await contexts.getBrowserContext()
    await context.addCookies([
      { name: 'scoped_token', value: 'root-value', domain: '.bilibili.com', path: '/', expires: Math.floor(Date.now() / 1000) + 3600 },
      { name: 'scoped_token', value: 'creator-value', domain: 'member.bilibili.com', path: '/platform', expires: Math.floor(Date.now() / 1000) + 3600 },
    ])
    await contexts.closeContext()
    context = await contexts.getBrowserContext()
    const cookies = await context.cookies()
    assert.ok(cookies.some((c) => c.name === 'scoped_token' && c.value === 'root-value' && c.path === '/'))
    assert.ok(cookies.some((c) => c.name === 'scoped_token' && c.value === 'creator-value' && c.domain === 'member.bilibili.com' && c.path === '/platform'))
    logins.clearCookie('bilibili'); await contexts.clearPlatformCookies('bilibili'); await contexts.closeContext()
  })
  await test('Qzone publishing verifies the feed and rejects the wrong account or retry', async () => {
    const context = await contexts.getBrowserContext()
    await context.addCookies([
      { name: 'p_uin', value: 'o077777', domain: '.qzone.qq.com', path: '/' },
      { name: 'p_skey', value: 'offline-test-only', domain: '.qzone.qq.com', path: '/' },
    ])
    await context.route('https://user.qzone.qq.com/**', (route) => route.fulfill({
      contentType: 'text/html; charset=utf-8', body: `<html><body><div id="editor" contenteditable="true"></div><button onclick="sessionStorage.setItem('post',document.querySelector('#editor').innerText);document.querySelector('#editor').innerText=''">发表</button><div id="feed"></div><script>document.querySelector('#feed').innerText=sessionStorage.getItem('post')||''</script></body></html>`,
    }))
    const draft = social.makePostDraft('只在离线测试页面发表的内容。')
    assert.equal((await social.publishQzone(draft.id, '88888')).accountMismatch, true)
    const result = await social.publishQzone(draft.id, '77777')
    assert.equal(result.ok, true, result.error)
    assert.equal(social.socialState().posts.find((p) => p.id === draft.id).status, 'published')
    assert.equal((await social.publishQzone(draft.id, '77777')).ok, false)
    await contexts.closeContext()
  })
  const media = await import('../lib/media-edit.js')
  await test('Local video editing produces verified clips, concatenation and subtitles', async () => {
    const input = path.join(scratch, 'fixture.mp4')
    const created = spawnSync(path.join(root, 'runtime', 'ffmpeg.exe'), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=15', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', input], { windowsHide: true })
    assert.equal(created.status, 0, String(created.stderr))
    const trim = await media.editMedia({ action: 'trim', file: input, start: 0.4, duration: 0.8 })
    const info = await media.probeMedia(trim.file); assert.ok(Number(info.format.duration) < 1.1)
    const mute = await media.editMedia({ action: 'mute', file: input })
    const concat = await media.editMedia({ action: 'concat', files: [trim.file, mute.file] })
    assert.ok(Number((await media.probeMedia(concat.file)).format.duration) > 2.5)
    const sub = path.join(scratch, '中文字幕.srt'); fs.writeFileSync(sub, '1\n00:00:00,000 --> 00:00:01,500\n本地剪辑测试\n')
    const subtitled = await media.editMedia({ action: 'subtitles', file: input, subtitles: sub }); assert.ok(subtitled.bytes > 0)
  })
}
console.log(`VERIFIED ${count} behavior checks; isolated data: ${scratch}`)
