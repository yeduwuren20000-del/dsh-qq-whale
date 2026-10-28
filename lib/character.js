/** Small, persistent self-chosen tastes, kept separate from facts about the user. */
import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from './store.js'

const file = () => path.join(dataDir(), 'character.json')
export function selfPreferences() {
  try { const data = JSON.parse(fs.readFileSync(file(), 'utf8')); return Array.isArray(data.preferences) ? data.preferences.slice(0, 16) : [] }
  catch { return [] }
}
export function rememberSelf({ slot, text, evidence, now = Date.now() } = {}) {
  if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(String(slot || ''))) return { ok: false, text: '喜好需要稳定的主题标识，如 music.style。' }
  if (!String(text || '').trim() || !String(evidence || '').trim()) return { ok: false, text: '写明自己的具体偏好和形成理由；不要编造经历或代替用户表态。' }
  const rows = selfPreferences(), previous = rows.find((r) => r.slot === slot)
  const choice = String(text).trim().slice(0, 160)
  if (previous?.text === choice) return { ok: true, text: '这条偏好已经记着，不重复改写。' }
  if (previous && now - previous.at < 12 * 3600000) return { ok: false, text: '这项喜好刚形成，先保留；不要随一轮情绪或迎合而反复改。' }
  const row = { slot, text: choice, reason: String(evidence).trim().slice(0, 240), at: now, createdAt: previous?.createdAt || now }
  const preferences = [row, ...rows.filter((r) => r.slot !== slot)].slice(0, 16)
  fs.mkdirSync(dataDir(), { recursive: true })
  fs.writeFileSync(file() + '.tmp', JSON.stringify({ version: 1, preferences }, null, 2), 'utf8')
  fs.renameSync(file() + '.tmp', file())
  return { ok: true, text: `保留了你自己的偏好：${row.text}。它不是用户的个人事实，也不是每轮都要提的口头禅。` }
}
export function buildCharacterBlock(query = '') {
  const words = String(query).toLowerCase().match(/[a-z]{3,}|[\u4e00-\u9fff]{2,4}/g) || []
  const rows = selfPreferences().map((r, index) => ({ ...r, score: words.reduce((n, w) => n + Number(`${r.slot} ${r.text}`.toLowerCase().includes(w)), 0), index }))
    .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 3)
  return rows.length ? '你自己留下的喜好（主观取向，不是用户事实，不必硬聊）：\n' + rows.map((r) => `- ${r.text}`).join('\n') : ''
}

/** A tentative taste becomes stable only after repeated independent choices.
 * Reuse browsing history as evidence; no extra reflection or storage service.
 */
export function reinforceTaste({ taste, url, interest, history = [], now = Date.now() } = {}) {
  const slot = String(taste?.slot || ''), text = String(taste?.text || '').trim()
  if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(slot) || !text || text.length > 120 || Number(interest) < .75 || !Number.isFinite(Number(interest))) return { ok: true, promoted: false }
  const canonical = (value) => {
    try { const u = new URL(value); return u.protocol === 'https:' ? u.origin + u.pathname.replace(/\/+$/, '') : '' } catch { return '' }
  }
  const current = canonical(url)
  if (!current) return { ok: true, promoted: false }
  if (selfPreferences().some((r) => r.slot === slot)) return { ok: true, promoted: false }
  const normalized = (s) => String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
  const prior = history.filter((r) => r.ok && Number(r.interest) >= .75 && r.taste?.slot === slot && normalized(r.taste.text) === normalized(text) && canonical(r.url) && canonical(r.url) !== current && Number.isFinite(r.at) && r.at <= now && now - r.at <= 30 * 86400000)
  const independent = [...new Map(prior.map((r) => [canonical(r.url), r])).values()]
  if (independent.length < 2 || now - Math.min(...independent.map((r) => r.at)) < 6 * 3600000) return { ok: true, promoted: false }
  const result = rememberSelf({ slot, text, evidence: `至少三次独立公开内容选择形成的主观偏好：${[...independent.slice(0, 2).map((r) => r.url), url].join('；')}`, now })
  return { ...result, promoted: result.ok }
}
