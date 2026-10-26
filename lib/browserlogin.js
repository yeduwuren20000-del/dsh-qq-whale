/**
 * 浏览器扫码登录：抖音 / 小红书 / B站。
 *
 * 为什么需要「真浏览器」：抖音 sso 的 get_qrcode 对裸 HTTP 客户端一律 4031
 * （TLS 指纹 + 无 JS 环境）；小红书的 qrcode 接口要 x-s 签名（xhshow 可算，但还要
 * 先 activate 拿 RSA 会话）。两家都干脆用真 Chrome 打开官方登录页，让页面自己的 JS
 * 生成二维码、自己轮询——我们只负责：把二维码图片抠出来给 DSH 界面显示、等 cookie
 * 出现、把 cookie 收走。全程 headless 不弹窗（用户只在自己手机上扫码）。
 *
 * 已验证的流程（2026-10-26 先用本机 Chrome headless 实测；同日换成自带 Chrome for Testing 156
 * 后复测：小红书出码正常，抖音那次被风控挡住没拿到码——抖音本来就是间歇性风控，不是浏览器换型的锅）：
 *   抖音：www.douyin.com → 点「登录」→ 页面自调 challenge/ticket_guard/get_qrcode
 *        → 登录框扫码 tab 渲染 canvas 二维码 → canvas.toDataURL() 拿图
 *        → 用户扫码后页面自走 check_qrconnect，登录成功即种下 sessionid cookie
 *   小红书：www.xiaohongshu.com/login → 页面自调 activate + qrcode/create
 *        → img.qrcode-img 的 src 就是二维码 dataURL
 *        → 扫码确认后种下 web_session cookie
 *
 * 安全边界：
 *   - 浏览器用内存 profile（launch + newContext，不落盘）——实测持久化 profile 会被
 *     小红书/抖音的风控盯上（直接给"安全限制"页），内存上下文和正常访客无异；
 *   - 登录态不靠浏览器保留：扫码成功即把 cookie 收进 logins.js（和 Cookie 导入同一套
 *     存储），下次直接用 cookie，不用再扫；
 *   - 只从登录成功的域名收 cookie；
 *   - 同一时刻只允许一个扫码会话。
 *
 * 依赖：playwright-core（npm 已装）+ lib/chromium.js 解析出来的浏览器（自带优先）。
 */
import path from 'node:path'
import { dataDir } from './store.js'
import { setCookie } from './logins.js'
import { findExecutable } from './chromium.js'
import { closeContext, exportPlatformCookies, getBrowserContext, reservePage } from './browser-context.js'

/** 登录成功标志：这些 cookie 出现就算登录完成。 */
export const DONE_COOKIE = {
  douyin: 'sessionid',
  xiaohongshu: 'web_session',
  bilibili: 'SESSDATA',
}

/**
 * 小红书特例：未登录游客也有 web_session，所以不能看「有没有」，
 * 要看「变没变」或「页面是否离开了 /login」（扫码确认后会自动跳走）。
 */
const DONE_RULE = {
  douyin: 'appear', // 游客没有 sessionid，出现即登录
  xiaohongshu: 'change-or-leave', // 游客也有 web_session，要变值或离页
  bilibili: 'appear', // 游客没有 SESSDATA，出现即登录
}

/** 当前会用到的浏览器可执行文件；一个都没有返回 null（自带优先，见 lib/chromium.js）。 */
export function findBrowser() {
  return findExecutable()?.path ?? null
}

/* ---- 单例浏览器 + 同时只开一个会话 ---- */

let ctx = null

async function ensureContext({ headless = true } = {}) {
  ctx = await getBrowserContext({ headless })
  return ctx
}

/** 当前进行中的扫码会话（同时只允许一个）。 */
let session = null

export function sessionState() {
  return session ? { platform: session.platform, startedAt: session.startedAt } : null
}

/** 关掉当前会话。 */
export async function cancelQR() {
  const s = session
  session = null
  ctx = null // Only close the QR tab; the shared persistent login survives.
  if (!s) return { ok: true }
  try {
    await s.page?.close()
  } catch {
    // 已经关了
  }
  return { ok: true }
}

/** 关掉浏览器进程（DSH 卸载/退出时调）。 */
export async function closeBrowser() {
  await cancelQR()
  try {
    await closeContext()
  } catch {
    // 已经关了
  }
  return { ok: true }
}

