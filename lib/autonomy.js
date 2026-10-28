import fs from './state-fs.js'
import path from 'node:path'
import { dataDir, getSettings } from './store.js'
import { dayKey } from './clock.js'
import { getBrowserContext, reservePage } from './browser-context.js'
import { fetchMedia } from './media.js'
import { activityCheck } from './social-behavior.js'

export function autonomyConfig() {
  const raw = getSettings().autonomy || {}
  return { enabled: true, maxPerDay: 4, ...raw,
    chance: { shout: getSettings().qq?.shout?.chance ?? .08, reply: .15, proactive: getSettings().proactive?.chance ?? .4, browse: .15, like: .25, ...(raw.chance && typeof raw.chance === 'object' ? raw.chance : typeof raw.chance === 'number' ? { browse: raw.chance } : {}) },
    maxPerDayByKind: { shout: 3, reply: 4, proactive: getSettings().proactive?.softPerDay ?? 10, browse: raw.maxPerDay ?? 4, like: 4, ...(raw.maxPerDayByKind || {}) },
  }
}
export function autonomyState() {
  try { return { history: [], ...(JSON.parse(fs.readFileSync(path.join(dataDir(), 'autonomy.json'), 'utf8'))) } }
  catch { return { history: [] } }
}
export function recordAutonomy(entry) {
  const data = autonomyState(); data.history.unshift({ at: Date.now(), ...entry }); data.history = data.history.slice(0, 60)
  fs.mkdirSync(dataDir(), { recursive: true })
  const file = path.join(dataDir(), 'autonomy.json'), tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2)); fs.renameSync(tmp, file)
}
export function canBrowse(now = Date.now()) {
  const cfg = autonomyConfig(), history = autonomyState().history
  if (!activityCheck('browse', { now }).ok) return false
  if (!cfg.enabled) return false
  const value = Number(cfg.maxPerDayByKind?.browse ?? cfg.maxPerDay)
  const cap = Number.isFinite(value) ? Math.max(0, Math.min(20, value)) : 4
  const today = history.filter((r) => dayKey(r.at) === dayKey(now))
  if (today.length >= cap) return false
  return true
}

/** Public browsing never clicks a social action or visits private inboxes. */
export async function browsePublicCandidates() {
  const context = await getBrowserContext()
  const page = reservePage(await context.newPage())
  try {
    await page.goto('https://www.bilibili.com/v/popular/all', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.locator('a[href*="/video/"]').first().waitFor({ timeout: 12000 }).catch(() => {})
    const candidates = await page.locator('a[href*="/video/"]').evaluateAll((links) => links.map((a) => ({ title: (a.getAttribute('title') || a.innerText || '').trim().slice(0, 100), url: a.href.split('?')[0] })).filter((r) => r.title && /^https:\/\/www\.bilibili\.com\/video\//.test(r.url)))
    return [...new Map(candidates.map((r) => [r.url, r])).values()].slice(0, 8)
  } finally { await page.close() }
}

export async function readCandidate(candidate) {
  const result = await fetchMedia(candidate.url)
  return JSON.stringify({ title: candidate.title, url: candidate.url, details: result, observed: '只读取公开标题和简介，尚未完整观看视频。' }).slice(0, 2200)
}
