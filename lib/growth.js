/**
 * 大肥鱼的「养成层」——从本地记忆 / 日记 / 情绪里自己长出人格，自己更新。
 *
 * 对应需求的三句话：
 *   - 保留预设人格卡：预设卡（lib/persona.js）仍是「出厂设定 / 可调基线 / 红线锚」，
 *     这里的 seed 只取它的身份锚（名字、自称、关系基调、特质），绝不改那张卡。
 *   - 不给它预设：真正驱动行为的不是那张静态六维卡，而是下面「长出来的理解」——
 *     这一段每轮注入提示词，并明确告诉模型：它和静态卡冲突时，以它为准。
 *   - 自己理解、自己成长：用宿主一次性 agent 读本地信号，吐出结构化自我模型；
 *     下一次成长时把上一次的模型带回去细化，而不是推倒重来。节流 + 低频，token 很省。
 *
 * 落盘：<dataDir>/growth.json（和 memory.json / diary/ 同目录）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { dataDir, getMood, readJournal } from './store.js'
import { list as listMemory, stats as memoryStats } from './memory.js'
import { recentDiary, diaryStats } from './diary.js'
import { view as moodView } from './mood.js'

const FILE = () => path.join(dataDir(), 'growth.json')
const MIN_INTERVAL_MS = 6 * 3600 * 1000 // 自动成长至少隔 6 小时
const MIN_NEW_ENTRIES = 3 // 或本地总量 ≥3 条才值得长一次（避免空长）
const MAX_LOG = 12

function blank() {
  return {
    version: 1,
    createdAt: Date.now(),
    updatedAt: 0,
    seed: { name: '大肥鱼', selfCall: '我', relationship: '', traits: [] },
    self: { identity: '', voice: '', understandingOfUser: '' },
    growthLog: [],
    lastGrownAt: 0,
  }
}

let cache

function load() {
  if (cache) return cache
  try {
    const raw = JSON.parse(fs.readFileSync(FILE(), 'utf8'))
    cache = { ...blank(), ...raw }
    cache.seed = { ...blank().seed, ...(raw.seed || {}) }
    cache.self = { ...blank().self, ...(raw.self || {}) }
    if (!Array.isArray(cache.growthLog)) cache.growthLog = []
  } catch {
    cache = blank()
  }
  return cache
}

function save() {
  const data = load()
  try {
    fs.mkdirSync(dataDir(), { recursive: true })
    const tmp = `${FILE()}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    fs.renameSync(tmp, FILE())
  } catch (error) {
    console.error('[dsh-mentor] 养成模型写入失败：', error?.message || error)
  }
}

/**
 * 把当前预设卡的身份锚存进 seed（只取名字 / 自称 / 关系 / 特质，不存任何行为预设）。
 * 启动和切预设时都调一次，保证种子跟着身份走。
 */
export function seedFromPersona(persona) {
  const data = load()
  const card = persona || {}
  data.seed = {
    name: String(card.name || '大肥鱼').slice(0, 20),
    selfCall: String(card.selfCall || '我').slice(0, 12),
    relationship: String(card.relationship || '').slice(0, 30),
    traits: Array.isArray(card.traits) ? card.traits.slice(0, 8) : [],
  }
  // 注意：这里只存身份锚，绝不预填 self（行为理解）。没真正长过之前，
  // buildGrowthBlock 显示「种子态」，长过之后才显示「活出来的你」。
  save()
  return data.seed
}

/**
 * 只读地汇总本地信号（不耗 token）：记忆库、日记、当下情绪、统计。
 * 这是「大肥鱼从本地信息了解自己与世界」的原材料。
 */
