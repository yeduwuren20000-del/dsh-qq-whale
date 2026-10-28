/**
 * 主动聊天：她想说话时自己找你，而不是等你开口。
 *
 * 用户明确要求「不设硬上限，让她自己判断」——所以这里没有 maxPerDay 卡死，
 * 只保留三个不惹人烦的底线：
 *   1. 安静时段（默认 0-8 点）不打扰；
 *   2. 刚聊过 / 刚主动过（冷却）不说话；
 *   3. 上一条主动发出去还没回，不追第二遍（已读不回就别连发）。
 * 每天仍有一个软上限（默认 8 条），防止异常时刷屏。
 */
import fs from 'node:fs'
import path from 'node:path'
import { dataDir, getSettings } from './store.js'
import { dayKey } from './clock.js'
import { quietAt } from './social-behavior.js'

const FILE = () => path.join(dataDir(), 'proactive.json')
const DEFAULTS = {
  enabled: true,
  quiet: [0, 8],
  softPerDay: 10, // 唯一的硬限制：一天最多主动找几次
  chance: 0.2, // 每个调度窗口（30 分钟）掷一次骰子，命中才找
  idleMinutes: 45,
  cooldownMinutes: 60,
}

export function proactiveConfig() {
  const cfg = { ...DEFAULTS, ...(getSettings().proactive || {}) }
  if (!Array.isArray(cfg.quiet) || cfg.quiet.length !== 2) cfg.quiet = DEFAULTS.quiet
  return cfg
}

export function proactiveState() {
  try {
    return { history: [], waiting: false, ...(JSON.parse(fs.readFileSync(FILE(), 'utf8'))) }
  } catch {
    return { history: [], waiting: false }
  }
}

function save(state) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true })
    const tmp = `${FILE()}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
    fs.renameSync(tmp, FILE())
  } catch (error) {
    console.error('[dsh-mentor] 主动聊天的状态没存上：', error?.message || error)
  }
}

/** 记一条：她主动发出去了。 */
export function recordProactive({ text = '', target = '', now = Date.now() } = {}) {
  const state = proactiveState()
  const at = now
  state.history = [{ at, text: String(text).slice(0, 120), target: String(target) }, ...(state.history || [])].slice(0, 80)
  state.lastSentAt = at
  state.waiting = true
  state.target = String(target)
  save(state)
}

/** 用户回话了：她这条主动就算落地了，下次可以再找。 */
export function markUserReply({ target = '', now = Date.now() } = {}) {
  const state = proactiveState()
  const expected = state.target || state.history?.[0]?.target || ''
  if (!target || (expected && String(target) !== String(expected))) return
  state.waiting = false
  state.lastReplyAt = now
  state.lastUserAt = now
  save(state)
}

/**
 * 现在该不该主动说话。
 * @param {{lastUserAt?: number, now?: number}} [options]
 */
export function proactiveCheck({ lastUserAt = 0, now = Date.now() } = {}) {
  const cfg = proactiveConfig()
  if (!cfg.enabled) return { ok: false, reason: '主动聊天关着' }
  const [quietFrom, quietTo] = cfg.quiet
  if (quietAt(now, cfg.quiet)) return { ok: false, reason: `安静时段（${quietFrom}-${quietTo} 点）` }
  const state = proactiveState()
  if (state.waiting) return { ok: false, reason: '上一条还没回，不追' }
  const boundedMinutes = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(5, Math.min(1440, Number(value))) : fallback
  const userAt = Math.max(Number(lastUserAt) || 0, Number(state.lastUserAt) || 0)
  if (userAt && now - userAt < boundedMinutes(cfg.idleMinutes, 45) * 60000) return { ok: false, reason: '刚聊过，让对话自然歇一会儿' }
  if (state.lastSentAt && now - state.lastSentAt < boundedMinutes(cfg.cooldownMinutes, 60) * 60000) return { ok: false, reason: '刚主动联系过，先不连发' }
  const today = (state.history || []).filter((row) => dayKey(row.at) === dayKey(now)).length
  const configured = Number(getSettings().autonomy?.maxPerDayByKind?.proactive ?? cfg.softPerDay)
  const cap = Number.isFinite(configured) ? Math.max(0, Math.min(20, Math.floor(configured))) : 10
  if (today >= cap) return { ok: false, reason: '今天已经聊得够多了' }
  return { ok: true }
}
