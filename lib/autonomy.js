import fs from 'node:fs'
import path from 'node:path'
import { dataDir, getSettings } from './store.js'
import { dayKey, localHour } from './clock.js'
import { getBrowserContext, reservePage } from './browser-context.js'
import { fetchMedia } from './media.js'

export function autonomyConfig() { return { enabled: true, minHours: 3, maxPerDay: 2, ...(getSettings().autonomy || {}) } }
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
  if (!cfg.enabled || localHour(now) < 8) return false
  const today = history.filter((r) => dayKey(r.at) === dayKey(now) && r.ok)
  if (today.length >= Math.max(1, Number(cfg.maxPerDay) || 2)) return false
  return !history[0] || now - history[0].at >= Math.max(1, Number(cfg.minHours) || 3) * 3600000
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
  return JSON.stringify({ title: candidate.title, url: candidate.url, details: result, observed: '只读取公开标题和简介，尚未完整观看视频。' }).slice(0, 5000)
}
