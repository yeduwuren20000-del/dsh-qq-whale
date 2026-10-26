import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { dataDir, getSettings } from './store.js'
import { dayKey } from './clock.js'
import { exportPlatformCookies, getBrowserContext, reservePage } from './browser-context.js'

const FILE = () => path.join(dataDir(), 'social.json')
let page, sending = false
export function socialState() {
  try {
    const data = { posts: [], shares: [], ...(JSON.parse(fs.readFileSync(FILE(), 'utf8'))) }
    for (const row of data.posts) {
      if (row.status === 'publishing' && Date.now() - (row.attemptedAt || row.at) > 120000) row.status = 'uncertain'
    }
    return data
  }
  catch { return { posts: [], shares: [] } }
}
function save(data) {
  fs.mkdirSync(dataDir(), { recursive: true })
  const tmp = `${FILE()}.tmp`; fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8'); fs.renameSync(tmp, FILE())
}
export function makePostDraft(text) {
  const state = socialState(), value = String(text || '').trim().slice(0, 500)
  if (!value) throw new Error('说说内容不能为空')
  const existing = state.posts.find((p) => p.text === value && p.status !== 'published')
  if (existing) return existing
  const row = { id: randomUUID(), text: value, at: Date.now(), status: 'draft' }
  state.posts.unshift(row); state.posts = state.posts.slice(0, 100); save(state); return row
}
export function updatePost(id, patch) {
  const state = socialState(), row = state.posts.find((p) => p.id === id)
  if (row) { Object.assign(row, patch); save(state) }
  return row
}

