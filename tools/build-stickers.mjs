/**
 * 把大肥鱼的表情包图库打包进插件。
 *
 * 为什么要「复制 + 生成索引」而不是运行时直接读原目录：
 * 原图库挂在 dsh-meme 插件包里（那个插件已被禁用，随时可能被删），
 * 另一个在 data/meme-packs 下。运行期依赖它们等于把功能押在别人的目录上。
 *
 * 所以在构建时把图片抄进 assets/stickers/，把 caption/关键词抄成 assets/stickers.json。
 * 运行期只读自己包里的东西，谁删了都不影响。
 *
 *   node tools/build-stickers.mjs
 *
 * index.db 用的是 node:sqlite（Node 22 自带）。构建时才需要，运行期不需要。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG = path.join(HERE, '..')
const OUT_DIR = path.join(PKG, 'assets', 'stickers')
const OUT_JSON = path.join(PKG, 'assets', 'stickers.json')

/** 已知的两套大肥鱼图库。找不到就跳过，不报错。 */
const SOURCES = [
  {
    key: 'dafeiyu-001',
    dir: 'D:/30651/DeepSeekHarness/data/profiles/desktop/node_modules/dsh-meme.disabled-20261022010850/memes/dafeiyu-001',
  },
  { key: 'dafeiyu-states', dir: 'D:/30651/DeepSeekHarness/data/meme-packs/dafeiyu-states' },
]

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])

function readIndex(dir) {
  const rows = []
  const dbFile = path.join(dir, 'index.db')
  if (!fs.existsSync(dbFile)) return rows
  let db
  try {
    db = new DatabaseSync(dbFile, { readOnly: true })
    const all = db.prepare('select path, tag, file_name, caption, keywords from memes').all()
    for (const row of all) rows.push(row)
  } catch (error) {
    console.warn(`  ! ${dir} 的 index.db 读不出来，退回按文件名建：${error?.message || error}`)
  } finally {
    try {
      db?.close?.()
    } catch {
      // 关不掉无所谓
    }
  }
  return rows
}

/** 没有索引时至少用文件名当说明，别让整张图变成无名氏。 */
function fallbackRows(dir) {
  const rows = []
  const walk = (now, depth) => {
    let entries = []
    try {
      entries = fs.readdirSync(now, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(now, entry.name)
      if (entry.isDirectory() && depth < 3) walk(full, depth + 1)
      else if (entry.isFile() && IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) {
        const rel = path.relative(dir, full).split(path.sep).join('/')
        rows.push({ path: rel, tag: path.basename(path.dirname(rel)), file_name: entry.name, caption: '', keywords: '' })
      }
    }
  }
  walk(dir, 0)
  return rows
}

function readManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  } catch {
    return {}
  }
}

fs.rmSync(OUT_DIR, { recursive: true, force: true })
fs.mkdirSync(OUT_DIR, { recursive: true })

const packs = []
const items = []
let missing = 0

for (const source of SOURCES) {
  if (!fs.existsSync(source.dir)) {
    console.warn(`  ! 跳过 ${source.key}：目录不存在`)
    continue
  }
  const manifest = readManifest(source.dir)
  let rows = readIndex(source.dir)
  if (!rows.length) rows = fallbackRows(source.dir)

  let copied = 0
  for (const row of rows) {
    const rel = String(row.path || '').replace(/\\/g, '/')
    const src = path.join(source.dir, rel)
    if (!fs.existsSync(src)) {
      missing += 1
      continue
    }
    const ext = path.extname(rel).toLowerCase()
    const tag = String(row.tag || 'misc')
    const base = path.basename(rel, ext)
    const file = `${source.key}__${tag}__${base}${ext}`
    fs.copyFileSync(src, path.join(OUT_DIR, file))
    copied += 1
    items.push({
      id: `${source.key}:${rel}`,
      pack: source.key,
      tag,
      file,
      caption: String(row.caption || '').trim(),
      keywords: String(row.keywords || '')
        .split(/[\s,，、]+/)
        .map((word) => word.trim())
        .filter(Boolean),
    })
  }

  packs.push({
    id: source.key,
    name: manifest.name || source.key,
    description: manifest.description || '',
    count: copied,
  })
  console.log(`  ${source.key}: ${copied} 张（${manifest.name || ''}）`)
}

const payload = {
  version: 1,
  builtAt: new Date().toISOString(),
  packs,
  items,
}
fs.writeFileSync(OUT_JSON, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

const bytes = items.reduce((sum, item) => {
  try {
    return sum + fs.statSync(path.join(OUT_DIR, item.file)).size
  } catch {
    return sum
  }
}, 0)

console.log(`\n共 ${items.length} 张 / ${Math.round(bytes / 1024)}KB -> assets/stickers/`)
console.log(`索引 -> assets/stickers.json`)
if (missing) console.log(`（有 ${missing} 条索引在磁盘上找不到图片，已跳过）`)
