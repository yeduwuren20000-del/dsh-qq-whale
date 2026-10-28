import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
const base = path.resolve(import.meta.dirname, '../verification-data'); fs.mkdirSync(base, { recursive: true })
const dir = fs.mkdtempSync(path.join(base, 'social-personality-')); process.env.DSH_MENTOR_DATA = dir
const store = await import('../lib/store.js')
const proactive = await import('../lib/proactive.js')
const social = await import('../lib/social-behavior.js')
const mood = await import('../lib/mood.js')
const bili = await import('../lib/bili-like.js')
const autonomy = await import('../lib/autonomy.js')
const character = await import('../lib/character.js')
const now = Date.parse('2026-10-28T04:00:00Z')
let checks = 0
async function test(name, fn) {
  for (const name of ['proactive.json', 'social-activity.json', 'autonomy.json', 'character.json']) fs.rmSync(path.join(dir, name), { force: true })
  store.setSettings({ autonomy: { enabled: true, maxPerDayByKind: { proactive: 10, shout: 3, reply: 4, browse: 4, like: 4 } }, proactive: { enabled: true, quiet: [0, 8] }, qq: { shout: { minMin: 180, maxMin: 180 } } })
  await fn(); checks++; console.log('PASS', name)
}
await test('Quiet windows handle midnight, disabled quiet hours and local Beijing time', () => {
  assert.equal(social.quietAt(Date.parse('2026-10-28T16:30Z'), [23, 8]), true)
  assert.equal(social.quietAt(Date.parse('2026-10-28T01:00Z'), [23, 8]), false)
  assert.equal(social.quietAt(now, [0, 0]), false)
})
await test('Recent user messages and recent proactive sends both enforce a real cooldown', () => {
  assert.equal(proactive.proactiveCheck({ now, lastUserAt: now - 5 * 60000 }).ok, false)
  assert.equal(proactive.proactiveCheck({ now, lastUserAt: now - 60 * 60000 }).ok, true)
  proactive.recordProactive({ target: 'fixture-owner', text: '聊一件具体的事', now: now - 20 * 60000 })
  proactive.markUserReply({ target: 'fixture-owner', now: now - 19 * 60000 })
  assert.equal(proactive.proactiveCheck({ now }).ok, false)
})
await test('Another person cannot clear the owner reply wait', () => {
  proactive.recordProactive({ target: 'fixture-owner', text: '一条主动消息', now: now - 2 * 3600000 })
  proactive.markUserReply({ target: 'someone-else', now: now - 3600000 })
  assert.equal(proactive.proactiveState().waiting, true)
  assert.equal(proactive.proactiveCheck({ now }).ok, false)
  proactive.markUserReply({ target: 'fixture-owner', now: now - 50 * 60000 })
  assert.equal(proactive.proactiveState().waiting, false)
  assert.equal(proactive.proactiveCheck({ now }).ok, true)
})
await test('Owner activity is remembered even without an outstanding proactive message', () => {
  proactive.markUserReply({ target: 'fixture-owner', now: now - 1000 })
  assert.equal(proactive.proactiveState().lastUserAt, now - 1000)
  assert.equal(proactive.proactiveCheck({ now }).ok, false)
})
await test('Master pause and zero per-kind caps avoid model work entirely', async () => {
  let calls = 0
  store.setSettings({ autonomy: { enabled: false } })
  assert.equal((await social.withSocialTask('shout', async () => { calls++; return { ok: true } }, { now })).ok, false)
  store.setSettings({ autonomy: { enabled: true, maxPerDayByKind: { like: 0, proactive: 0, browse: 0 } } })
  assert.equal(social.activityCheck('like', { now }).ok, false)
  assert.equal(proactive.proactiveCheck({ now }).ok, false)
  assert.equal(autonomy.canBrowse(now), false)
  assert.equal(calls, 0)
})
await test('Background social jobs run one at a time across different channels', async () => {
  let release, calls = 0
  const first = social.withSocialTask('browse', () => new Promise((resolve) => { release = () => resolve({ ok: true }); calls++ }), { now })
  const second = await social.withSocialTask('shout', async () => { calls++; return { ok: true } }, { now })
  assert.equal(second.ok, false); assert.equal(calls, 1)
  release(); await first
})
await test('The same source is not reconsidered by another model call after a skip', async () => {
  let calls = 0
  const run = () => { calls++; return { ok: true, skipped: true } }
  await social.withSocialTask('shout', run, { now, key: 'same-experience' })
  await social.withSocialTask('shout', run, { now: now + 4 * 3600000, key: 'same-experience' })
  assert.equal(calls, 1)
  await social.withSocialTask('shout', run, { now: now + 4 * 3600000, key: 'new-experience' })
  assert.equal(calls, 2)
})
await test('Existing configured posting intervals remain effective', async () => {
  store.setSettings({ qq: { shout: { minMin: 90, maxMin: 90 } } })
  await social.withSocialTask('shout', async () => ({ ok: true, skipped: true }), { now })
  assert.equal(social.activityCheck('shout', { now: now + 89 * 60000 }).ok, false)
  assert.equal(social.activityCheck('shout', { now: now + 91 * 60000 }).ok, true)
})
await test('Failures back off and still count against the daily work budget', async () => {
  store.setSettings({ autonomy: { enabled: true, maxPerDayByKind: { browse: 2 } } })
  let calls = 0
  const fail = () => { calls++; throw new Error('fixture offline') }
  await social.withSocialTask('browse', fail, { now })
  await social.withSocialTask('browse', fail, { now: now + 60000 })
  assert.equal(calls, 1)
  await social.withSocialTask('browse', fail, { now: now + 31 * 60000 })
  await social.withSocialTask('browse', fail, { now: now + 3 * 3600000 })
  assert.equal(calls, 2)
})
await test('Recent outgoing activity spaces other automatic channels', async () => {
  await social.withSocialTask('proactive', async () => ({ ok: true, sent: true, text: '新见闻' }), { now })
  assert.equal(social.activityCheck('shout', { now: now + 60000 }).ok, false)
  assert.equal(social.activityCheck('shout', { now: now + 11 * 60000 }).ok, true)
})
await test('Near-duplicate posts and obvious private details are filtered locally', () => {
  assert.equal(social.repeatedSocialText('还是喜欢有留白的音乐。', ['还是喜欢，有留白的音乐！']), true)
  assert.equal(social.repeatedSocialText('想试试节奏鲜明的剪辑', ['最近偏爱安静的钢琴']), false)
  assert.equal(social.publicTextAllowed('主人说他的手机号是12345678901'), false)
  assert.equal(social.publicTextAllowed('比起热闹的编曲，我更喜欢留白。'), true)
})
await test('Public browsing prefers an unseen title matching persistent interests', () => {
  const items = [{ title: '运动剪辑', url: 'one' }, { title: '轻音乐编曲', url: 'two' }, { title: '钢琴练习', url: 'three' }]
  assert.equal(social.chooseUnseenCandidate(items, [{ url: 'one' }], '喜欢轻音乐').url, 'two')
  assert.equal(social.chooseUnseenCandidate(items, items), null)
})
await test('Emotion intensity fades smoothly, without changing the input or voice identity', () => {
  const state = mood.observe(mood.defaultMood(now), 'praise', { now }), before = JSON.stringify(state)
  const later = mood.refresh(state, now + 20 * 60000)
  assert.equal(later.mood, 'happy'); assert.ok(later.intensity < state.intensity)
  assert.equal(JSON.stringify(state), before)
  assert.doesNotMatch(mood.buildMoodBlock(state, now), /关系 \d+\/100/)
})
await test('Repeated praise cannot rapidly max familiarity, and group praise does not change it', () => {
  let state = mood.observe(mood.defaultMood(now), 'praise', { now })
  assert.equal(state.affinity, 44)
  for (let i = 1; i <= 10; i++) state = mood.observe(state, 'praise', { now: now + i * 1000 })
  assert.ok(state.affinity < 48)
  assert.equal(mood.observe(mood.defaultMood(now), 'praise', { now, relationship: false }).affinity, 40)
})
await test('Silence does not reduce familiarity and technical corrections are not scolding', () => {
  const state = { ...mood.defaultMood(now), affinity: 90 }
  assert.equal(mood.refresh(state, now + 3 * 86400000).affinity, 90)
  for (const text of ['你这个功能没用', '你回复还是很慢', '你时间不准', '你音色不稳']) assert.equal(mood.readTone(text), null)
  assert.equal(mood.readTone('你太没用了'), 'scold')
})
await test('Routine tool successes do not turn every reply into bragging', () => {
  assert.equal(mood.observe(mood.defaultMood(now), 'tool-ok', { now }).mood, 'calm')
  assert.equal(mood.observe(mood.defaultMood(now), 'tool-ok', { now, meaningful: true }).mood, 'proud')
})
await test('Bilibili like and unlike confirmations deduplicate successful requests only', async () => {
  const folder = path.join(dir, 'logins'); fs.mkdirSync(folder, { recursive: true })
  const cookieFile = path.join(folder, 'logins.json')
  fs.writeFileSync(cookieFile, JSON.stringify({ bilibili: { cookie: 'SESSDATA=fixture-session; bili_jct=fixture-csrf' } }))
  const original = globalThis.fetch; let calls = 0, fail = false
  globalThis.fetch = async (url) => { assert.ok(String(url).startsWith('https://api.bilibili.com/')); calls++; return new Response(JSON.stringify(fail ? { code: -101 } : { code: 0 }), { status: 200 }) }
  try {
    const bvid = 'BV1fixture001'
    await bili.likeVideo({ bvid }); await bili.likeVideo({ bvid }); assert.equal(calls, 1)
    await bili.likeVideo({ bvid, like: false }); await bili.likeVideo({ bvid, like: false }); assert.equal(calls, 2)
    fs.writeFileSync(cookieFile, JSON.stringify({ bilibili: { cookie: 'SESSDATA=another-fixture-session; bili_jct=fixture-csrf' } }))
    await bili.likeVideo({ bvid }); assert.equal(calls, 3)
    fail = true; await assert.rejects(bili.likeVideo({ bvid: 'BV1fixture002' }), /没成功/)
    assert.equal(bili.hasVideoLike('BV1fixture002'), false)
  } finally { globalThis.fetch = original }
})
await test('A later manual interaction can recheck a stale successful-like record', () => {
  social.rememberLike('fixture-key', true, now)
  assert.equal(social.likeState('fixture-key', { now: now + 31 * 60000, maxAge: 30 * 60000 }), undefined)
  assert.equal(social.likeState('fixture-key', { now: now + 31 * 60000 }), true)
})
await test('Qzone successful-like memory avoids opening a real browser again', async () => {
  social.rememberLike('qzone:77777:88888:fixture-feed', true)
  const { likeQzoneFeed } = await import('../lib/social.js')
  const result = await likeQzoneFeed({ ownerUin: '88888', feedKey: 'fixture-feed', oper: 1 }, '77777')
  assert.equal(result.already, true)
})
await test('A taste requires three independent content choices spread over time', () => {
  const taste = { slot: 'music.style', text: '更喜欢留白多一点的编曲' }
  const first = { ok: true, at: now - 7 * 3600000, url: 'https://example.invalid/one', interest: .9, taste }
  assert.equal(character.reinforceTaste({ taste, url: 'https://example.invalid/two', interest: .9, history: [first], now }).promoted, false)
  assert.equal(character.reinforceTaste({ taste, url: 'https://example.invalid/two', interest: .9, history: [first, first], now }).promoted, false)
  const second = { ...first, at: now - 3600000, url: 'https://example.invalid/two' }
  assert.equal(character.reinforceTaste({ taste, url: 'https://example.invalid/three', interest: .9, history: [first, second], now }).promoted, true)
  assert.match(character.buildCharacterBlock(), /留白/)
})
await test('Low interest, rushed repetition and existing tastes cannot be overwritten by browsing', () => {
  const taste = { slot: 'music.style', text: '更喜欢激烈的编曲' }
  const history = ['one', 'two'].map((id) => ({ ok: true, at: now - 60000, url: 'https://example.invalid/' + id, interest: .9, taste }))
  assert.equal(character.reinforceTaste({ taste, url: 'https://example.invalid/three', interest: .4, history, now }).promoted, false)
  assert.equal(character.reinforceTaste({ taste, url: 'https://example.invalid/three', interest: .9, history, now }).promoted, false)
  character.rememberSelf({ slot: taste.slot, text: '我原来有自己的取向', evidence: '主观选择', now: now - 86400000 })
  history.forEach((r) => r.at = now - 8 * 3600000)
  assert.equal(character.reinforceTaste({ taste, url: 'https://example.invalid/three', interest: .9, history, now }).promoted, false)
  assert.match(character.buildCharacterBlock(), /原来有自己的取向/)
})
console.log(`VERIFIED ${checks} social/personality checks; isolated storage, simulated network, no QQ messages or posts`)
