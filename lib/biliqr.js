/**
 * lib/biliqr.js — B站扫码登录（真扫码，不是 Cookie 导入）。
 *
 * 流程（B站公开的 passport 接口，实测可用）：
 *   1) generate 拿 qrcode_key + 登录 URL → 本地编码成 QR 矩阵（lib/qr.js，不外传 URL）
 *   2) 前端渲染二维码，用户用 B站 App 扫
 *   3) poll 轮询状态：86101 未扫码 / 86098 已扫码待确认 / 0 成功
 *   4) 成功时从响应头 set-cookie 抓 SESSDATA 等，落进 logins.json（本机，不外传）
 *
 * 为什么只做 B站：抖音/小红书的网页扫码登录带反爬签名，服务端跑不通（已实测），
 * 那两个平台走「Cookie 导入」（lib/logins.js），界面里会写清楚。
 */
import { encodeQR, toSvg } from './qr.js'
import { setCookie } from './logins.js'

const GENERATE = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate'
const POLL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const HEADERS = { 'user-agent': UA, referer: 'https://www.bilibili.com' }

// 轮询状态码（B站文档/实测）
export const POLL_STATUS = {
  0: 'success', // 确认成功
  86038: 'expired', // 二维码过期
  86101: 'waiting', // 未扫码
  86098: 'scanned', // 已扫码，等确认
}

// 本进程只保留一个待确认登录；apply() 跑多次也不会串味。
let pending = null

async function defaultGet(url, opts = {}) {
  return fetch(url, { headers: { ...HEADERS, ...(opts.headers || {}) }, ...opts })
}

/** 从响应头里挑出登录要用的几个字段。 */
function pickCookie(headers) {
  let list = []
  if (headers && typeof headers.getSetCookie === 'function') {
    try {
      list = headers.getSetCookie() || []
    } catch {
      list = []
    }
  }
  if (!list.length) {
    const raw = headers?.get?.('set-cookie')
    if (raw) list = Array.isArray(raw) ? raw : String(raw).split(/[,;]/)
  }
  const keep = ['SESSDATA', 'bili_jct', 'DedeUserID']
  const out = []
  for (const item of list) {
    const seg = String(item).trim()
    const eq = seg.indexOf('=')
    if (eq <= 0) continue
    const name = seg.slice(0, eq).trim()
    if (keep.includes(name)) out.push(`${name}=${seg.slice(eq + 1).split(';')[0].trim()}`)
  }
  return out.join('; ')
}

/** 开始登录：生成二维码。返回 { ok, url, svg, expiresIn }。 */
export async function startBiliLogin({ get = defaultGet } = {}) {
  let r
  try {
    r = await get(GENERATE, { headers: { ...HEADERS } })
  } catch (error) {
    return { ok: false, error: `连不上 B站 passport：${String(error?.message || error)}` }
  }
  let j
  try {
    j = await r.json()
  } catch {
    return { ok: false, error: 'B站 返回的不是 JSON，可能是网络/代理问题。' }
  }
  if (j?.code !== 0 || !j?.data?.qrcode_key || !j?.data?.url) {
    return { ok: false, error: `B站 没给二维码（code=${j?.code} ${j?.message || ''}）` }
  }
  let svg
  try {
    const qr = encodeQR(j.data.url)
    svg = toSvg(qr.modules, { scale: 6 })
  } catch (error) {
    return { ok: false, error: `二维码编码失败：${String(error?.message || error)}` }
  }
  pending = { key: j.data.qrcode_key, url: j.data.url, at: Date.now() }
  return { ok: true, url: j.data.url, svg, expiresIn: 180 }
}

/** 轮询一次。返回 { ok, status, message?, saved? }。 */
export async function pollBiliLogin({ get = defaultGet } = {}) {
  if (!pending) return { ok: false, status: 'none', error: '当前没有进行中的扫码登录' }
  let r
  try {
    r = await get(`${POLL}?qrcode_key=${encodeURIComponent(pending.key)}`, { headers: { ...HEADERS } })
  } catch (error) {
    return { ok: false, status: 'error', error: `轮询失败：${String(error?.message || error)}` }
  }
  let j
  try {
    j = await r.json()
  } catch {
    return { ok: false, status: 'error', error: '轮询返回异常。' }
  }
  const code = j?.data?.code
  const status = POLL_STATUS[code]
  if (status === 'success') {
    const cookie = pickCookie(r.headers)
    pending = null
    if (cookie) {
      const saved = setCookie('bilibili', cookie)
      return { ok: true, status: 'success', saved: saved === true, message: saved ? '登录成功，Cookie 已保存到本机' : '登录成功，但 Cookie 字段不全（缺 SESSDATA？）' }
    }
    return { ok: false, status: 'success', message: '确认成功了，但没从响应里抓到 Cookie，请改用 Cookie 导入。' }
  }
  if (status === 'expired') {
    pending = null
    return { ok: true, status: 'expired', message: '二维码过期了，点「重新生成」再来一次。' }
  }
  return { ok: true, status: status || 'unknown', code, message: status === 'scanned' ? '已扫码，还没在手机上确认' : '等待扫码' }
}

/** 当前是否有待确认的登录（给前端判断要不要继续轮询）。 */
export function biliLoginState() {
  if (!pending) return { active: false }
  const age = Math.floor((Date.now() - pending.at) / 1000)
  return { active: true, ageSec: age, expired: age > 180, url: pending.url }
}

/** 取消/清理。 */
export function cancelBiliLogin() {
  pending = null
  return { ok: true }
}
