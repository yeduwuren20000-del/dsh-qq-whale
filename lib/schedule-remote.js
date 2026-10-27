/** 从用户配置的 SSH/MySQL 服务同步课表。默认关闭，不预置任何账号。 */
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { dataDir } from './store.js'
import { replaceAll } from './schedule.js'

export const remoteDefaults = {
  enabled: false,
  sshHost: '', // 用户自己的 SSH Host 别名
  db: 'LessonTable',
  studentId: '',
}

const REMOTE_CFG = path.join(dataDir(), 'schedule', 'remote.json')
const LOCAL_BAK = path.join(dataDir(), 'schedule', 'courses.local.json')

export function readRemoteConfig() {
  try {
    const j = JSON.parse(fs.readFileSync(REMOTE_CFG, 'utf8'))
    return { ...remoteDefaults, ...(j && typeof j === 'object' ? j : {}) }
  } catch {
    return { ...remoteDefaults }
  }
}

export function writeRemoteConfig(patch = {}) {
  const next = { ...readRemoteConfig(), ...patch }
  try {
    fs.mkdirSync(path.dirname(REMOTE_CFG), { recursive: true })
    fs.writeFileSync(REMOTE_CFG, JSON.stringify(next, null, 2), 'utf8')
  } catch {
    // 配置写不进去不打扰
  }
  return next
}

/** 第X节 → '第5-6节'；单节 → '第5节'。 */
function periodText(section, sectionCount) {
  const s = Number(section)
  const n = Math.max(1, Number(sectionCount) || 1)
  if (!Number.isFinite(s) || s <= 0) return '—'
  return n <= 1 ? `第${s}节` : `第${s}-${s + n - 1}节`
}

/**
 * 教学周数组 → all/odd/even。
 * 空/连续全段 → all；全奇数 → odd；全偶数 → even；混合 → all（note 里带原文）。
 */
function weekParity(weeks) {
  const arr = Array.isArray(weeks) ? weeks.map(Number).filter((n) => Number.isFinite(n) && n > 0) : []
  if (!arr.length) return 'all'
  const odd = arr.every((n) => n % 2 === 1)
  const even = arr.every((n) => n % 2 === 0)
  if (odd) return 'odd'
  if (even) return 'even'
  return 'all'
}

/** 远程一条 → 本地一条。 */
export function toLocalCourse(row, index) {
  const name = String(row?.name || '').trim()
  if (!name) return null
  const day = Number(row?.week)
  if (!Number.isFinite(day) || day < 1 || day > 7) return null
  const notes = []
  if (row.weekText) notes.push(String(row.weekText))
  if (row.credit) notes.push(`${row.credit}学分`)
  if (row.category) notes.push(String(row.category))
  if (row.CourseAttribute && row.CourseAttribute !== '正常') notes.push(String(row.CourseAttribute))
  if (Array.isArray(row.weeks) && row.weeks.length) {
    // 单双周之外的混合周次，本地格式表达不了；weekText 已描述就不重复列数字。
    if (weekParity(row.weeks) === 'all' && !row.weekText) {
      notes.push(`教学周：${row.weeks.join(',')}`)
    }
  }
  return {
    id: `r${String(row.num || index).replace(/[^0-9a-zA-Z]/g, '').slice(0, 10)}-${day}-${row.section || '0'}`,
    day,
    period: periodText(row.section, row.sectionCount),
    name,
    location: String(row.address || '').trim(),
    teacher: String(row.teacher || '').trim(),
    week: weekParity(row.weeks),
    weeks: Array.isArray(row.weeks) ? row.weeks.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [],
    note: notes.join(' · '),
  }
}

/** 远程 JSON 数组 → 本地数组。 */
export function convertRemote(list) {
  if (!Array.isArray(list)) return []
  const out = []
  const seen = new Set()
  list.forEach((row, i) => {
    const c = toLocalCourse(row, i)
    if (!c) return
    const key = `${c.day}|${c.period}|${c.name}`
    if (seen.has(key)) return // 同名同节次只留一条
    seen.add(key)
    out.push(c)
  })
  out.sort((a, b) => a.day - b.day || String(a.period).localeCompare(String(b.period)))
  return out
}

/** 从 mysql -N 的原始输出里抠出 JSON 数组。 */
export function extractJson(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    const j = JSON.parse(text.slice(start, end + 1))
    return Array.isArray(j) ? j : null
  } catch {
    return null
  }
}

/**
 * SSH 到配置的主机拉课表。
 * @param {object} [cfg] - 默认读 remote.json
 * @param {(cmd: string) => Promise<string>} [exec] - 可注入执行器（测试用）
 * @returns {Promise<{ok:boolean, count?:number, error?:string}>}
 */
export function syncRemoteCourses(cfg = readRemoteConfig(), exec) {
  const conf = { ...readRemoteConfig(), ...(cfg && typeof cfg === 'object' ? cfg : {}) }
  const run = exec || defaultExec
  const host = String(conf.sshHost || remoteDefaults.sshHost).trim()
  const db = String(conf.db || remoteDefaults.db).trim()
  const sid = String(conf.studentId || '').trim()
  if (!sid) return Promise.resolve({ ok: false, error: '没配学号' })
  if (!/^[0-9A-Za-z_-]+$/.test(host)) return Promise.resolve({ ok: false, error: `ssh 别名不合法：${host}` })

  // SQL 里学号只允许数字字母；别名只允许安全字符（上面校验过）。
  if (!/^[0-9A-Za-z]+$/.test(sid)) return Promise.resolve({ ok: false, error: `学号不合法：${sid}` })
  // 注意嵌套引号：ssh 收到的是  mysql db -N -e 'select ...'  这一整条。
  const remoteCmd = `mysql ${db} -N -e 'select ScheduleData from ScheduleData where UserID="${sid}";'`
  const cmd = `ssh -o BatchMode=yes -o ConnectTimeout=10 ${host} "${remoteCmd}"`

  return run(cmd).then(
    (raw) => {
      const rows = extractJson(raw)
      if (!rows) return { ok: false, error: '服务器没返回课表数据（可能学号不对或还没同步过）' }
      if (!rows.length) return { ok: false, error: '服务器课表是空的' }
      const local = convertRemote(rows)
      if (!local.length) return { ok: false, error: '远程数据解析不出有效课程' }
      // 覆盖前备份本地
      try {
        const cur = fs.existsSync(path.join(dataDir(), 'schedule', 'courses.json'))
          ? fs.readFileSync(path.join(dataDir(), 'schedule', 'courses.json'), 'utf8')
          : '[]'
        fs.writeFileSync(LOCAL_BAK, cur, 'utf8')
      } catch {
        // 备份失败也继续（不阻塞同步）
      }
      const n = replaceAll(local)
      return { ok: true, count: n }    },
    (err) => ({ ok: false, error: `SSH 失败：${err?.message || err}` })
  )
}

function defaultExec(cmd) {
  return new Promise((resolve, reject) => {
    execFile(cmd, { shell: true, maxBuffer: 16 * 1024 * 1024, timeout: 30000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message || '').trim().split('\n')[0] || 'ssh 执行失败'))
      else resolve(stdout)
    })
  })
}
