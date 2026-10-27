/**
 * 大肥鱼的情绪。
 *
 * 刻意不用模型去"感觉"——那既贵又不可解释。这里是一套确定性规则：
 * 干了多少活、隔了多久、你说的话是夸还是怼、是不是凌晨，都会推动三个数：
 *   精力 energy（0-100）    越用越低，歇着会回
 *   熟悉 affinity（0-100）  被信任/被夸会涨，被骂会掉
 *   mood                    由上面两个数 + 最近一件事决定
 *
 * 好处是每一步都能解释："它为什么现在有点困" → 因为连着干了 12 轮、现在是凌晨。
 */

import { localHour } from './clock.js'

export const MOODS = {
  calm: { label: '平静', face: '🐟', color: '#9aa4b2' },
  happy: { label: '开心', face: '😊', color: '#9ee7c8' },
  proud: { label: '得意', face: '😎', color: '#6ea8fe' },
  tired: { label: '有点困', face: '😪', color: '#8f7bf0' },
  annoyed: { label: '不爽', face: '🙄', color: '#f0a35e' },
  worried: { label: '有点急', face: '😰', color: '#e2678a' },
  curious: { label: '好奇', face: '🧐', color: '#4fc08d' },
}

const MOOD_IDS = Object.keys(MOODS)

export function defaultMood(now = Date.now()) {
  return {
    mood: 'calm',
    energy: 72,
    affinity: 40,
    at: now,
    emotionAt: now,
    turns: 0,
    note: '刚睡醒，精神还行',
  }
}

/**
 * 把状态按"过了多久"推到此刻：休息回精力，太闲会有点无聊。
 * 纯函数，不改入参。
 */
export function refresh(state, now = Date.now()) {
  const base = { ...defaultMood(now), ...(state || {}) }
  const minutes = Math.max(0, (now - (base.at || now)) / 60000)
  const emotionAt = state?.emotionAt ?? state?.at ?? now
  const emotionMinutes = Math.max(0, (now - emotionAt) / 60000)
  const energy = Math.min(100, (base.energy ?? 70) + minutes * 0.5)
  let mood = base.mood
  let note = base.note
  let affinity = base.affinity ?? 40

  // 歇够 20 分钟才会把「困」洗掉——不然刚打完哈欠就被当成睡饱了。
  if (mood === 'tired' && energy > 60 && minutes >= 20) {
    mood = 'calm'
    note = '缓过来了'
  }
  if (['annoyed', 'worried', 'happy', 'proud', 'curious'].includes(mood) && emotionMinutes >= 45) {
    mood = 'calm'
    note = '情绪慢慢平复了'
  }
  // 太久没聊（> 6 小时）：亲切感轻微回落，但不会归零。
  if (minutes > 360) {
    affinity = Math.max(20, affinity - Math.min(6, minutes / 120))
    note = '有一阵没见了'
  }

  return { ...base, mood, note, emotionAt, energy: Math.round(energy * 10) / 10, affinity: Math.round(affinity * 10) / 10, at: now }
}

const PRAISE = /谢谢|辛苦|太棒|厉害|牛啊|牛了|不错|好用|靠谱|爱你|赞|好评|可以啊|舒服/
const SCOLD = /垃圾|废物|没用|不行啊|太差|烦人|别废话|笨|傻|滚|废物点心|你是不是有问题/

/** 从用户一句话里读情绪方向。 */
export function readTone(text) {
  const value = String(text || '')
  // Quoted criticism and the user's distress are not attacks on the companion.
  const direct = value.replace(/[“「『"].*?[”」』"]/g, '').replace(/(?:还|从来|以前)?没用(?:过|到)|不(?:笨|傻)|不(?:太)?(?:好用|靠谱)|别(?:太)?(?:笨|傻)/g, '')
  if (/(?:他|她|别人|同学|老师|老板|有人).{0,8}(?:说|骂|觉得)|(?:说|骂)我|我(?:是|很|好|太|真).{0,5}(?:笨|傻|没用|废物)/.test(direct)) return null
  if (SCOLD.test(direct) && /你|大肥鱼|肥鱼|本鲸|^(?:垃圾|废物|滚|别废话|烦人)/.test(direct)) return 'scold'
  if (PRAISE.test(direct)) return 'praise'
  return null
}

