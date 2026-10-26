/**
 * 文件收发：你把文档交给她，她也能把文档递回给你。
 *
 * 两个目录，分工固定：
 *   inbox/  你丢进来的东西（她从这儿读）
 *   outbox/ 她要交给你的东西（前端只从这儿给下载按钮）
 *
 * 为什么不让你直接给绝对路径：桌面端下确实能读，但原文件一改名/移动/删除就断，
 * 而且模型看到一条裸路径容易去猜。收一份副本进 inbox，路径就稳定了。
 *
 * 为什么下载只认 outbox 里的文件名、不接受任意路径：那是把整个磁盘暴露给网页。
 * 文件名一律 basename + 白名单校验，越界即拒。
 */
import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from './store.js'

/** 单文件上限。base64 走 JSON 会膨胀 1/3，所以别开太大。 */
export const MAX_FILE = 24 * 1024 * 1024

export function inboxDir() {
  return path.join(dataDir(), 'inbox')
}

export function outboxDir() {
  return path.join(dataDir(), 'outbox')
}

// 保留中文和空格，只清掉路径分隔符、Windows 保留字符和控制字符。
const BAD = /[\\/:*?"<>|\u0000-\u001f]/g

export function safeName(raw, fallback = 'file') {
  const tail = String(raw || '').split(/[\\/]/).pop() || ''
  let name = tail.replace(BAD, '_').replace(/\s+/g, ' ').trim()
  // 开头的点会让文件在资源管理器里变隐藏；连续的点还可能拼出 `..`。
  name = name.replace(/^\.+/, '')
  if (!name) name = fallback
  if (name.length > 80) {
    const ext = path.extname(name).slice(0, 12)
    name = name.slice(0, Math.max(1, 80 - ext.length)) + ext
  }
  return name
}

function uniqueIn(dir, name) {
  const ext = path.extname(name)
  const base = name.slice(0, name.length - ext.length)
  let candidate = name
  let i = 1
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base}-${i}${ext}`
    i += 1
    if (i > 999) throw new Error('同名文件太多了')
  }
  return candidate
}

function rowOf(dir, name) {
  const full = path.join(dir, name)
  let stat
  try {
    stat = fs.statSync(full)
  } catch {
    return null
  }
  if (!stat.isFile()) return null
  return { name, path: full, size: stat.size, at: stat.mtimeMs, where: path.basename(dir) }
}

function recentIn(dir, limit = 20) {
  let names
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  return names
    .map((name) => rowOf(dir, name))
    .filter(Boolean)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
}

/**
 * 收一份文件进 inbox。
 * @param {{name?: string, data?: string|Buffer}} input - data 可以是 base64 字符串或 Buffer
 * @returns {object|null} 落盘后的信息；空文件返回 null
 */
export function saveInbox({ name, data } = {}) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data || ''), 'base64')
  if (!buf.length) return null
  if (buf.length > MAX_FILE) throw new Error(`文件超过 ${Math.round(MAX_FILE / 1024 / 1024)}MB`)
  const dir = inboxDir()
  fs.mkdirSync(dir, { recursive: true })
  const file = uniqueIn(dir, safeName(name))
  fs.writeFileSync(path.join(dir, file), buf)
  return rowOf(dir, file)
}

/**
 * 按 URL 收一份文件进 inbox（QQ 来的文件走这里）。
 *
 * QQ 图床/文件服务器对 UA 和 Referer 有要求，缺一个就 403，
 * 所以这里带上和图片下载一样的两条头。
 *
 * @param {string} url
 * @param {{ name?: string, timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: boolean, row?: object, error?: string }>}
 */
export async function saveFromUrl(url, options = {}) {
  const target = String(url || '').trim()
  if (!/^https?:\/\//i.test(target)) return { ok: false, error: '文件地址不是 http(s)' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 30000)
  timer.unref?.()
  let res
  try {
    res = await fetch(target, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        Referer: 'https://im.qq.com/',
      },
    })
  } catch (error) {
    clearTimeout(timer)
    return { ok: false, error: `下载失败：${error?.message || error}` }
  }
  clearTimeout(timer)
  if (!res?.ok) return { ok: false, error: `下载失败：HTTP ${res?.status}` }
  let buf
  try {
    buf = Buffer.from(await res.arrayBuffer())
  } catch (error) {
    return { ok: false, error: `读文件失败：${error?.message || error}` }
  }
  if (!buf.length) return { ok: false, error: '文件是空的' }
  if (buf.length > MAX_FILE) return { ok: false, error: `文件超过 ${Math.round(MAX_FILE / 1024 / 1024)}MB` }
  try {
    const row = saveInbox({ name: options.name, data: buf })
    return row ? { ok: true, row } : { ok: false, error: '存文件失败' }
  } catch (error) {
    return { ok: false, error: String(error?.message || error) }
  }
}

/**
 * 在指定的箱子里按名字找一个文件。
 * 只允许纯文件名（basename），`../` 之类一律找不到。
 *
 * @param {'inbox'|'outbox'} box
 * @param {string} name
 */
export function findIn(box, name) {
  const dir = box === 'outbox' ? outboxDir() : inboxDir()
  const base = path.basename(String(name || ''))
  if (!base || base !== String(name || '')) return null
  return rowOf(dir, base)
}

/**
 * 把一份文件放进 outbox，好让前端给下载按钮。
 * @param {string} source - 源文件绝对路径
 * @param {string} [name] - 交付时的文件名（缺省沿用源文件名）
 */
export function handover(source, name) {
  const src = String(source || '').trim()
  if (!src) return null
  const full = path.resolve(src)
  const stat = fs.statSync(full) // 不存在就抛，让工具层把原因带回去
  if (!stat.isFile()) throw new Error('那是个目录，不是文件')
  if (stat.size > MAX_FILE) throw new Error(`文件超过 ${Math.round(MAX_FILE / 1024 / 1024)}MB`)
  if (stat.size === 0) return null
  const dir = outboxDir()
  fs.mkdirSync(dir, { recursive: true })
  const file = uniqueIn(dir, safeName(name || path.basename(full), 'handover.bin'))
  fs.copyFileSync(full, path.join(dir, file))
  return rowOf(dir, file)
}

/** 下载前校验：只允许 outbox 里的纯文件名。 */
export function resolveOutbox(name) {
  const base = path.basename(String(name || ''))
  if (!base || base !== String(name || '')) return null
  const full = path.join(outboxDir(), base)
  if (!full.startsWith(outboxDir() + path.sep)) return null
  return rowOf(outboxDir(), base)
}

// 只做「别让浏览器把它当网页渲染」这件事，不追求全量表。
const MIME = {
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/plain; charset=utf-8', // 当纯文本给，避免在本地执行
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
}

export function mimeOf(name) {
  return MIME[path.extname(String(name || '')).toLowerCase()] || 'application/octet-stream'
}

export function listFiles(limit = 20) {
  return { inbox: recentIn(inboxDir(), limit), outbox: recentIn(outboxDir(), limit) }
}

export function filesStats() {
  const { inbox, outbox } = listFiles(50)
  const sum = (rows) => rows.reduce((n, row) => n + row.size, 0)
  return {
    inbox: { count: inbox.length, bytes: sum(inbox) },
    outbox: { count: outbox.length, bytes: sum(outbox) },
    dirs: { inbox: inboxDir(), outbox: outboxDir() },
  }
}

/** 给提示词用的一句：有文件就报名字，没有就不占地方。 */
export function renderFilesBlock() {
  const { inbox, outbox } = listFiles(5)
  if (!inbox.length && !outbox.length) return ''
  const lines = []
  if (inbox.length) {
    lines.push('用户最近交给你这些文件（你可以直接读，路径就是下面这个）：')
    lines.push(...inbox.map((row) => `- ${row.name}（${kb(row.size)}）${row.path}`))
  }
  if (outbox.length) {
    lines.push('你最近交付过的文件（已经在发件箱里，用户能直接下载）：')
    lines.push(...outbox.map((row) => `- ${row.name}（${kb(row.size)}）`))
  }
  return lines.join('\n')
}

function kb(bytes) {
  const n = Number(bytes) || 0
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`
  if (n >= 1024) return `${Math.round(n / 1024)}KB`
  return `${n}B`
}
