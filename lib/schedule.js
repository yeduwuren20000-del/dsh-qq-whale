/**
 * 课表：纯本地数据，不联网。
 *
 * 课程存在 dataDir()/schedule/courses.json。
 * 一门课：{ id, day(1-7 或 '周一'..'周日' 或 'mon'..'sun'), period(节次/时间段字符串),
 *          name, location, teacher, week(可选 'all'|'odd'|'even'), note }
 * day 统一规整成 1-7（1=周一）。week 默认 'all'（每周都上）。
 *
 * 查询以「本地时区」为准：今天周几、现在几点，都用进程本地时间。
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { dataDir } from './store.js'
import { clockParts, dayKey } from './clock.js'

const DIR = path.join(dataDir(), 'schedule')
const FILE = path.join(DIR, 'courses.json')

const WEEKDAYS_CN = {
  周一: 1, 星期一: 1,
  周二: 2, 星期二: 2,
  周三: 3, 星期三: 3,
  周四: 4, 星期四: 4,
  周五: 5, 星期五: 5,
  周六: 6, 星期六: 6,
  周日: 7, 星期日: 7, 周天: 7, 星期天: 7,
}
const WEEKDAYS_EN = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 }
const WEEKDAYS_LABEL = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' }

/** 把各种「周几」写法规整成 1-7；认不出返回 null。 */
export function normalizeDay(day) {
  if (day == null) return null
  if (typeof day === 'number' && day >= 1 && day <= 7) return Math.floor(day)
  const s = String(day).trim().toLowerCase()
  if (/^[1-7]$/.test(s)) return Number(s)
  if (WEEKDAYS_CN[day]) return WEEKDAYS_CN[day]
  if (WEEKDAYS_EN[s]) return WEEKDAYS_EN[s]
  return null
}

export function dayLabel(d) {
  return WEEKDAYS_LABEL[normalizeDay(d)] || String(d)
}

function readAll() {
  try {
    const arr = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function writeAll(list) {
  try {
    fs.mkdirSync(DIR, { recursive: true })
    const tmp = `${FILE}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8')
    fs.renameSync(tmp, FILE)
  } catch {
    // 写不进去不能拖垮对话。
  }
}

/**
 * 覆盖式写入整张课表（远程同步用）。会规整化每条（day/period/name），
 * 过滤非法条目；返回实际写入条数。
 */
export function replaceAll(list) {
  const clean = (Array.isArray(list) ? list : [])
    .map((c) => {
      const day = normalizeDay(c?.day)
      const name = String(c?.name || '').trim()
      if (!day || !name) return null
      return {
        id: String(c.id || randomUUID().slice(0, 8)),
        day,
        period: String(c.period || '').trim() || '—',
        name,
        location: String(c.location || '').trim(),
        teacher: String(c.teacher || '').trim(),
        week: ['all', 'odd', 'even'].includes(c.week) ? c.week : 'all',
        note: String(c.note || '').trim(),
      }
    })
    .filter(Boolean)
  clean.sort((a, b) => a.day - b.day || String(a.period).localeCompare(String(b.period)))
  writeAll(clean)
  return clean.length
}

export function listCourses() {
  return readAll()
}

/** 加一门课。返回新建的课（带 id）；参数不合法返回 null。 */
export function addCourse(input = {}) {
  const day = normalizeDay(input.day)
  const name = String(input.name || '').trim()
  if (!day || !name) return null
  const course = {
    id: randomUUID().slice(0, 8),
    day,
    period: String(input.period || '').trim() || '—',
    name,
    location: String(input.location || '').trim(),
    teacher: String(input.teacher || '').trim(),
    week: ['all', 'odd', 'even'].includes(input.week) ? input.week : 'all',
    note: String(input.note || '').trim(),
  }
  const all = readAll()
  all.push(course)
  all.sort((a, b) => a.day - b.day || String(a.period).localeCompare(String(b.period)))
  writeAll(all)
  return course
}

/** 按 id 删课，返回是否删到了。 */
export function removeCourse(id) {
  const all = readAll()
  const next = all.filter((c) => c.id !== id)
  if (next.length === all.length) return false
  writeAll(next)
  return true
}

function weekMatches(course, isoWeek) {
  const w = course.week || 'all'
  if (w === 'all') return true
  // ISO 周：每年第一周含该年第一个周四。简单用 getWeek。
  const parity = isoWeek % 2 === 0 ? 'even' : 'odd'
  return w === parity
}

function isoWeekOf(date) {
  const d = new Date(`${dayKey(date)}T00:00:00Z`)
  const dayNum = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return week
}

/** 某天（1-7）的课，按节次排。now 用来判断单双周。 */
export function coursesForDay(weekday, now = new Date()) {
  const d = normalizeDay(weekday)
  if (!d) return []
  const wk = isoWeekOf(now)
  return readAll()
    .filter((c) => c.day === d && weekMatches(c, wk))
    .sort((a, b) => String(a.period).localeCompare(String(b.period)))
}

/** 今天（本地）的课。 */
export function todayCourses(now = new Date()) {
  const day = new Date(`${dayKey(now)}T00:00:00Z`).getUTCDay()
  return coursesForDay(day === 0 ? 7 : day, now)
}

/** 明天（本地）的课。 */
export function tomorrowCourses(now = new Date()) {
  return todayCourses(new Date(now.getTime() + 86400000))
}

/**
 * 下一节课：从「现在」往后找。今天剩下的先找；今天没了就找最近的下一个有课的日子。
 * period 如果是能当时间的字符串（如 "08:00" 或 "第1节 08:00-09:40"）就按它判，
 * 否则只按「天」判（今天都算、跨天取最近）。返回 { course, dayOffset }，没课返回 null。
 */
export function nextCourse(now = new Date()) {
  const day = new Date(`${dayKey(now)}T00:00:00Z`).getUTCDay()
  const todayDow = day === 0 ? 7 : day
  const parts = clockParts(now)
  const hourNow = parts.hourNumber * 60 + Number(parts.minute)
  const wk = isoWeekOf(now)

  // 今天剩下的（按节次时间过滤）。
  const today = coursesForDay(todayDow, now).filter((c) => periodStartMin(c.period) == null || periodStartMin(c.period) > hourNow)
  if (today.length) return { course: today[0], dayOffset: 0 }

  // 往后 1-7 天里找最早有课的一天。
  for (let off = 1; off <= 7; off += 1) {
    const t = new Date(now.getTime() + off * 86400000)
    const nextDay = new Date(`${dayKey(t)}T00:00:00Z`).getUTCDay()
    const dow = nextDay === 0 ? 7 : nextDay
    const list = coursesForDay(dow, t)
    if (list.length) return { course: list[0], dayOffset: off }
  }
  return null
}

/** 从节次字符串里抠出开始分钟（"08:00" / "第3节 08:00-09:40" / "上午1-2节" 都尽量认）。 */
function periodStartMin(period) {
  const s = String(period || '')
  const m = s.match(/(\d{1,2}):(\d{2})/)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  return null
}

/** 给模型/前端看的一句话摘要。 */
export function summarize(list, title) {
  if (!list.length) return `${title}没有课。`
  const lines = list.map((c) => {
    const loc = c.location ? ` @${c.location}` : ''
    const tea = c.teacher ? `（${c.teacher}）` : ''
    return `- ${c.period} ${c.name}${tea}${loc}`
  })
  return `${title}共 ${list.length} 节：\n${lines.join('\n')}`
}
