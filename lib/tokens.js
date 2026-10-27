/**
 * 大肥鱼自己的 token 观察器。
 *
 * 设计前提（用户定的）：
 * 1. 只统计「大肥鱼」这个插件作用域里的对话消耗，不碰主对话、不碰 QQ 桥。
 * 2. 不耗 token——它只是把已经发生的对话数一数、记下来，不额外调任何模型。
 * 3. 用户想知道「今天花了多少」，也能直接问大肥鱼，她从本地日志答，不猜。
 *
 * 优先用宿主逐次模型请求回传的 usage（包含工具说明、缓存输入和有用量的重试）。
 * 没有回传时才退回文字估算，历史估算与实测分别保留；token 不是金额账单。
 */
import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from './store.js'
import { dayKey as beijingDayKey } from './clock.js'

const TOKENS_DIR = path.join(dataDir(), 'tokens')
const FILE = path.join(TOKENS_DIR, 'daily.json')

/**
 * 纯函数 token 估算。给同一段文字永远得到同一个数，方便单测。
 * 不追求精确（那要真 tokenizer），要的是「每天/每天之间的相对量」稳定可比。
 */
export function countTokens(text) {
  if (!text) return 0
  const s = String(text)
  let cjk = 0
  let word = 0
  let other = 0
  for (const ch of s) {
    const code = ch.codePointAt(0)
    if (code >= 0x3040 && code <= 0x30ff) cjk += 1 // 日文假名 + 部分 CJK 标点
    else if (code >= 0x4e00 && code <= 0x9fff) cjk += 1 // CJK 统一表意
    else if (code >= 0x3400 && code <= 0x4dbf) cjk += 1 // CJK 扩展 A
    else if (/\s/.test(ch)) continue // 空白不计
    else if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)) word += 1
    else other += 1
  }
  return Math.max(1, Math.round(cjk * 0.6 + word * 0.25 + other * 0.5))
}

/** 本地日期键 YYYY-MM-DD（按进程本地时区，不是 UTC，符合「今天」的直觉）。 */
export function dayKey(date = new Date()) {
  return beijingDayKey(date)
}

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'))
  } catch {
    return {}
  }
}

