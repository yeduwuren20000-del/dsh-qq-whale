/** Local NapCat login adapter. WebUI credentials never leave the host process. */
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'
import { dataDir, getSettings, setSettings } from './store.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SLOT = Symbol.for('dsh-qq-whale.login')
const shared = globalThis[SLOT] ||= { child: null, credential: '', origin: '', expires: 0, started: 0 }
function json(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch { return {} } }
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.whale-tmp`; fs.writeFileSync(temp, JSON.stringify(value, null, 2)); fs.renameSync(temp, file)
}

/** NapCat 一键包的 webui.json 常和 NapCatWinBootMain.exe 分在不同层目录，这里两个都扫。 */
function webuiDirs(root) {
  const out = []
  const push = (dir) => { if (dir && fs.existsSync(path.join(dir, 'webui.json')) && !out.includes(dir)) out.push(dir) }
  push(path.join(root, 'config'))
  let children = []
  try { children = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) } catch {}
  for (const name of children) {
    const sub = path.join(root, name)
    push(path.join(sub, 'config'))
    push(path.join(sub, 'resources', 'app', 'napcat', 'config'))
    try { for (const v of fs.readdirSync(path.join(sub, 'versions'))) push(path.join(sub, 'versions', v, 'resources', 'app', 'napcat', 'config')) } catch {}
  }
  return out
}

export function findNapcat() {
  const configured = process.env.DSH_QQ_WHALE_NAPCAT_DIR || process.env.DSH_MENTOR_NAPCAT_DIR || getSettings().qq?.napcatDir
  const roots = configured ? [configured] : [path.join(dataDir(), 'qq-runtime'), path.resolve(ROOT, '..', '..', 'napcat', 'onekey'), path.resolve(ROOT, '..', '..', 'napcat', 'shell')]
  for (const root of roots) {
    const exes = [path.join(root, 'NapCatWinBootMain.exe')]
    try { exes.push(...fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(root, e.name, 'NapCatWinBootMain.exe'))) } catch {}
    const dir = exes.map((p) => path.dirname(p)).find((d) => fs.existsSync(path.join(d, 'NapCatWinBootMain.exe')))
    if (!dir) continue
    const configs = [path.join(dir, 'config')]
    try { for (const v of fs.readdirSync(path.join(dir, 'versions'))) configs.push(path.join(dir, 'versions', v, 'resources', 'app', 'napcat', 'config')) } catch {}
    configs.push(...webuiDirs(root))
    const configDir = configs.find((p) => fs.existsSync(path.join(p, 'webui.json')))
    if (configDir) return { dir, exe: path.join(dir, 'NapCatWinBootMain.exe'), configDir }
  }
  return null
}

export async function reachable(value) {
  let url; try { url = new URL(value) } catch { return false }
  return new Promise((resolve) => {
    const socket = net.connect(Number(url.port || 80), url.hostname.replace(/^\[|\]$/g, ''))
    let done = false
    const finish = (ok) => { if (done) return; done = true; socket.destroy(); resolve(ok) }
    socket.setTimeout(700); socket.once('connect', () => finish(true)); socket.once('timeout', () => finish(false)); socket.once('error', () => finish(false))
  })
}

export async function launchQQ() {
  const runtime = findNapcat()
  if (!runtime) return { ok: false, code: 404, error: 'QQ 组件尚未准备好，请点击「准备 QQ 并扫码」', needsSetup: true }
  const webuiNow = json(path.join(runtime.configDir, 'webui.json'))
  if (await reachable(`http://127.0.0.1:${Number(webuiNow.port) || 6099}`)) return { ok: true, running: true, text: 'QQ 已在后台运行，请扫码或等待连接' }
  if (shared.child?.exitCode === null || Date.now() - shared.started < 45000) return { ok: true, starting: true, text: 'QQ 正在后台启动，请稍候' }
  const cfg = getSettings().qq || {}, webui = json(path.join(runtime.configDir, 'webui.json'))
  if (!webui.token) webui.token = randomBytes(24).toString('hex')
  webui.host = '127.0.0.1'; webui.disableWebUI = false
  if (cfg.selfId) webui.autoLoginAccount = String(cfg.selfId)
  write(path.join(runtime.configDir, 'webui.json'), webui)
  const logging = path.join(runtime.configDir, 'napcat.json')
  write(logging, { ...json(logging), consoleLog: false, fileLog: true, fileLogLevel: 'info' })
  // NapCat 官方 launcher.bat 会自己设置 NAPCAT_* 注入环境变量；直接跑 NapCatWinBootMain.exe 会缺这些变量。
  // 注入 QQ 需要管理员权限（Error 740），所以用 Start-Process -Verb RunAs 提权，由用户在 UAC 弹窗点「是」。
  const launcher = path.join(path.dirname(runtime.configDir), 'launcher.bat')
  if (fs.existsSync(launcher)) {
    const q = (v) => v.replace(/'/g, "''")
    const command = `Start-Process -FilePath '${q(launcher)}' -WorkingDirectory '${q(path.dirname(launcher))}' -Verb RunAs`
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], { cwd: path.dirname(launcher), windowsHide: true, detached: true, stdio: 'ignore' })
    shared.child = child; shared.started = Date.now(); shared.credential = ''; shared.expires = 0
    child.on('error', () => { if (shared.child === child) { shared.child = null; shared.started = 0 } })
    child.on('exit', () => { if (shared.child === child) shared.child = null })
    child.unref()
    return { ok: true, pid: child.pid, needsElevation: true, text: 'NapCat 需要管理员权限启动 QQ：请在弹出的 UAC 窗口点「是」，等 QQ 重启后点「扫码登录 QQ」' }
  }
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'lib', 'qq-hidden.ps1'), '-Exe', runtime.exe, '-Account', String(cfg.selfId || '')]
  const child = spawn('powershell.exe', args, { cwd: runtime.dir, windowsHide: true, detached: true, stdio: 'ignore' })
  shared.child = child; shared.started = Date.now(); shared.credential = ''; shared.expires = 0
  child.on('error', () => { if (shared.child === child) { shared.child = null; shared.started = 0 } })
  child.on('exit', () => { if (shared.child === child) shared.child = null })
  child.unref()
  return { ok: true, pid: child.pid, text: 'QQ 已在后台启动，二维码会显示在这里' }
}

