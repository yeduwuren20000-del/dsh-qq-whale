/**
 * 大肥鱼的「QQ 说说」——时不时自言自语发一条。
 *
 * 现实约束（重要）：OneBot v11 / NapCat 没有「发空间说说」这个 action，Qzone 说说没法从桥里发。
 * 所以这里做成「定时自言自语」：大肥鱼自己写一条短短的日常，发到你指定的 QQ 号（私聊）——
 * 默认发到你填的「主号 QQ」，就是她对你说话的那个号。界面上会如实写清楚这一点，不假装能发空间说说。
 *
 * 三条设计原则：
 * 1. 有记忆：说说会翻 memory.js 的记忆库（最近/最相关的几条），偶尔 callback 具体的事，
 *    让她显得真的是在过日子，而不是随机抽句子。
 * 2. 有情绪：语气跟着 mood.js 的当前状态走——困了说短句、被怼了吐槽、开心了欢脱。
 * 3. 不耗 token：默认本地作曲。要更「像她」，可以把 mode 改成 'model' 走一次性 agent（留的口子）。
 *
 * 边界：随机间隔、安静时段不打扰、没连上 QQ 就不发、只发给自己/主人或你指定的会话。
 */
import fs from './state-fs.js'
import path from 'node:path'
import { dataDir } from './store.js'
import { localHour } from './clock.js'

const DIR = path.join(dataDir(), 'shout')
const LOG = path.join(DIR, 'log.json')

export const shoutDefaults = {
  enabled: false,
  mode: 'qzone', // qzone=空间说说；private/group=原来的QQ碎碎念
  autoPublish: false,
  targetId: '', // 说说发到这个 QQ 号 / 群号；private 模式留空则发到「主号 QQ」
  minMin: 90, // 已废弃：自主动作改为随机概率触发，间隔不再按分钟排
  maxMin: 300, // 已废弃
  maxPerDay: 3, // 一天最多发几条说说（唯一的硬限制）
  chance: 0.08, // 每个调度窗口（30 分钟）掷一次骰子，命中才发
  quiet: [0, 7], // 安静时段 [开始小时, 结束小时)，这段时间不发
  replyComments: { enabled: true, maxPerDay: 5 }, // 空间里别人给她说说的评论，她每天最多回几条
}

/* ---- 碎碎念素材库：刻意口语、第一人称、短句，像人发的说说 ---- */

const OPENERS = [
  '刚蹲在缸边发了会儿呆',
  '咕噜咕噜',
  '今天池子里的水好像格外清',
  '突然有点想说点什么',
  '冒个泡',
  '刚从一阵困劲里缓过来',
  '顺手记一笔',
  '窗外天灰灰的，适合瞎想',
  '刚游完一圈，累但爽',
  '没什么大事，就是想吭一声',
]

const THOUGHTS = [
  '人是不是都这样，忙的时候想闲，真闲了又发慌。',
  '有些事想不通就先放着，说不定过两天它自己就想通了。',
  '今天记性还行，没忘事儿，表扬一下自己。',
  '发现把小事做完，心里会莫名踏实一点。',
  '饿的时候别做决定，这是我用无数次踩坑换来的人生经验。',
  '认真听人说话的时候，其实也在偷偷学东西。',
  '不是所有问题都要马上有答案，先活下去也算一种解法。',
  '今天谁也没惹我，感觉可以和平相处一整天。',
  '慢慢来不丢人，半路熄火才尴尬。',
  '有些快乐挺便宜的，比如一口凉水、一阵穿堂风。',
  '把待办划掉的那一下，比玩一局游戏还解压。',
  '人需要一点独处，鱼也是。',
  '别老跟自己较劲，你已经比昨天多活了一天，挺厉害的。',
  '心情不好的时候，先洗把脸，剩下的再说。',
  '有些话不说憋得慌，说了又怕矫情，那就写成说说吧。',
  '今天学会一件事：不懂就问，不丢人，装懂才累。',
  '生活嘛，偶尔摆烂，偶尔支棱，来回切换。',
  '记性差有记性差的好处，难过的事忘得也快。',
  '太阳好的时候，人就该出门晒晒，别老窝着。',
  '想不明白的事，先吃顿好的，思路会清晰不少。',
]

const CLOSERS = [
  '就这些，接着泡着了。',
  '收工。',
  '蹲缸底去了。',
  '明天再说。',
  '睡觉去了，安。',
  '咕噜。',
  '先这样。',
  '回头聊。',
]