/* ---- 各平台的页面流程 ---- */

/** 等页面里出现二维码，返回它的 dataURL。 */
async function waitForQR(page, platform, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const qr = await page.evaluate((plat) => {
      if (plat === 'douyin') {
        // 抖音：登录框扫码 tab 里的 canvas（QR 矩阵）。取页面第一个够大的 canvas。
        for (const c of document.querySelectorAll('canvas')) {
          const r = c.getBoundingClientRect()
          if (r.width >= 100 && r.height >= 100) {
            try {
              const url = c.toDataURL('image/png')
              if (url && url.length > 1000) return url
            } catch {
              // 跨域污染的 canvas 取不到，试下一个
            }
          }
        }
      } else if (plat === 'xiaohongshu') {
        const img = document.querySelector('img.qrcode-img')
        if (img && img.src.startsWith('data:image')) return img.src
      } else if (plat === 'bilibili') {
        const img = document.querySelector('.login-scan-box img, img.qrcode-img')
        if (img && img.src.startsWith('data:image')) return img.src
      }
      return null
    }, platform)
    if (qr) return qr
    await page.waitForTimeout(1200)
  }
  return null
}

/** 把 cookie 收进 logins.js（只收登录域名的关键字段，格式同 Cookie 导入）。 */
function harvestCookies(platform, cookies) {
  const dom = { douyin: 'douyin.com', xiaohongshu: 'xiaohongshu.com', bilibili: 'bilibili.com' }[platform] || ''
  const picked = cookies
    .filter((c) => (dom ? c.domain.includes(dom) : true))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ')
  if (picked) setCookie(platform, picked, { source: 'browser' })
  return picked
}

async function openLoginPage(platform, headless = true) {
  const urls = {
    douyin: 'https://www.douyin.com/',
    xiaohongshu: 'https://www.xiaohongshu.com/login',
    bilibili: 'https://passport.bilibili.com/login',
  }
  const c = await ensureContext({ headless })
  const page = reservePage(await c.newPage())
  await page.goto(urls[platform] || urls.douyin, { waitUntil: 'domcontentloaded', timeout: 30000 })

  if (platform === 'douyin') {
    // 抖音首页的「登录」按钮出现时间不稳，轮着点，点到弹登录框为止。
    let clicked = false
    for (let i = 0; i < 10 && !clicked; i += 1) {
      await page.waitForTimeout(i === 0 ? 5000 : 1500)
      clicked = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button, div, span, a')].find(
          (el) => el.textContent.trim() === '登录' && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().width < 220
        )
        if (btn) {
          btn.click()
          return true
        }
        return false
      })
    }
    return { page, clicked }
  }
  return { page, clicked: true }
}

/** 风控挑战页检测（小红书「安全限制」/抖音验证码）。 */
async function detectBlockPage(page) {
  try {
    const info = await page.evaluate(() => ({
      title: document.title || '',
      url: location.href,
    }))
    if (/安全限制|verify|captcha|security/i.test(info.title)) return `页面被风控挡住（${info.title.slice(0, 20)}），稍后再试或用 Cookie 导入`
    return null
  } catch {
    return null
  }
}

/**
 * 开始扫码。返回 { ok, state, qr?, error? }。
 * state: 'qr'（qr 是 dataURL，直接塞 <img>）/ 'already'（上下文里已是登录态）
 *
 * 风控现实：抖音对 headless 浏览器时松时紧。策略是 headless 先试，
 * 二维码没出来就关掉换 headful（窗口在屏幕外）再试一次。
 */
