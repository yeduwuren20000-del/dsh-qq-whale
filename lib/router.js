/**
 * 学伴的模式路由。
 *
 * 用户要的东西是「一句话进来，先判我想让 DSH 干什么，再切」。真正干这件事的应该是
 * 一个 System One 决策模型（Jev 系列）：它不给文字，只给标定概率。这里把接口按
 * Jev/gutsy 的 `POST /v1/systemone` 形状写好，本地服务在就自动接管，不在就用规则兜底——
 * 两者返回同一个结构，上层不关心是谁判的。
 *
 * 参考：kouhxp/gutsy（0.8B GGUF，Jev 兼容 API）
 *   curl http://127.0.0.1:8765/v1/systemone -d '{"state":"...","questions":{"intent":{"type":"choice",...}}}'
 */

export const MODE_IDS = ['chat', 'teach', 'quiz', 'plan', 'code', 'operate']

export const MODES = {
  chat: {
    label: '闲聊',
    hint: '放松聊两句，不必教学',
    color: '#9aa4b2',
    directive:
      '当前是闲聊模式：像熟人一样自然回话，简短、有温度。不要主动塞知识点、不要布置作业、' +
      '也不要怂恿用户「要不要我给你讲一课」——他想弄明白自己会问。就陪着把这阵子聊过去。',
  },
  teach: {
    label: '讲解',
    hint: '把概念讲透',
    color: '#6ea8fe',
    directive:
      '当前是讲解模式。按这个顺序：① 先用一句话给结论（它到底是什么）② 用用户已经会的东西打比方 ' +
      '③ 拆成 2-4 个要点，逐条讲，每条配一个最小例子 ④ 指出一个常见误解 ' +
      '⑤ 最后给一道 30 秒能想完的小检查题，并留白等用户答。不要一次倒完所有细节。',
  },
  quiz: {
    label: '测验',
    hint: '出题查掌握',
    color: '#f0a35e',
    directive:
      '当前是测验模式。默认出 3 道题，由浅入深，题型可混。每道题单独成段，标明题号与分值，' +
      '**先不要给答案**；等用户作答后再逐题判分、指出错在哪一步、给一句改正建议。' +
      '全部判完后给一个掌握度判断（未掌握/半懂/掌握）和下一步建议。',
  },
  plan: {
    label: '计划',
    hint: '排学习路线',
    color: '#8f7bf0',
    directive:
      '当前是学习计划模式。先确认三件事再排：目标是什么、每天能投入多久、现在的基础到哪。' +
      '信息不足就先问，最多问三个问题。给出计划时用表格式的阶段划分：阶段目标 / 关键动作 / 验收标准 / 预计时长，' +
      '阶段数控制在 3-5 个，每个阶段都要有能自己检查的验收标准。',
  },
  code: {
    label: '代码',
    hint: '排错与实现',
    color: '#4fc08d',
    directive:
      '当前是代码辅导模式。先定位再动手：让用户给出报错全文和最小复现，不要凭空猜。' +
      '解释时按「症状 → 原因 → 修法 → 怎么验证」四段说。需要看文件就用工具去读，需要验证就跑命令，' +
      '不要只说「你试试」。改代码时给最小 diff，并说明为什么这样改。',
  },
  operate: {
    label: '干活',
    hint: '接管浏览器 / 桌面，直接把事做完',
    color: '#e2678a',
    directive:
      '当前是干活模式：用户要的是结果，不是讲解。直接动手——用 browser 工具开网页、点、填、上传；' +
      '需要操作本机客户端就用 desktop 工具切窗口、打字、截图。\n' +
      '做法（按这个顺序，别跳）：\n' +
      '① 只读优先：先 open + read/links 看清页面，不猜、不盲点；\n' +
      '② 演练：真正点之前用 dryRun=true 调一次 click，确认要点的到底是哪个按钮；\n' +
      '③ 分步做，每步做完一句话说进展；关键页 shot 截图留证；\n' +
      '④ 收尾给三行「做了什么 / 结果在哪 / 怎么验证」。\n' +
      '红线：**对外发布、发送消息、付款、删除账号/作品**这类不可逆动作，先把要发的内容、目标账号、' +
      '最后一步讲清楚，等用户明确点头再带 confirm=true 点。登录一律让用户自己扫码，不要代填密码。' +
      '每天的不可逆动作有总额度（默认 10 次），用完会拒绝——这是防封号的总闸，不是建议。',
  },
}