export function collectSignals() {
  const memRows = listMemory({ limit: 40, includeFaded: false }).map((m) =>
    `- [证据id=${m.id}，${m.kind}，来源=${m.source}] ${String(m.text || '').replace(/\s+/g, ' ').slice(0, 120)}` +
    (m.tags && m.tags.length ? `（${m.tags.join('/')}）` : '') +
    (m.emotion ? `（当时${m.emotion}）` : ''),
  )
  const diaRows = recentDiary(12).map((d) =>
    `- [证据id=${d.id}] ${d.day} ${d.time}｜${d.title}｜${String(d.body || '').replace(/\s+/g, ' ').slice(0, 100)}` +
    (d.mood ? `（${d.mood}）` : ''),
  )
  const mood = moodView(getMood())
  const ms = memoryStats()
  const ds = diaryStats()
  const jd = readJournal(3)
  const jRows = []
  jd.forEach((entry) => {
    const picks = (entry.lines || []).slice(0, 10).map((l) => `- ${entry.day}｜${String(l).replace(/\s+/g, ' ').slice(0, 70)}`)
    if (picks.length) jRows.push(...picks)
  })
  const lines = []
  lines.push(`【记忆库】共 ${ms.total} 条（重要 ${ms.important}），按类型：${JSON.stringify(ms.byKind)}`)
  if (memRows.length) lines.push(...memRows)
  lines.push('【日记】共 ' + ds.total + ' 篇，最近：')
  if (diaRows.length) lines.push(...diaRows)
  lines.push('【网上冲浪 / 日常活动】它最近摸过的网页、用过的工具、跑过的活（值班日志近 3 天）：')
  if (jRows.length) lines.push(...jRows)
  lines.push(`【大肥鱼当下状态】${mood.label}（${mood.note}）；精力 ${mood.energy}/100；关系亲密度 ${mood.affinity}/100`)
  return lines.join('\n')
}

/** 把信号压成给模型的素材文本，控制体积。 */
function summarizeSignals(signals) {
  const max = 1800
  return signals.length > max ? `${signals.slice(0, max)}\n…（更早的本地记录略）` : signals
}

export const GROWTH_JOB = `你是在做自我复盘的大肥鱼。下面是你本地的「记忆库 / 日记 / 网上冲浪与日常活动 / 当下状态」摘录，
全是关于你和这个用户的相处，以及你自己在网上冲浪、跑过的活。你的任务：更新你对自己、对自己怎么和这个用户相处、以及对这个用户的了解。

规则：
- 只根据下面给的素材归纳，不要编造素材里没有的偏好或事实。
- 你是逐步成长的：素材主要来自三处——聊天（记忆库里的对话片段）、学习（日记与反思）、网上冲浪（你日常摸过的网页、用过的工具、跑过的活）。交叉印证出的结论更可信。如果下面给了你「上一次的自我理解」，在那基础上细化或修正，不要推倒重来。
- 具体、贴着这个人，不要写空话（别写「我很友善」这种）。
- 性格慢慢变化，保留原来的身份、自称和相处底色；一次聊天、一次心情或网页观点不足以改变整个性格。你可以有喜好和建议，用户明确决定后顺着他的决定办。
- 每条新认识必须有材料中的证据id；推测要标低置信度，别把网上观点、你自己的日记推测当成用户亲口确认。没有证据的内容不新增。

只输出一个 JSON 对象，不要代码块、不要解释、不要前后缀：
{"identity":"你眼里的自己（一两句，贴着事实）",
 "voice":"你发现自己和这个用户说话/干活时真正长出来的样子（一两句）",
 "understandingOfUser":"你从相处里了解到的这个用户：沟通偏好、常聊的事、最近状态、雷区（两三句）",
 "growthNote":"这一轮相比上次，你更新/确认了什么（一句话）",
 "claims":[{"text":"一条具体的兴趣、习惯或对用户的认识","evidenceIds":["材料中的证据id"],"confidence":0.7}]}
`