/**
 * 记一件事，返回新状态。
 * @param {object} state
 * @param {string} kind - turn-start/turn-done/tool-ok/tool-fail/praise/scold/late-night/reset
 * @param {object} [meta]
 */
export function observe(state, kind, meta = {}) {
  const now = meta.now || Date.now()
  const current = refresh(state, now)
  const next = { ...current }
  const hour = localHour(now)

  switch (kind) {
    case 'turn-start': {
      next.energy = Math.max(6, next.energy - 3.5)
      next.turns = (next.turns || 0) + 1
      break
    }
    case 'turn-done': {
      next.energy = Math.max(6, next.energy - 1.5)
      next.affinity = Math.min(100, next.affinity + 0.8)
      if (next.energy < 28) {
        next.mood = 'tired'
        next.note = '连着干了不少，有点撑不住'
      } else if (next.mood === 'worried') {
        next.mood = 'calm'
        next.note = '事办完了，松口气'
      }
      break
    }
    case 'tool-ok': {
      next.energy = Math.max(6, next.energy - 1)
      if (next.energy > 35) {
        next.mood = 'proud'
        next.note = '活儿顺了，有点小得意'
      }
      break
    }
    case 'tool-fail': {
      next.energy = Math.max(6, next.energy - 2)
      next.mood = 'worried'
      next.note = '卡住了，在想办法'
      break
    }
    case 'praise': {
      next.affinity = Math.min(100, next.affinity + 4)
      next.mood = 'happy'
      next.note = '被夸了，尾巴在摇'
      break
    }
    case 'scold': {
      next.affinity = Math.max(0, next.affinity - 5)
      next.mood = 'annoyed'
      next.note = '被怼了，嘴上不说但不痛快'
      break
    }
    case 'late-night': {
      next.energy = Math.max(6, next.energy - 6)
      next.mood = 'tired'
      next.note = '这个点还没睡，眼都花了'
      break
    }
    case 'curious': {
      next.mood = 'curious'
      next.note = '这个问题有点意思'
      break
    }
    case 'reset': {
      return defaultMood(now)
    }
    default:
      break
  }

  // 凌晨保底：不管上面算了什么，这个点就是困。
  if (hour >= 0 && hour < 6 && MOOD_IDS.includes(next.mood) && next.mood !== 'tired' && next.energy < 55) {
    next.mood = 'tired'
    next.note = next.note || '凌晨了，眼皮打架'
  }

  next.energy = Math.round(Math.max(0, Math.min(100, next.energy)) * 10) / 10
  next.affinity = Math.round(Math.max(0, Math.min(100, next.affinity)) * 10) / 10
  if (next.mood !== current.mood || ['praise', 'scold', 'tool-ok', 'tool-fail', 'late-night', 'curious'].includes(kind)) next.emotionAt = now
  next.at = now
  return next
}

/** 给界面的展示信息。 */
export function view(state, now = Date.now()) {
  const current = refresh(state, now)
  const meta = MOODS[current.mood] || MOODS.calm
  return {
    mood: current.mood,
    label: meta.label,
    face: meta.face,
    color: meta.color,
    energy: Math.round(current.energy),
    affinity: Math.round(current.affinity),
    note: current.note || '',
    turns: current.turns || 0,
    at: current.at,
  }
}

/** 渲染成提示词里的一段：只给方向，不让它每句都汇报心情。 */
export function buildMoodBlock(state, now = Date.now()) {
  const info = view(state, now)
  const closeness = info.affinity >= 75 ? '很熟，可以放开一点' : info.affinity >= 45 ? '算熟' : info.affinity >= 25 ? '还在熟悉' : '刚认识，客气些'
  const vigor = info.energy >= 70 ? '精神足' : info.energy >= 45 ? '正常' : info.energy >= 25 ? '有点乏' : '快没电了'
  return [
    `你此刻的状态：${info.label}（${info.note || '没什么特别'}）。`,
    `精力 ${info.energy}/100（${vigor}）；和用户的关系 ${info.affinity}/100（${closeness}）。`,
    '让语气跟着这个状态走：乏了就说得短一点，得意也别吹过头，不爽可以直说但别迁怒。',
    '情绪是你的底色，不是台词：可以自然流露（句子长短、语气词、要不要撒娇/吐槽、主动追问一句），但不要汇报心情、不要每句都带情绪词、不要解释「我为什么开心」。',
  ].join('\n')
}
