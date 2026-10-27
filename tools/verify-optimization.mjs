import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const root = path.resolve(import.meta.dirname, '..')
fs.mkdirSync(path.join(root, 'verification-data'), { recursive: true })
process.env.DSH_MENTOR_DATA = fs.mkdtempSync(path.join(root, 'verification-data', 'optimization-'))
const mood = await import('../lib/mood.js')
const memory = await import('../lib/memory.js')
const tokens = await import('../lib/tokens.js')
const { installToolAccess, restrictReflectionTools } = await import('../lib/tool-access.js')
let checks = 0
async function test(name, fn) { await fn(); checks++; console.log('PASS', name) }

await test('Neutral activity no longer keeps a temporary mood alive forever', () => {
  const now = Date.parse('2026-10-27T06:00:00Z')
  let state = mood.observe(mood.defaultMood(now), 'praise', { now })
  for (let i = 1; i < 46; i++) state = mood.observe(state, 'neutral', { now: now + i * 60000 })
  assert.equal(state.mood, 'calm')
  assert.equal(state.emotionAt, now)
  assert.equal(state.affinity, 44)
})
await test('New meaningful events renew emotion, and old saved states migrate safely', () => {
  const now = Date.parse('2026-10-27T06:00:00Z')
  const old = { mood: 'happy', affinity: 92, energy: 80, at: now, turns: 74 }
  assert.equal(mood.refresh(old, now + 46 * 60000).mood, 'calm')
  assert.equal(mood.refresh(old, now + 46 * 60000).affinity, 92)
  let state = mood.observe(old, 'praise', { now: now + 40 * 60000 })
  assert.equal(mood.refresh(state, now + 50 * 60000).mood, 'happy')
})
await test('Unused features, negated praise and quoted insults do not distort affection', () => {
  for (const text of ['你这个功能我还没用过', '你这个不靠谱', '这个不好用', '你说“废物”是什么意思', '我真笨']) assert.equal(mood.readTone(text), null, text)
  assert.equal(mood.readTone('你太没用了'), 'scold')
  assert.equal(mood.readTone('谢谢你，好用'), 'praise')
})
await test('Archived-only memories remain retrievable, without replacing or deleting facts', () => {
  const row = memory.add({ text: '雨天一起喝过乌龙茶', diary: false })
  const data = memory.load(); data.entries = []; data.archive = [row]
  assert.equal(memory.relevant('乌龙茶')[0]?.id, row.id)
  assert.equal(data.archive.length, 1)
})
await test('Memory prompt stays bounded while keeping core memories and intact text', () => {
  const data = memory.load(); data.entries = []; data.archive = []
  for (let i = 0; i < 10; i++) memory.add({ text: `核心偏好${i}，` + '喜欢乌龙茶与雨天。'.repeat(34), kind: 'preference', weight: i > 7 ? 5 : 4, diary: false, mergeSimilar: false })
  const block = memory.buildMemoryBlock('乌龙茶')
  assert.ok(block.length <= 2400)
  assert.match(block, /核心偏好[89]/)
  assert.equal(memory.load().entries.length, 10)
})
await test('Usage aggregates model attempts and cache input without double counting cumulative chunks', () => {
  const meter = tokens.usageMeter()
  const usage = (inputTokens, outputTokens, cacheReadTokens = 0) => meter.frame({ type: 'chunk', chunk: { type: 'usage', usage: { inputTokens, outputTokens, cacheReadTokens } } })
  meter.frame({ type: 'start' }); usage(100, 4); usage(100, 10, 20)
  meter.frame({ type: 'start' }); usage(50, 5)
  assert.deepEqual(meter.total(), { prompt: 170, completion: 15, cacheRead: 20, cacheWrite: 0, requests: 2 })
  meter.record({ mode: 'fixture' })
  const stat = tokens.statsFor().todayStat
  assert.equal(stat.prompt, 170); assert.equal(stat.completion, 15)
  assert.equal(stat.cacheRead, 20); assert.equal(stat.requests, 2)
})
await test('A failed request with reported usage is counted; missing failed usage is not fabricated', () => {
  const before = tokens.statsFor().todayStat.turns
  const meter = tokens.usageMeter()
  meter.frame({ type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 44, outputTokens: 2 } } })
  meter.frame({ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'error' } } })
  meter.record({ mode: 'fixture-failure' })
  tokens.usageMeter().record({ fallbackPrompt: 999 })
  assert.equal(tokens.statsFor().todayStat.turns, before + 1)
})
await test('Legacy estimates remain separate from real usage; lifetime includes older days', () => {
  const file = path.join(process.env.DSH_MENTOR_DATA, 'tokens', 'daily.json')
  const all = JSON.parse(fs.readFileSync(file)); all['2020-01-01'] = { prompt: 10, completion: 2, turns: 1, source: 'estimate', byMode: {} }
  fs.writeFileSync(file, JSON.stringify(all))
  tokens.recordTurn({ dateKey: '2020-01-01', prompt: 100, completion: 5, source: 'host' })
  const stats = tokens.statsFor({ dateKey: '2020-01-01' })
  assert.equal(stats.source, 'mixed')
  assert.equal(stats.todayStat.bySource.estimate.prompt, 10)
  assert.equal(stats.todayStat.bySource.host.prompt, 100)
  assert.ok(stats.lifetime.tokens > stats.total)
})

