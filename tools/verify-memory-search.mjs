import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
process.env.DSH_MENTOR_DATA = fs.mkdtempSync(path.join(root, 'verification-data', 'semantic-'))
const memory = await import('../lib/memory.js')
const { memoryScores, memorySearchStatus, primeMemorySearch } = await import('../lib/memory-search.js')
const { getSettings, setSettings } = await import('../lib/store.js')

const allergy = memory.add({ text: '用户对虾蟹过敏，吃海鲜会起疹子', kind: 'fact', weight: 5, diary: false })
memory.add({ text: '项目使用PostgreSQL数据库', kind: 'fact', diary: false })
memory.add({ text: '用户喜欢听钢琴音乐', kind: 'preference', diary: false })
const query = '我能不能吃螃蟹？'
assert.equal(memory.relevant(query).some((r) => r.id === allergy.id), false)
await primeMemorySearch()
const scores = await memoryScores(query)
assert.equal(memorySearchStatus().available, true, memorySearchStatus().error)
assert.ok(scores[allergy.id] >= 0.55, JSON.stringify(scores))
assert.equal(memory.relevant(query, 6, Date.now(), scores)[0].id, allergy.id)
console.log('PASS Local semantic recall connects different wording to the relevant memory')
const vectorFile = path.join(process.env.DSH_MENTOR_DATA, 'memory-vectors.json')
assert.ok(JSON.parse(fs.readFileSync(vectorFile)).entries[allergy.id])
memory.remove(allergy.id)
assert.equal(JSON.parse(fs.readFileSync(vectorFile)).entries[allergy.id], undefined)
console.log('PASS Forgetting a memory also removes its persisted semantic vector')
setSettings({ perception: { ...(getSettings().perception || {}), visionUrl: 'http://127.0.0.1:9' } })
assert.deepEqual(await memoryScores('PostgreSQL数据库'), {})
assert.ok(memory.relevant('PostgreSQL数据库').length)
console.log('PASS Keyword recall remains available when the local model is unavailable')