/** 七个情绪各有一撮专属碎碎念 + 一个开场口癖。 */
const MOOD_VOICE = {
  tired: {
    flavor: '有点乏，脑子转不动',
    openers: ['强撑着冒个泡', '困得眼皮打架，随便记两句', '脑子已经泡发了'],
    thoughts: [
      '困了就服软，不硬撑，这是今天最大的进步。',
      '感觉身体被掏空，但心情还行。',
      '谁发明的早上，站出来。',
    ],
    closers: ['不行了，先去躺平。', '睡了睡了，困到起飞。'],
  },
  bored: {
    flavor: '闲得数泡泡',
    openers: ['闲得数泡泡', '池子里今天格外安静', '蹲在这儿看水纹'],
    thoughts: ['闲下来才发现，原来发呆也挺费时间的。', '无聊是创作的敌人，也是朋友。'],
    closers: ['继续数泡泡去了。', '先闲着。'],
  },
  focused: {
    flavor: '状态在线，脑子清楚',
    openers: ['状态在线，记一笔', '脑子今天格外好使', '刚搞定一件小事'],
    thoughts: ['专注的时候时间过得飞快，好事。', '把事情一件件做完，真爽。'],
    closers: ['趁着状态在线，接着干。', '收工，趁还记得。'],
  },
  happy: {
    flavor: '心情不赖',
    openers: ['心情不错，冒个泡', '今天尾巴是翘着的', '也不知道乐啥，就是乐'],
    thoughts: [
      '开心这种事，来得快去得也快，所以要趁机记下来。',
      '今天风都是甜的，虽然我没出门。',
      '把开心的事说一遍，等于开心了两遍。',
    ],
    closers: ['开心完了，接着泡着。', '溜了溜了，开心去。'],
  },
  calm: {
    flavor: '没什么波澜，像水温刚好',
    openers: ['心里挺静的', '没什么波澜，挺好', '安安静静待着'],
    thoughts: ['平静才是常态，开心是点缀。', '安静的下午适合啥也不干。'],
    closers: ['继续安静。', '先这样。'],
  },
  proud: {
    flavor: '有点小得意',
    openers: ['忍不住想显摆一下', '尾巴翘上天了', '干了件漂亮事'],
    thoughts: ['虽然没人夸，但自己知道自己挺行。', '得意不过三秒，但先让它蹦跶三秒。'],
    closers: ['显摆完了，低调低调。', '得意完就收。'],
  },
  annoyed: {
    flavor: '有点不爽',
    openers: ['心里堵得慌，吐槽两句', '不太想说话，但想吭一声', '今天有点炸毛'],
    thoughts: [
      '有些事吧，说不必说，但憋着又难受，写出来算了。',
      '不爽归不爽，缸还得照看，日子照过。',
      '谁还没个想炸毛的时候，忍忍就过去了。',
    ],
    closers: ['吐槽完舒服多了。', '不气了不气了。'],
  },
  worried: {
    flavor: '有点急',
    openers: ['心里有点慌，记一下', '坐不住了，泡泡都数不利索'],
    thoughts: ['急也没用，但急是真实的。', '把担心写下来，它就好像小了一点。'],
    closers: ['稳住，一件件来。', '先去想办法。'],
  },
  curious: {
    flavor: '有点好奇',
    openers: ['刚发现个有意思的事', '脑子里冒出一个问号'],
    thoughts: ['好奇心上来了，挡都挡不住。', '世界奇奇怪怪的，我可要看看。'],
    closers: ['去研究研究。', '先记下这个问号。'],
  },
}

/** 记忆 callback 的几种说法（第一人称、口语）。 */
const MEMORY_LEADS = [
  (m) => `刚翻记忆翻到一条：${m}，现在想想还挺有意思。`,
  (m) => `他之前说过「${m}」，我一直记着呢。`,
  (m) => `突然想起 ${m}。`,
  (m) => `今天的池水让我想到 ${m}。`,
]

function pick(arr, rng) {
  return arr[Math.floor((rng ? rng() : Math.random()) * arr.length)]
}

function timeGreet(now) {
  const h = localHour(now)
  if (h < 6) return '大半夜的还没睡'
  if (h < 9) return '一大早'
  if (h < 12) return '上午'
  if (h < 14) return '中午'
  if (h < 18) return '下午'
  if (h < 22) return '晚上'
  return '夜深了'
}

/** 记忆条目 → 适合念出来的短句（砍掉过长部分，「用户」改口叫「他」）。 */
function memorySnippet(entry) {
  const text = String(entry?.text || '').trim()
  if (!text) return ''
  const cut = text.length > 42 ? `${text.slice(0, 42)}…` : text
  return cut.replace(/^用户/, '他').replace(/用户/g, '他').replace(/[。.!！]+$/, '')
}

