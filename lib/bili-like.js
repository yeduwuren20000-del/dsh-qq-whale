/**
 * B 站点赞：直接用浏览器档案里导出的 b 站 cookie 调官方接口。
 * 只做「赞 / 取消赞」这一件小事，不做别的互动。
 */
import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from './store.js'

function cookieString() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dataDir(), 'logins', 'logins.json'), 'utf8'))
    const raw = j?.bilibili?.cookie
    if (Array.isArray(raw)) return raw.map((c) => `${c?.name}=${c?.value}`).join('; ')
    return String(raw || '')
  } catch { return '' }
}

export function biliLoginState() {
  const cookie = cookieString()
  return { ok: true, logged: /SESSDATA=/.test(cookie), hasCookie: Boolean(cookie), cookieLength: cookie.length }
}

export async function likeVideo({ bvid, like = true }) {
  const id = String(bvid || '').trim()
  if (!/^BV[0-9A-Za-z]{9,12}$/.test(id)) throw new Error('需要一个 B 站视频号（BV 开头）')
  const cookie = cookieString()
  if (!/SESSDATA=/.test(cookie)) throw new Error('B 站还没登录，先在平台登录面板扫码登录一次')
  const jct = (cookie.match(/bili_jct=([^;]+)/) || [])[1] || ''
  const res = await fetch('https://api.bilibili.com/x/web-interface/archive/like', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookie,
      Referer: 'https://www.bilibili.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    },
    body: new URLSearchParams({ bvid: id, like: like ? '1' : '0', csrf: jct }).toString(),
  })
  const data = await res.json().catch(() => ({}))
  if (data?.code !== 0) throw new Error(`B 站点赞没成功：${data?.message || data?.code || `HTTP ${res.status}`}`)
  return { ok: true, text: like ? `给 ${id} 点了个赞` : `取消了 ${id} 的赞` }
}
