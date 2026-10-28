/**
 * 大肥鱼的日记（重要记忆的出口）。
 *
 * 和 `journal/`（值班日志）刻意分开：
 *   - journal 是「今天动过什么」，机器口吻，按天追加，给排障用；
 *   - diary  是「今天记住了什么」，第一人称，带情绪和重要度，给「像人」用。
 *
 * 触发点有两处：
 *   1. 记忆库收到一条 weight >= 4 的记忆（偏好、教训、重要事实）→ 自动记一篇；
 *   2. 模型或用户显式调用（memory 工具的 `action=diary` / `/api/diary` POST）。
 *
 * 落盘双写：`diary/YYYY-MM-DD.md` 给人看，`diary/index.json` 给程序读。
 * 写失败只留痕，不抛错——日记写不进去不该拖垮对话。
 */
import fs from './state-fs.js'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { dataDir } from './store.js'
import { dayKey, localTime } from './clock.js'

const INDEX = () => path.join(diaryDir(), 'index.json')
const MAX_ENTRIES = 500

export function diaryDir() {
  return path.join(dataDir(), 'diary')
}

function blank() {
  return { version: 1, entries: [] }
}

let cache

function load() {
  if (cache) return cache
  try {
    const raw = JSON.parse(fs.readFileSync(INDEX(), 'utf8'))
    cache = { ...blank(), ...raw }
    if (!Array.isArray(cache.entries)) cache.entries = []
  } catch {
    cache = blank()
  }
  return cache
}

function persist() {
  const data = load()
  try {
    fs.mkdirSync(diaryDir(), { recursive: true })
    const tmp = `${INDEX()}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    fs.renameSync(tmp, INDEX())
  } catch (error) {
    console.error('[dsh-mentor] 日记索引写入失败：', error?.message || error)
  }
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function dayOf(at) {
  return dayKey(at)
}

function timeOf(at) {
  return localTime(at).slice(0, 5)
}

function stars(weight) {
  const n = Math.max(1, Math.min(5, Number(weight) || 3))
  return '★'.repeat(n) + '☆'.repeat(5 - n)
}

/**
 * 写一篇日记。
 * @param {object} input
 * @param {string} input.title - 一句话标题（会截断）
 * @param {string} input.body - 正文
 * @param {string} [input.mood] - 当时的情绪标签
 * @param {number} [input.weight] - 重要度 1-5
 * @param {string[]|string} [input.tags]
 * @param {number} [input.at] - 时间戳（测试注入）
 * @returns {object|null} 写入的条目；没内容返回 null
 */
export function appendDiary({ title, body, mood = '', weight = 3, tags = [], at = Date.now(), source = 'memory' } = {}) {
  const text = String(body || title || '').trim()
  if (!text) return null
  const data = load()
  const day = dayOf(at)
  const time = timeOf(at)
  const entry = {
    id: randomUUID(),
    at,
    day,
    time,
    title: String(title || text).replace(/\s+/g, ' ').trim().slice(0, 40),
    body: text.slice(0, 2000),
    mood: String(mood || '').trim().slice(0, 20),
    weight: Math.max(1, Math.min(5, Number(weight) || 3)),
    tags: (Array.isArray(tags) ? tags : String(tags || '').split(/[,，、\s]+/))
      .map((t) => String(t).trim())
      .filter(Boolean)
      .slice(0, 8),
    source,
  }
  data.entries.unshift(entry)
  if (data.entries.length > MAX_ENTRIES) data.entries.length = MAX_ENTRIES
  persist()

  // markdown 给人看：同一天追加到同一个文件
  try {
    fs.mkdirSync(diaryDir(), { recursive: true })
    const file = path.join(diaryDir(), `${day}.md`)
    if (!fs.existsSync(file)) fs.writeFileSync(file, `# 大肥鱼的日记 · ${day}\n\n`, 'utf8')
    const head =
      `## ${time} · ${entry.title}\n` +
      `> ${entry.mood ? `情绪：${entry.mood} · ` : ''}重要度：${stars(entry.weight)}（${entry.weight}/5）` +
      (entry.tags.length ? ` · 标签：${entry.tags.join('、')}` : '') +
      '\n\n'
    fs.appendFileSync(file, `${head}${entry.body}\n\n`, 'utf8')
  } catch (error) {
    console.error('[dsh-mentor] 日记写入失败：', error?.message || error)
  }
  return entry
}