export async function startQR(platform) {
  const key = String(platform || '').toLowerCase()
  if (!DONE_COOKIE[key]) return { ok: false, state: 'error', error: `不支持的平台：${platform}` }
  await cancelQR()

  const attempt = async (headless) => {
    try {
      const opened = await openLoginPage(key, headless)
      const { page, clicked } = opened

      // 上下文里可能已经是登录态（比如复用）：先看一眼有没有现成 cookie。
      // 只对 appear 规则（游客不会有该 cookie）的平台做这个判断，避免小红书游客态误判。
      if ((DONE_RULE[key] || 'appear') === 'appear') {
        const early = await ctx.cookies()
        if (early.some((c) => c.name === DONE_COOKIE[key] && c.value)) {
          harvestCookies(key, early)
          await cancelQR()
          return { ok: true, state: 'already', done: true }
        }
      }

      const blocked = await detectBlockPage(page)
      if (blocked) return { ok: false, state: 'error', error: blocked }

      if (key === 'douyin' && !clicked) {
        return { ok: false, state: 'error', error: '没找到抖音登录按钮（页面结构可能变了）' }
      }

      const qr = await waitForQR(page, key)
      if (!qr) {
        const blocked2 = await detectBlockPage(page)
        // 带一份页面现场，便于真机排查（风控是间歇性的，现场比错误码有用）。
        const scene = await page
          .evaluate(() => {
            const modal = document.querySelector('[class*=login], [class*=dialog], [role=dialog]')
            return {
              hasModal: !!modal,
              canvases: document.querySelectorAll('canvas').length,
              hasScanText: (document.body.innerText || '').includes('扫码'),
              title: (document.title || '').slice(0, 30),
            }
          })
          .catch(() => null)
        const sceneText = scene
          ? `（页面现场：弹窗=${scene.hasModal ? '有' : '无'} canvas=${scene.canvases} 扫码文案=${scene.hasScanText ? '有' : '无'}）`
          : ''
        return {
          ok: false,
          state: 'error',
          error: blocked2 || `二维码没出来（可能被风控/验证码挡住）${sceneText}`,
        }
      }
      session = { platform: key, page, startedAt: Date.now(), baseline: await readBaseline(key, page) }
      return { ok: true, state: 'qr', qr }
    } catch (err) {
      return { ok: false, state: 'error', error: `打开登录页失败：${err?.message || err}` }
    }
  }

  // 第一轮：headless
  const first = await attempt(true)
  if (first.ok || first.done) return first

  // 第二轮：headful（窗口在屏幕外）
  await cancelQR()
  await new Promise((r) => setTimeout(r, 2500))
  const second = await attempt(false)
  if (second.ok || second.done) return second

  await cancelQR()
  return { ok: false, state: 'error', error: `${first.error}（换有窗口模式重试也不行，稍后再试或用 Cookie 导入）` }
}

/** 记录登录前的基线：目标 cookie 的值 + 当前 URL。 */
async function readBaseline(platform, page) {
  const target = DONE_COOKIE[platform]
  let cookieValue = ''
  let url = ''
  try {
    const cookies = await ctx.cookies()
    cookieValue = cookies.find((c) => c.name === target)?.value || ''
    url = page.url()
  } catch {
    // 读不到就当空
  }
  return { cookieValue, url }
}

/** 按平台规则判断是否登录成功。 */
async function isLoggedIn(platform) {
  const s = session
  if (!s) return false
  const rule = DONE_RULE[platform] || 'appear'
  if (rule === 'appear') {
    const cookies = await ctx.cookies()
    return cookies.some((c) => c.name === DONE_COOKIE[platform] && c.value)
  }
  // change-or-leave：cookie 值变了，或页面离开了登录页
  const cookies = await ctx.cookies()
  const now = cookies.find((c) => c.name === DONE_COOKIE[platform])?.value || ''
  if (now && now !== s.baseline.cookieValue) return true
  try {
    if (!s.page.url().includes('/login')) return true
  } catch {
    // 页面关了
  }
  return false
}

/**
 * 查扫码状态（非阻塞，UI 每 2 秒调一次）。
 * @returns {Promise<{state:'waiting'|'done'|'timeout'|'error', error?}>}
 */
export async function checkQR(platform, { timeoutMs = 180000 } = {}) {
  const key = String(platform || '').toLowerCase()
  const s = session
  if (!s || s.platform !== key) return { state: 'error', error: '没有进行中的扫码' }

  if (await isLoggedIn(key)) {
    const cookies = await ctx.cookies()
    const harvested = harvestCookies(key, cookies)
    await exportPlatformCookies(key)
    await cancelQR()
    return { state: 'done', cookie: harvested ? 'saved' : '' }
  }
  if (Date.now() - s.startedAt > timeoutMs) {
    await cancelQR()
    return { state: 'timeout', error: '扫码超时（二维码可能已过期，重新生成）' }
  }
  return { state: 'waiting' }
}
