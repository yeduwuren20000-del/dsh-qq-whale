/**
 * 学伴的本地档案：会话 + 学习足迹。
 *
 * 刻意不碰 DSH 的 session 日志：那份日志归宿主所有，我们只保存「窗口怎么展示」
 * 和「用户学了什么」这两件本插件自己的事。写盘走 tmp + rename，崩了不会留半截 JSON。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { defaultPersona, sanitizePersona } from './persona.js'
import { defaultMood, refresh } from './mood.js'
import { dayKey, localTime } from './clock.js'

// DSH_MENTOR_DATA 只给自测和「换个盘放档案」用，正常情况跟着 DSH 的 storages 走。
const DIR = process.env.DSH_MENTOR_DATA || path.join(os.homedir(), '.dsh', 'storages', 'dsh-mentor')
const FILE = path.join(DIR, 'store.json')
const MAX_MESSAGES = 400
const MAX_TRAIL = 300

function blank() {
  return {
    version: 1,
    sessions: [],
    profile: { trail: [], created: Date.now() },
    setup: { done: false, mode: 'unset', onboardedAt: 0 },
  }
}

let cache
let cacheMtimeMs = 0
let timer

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true })
}

export function load() {
  let mtimeMs = 0
  try { mtimeMs = fs.statSync(FILE).mtimeMs } catch { mtimeMs = 0 }
  // 盘上的文件被外部改过（脚本、面板、另一个进程）就重读一次；
  // 否则内存里的旧档案会在下一次 save 时把别人的改动盖回去。
  if (cache && (!mtimeMs || mtimeMs === cacheMtimeMs)) return cache
  if (cache && mtimeMs && mtimeMs !== cacheMtimeMs) cache = undefined
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    cache = { ...blank(), ...raw }
    if (!Array.isArray(cache.sessions)) cache.sessions = []
    if (!cache.profile || typeof cache.profile !== 'object') cache.profile = blank().profile
    if (!Array.isArray(cache.profile.trail)) cache.profile.trail = []
  } catch {
    cache = blank()
  }
  cacheMtimeMs = mtimeMs
  return cache
}

function writeNow() {
  const data = load()
  try {
    ensureDir()
    const tmp = `${FILE}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    fs.renameSync(tmp, FILE)
    try { cacheMtimeMs = fs.statSync(FILE).mtimeMs } catch { /* 记不下时间也无妨 */ }
  } catch (error) {
    // 档案写不进去不该拖垮对话；下一轮再试。
    console.error('[dsh-mentor] 档案写入失败：', error?.message || error)
  }
}

export function save() {
  clearTimeout(timer)
  timer = setTimeout(writeNow, 150)
  timer.unref?.()
}

export function flush() {
  clearTimeout(timer)
  writeNow()
}

export function dataDir() {
  return DIR
}

/* ------------------------------------------------------------------ 会话 */

export function listSessions() {
  return load()
    .sessions.slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((s) => ({
      id: s.id,
      title: s.title || '未命名学习',
      mode: s.mode || 'chat',
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      count: Array.isArray(s.messages) ? s.messages.length : 0,
    }))
}

export function getSession(id) {
  return load().sessions.find((s) => s.id === id)
}

