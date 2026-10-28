/** Local eligibility, novelty and single-flight control; no model calls here. */
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { dataDir, getSettings } from './store.js'
import { dayKey, localHour } from './clock.js'

const file = () => path.join(dataDir(), 'social-activity.json')
let busy = false
export function activityState() {
  try { const data = JSON.parse(fs.readFileSync(file(), 'utf8')); return { history: Array.isArray(data.history) ? data.history : [], likes: data.likes && typeof data.likes === 'object' && !Array.isArray(data.likes) ? data.likes : {} } }
  catch { return { history: [], likes: {} } }
}
function save(data) {
  fs.mkdirSync(dataDir(), { recursive: true })
  fs.writeFileSync(file() + '.tmp', JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(file() + '.tmp', file())
}
export function quietAt(now, quiet = [0, 8]) {
  if (!Array.isArray(quiet) || quiet.length !== 2 || !quiet.every((n) => Number.isFinite(Number(n)) && Number(n) >= 0 && Number(n) <= 24)) quiet = [0, 8]
  const [from, to] = quiet.map(Number), hour = localHour(now)
  return from === to ? false : from < to ? hour >= from && hour < to : hour >= from || hour < to
}
export const sourceKey = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)
export function activityCheck(kind, { now = Date.now(), key = '' } = {}) {
  const cfg = getSettings().autonomy || {}
  if (cfg.enabled === false) return { ok: false, reason: '自主行动已暂停' }
  const quiet = cfg.quiet || (['shout', 'reply'].includes(kind) ? getSettings().qq?.shout?.quiet : kind === 'proactive' ? getSettings().proactive?.quiet : null) || [0, 8]
  if (quietAt(now, quiet)) return { ok: false, reason: '安静时段' }
  const history = activityState().history
  const defaults = { proactive: getSettings().proactive?.softPerDay ?? 10, shout: 3, reply: 4, browse: cfg.maxPerDay ?? 4, like: 4 }
  const n = Number(cfg.maxPerDayByKind?.[kind] ?? defaults[kind] ?? 4)
  const cap = Number.isFinite(n) ? Math.max(0, Math.min(20, Math.floor(n))) : 4
  if (history.filter((r) => r.kind === kind && dayKey(r.at) === dayKey(now)).length >= cap) return { ok: false, reason: '本类行动今天的额度已用完' }
  const previous = history.find((r) => r.kind === kind)
  let minutes = { proactive: 45, shout: 180, reply: 30, browse: 60, like: 30 }[kind] || 30
  const post = getSettings().qq?.shout
  if (kind === 'shout' && previous && Number.isFinite(Number(post?.minMin))) {
    const low = Math.max(5, Math.min(1440, Number(post.minMin)))
    const high = Math.max(low, Math.min(2880, Number(post.maxMin) || low))
    minutes = low + parseInt(sourceKey(previous.id || previous.at).slice(0, 6), 16) / 0xffffff * (high - low)
  }
  if (previous && now - previous.at < (previous.status === 'failed' ? 30 : minutes) * 60000) return { ok: false, reason: '先留一点间隔' }
  if (key && history.some((r) => r.kind === kind && r.key === key && r.status !== 'failed')) return { ok: false, reason: '这份经历已经考虑过，不重复生成' }
  const outgoing = history.find((r) => r.sent)
  if (outgoing && now - outgoing.at < 10 * 60000) return { ok: false, reason: '刚有过一次主动互动' }
  return { ok: true }
}
export async function withSocialTask(kind, task, options = {}) {
  const check = activityCheck(kind, options)
  if (!check.ok) return check
  if (busy) return { ok: false, reason: '另一个自主行动正在进行' }
  busy = true
  const id = randomUUID(), at = options.now ?? Date.now()
  try {
    const data = activityState()
    data.history.unshift({ id, at, kind, key: options.key || '', status: 'pending' })
    data.history = data.history.slice(0, 160); save(data)
    const result = await task()
    const current = activityState(), row = current.history.find((r) => r.id === id)
    if (row) Object.assign(row, { status: result?.ok === false ? 'failed' : 'done', sent: Boolean(result?.sent), text: String(result?.text || result?.reason || result?.error || '').slice(0, 180) })
    save(current)
    return result
  } catch (error) {
    const data = activityState(), row = data.history.find((r) => r.id === id)
    if (row) { row.status = 'failed'; row.text = String(error.message || error).slice(0, 180); save(data) }
    return { ok: false, error: String(error.message || error) }
  } finally { busy = false }
}
export function recordAutoLike(key, { now = Date.now() } = {}) {
  const data = activityState()
  data.history.unshift({ id: randomUUID(), at: now, kind: 'like', key, status: 'done', sent: true })
  data.history = data.history.slice(0, 160); save(data)
}
export function likeState(key, { now = Date.now(), maxAge = Infinity } = {}) {
  const row = activityState().likes[key]
  return row && now - row.at <= maxAge ? row.liked : undefined
}
export function rememberLike(key, liked, now = Date.now()) {
  const data = activityState(); data.likes[key] = { liked: Boolean(liked), at: now }
  data.likes = Object.fromEntries(Object.entries(data.likes).sort((a, b) => b[1].at - a[1].at).slice(0, 300)); save(data)
}
const normalize = (s) => String(s || '').toLowerCase().replace(/\[[^\]]*\]|[\s\p{P}\p{S}]/gu, '')
export function repeatedSocialText(text, history = []) {
  const value = normalize(text)
  if (!value) return true
  const grams = (s) => new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)))
  const a = grams(value)
  return history.some((r) => {
    const other = normalize(typeof r === 'string' ? r : r.text)
    if (!other) return false
    if (value === other) return true
    const b = grams(other), common = [...a].filter((g) => b.has(g)).length
    return a.size && b.size && 2 * common / (a.size + b.size) >= .72
  })
}
export function publicTextAllowed(text) {
  const value = String(text || '').trim()
  return Boolean(value) && !/(?:\b\d{7,}\b|身份证|手机号|家庭住址|私聊记录|聊天记录|用户(?:说|的|叫)|主人(?:说|的|叫)|我和(?:用户|主人)|他的(?:课表|行程|账号)|她的(?:课表|行程|账号))/.test(value)
}
export function chooseUnseenCandidate(candidates, history = [], interests = '') {
  const seen = new Set(history.filter((r) => r.url).map((r) => r.url))
  const tokens = String(interests).toLowerCase().match(/[a-z]{3,}|[\u4e00-\u9fff]{2}/g) || []
  return candidates.filter((r) => !seen.has(r.url)).map((r, index) => ({ r, index, score: tokens.reduce((n, t) => n + Number(String(r.title).toLowerCase().includes(t)), 0) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.r || null
}