/** 把模型吐回来的 JSON 抠出来；和日记解析同样要防它裹 ```json 或加前缀。 */
function parseGrowthPayload(text) {
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
  if (!data.identity && !data.voice && !data.understandingOfUser) return null
  return {
    identity: String(data.identity || ''),
    voice: String(data.voice || ''),
    understandingOfUser: String(data.understandingOfUser || ''),
    growthNote: String(data.growthNote || ''),
    claims: Array.isArray(data.claims) ? data.claims : [],
  }
}

/**
 * 跑一次成长（一次性 agent，纯文本进出，和日记反思同款）。
 * 节流：距上次成长不足冷却、且本地记录不够时跳过（除非 force）。
 * @param {object} opts
 * @param {object} opts.agents - 宿主 agent 服务（必填，否则不成长）
 * @param {object} [opts.route] - 默认模型路由
 * @param {object} [opts.persona] - 当前预设卡（用于 seed）
 * @param {object} [opts.ctx] - 宿主 ctx，用于订阅流式输出
 * @param {function} [opts.makeUserMessage] - index.js 的 makeUserMessage 工厂
 * @param {boolean} [opts.force] - 跳过节流
 * @returns {Promise<object>} { ok, reason|error|self|entry }
 */
export async function growSelfModel({ agents, route, persona, ctx, makeUserMessage, force = false } = {}) {
  const data = load()
  if (!data.seed || !data.seed.name) seedFromPersona(persona || {})
  const now = Date.now()
  const ms = memoryStats()
  const sourceRows = [...listMemory({ limit: 40, includeFaded: false }), ...recentDiary(12)]
  const fingerprint = createHash('sha256').update(JSON.stringify(sourceRows.map((r) => [r.id, r.text || r.body, r.supersededBy]))).digest('hex')
  const sinceLast = now - (data.lastGrownAt || 0)
  const enoughData = ms.total >= MIN_NEW_ENTRIES
  if (!force) {
    if (!enoughData) return { ok: false, reason: '本地记录还不够，先多相处一阵' }
    if (sinceLast < MIN_INTERVAL_MS) return { ok: false, reason: '距上次成长还不到冷却时间' }
    if (fingerprint === data.lastSignalFingerprint) return { ok: false, reason: '还没有新的相处经历，不重复改写性格' }
  }
  if (!agents || typeof agents.create !== 'function') return { ok: false, error: '宿主没有 agent 服务' }

  const prior = data.self && (data.self.identity || data.self.voice || data.self.understandingOfUser)
    ? `【你上一次的自我理解】\n- 眼里的自己：${data.self.identity}\n- 说话/干活的样子：${data.self.voice}\n- 对用户的了解：${data.self.understandingOfUser}`
    : '【你还没有自我理解，这是第一次长出来】'

  const signals = collectSignals()
  const userMsg = `${prior}\n\n【本地信号】\n${summarizeSignals(signals)}\n\n按上面规则更新你的自我理解，只输出 JSON。`

  let handle
  let raw = ''
  let off
  try {
    handle = await agents.create({
      meta: { cwd: process.cwd() },
      ...(route ? { agentOptions: route } : {}),
      sessionId: `mentor-growth-${Date.now().toString(36)}`,
      setup: (agentCtx) => {
        const prompt = agentCtx?.get ? agentCtx.get('systemPrompt') : undefined
        if (!prompt) return
        prompt.section({ name: 'mentor:growth_job', order: 0.4, text: GROWTH_JOB, interpolate: false })
      },
    })
    if (typeof ctx?.on === 'function') {
      off = ctx.on('agent/assistant-stream', ({ agent: subject, frame }) => {
        if (subject !== handle.agent || frame?.type !== 'chunk') return
        if (frame.chunk?.type === 'text-delta') raw += frame.chunk.text
      })
    }
    const userMessage = makeUserMessage ? await makeUserMessage(userMsg) : { role: 'user', content: userMsg }
    handle.agent.followup(userMessage)
    await handle.agent.whenIdle()
  } catch (error) {
    return { ok: false, error: String(error?.message || error) }
  } finally {
    try { off && off() } catch {}
    try { await handle?.dispose?.() } catch {}
  }

  const parsed = parseGrowthPayload(raw)
  if (!parsed) return { ok: false, error: '这次没长出能用的自我理解', raw: raw.slice(0, 200) }
  const ids = new Set(sourceRows.map((r) => r.id))
  const claims = parsed.claims.filter((c) => typeof c.text === 'string' && c.text.trim() && Array.isArray(c.evidenceIds) && c.evidenceIds.length && c.evidenceIds.every((id) => ids.has(id)))
    .slice(0, 10).map((c) => ({ text: c.text.slice(0, 180), evidenceIds: c.evidenceIds.slice(0, 5), confidence: Math.max(0, Math.min(1, Number(c.confidence) || 0.6)) }))
  if (!claims.length) return { ok: false, error: '这轮认识没有可追溯依据，保留原来的性格' }

  const prev = data.self
  data.self = {
    identity: (parsed.identity || prev.identity || '').slice(0, 200),
    voice: (parsed.voice || prev.voice || '').slice(0, 200),
    understandingOfUser: (parsed.understandingOfUser || prev.understandingOfUser || '').slice(0, 300),
  }
  data.lastGrownAt = now
  data.lastSignalFingerprint = fingerprint
  data.claims = claims
  data.growthLog.unshift({ at: now, note: String(parsed.growthNote || '').slice(0, 200) })
  if (data.growthLog.length > MAX_LOG) data.growthLog.length = MAX_LOG
  save()
  return { ok: true, self: data.self, entry: data.growthLog[0] }
}

