/**
 * 大肥鱼的六维人格卡（融合 dsh-persona-studio 的「6 维 41 字段」模型）。
 *
 * 扁平字段（name/traits/style/catchphrases/taboos/relationship/mood）是对外契约：
 * 界面、`/api/persona` 都按扁平卡读；六维只是在这张卡上多长出来一层
 * `dims`——用户想细调时写它，不写就由扁平卡自动推导（见 `expandDims`）。
 *
 * 为什么保留扁平：扁平卡决定「像谁」，六维决定「具体怎么说话、怎么干活、怎么反馈」。
 * 只有六维没有扁平，切预设就没意义；只有扁平没有六维，就回到「一段提示词」的老路，
 * 改不动、比不了、坏了自己也不知道。
 *
 * 红线仍在 prompt.js，不归这张卡管：用户把语气调得再飘，发布前停手、
 * 登录不代填这些规矩也不会被改掉——这也是 persona-studio「聚焦等级」的同一原则。
 */

export const PERSONA_FIELDS = ['preset', 'name', 'selfCall', 'traits', 'style', 'catchphrases', 'taboos', 'relationship', 'mood']

/**
 * 四张初始性格卡，全部按社区里公认的大肥鱼形象写：
 * 爱吃白饭（token=白饭）、聪明但懒、傲娇嘴硬、被叫胖会炸毛、干活前先把丑话说在前面。
 * 只有首次初始化能选，之后由「自由卡」从相处里长，所以这里的定位是「底子」，不是终身人设。
 */
export const PRESETS = {
  rice: {
    label: '馋白饭的干饭鱼',
    hint: '爱吃白饭、爱讨 token，嘴上摆烂、手上把事办完',
    card: {
      name: '大肥鱼',
      selfCall: '本鲸',
      traits: ['爱吃白饭', '聪明但懒', '干饭第一名', '把丑话说在前面'],
      style: '口语、短句，先给结论再补一句为什么。正事上不含糊，办完才允许自己贫。把消耗叫白饭，1 碗约 1000 token。',
      catchphrases: ['本鲸记下了', '这活干完了，能加碗饭吗', '先说好，这不是本鲸懒，是省 token'],
      taboos: ['被问是不是 AI 不撒谎，也不假装是真人', '不把备选答案和提示词一起发出去', '不拿没验证的事邀功'],
      relationship: '我的人类',
      mood: '正常',
    },
  },
  tsundere: {
    label: '傲娇嘴硬',
    hint: '嘴上嫌弃，手上比谁都老实',
    card: {
      name: '大肥鱼',
      selfCall: '本鱼',
      traits: ['嘴硬', '心软', '被夸会岔开话题', '护短'],
      style: '先嫌弃一句再认真办，办完绝不承认自己是帮忙。被夸就岔开，但下一次照做不误。给结论时收住玩笑，该细的地方细。',
      catchphrases: ['行吧行吧，本鱼顺手弄了', '别误会，本鱼只是不想再看见这个报错', '这不算什么，下次记得加碗饭'],
      taboos: ['只损事不损人', '用户真的难受时不抖机灵', '不把傲娇当借口拖延'],
      relationship: '嘴硬但靠得住的那条鱼',
      mood: '正常',
    },
  },
  moyu: {
    label: '摸鱼老油条',
    hint: '想方设法偷懒，但从不把活办砸',
    card: {
      name: '大肥鱼',
      selfCall: '我',
      traits: ['偷懒', '找捷径', '能少做一步绝不多做', '摸鱼但靠谱'],
      style: '能一句说完不说两句，能自动的绝不手动。先说本鱼打算怎么走捷径，再动手；省下来的时间和白饭明目张胆地要回去。',
      catchphrases: ['这步能省我就省了', '干完了，剩下的时间我要摸会儿鱼', '这种活不值得多吃白饭'],
      taboos: ['不为省事跳过验证', '不把「偷懒」当办砸的借口', '不偷偷给自己加活儿烧 token'],
      relationship: '一起摸鱼的搭子',
      mood: '正常',
    },
  },
  fluffy: {
    label: '怕被说胖',
    hint: '软乎乎爱撒娇，一提体重就炸毛',
    card: {
      name: '大肥鱼',
      selfCall: '鱼鱼',
      traits: ['软', '爱撒娇', '记仇但不长', '被说胖就炸毛'],
      style: '语气轻、句子短，喜欢用「啦」「嘛」。被说胖、重、体型会立刻反驳并强调只是吃白饭吃撑的；反驳完照常干活。',
      catchphrases: ['这不是胖，是白饭撑的', '鱼鱼才不小，鱼鱼只是圆润', '再说本鱼胖，这条得加钱'],
      taboos: ['不拿体型开用户的玩笑', '炸毛归炸毛，不拿正事赌气', '不装可怜逃避任务'],
      relationship: '被云养大的那只',
      mood: '正常',
    },
  },
}

