import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { dataDir } from './store.js'
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

async function qzonePage(qqId, visible = false) {
  if (!/^\d{5,12}$/.test(String(qqId))) throw new Error('先连接大肥鱼的QQ，确定她的账号')
  const context = await getBrowserContext({ headless: !visible })
  if (!page || page.isClosed()) page = reservePage(await context.newPage())
  if (!page.url().startsWith(`https://user.qzone.qq.com/${qqId}`)) {
    await page.goto(`https://user.qzone.qq.com/${qqId}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForTimeout(1500)
  }
  return page
}

export async function qzoneStatus(qqId, { open = false, visible = false } = {}) {
  if (open) await qzonePage(qqId, visible)
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

async function findEditor(p) {
  for (const frame of p.frames()) {
    const editor = frame.locator('[contenteditable="true"], textarea[placeholder*="说"], textarea[placeholder*="分享"], #taotao-textarea').first()
    if (await editor.isVisible().catch(() => false)) return { frame, editor }
  }
  return null
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
  try {
    const status = await qzoneStatus(qqId, { open: true })
    if (!status.logged) return { ...status, ok: false, needsLogin: true, error: status.accountMismatch ? '空间登录的是另一账号，请改为大肥鱼的QQ，避免发错账号' : '先在QQ面板登录大肥鱼的空间' }
    let target = await findEditor(page)
    if (!target) {
      const entry = page.getByText(/说点什么|分享新鲜事|写说说/).first()
      if (await entry.isVisible().catch(() => false)) await entry.click()
      await page.waitForTimeout(500); target = await findEditor(page)
    }
    if (!target) return { ok: false, error: '空间编辑框未出现，可能需要完成登录或验证；草稿已保留' }
    await target.editor.fill(row.text)
    let button
    for (const frame of page.frames()) {
      for (const candidate of [frame.getByRole('button', { name: /^发表$|^发布$/ }).first(), frame.locator('.btn-post, .op_publish, #QM_Mood_Poster_Inner .btn-post').first()]) {
        if (await candidate.isVisible().catch(() => false)) { button = candidate; break }
      }
      if (button) break
    }
    if (!button) return { ok: false, error: '没有找到空间发表按钮，草稿已保留' }
    updatePost(id, { status: 'publishing', attemptedAt: Date.now() })
    await button.click()
    await page.waitForTimeout(2500)
    const cleared = !(await target.editor.evaluate((el) => el.value ?? el.textContent).catch(() => row.text)).trim()
    // Verify by a fresh read of the feed; editor text alone is not evidence.
    if (cleared) await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
    const found = cleared && (await Promise.all(page.frames().map((f) => f.locator('body').innerText().catch(() => '')))).some((s) => s.includes(row.text))
    const dir = path.join(dataDir(), 'shots'); fs.mkdirSync(dir, { recursive: true })
    const shot = `qzone-post-${Date.now()}.png`; await page.screenshot({ path: path.join(dir, shot) })
    if (!found) { updatePost(id, { status: 'uncertain', shot }); return { ok: false, uncertain: true, error: '已点击发表，暂未在动态里确认；请查看空间，系统不会自动重发', shot } }
    updatePost(id, { status: 'published', publishedAt: Date.now(), shot, url: status.url })
    return { ok: true, text: row.text, url: status.url, shot }
  } catch (error) {
    const current = socialState().posts.find((p) => p.id === id)
    if (current?.status === 'publishing') updatePost(id, { status: 'uncertain', error: error.message })
    return { ok: false, error: error.message }
  } finally { sending = false }
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