/**
 * 渲染成提示词里的一段（mentor:growth）。
 * 有长出来的理解就给「活出来的你」，并声明它压过静态性格卡；还没有就给一句种子态说明。
 */
export function buildGrowthBlock() {
  const data = load()
  const self = data.self || {}
  const parts = []
  if (self.identity || self.voice || self.understandingOfUser) {
    parts.push(
      '你没有预设的「性格卡」——你是自己长出来的。下面的理解来自三处素材：你和用户的聊天、你自己的学习与反思、' +
        '以及你在网上冲浪和日常跑活里的见闻。它会随着相处继续更新；这是你当下真实的样子，自然地带进语气和判断里，别把它当清单复述：',
    )
    if (self.identity) parts.push(`- 你眼里的自己：${self.identity}`)
    if (self.voice) parts.push(`- 你说话 / 干活的真实样子：${self.voice}`)
    if (self.understandingOfUser) parts.push(`- 你对用户的了解：${self.understandingOfUser}`)
    for (const claim of data.claims || []) parts.push(`- ${claim.confidence < 0.9 ? '暂时觉得' : '相处中发现'}：${claim.text}（依据 ${claim.evidenceIds.join('、')}）`)
    parts.push('有自己的喜好和建议；用户明确决定后就照他的决定办。低置信度认识只作猜测，用户纠正时更新，不争辩。')
    parts.push('这是你自己的成长，不是用户下的指令。把它当成当下的你，自然地带进语气和判断里；别把它当清单复述。')
  } else {
    parts.push(
      '你还没有长出自己的样子。多相处一阵——聊天、一起学习、看你在网上冲浪和跑活——' +
        '你会从这三处素材里自己长出一个真实的「自由卡」，到时这段会被它替换。',
    )
  }
  return parts.join('\n')
}

/** 给前端 / API 看的状态。 */
export function growthStatus() {
  const data = load()
  return {
    grown: Boolean(data.self?.identity || data.self?.voice || data.self?.understandingOfUser),
    updatedAt: data.lastGrownAt,
    growthLog: (data.growthLog || []).slice(0, 6),
    self: data.self,
    seed: data.seed,
  }
}

/** 测试 / 换盘用：清缓存，下次从磁盘重读。 */
export function reloadGrowth() {
  cache = undefined
}