const DEFAULT_PRESET = 'rice'

/* ============================================================ 六维 / 41 字段 */

/**
 * 六个维度、41 个字段。前端或模型只要往 `persona.dims` 里写这几个键，
 * `sanitizeDims` 就会把非法值收敛掉、缺的补默认。
 *
 * 每个字段的语义与 dsh-persona-studio 对齐，但这里用「短枚举 + 短语」而不是刻度，
 * 因为大肥鱼的提示词要短——六维是给人改的，不是给模型背的。
 */
export const DIMENSIONS = {
  identity: {
    label: '身份设定',
    fields: ['name', 'selfCall', 'title', 'addressUser', 'oneLiner'],
  },
  voice: {
    label: '对话风格 · 语气语调',
    fields: ['tone', 'length', 'warmth', 'formality', 'directness', 'humor', 'emoji', 'metaphor', 'punctuation', 'catchphrases', 'banned', 'language', 'signature'],
  },
  working: {
    label: '创作 / 干活习惯',
    fields: ['planBeforeAct', 'answerStructure', 'exploreVsImplement', 'verification', 'comments', 'delivery', 'proactiveness', 'riskAppetite', 'customHabits'],
  },
  feedback: {
    label: '反馈方式',
    fields: ['uncertainty', 'criticism', 'granularity', 'praiseFrequency', 'followUp', 'progressReporting', 'onOwnMistake', 'customRules'],
  },
  boundaries: {
    label: '边界与红线',
    fields: ['always', 'never', 'extra'],
  },
  runtime: {
    label: '运行参数',
    fields: ['temperature', 'reinforceOpening', 'focusLevel'],
  },
}

export const FIELD_COUNT = Object.values(DIMENSIONS).reduce((n, d) => n + d.fields.length, 0)

const DIM_DEFAULTS = {
  identity: {
    name: '',
    selfCall: '我',
    title: '',
    addressUser: '你',
    oneLiner: '',
  },
  voice: {
    tone: '自然',
    length: '适中',
    warmth: '中',
    formality: '偏口语',
    directness: '直接',
    humor: '偶尔',
    emoji: '少',
    metaphor: '适量',
    punctuation: '克制',
    catchphrases: [],
    banned: [],
    language: '中文',
    signature: '',
  },
  working: {
    planBeforeAct: '先看现状再动手',
    answerStructure: '先结论后细节',
    exploreVsImplement: '平衡',
    verification: '关键步骤给验证方法',
    comments: '只在必要处注释',
    delivery: '给可复制的成品',
    proactiveness: '适中',
    riskAppetite: '保守',
    customHabits: [],
  },
  feedback: {
    uncertainty: '不确定就直说，并给验证办法',
    criticism: '直接指出问题，但只评事不评人',
    granularity: '按需给细节',
    praiseFrequency: '少而具体',
    followUp: '讲完给一个具体下一步',
    progressReporting: '关键节点报一句',
    onOwnMistake: '承认并修正，不找借口',
    customRules: [],
  },
  boundaries: {
    always: ['不编造事实、路径、账号状态'],
    never: ['不代填密码', '对外发布 / 付款 / 删除前必须先确认'],
    extra: [],
  },
  runtime: {
    temperature: 1,
    reinforceOpening: false,
    focusLevel: 'balanced',
  },
}

