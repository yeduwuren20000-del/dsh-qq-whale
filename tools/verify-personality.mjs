import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const base = path.resolve(import.meta.dirname, '../verification-data'); fs.mkdirSync(base, { recursive: true })
const dir = fs.mkdtempSync(path.join(base, 'personality-'))
process.env.DSH_MENTOR_DATA = dir
const { rememberSelf, buildCharacterBlock } = await import('../lib/character.js')
const { defaultPersona, buildPersonaBlock } = await import('../lib/persona.js')
const { PERSONA, modeBlock } = await import('../lib/prompt.js')
const { buildGrowthBlock, reloadGrowth } = await import('../lib/growth.js')
let checks = 0
const test = (name, fn) => { fn(); checks++; console.log('PASS', name) }
test('Self tastes require a topic and reason, independent of user memories', () => {
  assert.equal(rememberSelf({ slot: 'music.style', text: '更喜欢留白多一点的配器' }).ok, false)
  assert.equal(rememberSelf({ slot: '../store', text: 'x', evidence: 'y' }).ok, false)
  assert.equal(rememberSelf({ slot: 'music.style', text: '更喜欢留白多一点的配器', evidence: '这是我比较两种表达后做的主观选择', now: 1000 }).ok, true)
  assert.ok(!fs.existsSync(path.join(dir, 'memory.json')))
})
test('A saved taste persists and is not randomized per reply', () => {
  assert.match(buildCharacterBlock('音乐'), /留白/)
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'character.json')))
  assert.equal(saved.preferences.length, 1)
  assert.equal(saved.preferences[0].slot, 'music.style')
  assert.equal(buildCharacterBlock('音乐'), buildCharacterBlock('音乐'))
})
test('One turn cannot invert a recent taste; later experiences can revise it', () => {
  assert.equal(rememberSelf({ slot: 'music.style', text: '完全不喜欢留白', evidence: '新看法', now: 2000 }).ok, false)
  assert.match(buildCharacterBlock(), /更喜欢留白/)
  assert.equal(rememberSelf({ slot: 'music.style', text: '也喜欢层次丰富的弦乐', evidence: '后来比较之后做出的新选择', now: 1000 + 13 * 3600000 }).ok, true)
  assert.match(buildCharacterBlock(), /弦乐/)
})
test('Preference context stays small and does not expose internal evidence logs', () => {
  for (let i = 0; i < 20; i++) rememberSelf({ slot: `creative.topic${i}`, text: '偏好' + '具体的表达方式'.repeat(30), evidence: '主观比较后的理由' })
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'character.json'))).preferences.length, 16)
  assert.ok(buildCharacterBlock().length < 550)
  assert.doesNotMatch(buildCharacterBlock(), /createdAt|preferences|evidence/)
})
test('Core identity keeps boundaries while excluding irrelevant teaching instructions', () => {
  const card = defaultPersona(), full = buildPersonaBlock(card), compact = buildPersonaBlock(card, { compact: true })
  assert.ok(compact.length < full.length)
  assert.match(compact, /身份|边界|避免/)
  assert.doesNotMatch(modeBlock('chat', { scene: null }), /这一轮结束前给出/)
  assert.match(PERSONA, /已有喜好延续|主观取向/)
  console.log('IDENTITY CHARACTERS', JSON.stringify({ full: full.length, compact: compact.length, core: PERSONA.length }))
})
test('Growth context uses saved specifics within a fixed prompt budget', () => {
  fs.writeFileSync(path.join(dir, 'growth.json'), JSON.stringify({ self: { identity: '身份'.repeat(200), voice: '表达'.repeat(200), understandingOfUser: '了解'.repeat(200) }, claims: Array.from({ length: 10 }, () => ({ text: '发现'.repeat(200), confidence: .8, evidenceIds: ['fixture'] })) }))
  reloadGrowth()
  assert.ok(buildGrowthBlock().length < 1000)
  assert.doesNotMatch(buildGrowthBlock(), /fixture|没有预设/)
})
console.log(`VERIFIED ${checks} personality checks; isolated data, no model calls`)