async function qzonePage(qqId, visible = false, refresh = false) {
  if (!/^\d{5,12}$/.test(String(qqId))) throw new Error('先连接大肥鱼的QQ，确定她的账号')
  const context = await getBrowserContext({ headless: !visible })
  if (!page || page.isClosed()) page = reservePage(await context.newPage())
  if (refresh || !page.url().startsWith(`https://user.qzone.qq.com/${qqId}`)) {
    await page.goto(`https://user.qzone.qq.com/${qqId}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForTimeout(1500)
  }
  return page
}

export async function qzoneStatus(qqId, { open = false, visible = false, refresh = false } = {}) {
  if (open) await qzonePage(qqId, visible, refresh)
  const context = await getBrowserContext()
  const cookies = await context.cookies('https://user.qzone.qq.com/')
  const id = String((cookies.find((c) => c.name === 'p_uin') || cookies.find((c) => c.name === 'uin'))?.value || '').replace(/^o0*/, '')
  const authenticated = cookies.some((c) => ['p_skey', 'skey'].includes(c.name) && c.value)
  const match = authenticated && id === String(qqId)
  let shot = ''
  if (open && page && !page.isClosed()) {
    const dir = path.join(dataDir(), 'shots'); fs.mkdirSync(dir, { recursive: true })
    shot = `qzone-login-${Date.now()}.png`
    let captured = false
    for (const frame of page.frames()) {
      const qr = frame.locator('#qrlogin_img, img[id*="qrlogin"]').first()
      if (await qr.isVisible().catch(() => false)) { await qr.screenshot({ path: path.join(dir, shot) }); captured = true; break }
    }
    if (!captured) await page.screenshot({ path: path.join(dir, shot) })
  }
  if (match) await exportPlatformCookies('qzone')
  return { ok: true, logged: Boolean(match), needsLogin: !authenticated, accountMismatch: Boolean(authenticated && id !== String(qqId)), shot, url: `https://user.qzone.qq.com/${qqId}` }
}

const EDITOR = '[contenteditable="true"], textarea[placeholder*="说"], textarea[placeholder*="分享"], textarea[placeholder*="想"], #taotao-textarea, .ui-textarea textarea, .text-input textarea'
const ENTRY = /说点儿?什么|说点什么|分享新鲜事|写说说|写条说说|发表说说/

/**
 * 找编辑框。Qzone 主页的「说点儿什么吧」只是个快捷入口，真正的编辑区
 * 点开才出现（有的是 contenteditable，有的是浮层 iframe 里的 textarea），
 * 所以这里按帧逐个找，并允许等一会儿再返回。
 */
async function findEditor(p, timeout = 0) {
  const deadline = Date.now() + timeout
  for (;;) {
    for (const frame of p.frames()) {
      const editor = frame.locator(EDITOR).first()
      if (await editor.isVisible().catch(() => false)) return { frame, editor }
    }
    if (Date.now() >= deadline) return null
    await p.waitForTimeout(300)
  }
}

/** 先直接找编辑框；找不到就点开快捷入口，等浮层/新标签出现。 */
async function openComposer(p) {
  let target = await findEditor(p)
  if (target) return { page: p, target }
  const entries = []
  for (const frame of p.frames()) {
    const entry = frame.getByText(ENTRY).first()
    if (await entry.isVisible().catch(() => false)) entries.push(entry)
  }
  for (const entry of entries) {
    await entry.click({ timeout: 5000 }).catch(() => {})
    // 点开可能开浮层（同页 iframe），也可能开新标签；两种都接受。
    for (const candidate of new Set([p, ...p.context().pages().slice(-2)])) {
      if (candidate.isClosed()) continue
      target = await findEditor(candidate, 8000)
      if (target) return { page: candidate, target }
    }
  }
  return { page: p, target: null }
}

/** QQ 的 g_tk 算法：p_skey 经 33 位 hash。空间接口用它做鉴权。 */
function bknOf(pskey) {
  let hash = 5381
  for (let i = 0; i < pskey.length; i++) hash += (hash << 5) + pskey.charCodeAt(i)
  return hash & 2147483647
}

/**
 * 用说说列表接口确认「真的发出去了」。主页 body 不含说说正文，靠它判断
 * 会把成功误报成 uncertain，所以直接读接口。
 */
async function feedContains(p, qqId, text) {
  const pskey = (await p.context().cookies('https://user.qzone.qq.com/')).find((c) => c.name === 'p_skey')?.value || ''
  if (!pskey) return false
  const url = `https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6?uin=${qqId}&ftype=0&sort=0&pos=0&num=20&replynum=0&g_tk=${bknOf(pskey)}&code_version=1&format=json`
  const res = await p.request.get(url, { timeout: 20000 }).catch(() => null)
  if (!res || !res.ok()) return false
  return String(await res.text()).includes(String(text).trim().slice(0, 60))
}

/** A persisted publish attempt is never blindly repeated after a timeout. */
export async function publishQzone(id, qqId) {
  if (sending) return { ok: false, error: '已有一条说说正在发布' }
  const state = socialState(), row = state.posts.find((p) => p.id === id)
  if (!row) return { ok: false, error: '没有这条说说草稿' }
  if (['published', 'publishing', 'uncertain'].includes(row.status)) return { ok: false, error: '这条已经发布或结果待核实，请先查看空间，避免重复发表' }
  const today = state.posts.filter((p) => p.publishedAt && dayKey(p.publishedAt) === dayKey())
  if (today.length >= 3) return { ok: false, error: '今天已经发过3条空间说说，先留作草稿' }
  sending = true
  const fail = (error, detail = {}) => {
    updatePost(id, { error, needsLogin: Boolean(detail.needsLogin) })
    return { ...detail, ok: false, error }
  }
  try {
    const status = await qzoneStatus(qqId, { open: true })
    if (!status.logged) return fail(status.accountMismatch ? '空间登录的是另一账号，请改为大肥鱼的QQ，避免发错账号' : 'QQ聊天已连接不代表空间已登录。请在QQ面板扫描空间二维码，再在手机确认', { ...status, needsLogin: true })
    const opened = await openComposer(page)
    if (opened.page !== page) page = opened.page
    const target = opened.target
    if (!target) return fail('空间编辑框未出现，可能需要完成登录或验证；草稿已保留')
    await target.editor.fill(row.text)
    let button
    for (const frame of page.frames()) {
      for (const candidate of [frame.getByRole('button', { name: /^(发表|发布|提交)$/ }).first(), frame.locator('.btn-post, .op_publish, #QM_Mood_Poster_Inner .btn-post').first()]) {
        if (await candidate.isVisible().catch(() => false)) { button = candidate; break }
      }
      if (button) break
    }
    if (!button) {
      // 有的版本按钮延迟出现，最多再等 5 秒。
      const deadline = Date.now() + 5000
      while (!button && Date.now() < deadline) {
        await page.waitForTimeout(500)
        for (const frame of page.frames()) {
          for (const candidate of [frame.getByRole('button', { name: /^(发表|发布|提交)$/ }).first(), frame.locator('.btn-post, .op_publish').first()]) {
            if (await candidate.isVisible().catch(() => false)) { button = candidate; break }
          }
          if (button) break
        }
      }
    }
    if (!button) return fail('没有找到空间发表按钮，草稿已保留')
    updatePost(id, { status: 'publishing', attemptedAt: Date.now(), error: '', needsLogin: false })
    await button.click()
    await page.waitForTimeout(2500)
    const cleared = !(await target.editor.evaluate((el) => el.value ?? el.textContent).catch(() => row.text)).trim()
    const found = cleared && (await feedContains(page, qqId, row.text))
    const dir = path.join(dataDir(), 'shots'); fs.mkdirSync(dir, { recursive: true })
    const shot = `qzone-post-${Date.now()}.png`; await page.screenshot({ path: path.join(dir, shot) })
    if (!found) { updatePost(id, { status: 'uncertain', shot }); return { ok: false, uncertain: true, error: '已点击发表，暂未在动态里确认；请查看空间，系统不会自动重发', shot } }
    updatePost(id, { status: 'published', publishedAt: Date.now(), shot, url: status.url })
    return { ok: true, text: row.text, url: status.url, shot }
  } catch (error) {
    const current = socialState().posts.find((p) => p.id === id)
    if (current?.status === 'publishing') updatePost(id, { status: 'uncertain', error: error.message })
    if (current?.status === 'draft') return fail(error.message)
    return { ok: false, error: error.message }
  } finally { sending = false }
}

/* ---------------------------------------------------------------- 空间评论 */
/*
 * 别人在她说说下面留言时，她可以自己挑几条回。次数由
 * 设置里的 qq.shout.replyComments（enabled / maxPerDay）控制，
 * 回复记录落在 social.json 的 replies，用来去重和算当天用量。
 */

const REPLY_DEFAULTS = { enabled: true, maxPerDay: 5 }

export function replyConfig() {
  const raw = getSettings()?.qq?.shout?.replyComments
  const cfg = { ...REPLY_DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) }
  cfg.maxPerDay = Math.max(0, Math.min(30, Number(cfg.maxPerDay) || 0))
  return cfg
}

/** 今天还剩几次回复额度。 */
export function replyQuota(now = Date.now()) {
  const used = (socialState().replies || []).filter((r) => dayKey(r.at) === dayKey(now)).length
  return Math.max(0, replyConfig().maxPerDay - used)
}

async function gtkOf(p) {
  const cookies = await p.context().cookies('https://user.qzone.qq.com/')
  const pskey = (cookies.find((c) => c.name === 'p_skey') || cookies.find((c) => c.name === 'skey'))?.value || ''
  return pskey ? bknOf(pskey) : 0
}

async function apiJson(p, url) {
  const res = await p.request.get(url, { timeout: 20000, headers: { Referer: 'https://user.qzone.qq.com/' } })
  if (!res.ok()) throw new Error(`空间接口 HTTP ${res.status()}`)
  const text = (await res.text()).trim()
  try { return JSON.parse(text) } catch { return JSON.parse(text.replace(/^[^{[]+/, '').replace(/[;)\s]+$/, '')) }
}

const feedsOf = (json) => {
  const d = json?.data ?? json ?? {}
  if (Array.isArray(d)) return d
  return d.list || d.msglist || d.vFeeds || d.feeds || d.msglist_v6 || []
}
const commentsOf = (json) => {
  const d = json?.data ?? json ?? {}
  return d.commentlist || d.comments || d.replylist || []
}
const feedIdOf = (f) => String(f?.tid || f?.topicId || f?.id || f?.feedskey || '')
const MSG_LIST = (uin, g, num) => `https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6?uin=${uin}&ftype=0&sort=0&pos=0&num=${num}&replynum=0&g_tk=${g}&code_version=1&format=json`
const MSG_DETAIL = (uin, tid, g) => `https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msgdetail_v6?uin=${uin}&tid=${tid}&ftype=0&sort=0&pos=0&num=50&g_tk=${g}&code_version=1&format=json`

/** 拉最近几条说说下面「别人给我」的评论，已经回过的不再列。 */
export async function listQzoneComments(qqId, { limit = 8 } = {}) {
  if (!/^\d{5,12}$/.test(String(qqId))) throw new Error('先连接大肥鱼的QQ，确定她的账号')
  const p = await qzonePage(qqId)
  const g = await gtkOf(p)
  if (!g) throw new Error('空间还没登录，读不到评论')
  const feeds = feedsOf(await apiJson(p, MSG_LIST(qqId, g, Math.max(4, limit))))
  const replied = new Set((socialState().replies || []).map((r) => String(r.commentId)))
  const out = []
  for (const feed of feeds.slice(0, limit)) {
    const postId = feedIdOf(feed)
    if (!postId) continue
    let comments = commentsOf(feed)
    if (!comments.length) {
      comments = commentsOf(await apiJson(p, MSG_DETAIL(qqId, postId, g)).catch(() => ({})))
    }
    for (const c of comments) {
      const commentId = String(c?.id || c?.commentId || c?.commentid || '')
      const uin = String(c?.uin || c?.owner_uin || c?.ownerUin || '')
      const content = String(c?.content || c?.reply || '').trim()
      if (!commentId || !content) continue
      if (uin === String(qqId)) continue // 自己的回复不算
      if (replied.has(commentId)) continue
      out.push({
        postId,
        commentId,
        uin,
        name: String(c?.name || c?.nickname || c?.nick || '').slice(0, 40),
        text: content.slice(0, 300),
        at: Number(c?.createTime || c?.create_time || 0) * 1000 || undefined,
        postText: String(feed.content || feed?.conlist?.find?.((x) => x.type === 0)?.content || '').slice(0, 120),
      })
    }
  }
  return { ok: true, comments: out, quota: replyQuota(), config: replyConfig() }
}

/** 回复一条说说评论；超出当天次数或重复回复都会被拒绝。 */
export async function replyQzoneComment({ postId, commentId, text, commentUin = '', commentText = '' }, qqId) {
  const value = String(text || '').trim().slice(0, 200)
  if (!postId || !commentId) throw new Error('缺少说说或评论 id')
  if (!value) throw new Error('回复内容不能为空')
  if (replyQuota() <= 0) throw new Error(`今天已经回复过 ${replyConfig().maxPerDay} 条空间评论，明天再回`)
  if ((socialState().replies || []).some((r) => String(r.commentId) === String(commentId))) throw new Error('这条评论已经回复过了')
  const p = await qzonePage(qqId)
  const g = await gtkOf(p)
  if (!g) throw new Error('空间还没登录，回复发不出去')
  // 2026-10 实测：空间网页回复评论走 emotion_cgi_re_feeds（表单 POST），
  // topicId = {uin}_{feedTid}__{commentId}，缺 commentUin 会被拒。
  const feedTid = String(postId).startsWith(`${qqId}_`) ? String(postId).slice(String(qqId).length + 1) : String(postId)
  const res = await p.request.post(`https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_re_feeds?g_tk=${g}`, {
    form: {
      topicId: `${qqId}_${feedTid}__${commentId}`,
      feedsType: '100', inCharset: 'utf-8', outCharset: 'utf-8', plat: 'qzone', source: 'ic',
      hostUin: String(qqId), isSignIn: '', platformid: '50', uin: String(qqId),
      format: 'fs', ref: 'feeds', content: value,
      commentId: String(commentId), commentUin: String(commentUin || ''),
      richval: '', richtype: '', private: '0', paramstr: '1',
      qzreferrer: `https://user.qzone.qq.com/${qqId}`,
    },
    headers: { Referer: `https://user.qzone.qq.com/${qqId}` },
    timeout: 20000,
  })
  if (!res.ok()) throw new Error(`回复接口 HTTP ${res.status()}`)
  const raw = (await res.text()).trim()
  // 该接口 format=fs 的响应不一定是纯 JSON：只要明确报错就抛，宁可报错也不写假记录。
  if (/"(?:ret|code|subcode)"\s*:\s*-\d+/.test(raw)) {
    throw new Error(`回复没有成功${raw ? `（${raw.slice(0, 120)}）` : ''}`)
  }
  const state = socialState()
  state.replies = [{
    postId: String(postId), commentId: String(commentId), uin: String(commentUin),
    commentText: String(commentText).slice(0, 200), text: value, at: Date.now(),
  }, ...(state.replies || [])].slice(0, 200)
  save(state)
  return { ok: true, text: value, quota: replyQuota() }
}

export function validDouyinVideo(value) {
  try {
    const u = new URL(value)
    return u.protocol === 'https:' && ['www.douyin.com', 'douyin.com', 'v.douyin.com'].includes(u.hostname) && (u.hostname === 'v.douyin.com' || /^\/video\/\d+/.test(u.pathname))
  } catch { return false }
}

export function saveShare({ url, comment = '', reason = '' }) {
  if (!validDouyinVideo(url)) throw new Error('只接收有效的抖音视频链接')
  const data = socialState()
  const old = data.shares.find((p) => p.url === url)
  if (old) return old
  const row = { id: randomUUID(), url, comment: String(comment).slice(0, 160), reason: String(reason).slice(0, 160), status: 'pending-account', at: Date.now() }
  data.shares.unshift(row); data.shares = data.shares.slice(0, 100); save(data); return row
}
