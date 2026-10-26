import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { dataDir } from './store.js'
import { resolveExecutable } from './chromium.js'
import { cookieSource, getCookie, setCookie } from './logins.js'
import { CREATIVE_PLATFORMS } from './creative-platforms.js'

export const PROFILE_DIR = path.join(dataDir(), 'browser')
export const PLATFORM_DOMAINS = { bilibili: '.bilibili.com', douyin: '.douyin.com', xiaohongshu: '.xiaohongshu.com', qzone: '.qzone.qq.com', ...Object.fromEntries(CREATIVE_PLATFORMS.map((p) => [p.id, p.domain])) }
let context, launching, visible = false
const reserved = new WeakSet()
export function reservePage(page) { reserved.add(page); return page }
export function isReservedPage(page) { return reserved.has(page) }
const imported = new Map()

export function parseCookieHeader(header, domain) {
  return String(header || '').split(';').map((s) => {
    const at = s.indexOf('=')
    return at > 0 ? { name: s.slice(0, at).trim(), value: s.slice(at + 1).trim(), domain, path: '/', secure: true, httpOnly: false, sameSite: 'Lax' } : null
  }).filter((r) => r?.name)
}

async function importCookies(ctx) {
  for (const [platform, domain] of Object.entries(PLATFORM_DOMAINS)) {
    const value = getCookie(platform)
    if (!value) continue
    const hash = createHash('sha256').update(value).digest('hex')
    if (imported.get(platform) === hash) continue
    // 浏览器 profile 自己还带着登录态时不要覆盖（保存的旧副本可能已过期）。
    const existing = await ctx.cookies(`https://${domain.replace(/^\./, '')}/`).catch(() => [])
    if (existing.some((c) => c.value && ['p_skey', 'skey', 'SESSDATA', 'sessionid', 'sessionid_ss', 'sid_guard'].includes(c.name))) {
      imported.set(platform, hash)
      continue
    }
    // qzone 等平台保存的是完整 cookie 数组（含 qq.com 主域），旧数据仍是分号串。
    let rows = null
    try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) rows = parsed } catch {}
    await ctx.addCookies(rows || parseCookieHeader(value, domain))
    imported.set(platform, hash)
  }
}

export async function getBrowserContext({ headless = true } = {}) {
  if (launching) await launching
  if (context && !headless && !visible) await closeContext()
  if (!context) {
    launching = (async () => {
      const { chromium } = await import('playwright-core')
      fs.mkdirSync(PROFILE_DIR, { recursive: true })
      const created = await chromium.launchPersistentContext(PROFILE_DIR, {
        executablePath: resolveExecutable(), headless, viewport: { width: 1280, height: 800 },
        args: ['--no-first-run', '--no-default-browser-check'],
      })
      context = created; visible = !headless; imported.clear()
      created.on('close', () => { if (context === created) context = undefined })
    })().finally(() => { launching = undefined })
    await launching
  }
  await importCookies(context)
  return context
}

export async function exportPlatformCookies(platform) {
  if (!context || !PLATFORM_DOMAINS[platform]) return false
  const domain = PLATFORM_DOMAINS[platform].slice(1)
  // qzone 的登录态横跨 qzone.qq.com 和 qq.com 主域（uin/skey 在主域，p_skey 在空间域），
  // 只存 .qzone.qq.com 会在重启后恢复出一个「少一半」的会话，所以整包存 qq.com 相关 cookie。
  const inScope = platform === 'qzone'
    ? (d) => d === 'qq.com' || d.endsWith('.qq.com')
    : (d) => d === domain || d.endsWith(`.${domain}`)
  const rows = (await context.cookies()).filter((c) => inScope(c.domain.replace(/^\./, '')))
  if (!rows.length) return false
  const value = platform === 'qzone'
    ? JSON.stringify(rows.map(({ name, value, domain, path, expires, httpOnly, secure, sameSite }) => ({ name, value, domain, path, expires, httpOnly, secure, sameSite })))
    : rows.map((c) => `${c.name}=${c.value}`).join('; ')
  setCookie(platform, value, { source: 'browser' })
  imported.set(platform, createHash('sha256').update(value).digest('hex'))
  return true
}

export async function clearPlatformCookies(platform) {
  imported.delete(platform)
  // Open the same profile so clearing a saved login also clears its browser copy.
  const ctx = context || await getBrowserContext()
  const domain = PLATFORM_DOMAINS[platform]?.slice(1)
  if (!domain) return
  for (const row of await ctx.cookies()) if (row.domain.replace(/^\./, '') === domain || row.domain.endsWith(`.${domain}`)) await ctx.clearCookies({ name: row.name, domain: row.domain })
}

export async function closeContext() {
  const current = context
  if (!current) return
  for (const platform of Object.keys(PLATFORM_DOMAINS)) await exportPlatformCookies(platform)
  context = undefined
  await current.close()
}

export function contextStatus() { return { running: Boolean(context), visible, profile: PROFILE_DIR, engine: 'playwright' } }