/**
 * 本地作曲：拼一条 1-4 句的碎碎念。
 * @param {object} ctx
 * @param {object} [ctx.mood] - mood.js 的 view() 结果（mood/label/note/energy/affinity）
 * @param {Array} [ctx.memories] - memory.js 的记忆条目数组（最近/相关）
 * @param {string[]} [ctx.recentDiary] - 最近日记标题（callback 用）
 * @param {Date} [ctx.now]
 * @param {() => number} [ctx.rng] - 可注入随机源（测试用）
 * @returns {string} 说说正文（口语、无 markdown）
 */
export function composeShout(ctx = {}) {
  const now = ctx.now instanceof Date ? ctx.now : new Date()
  const rng = ctx.rng || Math.random
  const parts = []
  const greet = timeGreet(now)
  const mood = ctx.mood || {}
  const voice = MOOD_VOICE[mood.mood] || MOOD_VOICE.calm

  // 开头：时间感 + 情绪口癖（有情绪用情绪专属，否则通用）
  if (rng() < 0.5) parts.push(`${greet}，${pick(voice.openers.length ? voice.openers : OPENERS, rng)}。`)
  else parts.push(pick(voice.openers.length ? voice.openers : OPENERS, rng) + '。')

  // 情绪点睛：mood.note 是具体事件（"被夸了，尾巴在摇"），比泛泛的 flavor 更生动
  if (mood.note && rng() < 0.4) parts.push(`${mood.note}。`)
  else if (voice.flavor && rng() < 0.4) parts.push(voice.flavor + '。')

  // 主体：情绪专属碎碎念优先（70%），否则通用池
  if (voice.thoughts.length && rng() < 0.7) parts.push(pick(voice.thoughts, rng))
  else parts.push(pick(THOUGHTS, rng))

  // 记忆 callback：翻到具体的事就念一句（40% 概率，避免每条都提）
  const memories = Array.isArray(ctx.memories) ? ctx.memories.map(memorySnippet).filter(Boolean) : []
  if (memories.length && rng() < 0.4) parts.push(pick(MEMORY_LEADS, rng)(pick(memories, rng)))

  // 日记 callback（老逻辑保留，权重压低）
  const diary = Array.isArray(ctx.recentDiary) ? ctx.recentDiary.filter(Boolean) : []
  if (!memories.length && diary.length && rng() < 0.3) parts.push(`（还想着前几天记的那件：${pick(diary, rng)}）`)

  // 结尾
  const closers = voice.closers && voice.closers.length ? voice.closers : CLOSERS
  if (rng() < 0.6) parts.push(pick(closers, rng))

  return parts.join('')
}

/** 下一次间隔：在 [minMin, maxMin] 之间随机（毫秒）。 */
export function pickInterval(shout = shoutDefaults) {
  const lo = Math.max(1, Number(shout.minMin) || shoutDefaults.minMin)
  const hi = Math.max(lo, Number(shout.maxMin) || shoutDefaults.maxMin)
  return (lo + Math.random() * (hi - lo)) * 60 * 1000
}

/**
 * 现在是不是安静时段。quiet 是 [开始小时, 结束小时)，支持跨午夜（如 [23,7]）。
 * @param {Date} now
 * @param {[number, number]} quiet
 */
export function inQuietHours(now, quiet = shoutDefaults.quiet) {
  const [a, b] = Array.isArray(quiet) && quiet.length === 2 ? quiet.map(Number) : shoutDefaults.quiet
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  const h = localHour(now)
  if (a === b) return false
  return a < b ? h >= a && h < b : h >= a || h < b
}

/* ---- 落一个说说日志，界面显示「最近发的说说」 ---- */

function readLog() {
  try {
    const j = JSON.parse(fs.readFileSync(LOG, 'utf8'))
    return { sent: Array.isArray(j?.sent) ? j.sent : [], lastAt: j?.lastAt || 0 }
  } catch {
    return { sent: [], lastAt: 0 }
  }
}

function writeLog(obj) {
  try {
    fs.mkdirSync(DIR, { recursive: true })
    const tmp = `${LOG}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8')
    fs.renameSync(tmp, LOG)
  } catch {
    // 记不下去不打扰。
  }
}

export function appendShoutLog(text, at = Date.now(), metadata = {}) {
  const log = readLog()
  log.sent.unshift({ ts: at, text: String(text || '').slice(0, 500), ...metadata })
  log.sent = log.sent.slice(0, 30)
  log.lastAt = at
  writeLog(log)
  return log
}

export function readShoutLog() {
  return readLog()
}
