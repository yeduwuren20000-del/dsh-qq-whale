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
const tokens = await import('../lib/tokens.js')
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
  store.setSettings({ memory: { maxEntries: 500 } })
  const important = memory.add({ text: '很重要的生日约定', weight: 5, diary: false })
  for (let i = 0; i < 505; i++) memory.add({ text: `普通片段-${i}`, weight: 1, diary: false })
  assert.ok(memory.stats().archived > 0)
  assert.ok(memory.list({ limit: 1000 }).some((r) => r.id === important.id))
  assert.equal(memory.list({ limit: 1000 }).length, 508)
  store.setSettings({ memory: { maxEntries: memory.MAX_ENTRIES } })
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
  assert.throws(() => perception.localEndpoint('http://10.0.0.1:11434'))
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
await test('Comment replies clamp the daily cap and reject empty input before touching the browser', async () => {
  store.setSettings({ qq: { enabled: false, shout: { replyComments: { enabled: true, maxPerDay: 2 } } } })
  assert.equal(social.replyConfig().maxPerDay, 2)
  assert.equal(social.replyQuota(), 2)
  await assert.rejects(() => social.replyQzoneComment({ postId: '', commentId: '1', text: '嗯' }, '77777'), /缺少/)
  await assert.rejects(() => social.replyQzoneComment({ postId: 'p', commentId: '1', text: '   ' }, '77777'), /不能为空/)
  assert.equal(social.replyQuota(), 2)
})

