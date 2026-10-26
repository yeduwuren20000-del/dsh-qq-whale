import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { dataDir } from './store.js'
import { localEndpoint, perceptionConfig } from './perception.js'
import { list, relevant } from './memory.js'

const queries = new Map()
let state = { available: false, indexed: 0, error: '' }
let warming
const file = () => path.join(dataDir(), 'memory-vectors.json')
const digest = (text) => createHash('sha256').update(text).digest('hex')
const document = (row) => `${row.text} ${(row.tags || []).join(' ')}`.trim()
export function cosine(a, b) {
  if (!Array.isArray(a) || a.length !== b?.length || !a.length) return 0
  let dot = 0, aa = 0, bb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2 }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0
}
export function memorySearchStatus() { return { ...state, localOnly: true } }

/** Warm an already installed model with a fixed public string, outside chat latency. */
export function primeMemorySearch() {
  const cfg = perceptionConfig()
  if (!cfg.enabled || cfg.memorySemantic === false) return Promise.resolve()
  if (warming) return warming
  warming = (async () => {
    try {
      const endpoint = localEndpoint(cfg.visionUrl), model = cfg.memoryModel || 'bge-m3:latest'
      const tags = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(2000), redirect: 'error' }).then((r) => r.json())
      if (!tags.models?.some((m) => m.name === model || m.name === `${model}:latest`)) return
      const response = await fetch(`${endpoint}/api/embed`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(45000), redirect: 'error',
        body: JSON.stringify({ model, input: ['记忆检索'], keep_alive: '5m' }),
      })
      if (!response.ok) throw new Error('本地语义模型暂未就绪')
      await response.json()
    } catch (error) { state.error = error.message }
  })().finally(() => { warming = undefined })
  return warming
}

/** Keyword retrieval remains available if the local semantic model is unavailable. */
export async function memoryScores(query) {
  const cfg = perceptionConfig(), text = String(query || '').trim().slice(0, 1800)
  const rows = list({ limit: 2000 })
  if (!cfg.enabled || cfg.memorySemantic === false || warming || !rows.length || text.length < 3 || /^(你好|谢谢|好的|在吗)[！!。?？]*$/.test(text)) return {}
  const model = cfg.memoryModel || 'bge-m3:latest'
  let cache = { model, entries: {} }
  try {
    const loaded = JSON.parse(fs.readFileSync(file(), 'utf8'))
    if (loaded.model === model && loaded.entries && typeof loaded.entries === 'object') cache = loaded
  } catch { /* A new memory store has no vector cache. */ }
  const ranked = [...relevant(text, 20), ...rows.filter((r) => r.weight >= 4), ...rows]
  const unique = [...new Map(ranked.map((row) => [row.id, row])).values()]
  const missing = unique.filter((row) => cache.entries[row.id]?.hash !== digest(document(row))).slice(0, 24)
  const queryKey = `${model}:${digest(text)}`
  let vector = queries.get(queryKey)
  const input = [...(vector ? [] : [text]), ...missing.map(document)]
  try {
    if (input.length) {
      const response = await fetch(`${localEndpoint(cfg.visionUrl)}/api/embed`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(4000), redirect: 'error',
        body: JSON.stringify({ model, input, truncate: true, keep_alive: '5m' }),
      })
      const result = await response.json()
      if (!response.ok || !Array.isArray(result.embeddings) || result.embeddings.length !== input.length || !result.embeddings.every((v) => Array.isArray(v) && v.length && v.every(Number.isFinite))) throw new Error(result.error || '本地语义检索暂不可用')
      const vectors = [...result.embeddings]
      if (!vector) { vector = vectors.shift(); queries.set(queryKey, vector); if (queries.size > 60) queries.delete(queries.keys().next().value) }
      missing.forEach((row, i) => { cache.entries[row.id] = { hash: digest(document(row)), vector: vectors[i] } })
    }
    const scores = {}
    for (const row of rows) {
      const entry = cache.entries[row.id]
      if (!entry || entry.hash !== digest(document(row))) continue
      const score = cosine(vector, entry.vector)
      if (score >= 0.55) scores[row.id] = score
    }
    // A deletion during model inference must not put a forgotten entry back.
    const ids = new Set(list({ limit: 2000 }).map((r) => r.id))
    for (const id of Object.keys(cache.entries)) if (!ids.has(id)) delete cache.entries[id]
    if (missing.length) {
      try {
        fs.mkdirSync(dataDir(), { recursive: true })
        const tmp = `${file()}.tmp`; fs.writeFileSync(tmp, JSON.stringify(cache)); fs.renameSync(tmp, file())
      } catch { /* Retrieval still works if the optional cache cannot be saved. */ }
    }
    state = { available: true, indexed: Object.keys(cache.entries).length, error: '' }
    return scores
  } catch (error) { state = { available: false, indexed: Object.keys(cache.entries).length, error: error.message }; return {} }
}
