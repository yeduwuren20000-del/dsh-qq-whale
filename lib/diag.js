/**
 * 装配诊断：记录「这一轮宿主到底把插件装了几次」。
 *
 * 为什么要有这个：
 * 「发一条消息、她以为收到四条」追到最后是「插件被装配了多次、每个实例各开一条连接」。
 * 但插件里的 console.log 在 DSH 桌面端落不到任何日志文件——打出来也没人看得见。
 * 所以这里把每次装配写进一个 jsonl，重启后直接数一数，不用翻控制台、不用 netstat。
 *
 * 三个刻意的选择：
 * 1. 用 globalThis 上的 Symbol 计数，不用模块变量——插件可能被打包成多份，模块变量各有一份。
 * 2. 记 `boot`（进程启动时刻），这样能分清「同一次启动装了 4 次」和「重启了 4 次」。
 * 3. 写盘失败一律吞掉：诊断是增值信息，不能因为它把插件带崩。
 */
import fs from 'node:fs'
import path from 'node:path'

const MAX_RECORDS = 400
const BOOT_SLOT = Symbol.for('dsh-mentor.diag.boot')

function diagDir(dir) {
  return path.join(dir, 'diagnostics')
}

function fileOf(dir) {
  return path.join(diagDir(dir), 'instances.jsonl')
}

/**
 * 进程启动时刻（用来区分「一次启动装了 N 次」和「重启了 N 次」）。
 *
 * 注意：不能每次现算。`Date.now() - uptime*1000` 每调用一次就漂几毫秒，
 * 拿它去和记录里的 boot 比对会永远对不上（本轮记录认不出自己）。
 * 所以真正的来源是 bootState() 里那份一次算好的值。
 */
function computeBoot() {
  return Math.round(Date.now() - process.uptime() * 1000)
}

/** 本进程的启动时刻，进程内稳定。 */
export function bootStamp() {
  return bootState().boot
}

function bootState() {
  if (!globalThis[BOOT_SLOT]) {
    globalThis[BOOT_SLOT] = { pid: process.pid, boot: computeBoot(), seq: 0 }
  }
  const slot = globalThis[BOOT_SLOT]
  // 理论上不会变；真变了（宿主换了进程）就当新的一轮从 1 开始。
  if (slot.pid !== process.pid) {
    slot.pid = process.pid
    slot.boot = computeBoot()
    slot.seq = 0
  }
  return slot
}

/** 读现有记录；坏行跳过（写到一半断电是常态，不能因此整个读不出来）。 */
export function readBoots(dir) {
  return parseBoots(readRaw(dir))
}

function readRaw(dir) {
  try {
    return fs.readFileSync(fileOf(dir), 'utf8')
  } catch {
    return ''
  }
}

/** 纯函数：把 jsonl 文本解析成记录数组。单独导出是为了能测。 */
export function parseBoots(text) {
  const rows = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const row = JSON.parse(trimmed)
      if (row && typeof row === 'object' && Number.isFinite(row.pid)) rows.push(row)
    } catch {
      // 半行 JSON：丢掉。
    }
  }
  return rows
}

/**
 * 纯函数：把记录按「一次进程启动」分组，最新的在前。
 * @returns {{ total: number, current: object|null, runs: Array<{pid:number,boot:number,count:number,lastAt:number}> }}
 */
export function summarize(records, pid = process.pid, boot = bootStamp()) {
  const groups = new Map()
  for (const row of records || []) {
    const key = `${row.pid}:${row.boot ?? 0}`
    const hit = groups.get(key) || { pid: row.pid, boot: row.boot ?? 0, count: 0, lastAt: 0, seqMax: 0 }
    hit.count += 1
    hit.lastAt = Math.max(hit.lastAt, Number(row.at) || 0)
    hit.seqMax = Math.max(hit.seqMax, Number(row.seq) || 0)
    groups.set(key, hit)
  }
  const runs = [...groups.values()].sort((a, b) => b.lastAt - a.lastAt)
  const current = runs.find((run) => run.pid === pid && run.boot === boot) || null
  return { total: (records || []).length, current, runs }
}

/**
 * 记一次装配。返回 `{ seq }`。
 * @param {string} dir 数据目录
 * @param {object} extra 额外信息（版本、入口参数等），方便比对几次装配的差异
 */
export function noteBoot(dir, extra = {}) {
  const slot = bootState()
  slot.seq += 1
  const record = {
    at: Date.now(),
    pid: process.pid,
    ppid: process.ppid ?? 0,
    boot: slot.boot,
    seq: slot.seq,
    version: extra.version || '',
    where: extra.where || '',
    argv: extra.argv || '',
  }
  try {
    fs.mkdirSync(diagDir(dir), { recursive: true })
    fs.appendFileSync(fileOf(dir), `${JSON.stringify(record)}\n`, 'utf8')
    trim(dir)
  } catch {
    // 诊断写不下去就算了，主流程继续。
  }
  return { seq: slot.seq, pid: process.pid, boot: slot.boot }
}

/** 文件别无限长：超了就只留最后 MAX_RECORDS 条。 */
function trim(dir) {
  let text
  try {
    text = fs.readFileSync(fileOf(dir), 'utf8')
  } catch {
    return
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  if (lines.length <= MAX_RECORDS) return
  try {
    fs.writeFileSync(fileOf(dir), `${lines.slice(-MAX_RECORDS).join('\n')}\n`, 'utf8')
  } catch {
    // 裁不掉也不影响读。
  }
}

/**
 * 给人和给接口看的汇总。
 * `duplicated` 是这次真正关心的结论：本轮装配是不是超过 1 次。
 */
export function instanceReport(dir) {
  const { total, current, runs } = summarize(readBoots(dir))
  const count = current?.count ?? 0
  return {
    total,
    pid: process.pid,
    boot: bootStamp(),
    count,
    duplicated: count > 1,
    runs: runs.slice(0, 6),
    hint:
      count > 1
        ? `本轮宿主把插件装配了 ${count} 次（已按单例合并成一条连接，但说明加载器在重复装配）`
        : '本轮只装配了一次',
  }
}

/**
 * 换了个数据目录也要能定位文件——给测试和排障用。
 */
export function instancesFile(dir) {
  return fileOf(dir)
}