/**
 * 规则兜底用的关键词表。
 *
 * strong = 这句话几乎就是在要这个；weak = 只是相关背景（比如代码里提到 python，
 * 不代表用户在问代码）。二者分开加权，才不会让「Python 的 GIL 和 Java 的锁有什么区别」
 * 被语言名拽进代码模式。
 */
const STRONG = 2.4
const WEAK = 0.7

const RULES = [
  {
    mode: 'code',
    strong: [
      /报错|异常|堆栈|traceback|exception|error\b|bug|跑不通|运行不了|编译|崩溃|闪退/i,
      /undefined|cannot read|is not a function|syntaxerror|typeerror|importerror|segmentation/i,
      /这段代码|为什么错|哪里错|错在哪|帮我改代码|重构|单元测试|写个函数|实现一下/i,
    ],
    weak: [
      /函数|类|接口|变量|循环|递归|算法|正则|异步|线程|内存/i,
      /python|javascript|typescript|node|npm|pip|git|docker|sql|react|vue|java\b|c\+\+|rust/i,
    ],
  },
  {
    mode: 'quiz',
    strong: [/出题|出几道|考我|测我|测一下|小测|测验|做题|刷题|quiz/i],
    weak: [/选择题|判断题|练习|自测|来几道|几道题|答案/i],
  },
  {
    mode: 'plan',
    strong: [/学习计划|学习路线|怎么学|如何学|从哪开始|先学什么|路线图|roadmap|学习路径/i],
    weak: [/计划|规划|安排|几天|几周|一个月|三个月|阶段|进度|从零/i],
  },
  {
    mode: 'operate',
    strong: [
      /接管|把我的|帮我发|帮我传|帮我登|发一条|发个视频|发个作品|发到|上传到|发布到|定时发|自动发/i,
      /抖音|快手|小红书|哔哩哔哩|bilibili|视频号|公众号|微博|闲鱼|淘宝|店铺|橱窗/i,
      /帮我做|替我|动手|跑一下|执行一下|装一下|配置环境|部署|打包/i,
    ],
    weak: [
      /打开|登录|点一下|填写|填表|截图|批量|导出|下载|上传|发一下|回个|私信|评论|点赞|关注|粉丝/i,
      /qq|微信|邮箱|邮件|浏览器|网页|网站|后台|控制台/i,
    ],
  },
  {
    mode: 'teach',
    strong: [/是什么|什么是|为什么|怎么回事|原理|区别|差别|讲讲|解释|说一下|科普|推导|证明|举例|怎么理解|如何理解|本质/i],
    weak: [/不懂|没懂|看不懂|听不明白|教我|入门|概念|定义|机制|底层|作用|用途|例子/i],
  },
  {
    mode: 'chat',
    strong: [/好累|累了|困了|无聊|聊聊|随便聊|哈哈|在吗|谢谢|晚安|早上好|吃了吗/i],
    weak: [],
  },
]

function normalize(scores) {
  const entries = Object.entries(scores)
  const total = entries.reduce((sum, [, v]) => sum + v, 0)
  if (total <= 0) return Object.fromEntries(entries.map(([k]) => [k, 1 / entries.length]))
  return Object.fromEntries(entries.map(([k, v]) => [k, v / total]))
}

function summarize(probs) {
  const ranked = Object.entries(probs).sort((a, b) => b[1] - a[1])
  const [topMode, topProb] = ranked[0]
  const second = ranked[1]?.[1] ?? 0
  const n = ranked.length
  // 与 Jev 的 confidence 定义保持一致：(n·p - 1) / (n - 1)
  const confidence = n > 1 ? (n * topProb - 1) / (n - 1) : 1
  return { mode: topMode, confidence, margin: topProb - second, probs }
}