store.setSettings({ qq: { enabled: false }, autonomy: { enabled: false } })
const listeners = new Set(), errorListeners = new Set(), createdOptions = [], disposers = [], sections = [], contexts = [], variables = new Map(), tools = new Map()
let route, modelCalls = 0, behavior = 'normal'
const nativeHandover = { name: 'handover', output: { schema: {}, render() {} } }
const globalTools = new Map([['handover', nativeHandover]])
const toolContext = {
  tools: { schemas() { return [...tools.values()].map(({name,description,parameters}) => ({name,description,parameters})) }, restrict() { return () => {} }, register(def) { assert.ok(def.output && typeof def.output.render === 'function', `Tool ${def.name} must declare an output schema and renderer`); tools.set(def.name, def); return () => { if (tools.get(def.name) === def) tools.delete(def.name) } } },
  get(name) { if (name === 'tools') return toolContext.tools; if (name === 'systemPrompt') return { context: (s) => contexts.push(s), section: (s) => sections.push(s), variable: (name, fn) => variables.set(name, fn) } },
}
const ctx = {
  tools: { register(def) { assert.ok(!globalTools.has(def.name), `Duplicate global tool: ${def.name}`); globalTools.set(def.name, def); return () => globalTools.delete(def.name) } },
  get(name) { if (name === 'agents') return ctx.agents },
  on(event, listener) { const set = event === 'agent/error' ? errorListeners : listeners; set.add(listener); return () => set.delete(listener) },
  inject(_deps, fn) { fn({ webServer: { register(entry) { route = entry; return () => {} } }, effect: (fn) => fn() }) },
  effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d) },
  agents: { async create(options) {
    createdOptions.push(options)
    const agent = { messages: [{ role: 'assistant', content: '上一轮旧回答，不能当作当前回复' }], followup() {
      modelCalls++
      if (behavior === 'model-error') {
        for (const listener of listeners) listener({ agent, frame: { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'error', failure: { message: '410: ModelDeprecated fixture-model' } } } } })
        return
      }
      if (behavior === 'retried') {
        for (const listener of listeners) {
          listener({ agent, frame: { type: 'start' } })
          listener({ agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: '失败尝试的残片' } } })
          listener({ agent, frame: { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'error', failure: { message: '429: fixture capacity retry' } } } } })
          listener({ agent, frame: { type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 3, cacheReadTokens: 20 } } } })
          listener({ agent, frame: { type: 'end' } })
          listener({ agent, frame: { type: 'start' } })
          listener({ agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: '重试后的有效回复' } } })
          listener({ agent, frame: { type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 200, outputTokens: 7 } } } })
          listener({ agent, frame: { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'stop' } } } })
        }
        return
      }
      if (behavior === 'agent-error') { for (const listener of errorListeners) listener({ agent, error: new Error('fixture provider is unavailable') }); return }
      if (behavior === 'empty') return
      const reply = () => { for (const listener of listeners) listener({ agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: '本鲸在。' } } }) }
      return behavior === 'async-followup' ? Promise.resolve().then(reply) : reply()
    }, async whenIdle() {}, cancel() {} }
    options.setup?.(toolContext, agent)
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
    assert.ok(globalTools.has('mentor'))
    assert.equal(globalTools.get('handover'), nativeHandover)
    assert.ok(!globalTools.has('memory')); assert.ok(!globalTools.has('sticker'))
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
    assert.ok(contexts.some((r) => r.name === 'mentor:clock'))
    assert.match(contexts.find((r) => r.name === 'mentor:clock').text(), /北京时间/)
    assert.ok(tools.has('companion')); assert.ok(!tools.has('mediaEdit')); assert.ok(!tools.has('animation'))
    assert.ok(tools.size <= 4)
    console.log('CHAT SURFACE', JSON.stringify({ tools: tools.size, schemaBytes: Buffer.byteLength(JSON.stringify(toolContext.tools.schemas())), promptCharacters: sections.reduce((n,r)=>n+String(r.text||'').length,0)+contexts.reduce((n,r)=>n+String(r.text?.()||'').length,0) }))
    const enabled = await tools.get('toolAccess').execute({ action: 'enable', names: ['mediaEdit', 'animation', 'browser', 'sticker'] })
    assert.equal(enabled.ok, true); assert.ok(tools.has('mediaEdit')); assert.ok(tools.has('animation'))
    assert.ok(tools.has('handover')); assert.ok(tools.has('memory')); assert.ok(tools.has('sticker'))
    assert.equal(globalTools.get('handover'), nativeHandover)
    assert.ok(tools.get('browser').parameters.properties.action.enum.includes('download'))
    assert.ok(tools.get('browser').parameters.properties.action.enum.includes('inspect'))
  })
  await test('Recent user context and mood update without recreating the chat driver', async () => {
    const session = store.createSession({ title: 'context fixture', mode: 'chat' })
    await call('POST', 'turn', { sessionId: session.id, text: '我很困，但还得上课', mode: 'chat' })
    const context = contexts.findLast((row) => row.name === 'mentor:conversation')
    assert.match(context.text(), /别一律催睡/)
    const state = contexts.findLast((row) => row.name === 'mentor:mood')
    store.setMood(mood.observe(store.getMood(), 'praise'))
    assert.match(state.text(), /开心/)
    await call('POST', 'turn', { sessionId: session.id, text: '我现在不困了，已经好了', mode: 'chat' })
    assert.equal(context.text(), '')
  })
  await test('A retired model reports an SSE error instead of returning an old reply or fabricated greeting', async () => {
    const session = store.createSession({ title: 'failure fixture', mode: 'chat' })
    behavior = 'model-error'
    const response = await call('POST', 'turn', { sessionId: session.id, text: 'fixture question', mode: 'chat' })
    assert.match(response.body, /event: error/); assert.match(response.body, /ModelDeprecated/)
    assert.doesNotMatch(response.body, /event: done|上一轮旧回答|嗯，我在/)
    assert.ok(!store.getSession(session.id).messages.some((m) => m.role === 'mentor'))
    behavior = 'normal'
    const recovered = await call('POST', 'turn', { sessionId: session.id, text: 'fixture retry', mode: 'chat' })
    assert.match(recovered.body, /event: done/); assert.match(recovered.body, /本鲸在/)
  })
  await test('An automatic retry that succeeds clears the temporary capacity error', async () => {
    const session = store.createSession({ title: 'retry fixture', mode: 'chat' })
    const beforeUsage = tokens.statsFor().todayStat
    behavior = 'retried'
    const response = await call('POST', 'turn', { sessionId: session.id, text: 'fixture retry', mode: 'chat' })
    assert.match(response.body, /event: done/); assert.match(response.body, /重试后的有效回复/)
    assert.doesNotMatch(response.body, /event: error/)
    assert.equal(store.getSession(session.id).messages.at(-1).text, '重试后的有效回复')
    const afterUsage = tokens.statsFor().todayStat
    assert.equal(afterUsage.prompt - beforeUsage.prompt, 320)
    assert.equal(afterUsage.completion - beforeUsage.completion, 10)
    assert.equal(afterUsage.source, 'mixed')
    behavior = 'normal'
  })
  await test('Host agent errors and empty output cannot silently succeed', async () => {
    const session = store.createSession({ title: 'empty fixture', mode: 'chat' })
    for (const kind of ['agent-error', 'empty']) {
      behavior = kind
      const response = await call('POST', 'turn', { sessionId: session.id, text: 'fixture question', mode: 'chat' })
      assert.match(response.body, /event: error/); assert.doesNotMatch(response.body, /event: done|上一轮旧回答/)
    }
    behavior = 'normal'
  })
  await test('Changing the companion model recreates its driver and accepts asynchronous followup', async () => {
    const session = store.createSession({ title: 'model fixture', mode: 'chat' })
    store.setSettings({ chatModel: { provider: 'fixture-provider', model: 'model-one' } })
    await call('POST', 'turn', { sessionId: session.id, text: 'fixture one', mode: 'chat' })
    assert.equal(createdOptions.at(-1).agentOptions.model, 'model-one')
    const before = createdOptions.length
    store.setSettings({ chatModel: { provider: 'fixture-provider', model: 'model-two' } })
    behavior = 'async-followup'
    const response = await call('POST', 'turn', { sessionId: session.id, text: 'fixture two', mode: 'chat' })
    assert.equal(createdOptions.length, before + 1)
    assert.equal(createdOptions.at(-1).agentOptions.model, 'model-two')
    assert.match(response.body, /event: done/); assert.match(response.body, /本鲸在/)
    behavior = 'normal'
  })
  await test('Public posting remains gated until exact approval or enabled automation', async () => {
    const result = await tools.get('companion').execute({ action: 'qzonePublish', id: 'not-published' })
    assert.equal(result.ok, false); assert.match(result.text, /确认|自动发表/)
  })
  await test('Autonomy settings accept zero and paused actions perform no model work', async () => {
    const before = modelCalls
    const updated = JSON.parse((await call('POST', 'autonomy', { enabled: false, chance: { like: 0 }, maxPerDayByKind: { like: 0 } })).body)
    assert.equal(updated.config.chance.like, 0); assert.equal(updated.config.maxPerDayByKind.like, 0)
    const paused = JSON.parse((await call('POST', 'autonomy', { action: 'now' })).body)
    assert.equal(paused.ok, false)
    assert.equal(modelCalls, before)
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
console.log('COMPANION TOOL SCHEMAS', JSON.stringify({count: tools.size, bytes: Buffer.byteLength(JSON.stringify(toolContext.tools.schemas()))}))
console.log(`VERIFIED ${count} behavior checks; isolated data: ${scratch}`)