/** 最近 N 天的日记，按天倒序。 */
export function listDiary({ days = 7 } = {}) {
  const data = load()
  const cutoff = Date.now() - Math.max(1, Math.min(Number(days) || 7, 366)) * 86400000
  const rows = data.entries.filter((row) => row.at >= cutoff)
  const byDay = new Map()
  for (const row of rows) {
    if (!byDay.has(row.day)) byDay.set(row.day, [])
    byDay.get(row.day).push(row)
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, entries]) => ({ day, entries: entries.sort((a, b) => b.at - a.at) }))
}

/** 最近 N 篇（跨天）。 */
export function recentDiary(limit = 5) {
  return load()
    .entries.slice()
    .sort((a, b) => b.at - a.at)
    .slice(0, Math.max(1, Math.min(Number(limit) || 5, 50)))
}

export function readDiary(day) {
  try {
    return fs.readFileSync(path.join(diaryDir(), `${day}.md`), 'utf8')
  } catch {
    return ''
  }
}

export function diaryStats() {
  const data = load()
  const today = dayOf(Date.now())
  return {
    total: data.entries.length,
    today: data.entries.filter((row) => row.day === today).length,
    dir: diaryDir(),
  }
}

/** 今天写了没、最后一条什么时候——提示词和「自动落笔」都靠它判断。 */
export function diaryToday() {
  const today = dayOf(Date.now())
  const rows = load().entries.filter((row) => row.day === today)
  return {
    day: today,
    count: rows.length,
    lastAt: rows.reduce((max, row) => Math.max(max, row.at || 0), 0),
  }
}

/**
 * 渲染成提示词里的一段：只给最近几篇的「标题 + 一句正文 + 情绪」。
 * 重要的先给，避免最近的琐事把大事挤掉。
 *
 * 末尾永远带一句今天的进度：不是催更，是把事实摆出来，让模型自己决定要不要落笔。
 */
export function renderDiaryBlock(limit = 5) {
  const rows = recentDiary(limit)
  const today = diaryToday()
  const parts = []
  if (rows.length) {
    parts.push('这是你自己写过的日记（第一人称，给未来的自己看）：')
    parts.push(...rows.map((row) => {
      const snippet = row.body.replace(/\s+/g, ' ').slice(0, 80)
      return `- ${row.day} ${row.time}｜${row.title}｜${snippet}${row.mood ? `（当时${row.mood}）` : ''}`
    }))
    parts.push('自然地带着这些记忆说话；别把日记当清单复述，也别编没写过的事。')
  }
  parts.push(
    today.count === 0
      ? '今天你还没往日记里落笔——这轮聊完要是有什么值得留住的，你自己写一篇，不用问我。'
      : `今天你已经写了 ${today.count} 篇。还有值得记的就接着写，没有就别凑数。`,
  )
  return parts.join('\n')
}

/**
 * 解析「后台 agent」吐回来的日记 JSON。
 *
 * 模型经常裹一层 ```json 或者前面加一句「好的，这是日记：」，所以不能直接 JSON.parse。
 * 抠第一个 `{` 到最后一个 `}`，再试一次——失败就返回 null，宁可这篇不写，也不要把
 * 半截乱码写进日记。
 */
export function parseDiaryPayload(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let data
  try {
    data = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  if (data.skip === true) return { skip: true }
  const body = String(data.body || '').trim()
  if (!body) return null
  return {
    title: String(data.title || '').trim() || body.replace(/\s+/g, ' ').slice(0, 20),
    body,
    mood: String(data.mood || '').trim().slice(0, 20),
    weight: Math.max(1, Math.min(5, Number(data.weight) || 3)),
    tags: Array.isArray(data.tags) ? data.tags : String(data.tags || '').split(/[,，、]/),
  }
}

/** 测试/换盘用：清掉内存缓存，下次从磁盘重读。 */
export function reloadDiary() {
  cache = undefined
}