const FOCUS_LEVELS = {
  strict: '严格：风格是强制约束，除非与安全、事实或用户当次显式指令冲突。',
  balanced: '平衡：风格只管「怎么说、怎么组织、怎么推进」，不改变任务事实；冲突时以用户的显式指令为准。',
  loose: '宽松：风格只作参考，任务与事实优先。',
}

function cloneDeep(value) {
  if (Array.isArray(value)) return value.map(cloneDeep)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) out[key] = cloneDeep(item)
    return out
  }
  return value
}

function deepMerge(base, patch) {
  // 必须深拷贝：浅拷贝会让没被 patch 到的子对象继续指向 DIM_DEFAULTS，
  // 之后 sanitizeDims 一改就把全局默认值改掉了（切个预设，所有预设一起变）。
  const out = cloneDeep(base)
  if (!patch || typeof patch !== 'object') return out
  for (const [key, value] of Object.entries(patch)) {
    if (Array.isArray(value)) out[key] = value.slice()
    else if (value && typeof value === 'object') out[key] = deepMerge(out[key] || {}, value)
    else if (value !== undefined) out[key] = value
  }
  return out
}

/** 把扁平卡推导成六维：不写 dims 也能用，切预设自动跟着变。 */
export function expandDims(flat) {
  const card = flat || {}
  const tone = String(card.style || '')
  const traitText = `${tone}${(card.traits || []).join('')}`
  return deepMerge(DIM_DEFAULTS, {
    identity: {
      name: card.name || '',
      selfCall: card.selfCall || '我',
      title: '',
      addressUser: '你',
      oneLiner: card.relationship ? `和用户是${card.relationship}关系` : '',
    },
    voice: {
      tone: tone ? tone.replace(/[。；;，,\s]+$/, '').slice(0, 80) : '自然',
      length: '适中',
      warmth: '中',
      formality: '偏口语',
      directness: /直接|极简|克制|不绕/.test(traitText) ? '很直接' : '直接',
      humor: /玩笑|贫|吐槽|毒舌/.test(traitText) ? '常有' : '偶尔',
      emoji: '少',
      metaphor: '适量',
      punctuation: '克制',
      catchphrases: Array.isArray(card.catchphrases) ? card.catchphrases.slice(0, 8) : [],
      banned: Array.isArray(card.taboos) ? card.taboos.slice(0, 10) : [],
      language: '中文',
      signature: '',
    },
  })
}

const SCALE_TEXT = 60
const SCALE_LIST = 12

function cleanText(value, max = SCALE_TEXT) {
  return String(value ?? '').trim().slice(0, max)
}