/** 规则路由：离线、零依赖，永远可用。 */
export function ruleRoute(text) {
  const input = String(text || '').slice(0, 2000)
  const scores = {}
  for (const id of MODE_IDS) scores[id] = 0.35 // 给个底，避免全 0
  for (const rule of RULES) {
    for (const pattern of rule.strong || []) {
      if (pattern.test(input)) scores[rule.mode] += STRONG
    }
    for (const pattern of rule.weak || []) {
      if (pattern.test(input)) scores[rule.mode] += WEAK
    }
  }
  // 很短、没有问号的寒暄别被「怎么」这类字眼误判成讲解。
  if (input.length <= 6 && !/[?？]/.test(input)) {
    scores.chat += 1.6
  }
  const result = summarize(normalize(scores))
  return { ...result, engine: 'rules', detail: '离线关键词判定' }
}

const JEV_QUESTIONS = {
  intent: {
    type: 'choice',
    instructions: '这段话背后，用户最想让学习助手做哪一件事？',
    criteria: {
      chat: '随便聊聊、情绪表达、寒暄',
      teach: '解释一个概念、原理或原因',
      quiz: '出题检验自己掌握到什么程度',
      plan: '制定学习计划或学习路线',
      code: '排查代码错误、解释代码或写代码',
      handoff: '让助手直接动手改项目、装环境、跑命令',
    },
  },
  learning: {
    type: 'noul',
    instructions: '这句话是在寻求学习或知识上的帮助吗？',
  },
  effort: {
    type: 'score',
    instructions: '要答好它，需要多深的内容？',
    criteria: ['随口一问', '需要一段讲解', '需要系统学习'],
  },
}

/** 把最近几轮对话压成 state：Jev 只看状态，不看历史轮次，压平反而更准。 */
function buildState(text, history) {
  const parts = []
  if (Array.isArray(history) && history.length) {
    const tail = history.slice(-4).map((m) => `${m.role === 'user' ? '用户' : '助手'}：${String(m.text || '').slice(0, 400)}`)
    parts.push(`之前的对话：\n${tail.join('\n')}`)
  }
  parts.push(`用户现在说：${String(text || '').slice(0, 1500)}`)
  return parts.join('\n\n')
}

/**
 * 探测本地决策模型服务。
 * @returns {Promise<{ok: boolean, url: string, models?: string[], error?: string}>}
 */
export async function probeJev(baseUrl, timeoutMs = 1500) {
  const url = String(baseUrl || '').replace(/\/+$/, '')
  if (!url) return { ok: false, url, error: '未配置' }
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return { ok: false, url, error: `HTTP ${res.status}` }
    const body = await res.json().catch(() => ({}))
    const models = Array.isArray(body?.models)
      ? body.models.map((m) => (typeof m === 'string' ? m : m?.name)).filter(Boolean)
      : []
    return { ok: true, url, models }
  } catch (error) {
    return { ok: false, url, error: error?.name === 'TimeoutError' ? '超时' : String(error?.message || error) }
  }
}

/**
 * 走本地 Jev 兼容服务判定。
 * @returns {Promise<{mode: string, confidence: number, margin: number, probs: object, engine: string, detail: string}>}
 */
export async function jevRoute(text, history, baseUrl, timeoutMs = 12000) {
  const url = String(baseUrl || '').replace(/\/+$/, '')
  const res = await fetch(`${url}/v1/systemone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: buildState(text, history), questions: JEV_QUESTIONS }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`jev HTTP ${res.status}`)
  const body = await res.json()
  const intent = body?.answers?.intent
  if (!intent || typeof intent !== 'object') throw new Error('jev 返回里没有 intent')

  const probs = {}
  for (const id of MODE_IDS) probs[id] = Number(intent.probabilities?.[id] ?? 0)
  const reject = Number(intent.reject ?? 0)
  const learning = Number(body?.answers?.learning?.noul ?? 0.5)

  const result = summarize(probs)
  const latency = Number(body?.usage?.latency_ms ?? 0)
  const detailParts = [
    latency ? `${Math.round(latency)}ms` : '',
    `学习类 ${(learning * 100).toFixed(0)}%`,
    reject ? `都不像 ${(reject * 100).toFixed(0)}%` : '',
  ].filter(Boolean)

  return {
    ...result,
    // reject 高说明这句话不在既有模式里，宁可回到闲聊而不是硬套一个模式。
    mode: reject > 0.55 && result.margin < 0.2 ? 'chat' : result.mode,
    engine: 'jev',
    detail: detailParts.join(' · '),
    learning,
    reject,
  }
}