function writeAll(obj) {
  try {
    fs.mkdirSync(TOKENS_DIR, { recursive: true })
    const tmp = `${FILE}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(obj))
    fs.renameSync(tmp, FILE)
  } catch {
    // 记不下去不能拖垮对话，下一轮再说。
  }
}

/**
 * 记大肥鱼自己一轮的消耗。只累加，不删历史。
 * @param {{ dateKey?: string, mode?: string, prompt?: number, completion?: number, source?: string }} arg
 */
export function recordTurn({ dateKey, mode = 'chat', prompt = 0, completion = 0, source = 'estimate', cacheRead = 0, cacheWrite = 0, requests = 0 } = {}) {
  const key = dateKey || dayKey()
  const all = readAll()
  const day = all[key] || { prompt: 0, completion: 0, turns: 0, byMode: {} }
  const priorSource = day.source || 'estimate'
  const p = Math.max(0, Math.round(prompt))
  const c = Math.max(0, Math.round(completion))
  day.prompt += p
  day.completion += c
  day.turns += 1
  day.cacheRead = (day.cacheRead || 0) + Math.max(0, Number(cacheRead) || 0)
  day.cacheWrite = (day.cacheWrite || 0) + Math.max(0, Number(cacheWrite) || 0)
  day.requests = (day.requests || 0) + Math.max(0, Number(requests) || 0)
  // Older totals remain estimates even after authoritative usage becomes available.
  day.source = day.turns > 1 && (day.source || 'estimate') !== source ? 'mixed' : source
  day.bySource ||= {}
  if (!Object.keys(day.bySource).length && day.turns > 1) {
    day.bySource[priorSource] = { prompt: day.prompt - p, completion: day.completion - c, turns: day.turns - 1 }
  }
  const bucket = day.bySource[source] || { prompt: 0, completion: 0, turns: 0 }
  bucket.prompt += p; bucket.completion += c; bucket.turns += 1
  day.bySource[source] = bucket
  const m = day.byMode[mode] || { prompt: 0, completion: 0, turns: 0 }
  m.prompt += p
  m.completion += c
  m.turns += 1
  day.byMode[mode] = m
  all[key] = day
  writeAll(all)
  return day
}

/** 取聚合数据：今天 + 最近 N 天序列 + 区间总计。 */
export function statsFor({ dateKey, days = 7 } = {}) {
  const all = readAll()
  const today = dateKey || dayKey()
  const base = new Date()
  const keys = []
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(base)
    d.setDate(base.getDate() - i)
    keys.push(dayKey(d))
  }
  const series = keys.map((k) => ({ date: k, prompt: 0, completion: 0, turns: 0, byMode: {}, ...(all[k] || {}) }))
  const todayStat = all[today] || { prompt: 0, completion: 0, turns: 0, byMode: {} }
  const total = series.reduce((a, s) => a + s.prompt + s.completion, 0)
  const totalTurns = series.reduce((a, s) => a + s.turns, 0)
  const lifetime = Object.values(all).reduce((a, s) => ({ tokens: a.tokens + (s.prompt || 0) + (s.completion || 0), turns: a.turns + (s.turns || 0) }), { tokens: 0, turns: 0 })
  return { today, todayStat, series, total, totalTurns, lifetime, source: todayStat.source || 'estimate' }
}

export function sourceLabel(source) {
  return source === 'host' ? '宿主回传用量' : source === 'mixed' ? '宿主用量与历史估算混合' : '本地估算'
}

/** Usage chunks are cumulative within one attempt, disjoint across model attempts/steps. */
export function usageMeter() {
  let latest, requests = 0, prompt = 0, completion = 0, cacheRead = 0, cacheWrite = 0
  const flush = () => {
    if (!latest) return
    const n = (key) => Math.max(0, Number(latest[key]) || 0)
    cacheRead += n('cacheReadTokens'); cacheWrite += n('cacheWriteTokens')
    prompt += n('inputTokens') + n('cacheReadTokens') + n('cacheWriteTokens')
    completion += n('outputTokens')
    requests++; latest = undefined
  }
  return {
    frame(frame) {
      if (frame?.type === 'start') flush()
      const usage = frame?.type === 'chunk' && frame.chunk?.type === 'usage' ? frame.chunk.usage : undefined
      if (usage && Number.isFinite(usage.inputTokens) && Number.isFinite(usage.outputTokens)) latest = usage
    },
    total() { flush(); return { prompt, completion, cacheRead, cacheWrite, requests } },
    record({ mode = 'chat', fallbackPrompt = 0, fallbackCompletion = 0 } = {}) {
      const totals = this.total()
      if (totals.requests) return recordTurn({ mode, ...totals, source: 'host' })
      if (fallbackCompletion) return recordTurn({ mode, prompt: fallbackPrompt, completion: fallbackCompletion })
    },
  }
}

/** Observe background calls as well, without adding their material to normal chats. */
export function trackUsage(ctx, agent, { mode, prompt = '', completion = () => '' }) {
  const meter = usageMeter()
  const off = ctx.on('agent/assistant-stream', (evt) => { if (evt.agent === agent) meter.frame(evt.frame) })
  return () => { off(); meter.record({ mode, fallbackPrompt: countTokens(prompt), fallbackCompletion: countTokens(completion()) }) }
}

/** 给模型看的一句话摘要：被问到用量时，她照着这段答，不自己编数字。 */
export function formatForModel(stats = statsFor()) {
  const s = stats
  const t = s.todayStat || { prompt: 0, completion: 0, turns: 0 }
  const todayTotal = t.prompt + t.completion
  const lines = [`今天（${s.today}）大肥鱼记录 ${todayTotal} token（提示 ${t.prompt} + 生成 ${t.completion}），共 ${t.turns} 轮（${sourceLabel(s.source)}，不是金额账单）。`]
  const recent = s.series.filter((x) => x.turns > 0)
  if (recent.length) {
    lines.push('最近有消耗的几天：')
    for (const x of recent.slice(-7)) {
      lines.push(`- ${x.date}: 约 ${x.prompt + x.completion} token（${x.turns} 轮）`)
    }
  } else {
    lines.push('最近几天还没有对话记录。')
  }
  return lines.join('\n')
}