async function webuiAPI(route, body = {}, retry = true) {
  const runtime = findNapcat()
  if (!runtime) throw new Error('QQ 组件尚未准备好')
  const cfg = json(path.join(runtime.configDir, 'webui.json'))
  if (cfg.enable2FA) throw new Error('此 QQ 后台启用了二次验证，请先在原管理页完成验证')
  const origin = `http://127.0.0.1:${Number(cfg.port) || 6099}`
  const post = async (endpoint, payload, credential = '') => {
    const response = await fetch(`${origin}/api${endpoint}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(6000), headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}) }, body: JSON.stringify(payload) })
    if (!response.ok) throw new Error('QQ 后台暂未准备完成')
    return response.json()
  }
  if (!shared.credential || shared.origin !== origin || shared.expires < Date.now()) {
    const result = await post('/auth/login', { hash: createHash('sha256').update(`${cfg.token}.napcat`).digest('hex') })
    if (!result.data?.Credential) throw new Error(result.data?.require2FA ? '请先完成 QQ 后台二次验证' : 'QQ 后台配置已变化，请重启 QQ 后台后重试')
    shared.credential = result.data.Credential; shared.origin = origin; shared.expires = Date.now() + 3000000
  }
  const result = await post(route, body, shared.credential)
  if (result.code !== 0) {
    if (retry && /Unauthorized|Authorization|credential/i.test(result.message || '')) { shared.credential = ''; return webuiAPI(route, body, false) }
    throw new Error(result.message || 'QQ 操作未完成')
  }
  return result.data
}

/** Preserve other OneBot transports. Configure only this plugin's loopback server. */
export function onebotConfig(previous, { port, token }) {
  const result = structuredClone(previous || {})
  result.network ||= {}; result.network.websocketServers ||= []
  let server = result.network.websocketServers.find((s) => s.name === 'dsh-qq-whale' || (['127.0.0.1', 'localhost', ''].includes(s.host) && Number(s.port) === Number(port)))
  if (!server) { server = { name: 'dsh-qq-whale' }; result.network.websocketServers.push(server) }
  Object.assign(server, { enable: true, host: '127.0.0.1', port: Number(port), token, reportSelfMessage: false, enableForcePushEvent: true, messagePostFormat: 'array', heartInterval: 30000, enableDebug: false })
  return result
}

export async function loginQQ(action = 'status') {
  const runtime = findNapcat()
  if (!runtime) return { ok: false, needsSetup: true, error: '请先准备 QQ 组件' }
  const cfg = getSettings().qq || {}
  if (action === 'start') {
    setSettings({ qq: { ...cfg, enabled: true, autoLaunchNapcat: true } })
    const webui = json(path.join(runtime.configDir, 'webui.json'))
    if (!await reachable(`http://127.0.0.1:${Number(webui.port) || 6099}`)) return launchQQ()
  }
  if (action === 'refresh') await webuiAPI('/QQLogin/RefreshQRcode')
  const state = await webuiAPI('/QQLogin/CheckLoginStatus')
  if (state.isLogin) {
    const info = await webuiAPI('/QQLogin/GetQQLoginInfo'), selfId = String(info.uin || info.user_id || '')
    if (!/^\d{5,12}$/.test(selfId)) throw new Error('QQ 登录信息尚未准备完成')
    if (cfg.selfId && String(cfg.selfId) !== selfId) return { ok: false, accountMismatch: true, error: '当前登录的 QQ 与之前保存的账号不同，请确认扫码账号' }
    const url = new URL(cfg.url || 'ws://127.0.0.1:3010')
    if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('自动扫码连接仅支持本机 QQ；远程连接请使用高级设置')
    const port = Number(url.port || 3010), token = cfg.token || randomBytes(24).toString('hex')
    const current = await webuiAPI('/OB11Config/GetConfig')
    const next = onebotConfig(current, { port, token })
    if (JSON.stringify(current) !== JSON.stringify(next)) await webuiAPI('/OB11Config/SetConfig', { config: JSON.stringify(next) })
    const webui = json(path.join(runtime.configDir, 'webui.json'))
    if (webui.autoLoginAccount !== selfId) write(path.join(runtime.configDir, 'webui.json'), { ...webui, autoLoginAccount: selfId })
    setSettings({ qq: { ...cfg, enabled: true, autoLaunchNapcat: true, selfId, url: `ws://127.0.0.1:${port}`, token } })
    return { ok: true, logged: true, selfId, text: 'QQ 已登录，正在连接大肥鱼' }
  }
  let qr = state.qrcodeurl
  if (!qr && action === 'start') { await webuiAPI('/QQLogin/RefreshQRcode'); qr = (await webuiAPI('/QQLogin/CheckLoginStatus')).qrcodeurl }
  return { ok: true, logged: false, phase: state.loginPhase || 'waiting_qrcode', qr: qr ? await QRCode.toDataURL(qr, { width: 240, margin: 2 }) : '', text: state.loginError || (state.qrLoginAccepted ? '已扫码，请在手机确认并等待 QQ 连接' : '请使用大肥鱼的 QQ 扫码并在手机确认') }
}
