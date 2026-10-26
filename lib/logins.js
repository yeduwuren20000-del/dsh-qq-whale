/**
 * 平台登录态：把各平台的 Cookie 存本地，抓内容时带上，换取更高的权限/更全的数据。
 *
 * 为什么是 Cookie 导入而不是扫码：
 * - QQ 的扫码登录由 NapCat 负责（点「启动网关」即弹码），不在这里。
 * - B站/抖音/小红书的网页扫码登录是强反爬的，服务端「生成码→轮询→换凭证」抖音/小红书基本跑不通；
 *   而且给插件加 QR 依赖、动它的 node_modules 有让 DSH 加载器出问题的风险。
 * - Cookie 导入四平台通用、免依赖、可靠：用户从浏览器开发者工具复制 Cookie 粘进来即可。
 *
 * Cookie 只落在本机 dataDir()/logins.json，不外传；界面会提醒这只存本地。
 */
import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from './store.js'
import { CREATIVE_PLATFORMS } from './creative-platforms.js'

const DIR = path.join(dataDir(), 'logins')
const FILE = path.join(DIR, 'logins.json')

export const PLATFORMS = [
  { id: 'bilibili', label: 'B站', field: 'SESSDATA', hint: '登录 bilibili.com 后，开发者工具 → 网络 → 任一请求 → 复制 Cookie（至少含 SESSDATA）。' },
  { id: 'douyin', label: '抖音', field: 'sessionid', hint: '登录 douyin.com 后复制 Cookie（含 sessionid 等）。抖音反爬强，Cookie 也未必抓得到正文。' },
  { id: 'xiaohongshu', label: '小红书', field: 'web_session', hint: '登录 xiaohongshu.com 后复制 Cookie（含 web_session）。同样受反爬限制。' },
  ...CREATIVE_PLATFORMS.map((p) => ({ id: p.id, label: p.name, field: '', url: p.url, browserLogin: true, hint: `${p.capabilities}。在独立浏览器中本人登录，之后回此刷新；实际功能和额度以账号页面为准。` })),
]

function read() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    return j && typeof j === 'object' ? j : {}
  } catch {
    return {}
  }
}

function write(obj) {
  try {
    fs.mkdirSync(DIR, { recursive: true })
    const tmp = `${FILE}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8')
    fs.renameSync(tmp, FILE)
  } catch {
    // 存不下去不打扰。
  }
}

/** 取某平台 Cookie 字符串，没有返回 ''。 */
export function getCookie(platform) {
  const row = read()[platform]
  return String(row?.cookie || '')
}

export function cookieSource(platform) {
  return read()[platform]?.source || 'manual'
}

/** 存某平台 Cookie；空串等于清除。返回是否含该平台关键字段的粗判。 */
export function setCookie(platform, cookie, { source = 'manual' } = {}) {
  const p = String(platform || '')
  const c = String(cookie || '').trim()
  const all = read()
  if (!c) delete all[p]
  else all[p] = { cookie: c, at: Date.now(), source }
  write(all)
  return hasKey(p, c)
}

export function clearCookie(platform) {
  const all = read()
  if (all[platform]) {
    delete all[platform]
    write(all)
    return true
  }
  return false
}

/** 各平台登录态概览（不泄露 Cookie 内容，只报有没有、多久前存的、关键字段在不在）。 */
export function loginStatus() {
  const all = read()
  return PLATFORMS.map((p) => {
    const row = all[p.id]
    const cookie = row?.cookie || ''
    return {
      id: p.id,
      label: p.label,
      field: p.field,
      hint: p.hint,
      url: p.url,
      browserLogin: Boolean(p.browserLogin),
      logged: Boolean(cookie),
      hasKey: hasKey(p.id, cookie),
      at: row?.at || 0,
      len: cookie.length,
    }
  })
}

function hasKey(platform, cookie) {
  const p = PLATFORMS.find((x) => x.id === platform)
  if (!p) return false
  if (p.browserLogin) return false // A saved cookie is not proof of a signed-in account.
  return new RegExp(`(^|;\\s*)${p.field}\\s*=`, 'i').test(String(cookie || ''))
}