export function createSession(options = {}) {
  const data = load()
  const now = Date.now()
  const session = {
    id: randomUUID(),
    title: String(options.title || '').trim() || '新的学习',
    mode: options.mode || 'chat',
    // QQ 这类外部会话用它做键：重启后还能接回同一段上下文。
    external: options.external || '',
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
  data.sessions.unshift(session)
  if (data.sessions.length > 60) data.sessions.length = 60
  save()
  return session
}

export function findSessionByExternal(external) {
  if (!external) return undefined
  return load().sessions.find((row) => row.external === external)
}

export function deleteSession(id) {
  const data = load()
  const index = data.sessions.findIndex((s) => s.id === id)
  if (index < 0) return false
  data.sessions.splice(index, 1)
  save()
  return true
}

export function renameSession(id, title) {
  const session = getSession(id)
  if (!session) return false
  const clean = String(title || '').trim()
  if (clean) session.title = clean.slice(0, 60)
  save()
  return true
}

/**
 * 会话轮转：旧会话让出 external 键，新会话接管。
 * 旧会话不删——用户还能翻回去看，只是不再往里追加。
 */
export function setSessionExternal(id, external) {
  const session = getSession(id)
  if (!session) return false
  session.external = String(external || '').slice(0, 200)
  session.updatedAt = Date.now()
  save()
  return true
}

export function appendMessage(id, message) {
  const session = getSession(id)
  if (!session) return undefined
  const row = {
    id: randomUUID(),
    at: Date.now(),
    ...message,
  }
  session.messages.push(row)
  if (session.messages.length > MAX_MESSAGES) {
    session.messages.splice(0, session.messages.length - MAX_MESSAGES)
  }
  session.updatedAt = row.at
  // 第一条用户输入就是这一课的标题，和大多数聊天工具一致。
  if (row.role === 'user' && (!session.title || session.title === '新的学习')) {
    session.title = String(row.text || '').replace(/\s+/g, ' ').trim().slice(0, 24) || '新的学习'
  }
  save()
  return row
}

export function setMode(id, mode) {
  const session = getSession(id)
  if (!session) return false
  session.mode = mode
  save()
  return true
}

/** 删一条消息（右键菜单用）。只删窗口里的记录，不动宿主 session 日志。 */
export function deleteMessage(sessionId, messageId) {
  const session = getSession(sessionId)
  if (!session) return false
  const index = (session.messages || []).findIndex((row) => row.id === messageId)
  if (index < 0) return false
  session.messages.splice(index, 1)
  session.updatedAt = Date.now()
  save()
  return true
}

/* ------------------------------------------------------------------ 值班日志 */

/**
 * 干活留痕：每天一份 markdown，和 dsh-douyin-scroll 的日报一个思路——
 * 出了事能回答「它今天到底动过什么」。
 */
export function appendJournal(entry) {
  try {
    const day = dayKey()
    const dir = path.join(DIR, 'journal')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${day}.md`)
    const time = localTime()
    const row = `- ${time} · ${entry.mode || 'chat'} · ${String(entry.text || '').replace(/\s+/g, ' ').slice(0, 80)}` +
      (entry.note ? ` → ${String(entry.note).replace(/\s+/g, ' ').slice(0, 120)}` : '') + '\n'
    if (!fs.existsSync(file)) fs.writeFileSync(file, `# 大肥鱼值班日志 · ${day}\n\n`, 'utf8')
    fs.appendFileSync(file, row, 'utf8')
  } catch (error) {
    console.error('[dsh-mentor] 值班日志写入失败：', error?.message || error)
  }
}

export function journalDir() {
  return path.join(DIR, 'journal')
}

/** 读最近几天的值班日志（按天倒序），给界面的「每天干了啥」用。 */
export function readJournal(days = 3) {
  const dir = journalDir()
  const out = []
  try {
    if (!fs.existsSync(dir)) return out
    const files = fs
      .readdirSync(dir)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
      .sort()
      .reverse()
      .slice(0, Math.max(1, Math.min(days, 30)))
    for (const name of files) {
      const text = fs.readFileSync(path.join(dir, name), 'utf8')
      const lines = text
        .split('\n')
        .filter((line) => line.trim().startsWith('- '))
        .map((line) => line.replace(/^-\s*/, '').trim())
      out.push({ day: name.replace('.md', ''), lines })
    }
  } catch (error) {
    console.error('[dsh-mentor] 值班日志读取失败：', error?.message || error)
  }
  return out
}

/* ------------------------------------------------------------------ 设置 */

const DEFAULT_SETTINGS = { autopilot: false }

export function getSettings() {
  const data = load()
  return { ...DEFAULT_SETTINGS, ...(data.settings || {}) }
}

export function setSettings(patch) {
  const data = load()
  const current = getSettings()
  const next = { ...current }
  // 设置是分组的（qq / perception / shout…），整组替换会把没提到的字段冲掉：
  // 之前只改语音音色，asr/tts 这些开关就被抹了。这里改成一层深合并。
  for (const [key, value] of Object.entries(patch || {})) {
    const previous = current[key]
    if (value && typeof value === 'object' && !Array.isArray(value) && previous && typeof previous === 'object' && !Array.isArray(previous)) {
      next[key] = { ...previous, ...value }
    } else {
      next[key] = value
    }
  }
  if (typeof next.autopilot !== 'boolean') next.autopilot = false
  data.settings = next
  save()
  return next
}

/* ------------------------------------------------------------------ 性格 */

/** 性格卡是全局的：换个会话它还是同样的脾气。 */
export function getPersona() {
  const data = load()
  return sanitizePersona(data.persona, defaultPersona())
}

export function setPersona(patch) {
  const data = load()
  data.persona = sanitizePersona(patch, getPersona())
  save()
  return data.persona
}

/* ------------------------------------------------------------------ 初始化（首次向导 · 人格来源） */

/**
 * 初始化状态：
 *   done    : 首次向导是否已经跑过（跑过就不再自动弹）
 *   mode    : 始终为 'growth'（自由卡模式）。人格只在首次初始化时定一次（选个初始预设或留空），
 *             之后完全由「自由卡」从聊天 / 学习 / 网上冲浪里自己长出来，不能再手动改。
 *   onboardedAt : 完成向导的时间戳
 */
export function getSetup() {
  const data = load()
  const s = data.setup || {}
  return {
    done: Boolean(s.done),
    mode: s.mode || 'unset',
    onboardedAt: s.onboardedAt || 0,
    // 人格来源：preset=用户选的预设卡（可改）；memory=从本地记忆形成（形成后六维卡只读）。
    personaSource: s.personaSource || 'unset',
    personaLocked: Boolean(s.personaLocked),
  }
}

export function setSetup(patch) {
  const data = load()
  data.setup = { ...getSetup(), ...(patch || {}) }
  save()
  return data.setup
}

/* ------------------------------------------------------------------ 情绪 */

/** 读的时候顺手按"过了多久"推一把：歇着会回精力，但不会自己变开心。 */
export function getMood() {
  const data = load()
  return refresh(data.mood, Date.now())
}

export function setMood(state) {
  const data = load()
  data.mood = state
  save()
  return state
}

/* ------------------------------------------------------------------ 足迹 */

export function recordTrail(entry) {
  const data = load()
  data.profile.trail.push({ at: Date.now(), ...entry })
  if (data.profile.trail.length > MAX_TRAIL) {
    data.profile.trail.splice(0, data.profile.trail.length - MAX_TRAIL)
  }
  save()
}

export function getProfile() {
  const data = load()
  const trail = data.profile.trail || []
  const byMode = {}
  for (const row of trail) {
    const key = row.mode || 'chat'
    byMode[key] = (byMode[key] || 0) + 1
  }
  return {
    total: trail.length,
    byMode,
    recent: trail.slice(-40),
    streak: streakDays(trail),
    dir: DIR,
  }
}

function streakDays(trail) {
  if (!trail.length) return 0
  const days = new Set(trail.filter((row) => Number.isFinite(row.at)).map((row) => dayKey(row.at)))
  let streak = 0
  let cursor = Date.now()
  if (!days.has(dayKey(cursor))) cursor -= 86400000
  for (let i = 0; i < 400; i++) {
    if (days.has(dayKey(cursor))) {
      streak += 1
    } else {
      break
    }
    cursor -= 86400000
  }
  return streak
}
