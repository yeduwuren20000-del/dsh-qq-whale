/**
 * 大肥鱼的表情包库（发图给 QQ 用）。
 *
 * 数据来源：`tools/build-stickers.mjs` 把两套图库（24 张日常表情 + 13 张工作状态）
 * 抄进 `assets/stickers/`，同时把 caption 和关键词抄成 `assets/stickers.json`。
 * 所以运行期不依赖任何外部插件目录，也不需要 sqlite。
 *
 * 选图分两步：
 * 1. 先按「这句话里提到了什么」找 —— 关键词命中权重最高（她说"饿死了"，就该发干饭）。
 * 2. 再按当前心情兜底 —— 心情到 tag 的映射在 MOOD_TAGS 里。
 *
 * 刻意不做的事：不按文件哈希随机到「完全不搭」的图。发表情包的意义是贴题，
 * 发错比不发更尴尬。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets')
const DIR = path.join(ASSETS, 'stickers')
const INDEX = path.join(ASSETS, 'stickers.json')

/** 心情 -> 优先 tag。顺序代表优先级。 */
const MOOD_TAGS = {
  happy: ['happy', 'like', 'morning'],
  proud: ['happy', 'like'],
  tired: ['sleep', 'work', 'sigh', 'tangping'],
  annoyed: ['angry', 'fool', 'sigh'],
  worried: ['confused', 'cpu', 'sad'],
  curious: ['confused', 'see'],
  calm: ['daily', 'happy'],
}

/** 静态表情包的老生常谈：这些 tag 在聊天里最容易"贴题"，平时优先。 */
const CHAT_TAGS = new Set(['happy', 'daily', 'confused', 'angry', 'like', 'shy', 'sad', 'sleep', 'morning'])

let cache = null

/** 读索引并丢掉磁盘上真没文件的条目（图库被换过也不会炸）。 */
export function load() {
  if (cache) return cache
  let raw = { packs: [], items: [] }
  try {
    raw = JSON.parse(fs.readFileSync(INDEX, 'utf8'))
  } catch {
    cache = { packs: [], items: [], dir: DIR, ready: false }
    return cache
  }
  const items = []
  for (const item of Array.isArray(raw.items) ? raw.items : []) {
    const file = path.join(DIR, item.file)
    if (!fs.existsSync(file)) continue
    items.push({ ...item, path: file })
  }
  cache = {
    packs: Array.isArray(raw.packs) ? raw.packs : [],
    items,
    dir: DIR,
    ready: items.length > 0,
    builtAt: raw.builtAt || '',
  }
  return cache
}

export function stats() {
  const pack = load()
  const byTag = {}
  for (const item of pack.items) byTag[item.tag] = (byTag[item.tag] || 0) + 1
  return {
    total: pack.items.length,
    packs: pack.packs,
    tags: byTag,
    dir: pack.dir,
    builtAt: pack.builtAt,
    ready: pack.ready,
  }
}

function haystack(item) {
  if (!item._hay) {
    item._hay = `${item.tag} ${item.caption} ${(item.keywords || []).join(' ')}`.toLowerCase()
  }
  return item._hay
}

/**
 * 搜表情包。
 * @param {{ q?: string, tag?: string, limit?: number }} options
 */
export function search(options = {}) {
  const pack = load()
  if (!pack.ready) return []
  const q = String(options.q || '').trim().toLowerCase()
  const tag = String(options.tag || '').trim()
  const limit = Math.max(1, Math.min(Number(options.limit) || 8, 30))

  let rows = pack.items
  if (tag) rows = rows.filter((item) => item.tag === tag)
  if (!q) return rows.slice(0, limit)

  const scored = []
  for (const item of rows) {
    let score = 0
    // 关键词整词命中权重最高：那是这张图最想表达的几件事。
    for (const word of item.keywords || []) {
      const w = word.toLowerCase()
      if (w && q.includes(w)) score += 6
      else if (w && w.includes(q)) score += 2
    }
    if (item.caption && item.caption.toLowerCase().includes(q)) score += 3
    if (item.tag.toLowerCase().includes(q)) score += 2
    if (haystack(item).includes(q)) score += 1
    if (score > 0) scored.push({ item, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((row) => row.item)
}

/**
 * 挑一张。优先按对话内容，退化成按心情，最后按「适合聊天」的 tag 随机。
 * @param {{ text?: string, mood?: string, recent?: string[], exclude?: string }} options
 */
export function pick(options = {}) {
  const pack = load()
  if (!pack.ready) return null
  const text = String(options.text || '').toLowerCase()
  const exclude = new Set(options.exclude || [])
  // 刚发过的几张先排后面，别连着发同一张。
  for (const id of options.recent || []) exclude.add(id)
  const pool = pack.items.filter((item) => !exclude.has(item.id))
  const usable = pool.length ? pool : pack.items

  if (text) {
    const hit = search({ q: text, limit: 6 }).filter((item) => usable.includes(item))
    if (hit.length) return pickOne(hit)
  }

  const tags = MOOD_TAGS[String(options.mood || 'calm')] || MOOD_TAGS.calm
  for (const tag of tags) {
    const bucket = usable.filter((item) => item.tag === tag)
    if (bucket.length) return pickOne(bucket)
  }

  const chatty = usable.filter((item) => CHAT_TAGS.has(item.tag))
  return pickOne(chatty.length ? chatty : usable)
}

function pickOne(rows) {
  if (!rows?.length) return null
  return rows[Math.floor(Math.random() * rows.length)]
}

/** OneBot v11 的图片段。base64 走网关不依赖本地路径，最省事。 */
export function imageSegment(item) {
  if (!item?.path) return null
  const data = fs.readFileSync(item.path)
  const ext = path.extname(item.path).replace('.', '').toLowerCase()
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
  return {
    type: 'image',
    data: { file: `base64://${data.toString('base64')}`, sub_type: 0, summary: item.caption ? `[表情包]${item.caption}` : '[表情包]' },
    _mime: mime,
  }
}

/** 只读一次文件，给前端缩略图用。 */
export function bytesOf(item) {
  try {
    return fs.readFileSync(item.path)
  } catch {
    return null
  }
}

export function fileOf(id) {
  return load().items.find((item) => item.id === id) || null
}

/** 拼给模型看的一行说明，别把 37 张的全量描述塞进提示词。 */
export function renderHint() {
  const pack = load()
  if (!pack.ready) return ''
  const rows = pack.packs.map((p) => `${p.name}（${p.count} 张）`).join('、')
  const tags = Object.entries(stats().tags)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag, count]) => `${tag}×${count}`)
    .join(' ')
  return `可选表情包：${rows}；按心情/关键词挑，挑不到就不发。tag 分布：${tags}`
}