// Exercise the actual installed host SDK, not a mock of the masking semantics.
const hostRoot = process.env.DSH_HOST_TOOLS || (() => { throw new Error('Set DSH_HOST_TOOLS to the host tools SDK entry for these integration checks') })()
const host = createRequire(hostRoot)
const load = (name) => import(pathToFileURL(host.resolve(name)))
const [{ Context }, { default: ToolRuntime }, { default: SystemPrompt }, { createScope }] = await Promise.all([
  load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-tools'), load('@deepseek-ai/dsh-system-prompt'), load('@deepseek-ai/dsh-scope'),
])
const ctx = new Context()
await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
const definition = (name, description = '') => ({ name, description, parameters: { type: 'object' }, output: { schema: { type: 'object' }, render: () => [] }, execute: () => ({}) })
for (let i = 0; i < 281; i++) ctx.tools.register(definition(`fixture_tool_${i}`, `文件搜索能力 ${i} ` + 'large schema description '.repeat(150)))
const agent = {}, scope = createScope(ctx, agent)
const other = {}, otherScope = createScope(ctx, other)
try {
  const before = Buffer.byteLength(JSON.stringify(ctx.tools.schemas(agent)))
  const stats = installToolAccess(scope.ctx, agent)
  scope.ctx.get('tools').register(definition('browser', '打开网页'))
  scope.ctx.get('tools').register(definition('memory', '读写记忆'))
  const access = ctx.tools.get('toolAccess', agent)
  await test('Real SDK hides inherited schemas only for this agent and keeps its own tools', () => {
    assert.deepEqual(ctx.tools.schemas(agent).map((row) => row.name).sort(), ['browser', 'memory', 'toolAccess'])
    assert.equal(ctx.tools.schemas(other).length, 281)
    assert.ok(stats().schemaBytes < before / 100)
  })
  await test('Discovery lists compact results and enabling exposes exact tool schemas', async () => {
    const result = await access.execute({ action: 'search', query: 'fixture_tool_280' })
    assert.equal(result.tools[0].name, 'fixture_tool_280')
    assert.ok(result.tools[0].description.length <= 200)
    assert.equal((await access.execute({ action: 'enable', names: ['fixture_tool_280'] })).ok, true)
    assert.ok(ctx.tools.schemas(agent).some((row) => row.name === 'fixture_tool_280'))
  })
  await test('Invalid tools cannot broaden access and release removes only inherited capabilities', async () => {
    assert.equal((await access.execute({ action: 'enable', names: ['browser'] })).ok, false)
    assert.equal((await access.execute({ action: 'enable', names: ['made_up'] })).ok, false)
    stats.reset()
    assert.equal(ctx.tools.schemas(agent).length, 3)
    await access.execute({ action: 'enable', names: ['fixture_tool_280'] })
    await access.execute({ action: 'release' })
    assert.equal(ctx.tools.schemas(agent).length, 3)
    assert.equal(ctx.tools.schemas(other).length, 281)
  })
  await test('JSON reflections receive no inherited tools and normal agents remain unchanged', () => {
    restrictReflectionTools(otherScope.ctx)
    assert.equal(ctx.tools.schemas(other).length, 0)
    assert.equal(ctx.tools.schemas().length, 281)
  })
  console.log('TOOL SCHEMA BYTES', JSON.stringify({ before, after: stats().schemaBytes }))
} finally { await scope.dispose(); await otherScope.dispose(); await ctx.dispose?.() }
console.log(`VERIFIED ${checks} optimization checks, isolated data only`)