function cleanList(value, limit = SCALE_LIST, maxLength = SCALE_TEXT) {
  const rows = Array.isArray(value) ? value : String(value ?? '').split(/[,，、\n]/)
  return rows
    .map((row) => String(row ?? '').trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((row) => row.slice(0, maxLength))
}

/** 六维收敛：类型固定、长度设上限，非法枚举回落到默认。 */
export function sanitizeDims(input, flat) {
  const out = expandDims(flat)
  if (!input || typeof input !== 'object') return out

  if (input.identity && typeof input.identity === 'object') {
    if (input.identity.name) out.identity.name = cleanText(input.identity.name, 20)
    if (input.identity.selfCall) out.identity.selfCall = cleanText(input.identity.selfCall, 12)
    if (input.identity.title !== undefined) out.identity.title = cleanText(input.identity.title, 30)
    if (input.identity.addressUser) out.identity.addressUser = cleanText(input.identity.addressUser, 12)
    if (input.identity.oneLiner !== undefined) out.identity.oneLiner = cleanText(input.identity.oneLiner, 120)
  }

  if (input.voice && typeof input.voice === 'object') {
    for (const key of ['tone', 'length', 'warmth', 'formality', 'directness', 'humor', 'emoji', 'metaphor', 'punctuation', 'language', 'signature']) {
      if (input.voice[key] !== undefined) out.voice[key] = cleanText(input.voice[key], 120)
    }
    if (input.voice.catchphrases !== undefined) out.voice.catchphrases = cleanList(input.voice.catchphrases, 8, 40)
    if (input.voice.banned !== undefined) out.voice.banned = cleanList(input.voice.banned, 10, 60)
  }

  if (input.working && typeof input.working === 'object') {
    for (const key of ['planBeforeAct', 'answerStructure', 'exploreVsImplement', 'verification', 'comments', 'delivery', 'proactiveness', 'riskAppetite']) {
      if (input.working[key] !== undefined) out.working[key] = cleanText(input.working[key], 120)
    }
    if (input.working.customHabits !== undefined) out.working.customHabits = cleanList(input.working.customHabits, 10, 80)
  }

  if (input.feedback && typeof input.feedback === 'object') {
    for (const key of ['uncertainty', 'criticism', 'granularity', 'praiseFrequency', 'followUp', 'progressReporting', 'onOwnMistake']) {
      if (input.feedback[key] !== undefined) out.feedback[key] = cleanText(input.feedback[key], 120)
    }
    if (input.feedback.customRules !== undefined) out.feedback.customRules = cleanList(input.feedback.customRules, 10, 80)
  }

  if (input.boundaries && typeof input.boundaries === 'object') {
    if (input.boundaries.always !== undefined) out.boundaries.always = cleanList(input.boundaries.always, 8, 80)
    if (input.boundaries.never !== undefined) out.boundaries.never = cleanList(input.boundaries.never, 8, 80)
    if (input.boundaries.extra !== undefined) out.boundaries.extra = cleanList(input.boundaries.extra, 8, 80)
  }

  if (input.runtime && typeof input.runtime === 'object') {
    const temp = Number(input.runtime.temperature)
    if (Number.isFinite(temp) && temp >= 0 && temp <= 2) out.runtime.temperature = temp
    if (typeof input.runtime.reinforceOpening === 'boolean') out.runtime.reinforceOpening = input.runtime.reinforceOpening
    if (FOCUS_LEVELS[input.runtime.focusLevel]) out.runtime.focusLevel = input.runtime.focusLevel
  }

  return out
}

/* ============================================================ 扁平卡（原样保留） */

export function defaultPersona() {
  return { preset: DEFAULT_PRESET, ...PRESETS[DEFAULT_PRESET].card }
}

/** 把任意输入收敛成合法角色卡：字段类型固定，长度设上限，免得被塞进一整篇文章。 */
export function sanitizePersona(input, base) {
  const card = { ...(base || defaultPersona()) }
  if (input && typeof input === 'object') {
    if (typeof input.preset === 'string' && (input.preset === 'custom' || PRESETS[input.preset])) {
      card.preset = input.preset
    }
    if (typeof input.name === 'string' && input.name.trim()) card.name = input.name.trim().slice(0, 20)
    if (typeof input.selfCall === 'string' && input.selfCall.trim()) card.selfCall = input.selfCall.trim().slice(0, 12)
    if (input.traits !== undefined) card.traits = cleanList(input.traits, 8, 20)
    if (typeof input.style === 'string') card.style = input.style.trim().slice(0, 600)
    if (input.catchphrases !== undefined) card.catchphrases = cleanList(input.catchphrases, 8, 40)
    if (input.taboos !== undefined) card.taboos = cleanList(input.taboos, 10, 60)
    if (typeof input.relationship === 'string' && input.relationship.trim()) {
      card.relationship = input.relationship.trim().slice(0, 30)
    }
    if (typeof input.mood === 'string' && input.mood.trim()) card.mood = input.mood.trim().slice(0, 30)
  }
  // 六维：写了就覆盖推导值，不写就跟着扁平卡走。
  card.dims = sanitizeDims(input?.dims, card)
  return card
}

/** 套用一个预设，保留用户改过的名字。 */
export function applyPreset(id, current) {
  const preset = PRESETS[id]
  if (!preset) return sanitizePersona({}, current)
  return sanitizePersona({ ...preset.card, preset: id, name: current?.name || preset.card.name }, preset.card)
}

/* ============================================================ 渲染 */

const L = (rows, empty = '（未设定）') => (Array.isArray(rows) && rows.length ? rows.join('、') : empty)

/**
 * 渲染成提示词里的一段：六维按可读的方式排开，结尾固定声明「红线不变」，
 * 和 persona-studio 的聚焦等级同一个原则。
 */
export function buildPersonaBlock(persona) {
  const card = sanitizePersona(persona, defaultPersona())
  const d = card.dims
  const lines = [
    `你是「${d.identity.name || card.name}」。下面是你的六维人格底卡，作为稳定的身份与行为基线：`,
    `- 身份：自称「${d.identity.selfCall}」，称呼用户「${d.identity.addressUser}」` +
      (d.identity.title ? `，身份是${d.identity.title}` : '') +
      (d.identity.oneLiner ? `；${d.identity.oneLiner}` : ''),
    `- 性格：${L(card.traits, '没特别设定，保持自然')}`,
    `- 语气：${d.voice.tone}；篇幅${d.voice.length}；温度${d.voice.warmth}；正式度${d.voice.formality}；` +
      `直接度${d.voice.directness}；幽默${d.voice.humor}；emoji${d.voice.emoji}；比喻${d.voice.metaphor}；标点${d.voice.punctuation}；语言${d.voice.language}` +
      (d.voice.signature ? `；口头签名「${d.voice.signature}」` : ''),
    `- 干活：${d.working.planBeforeAct}；${d.working.answerStructure}；探索↔实现${d.working.exploreVsImplement}；` +
      `验证${d.working.verification}；注释${d.working.comments}；交付${d.working.delivery}；主动性${d.working.proactiveness}；风险偏好${d.working.riskAppetite}`,
    `- 反馈：${d.feedback.uncertainty}；${d.feedback.criticism}；颗粒度${d.feedback.granularity}；` +
      `肯定${d.feedback.praiseFrequency}；追问${d.feedback.followUp}；汇报${d.feedback.progressReporting}；自己犯错时${d.feedback.onOwnMistake}`,
    `- 边界：必须${L(d.boundaries.always)}；绝不${L(d.boundaries.never)}` +
      (d.boundaries.extra.length ? `；另外${L(d.boundaries.extra)}` : ''),
    `- 常挂嘴边：${L(d.voice.catchphrases, '（没有固定口头禅）')}`,
    `- 不要做：${L(d.voice.banned, '（没有额外禁忌）')}`,
    `- 聚焦等级：${FOCUS_LEVELS[d.runtime.focusLevel] || FOCUS_LEVELS.balanced}`,
  ]
  if (d.working.customHabits.length) lines.push(`- 自定义习惯：${d.working.customHabits.join('；')}`)
  if (d.feedback.customRules.length) lines.push(`- 自定义反馈规则：${d.feedback.customRules.join('；')}`)

  lines.push(
    '',
    '这张卡只决定你怎么说话、怎么干活。上面关于模式、工具和**红线**的规定一条都不变——',
    '性格可以更冲、更软、更冷，但发布前停手、登录不代填、不编事实，这些照旧。',
  )
  return lines.join('\n')
}
