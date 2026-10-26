import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const root = path.resolve(import.meta.dirname, '..')
fs.mkdirSync(path.join(root, 'verification-data'), { recursive: true })
const scratch = fs.mkdtempSync(path.join(root, 'verification-data', 'release-'))
process.env.DSH_MENTOR_DATA = scratch
process.env.DSH_MENTOR_NAPCAT_DIR = path.join(scratch, 'napcat')
const configDir = path.join(process.env.DSH_MENTOR_NAPCAT_DIR, 'config')
fs.mkdirSync(configDir, { recursive: true })
fs.writeFileSync(path.join(process.env.DSH_MENTOR_NAPCAT_DIR, 'NapCatWinBootMain.exe'), '')
const webui = path.join(configDir, 'webui.json')
fs.writeFileSync(webui, JSON.stringify({ host: '127.0.0.1', port: 6099, token: 'fixture-local-webui-token' }))
const store = await import('../lib/store.js')
const { onebotConfig, loginQQ, findNapcat } = await import('../lib/qq-login.js')
const { COMPONENTS, startComponents } = await import('../lib/components.js')
const calls = [], originalFetch = globalThis.fetch
let logged = false, account = '7777777', configured
globalThis.fetch = async (url, options) => {
  assert.ok(String(url).startsWith('http://127.0.0.1:6099/api/'))
  assert.equal(options.redirect, 'error')
  const action = new URL(url).pathname, body = JSON.parse(options.body)
  calls.push(action)
  let data
  if (action === '/api/auth/login') {
    assert.equal(body.hash, createHash('sha256').update('fixture-local-webui-token.napcat').digest('hex'))
    data = { Credential: 'fixture-private-credential' }
  } else {
    assert.equal(options.headers.Authorization, 'Bearer fixture-private-credential')
    if (action.endsWith('/CheckLoginStatus')) data = { isLogin: logged, loginPhase: 'waiting_qrcode', qrcodeurl: 'https://example.invalid/qq-login-fixture' }
    else if (action.endsWith('/GetQQLoginInfo')) data = { uin: account, online: true }
    else if (action.endsWith('/GetConfig')) data = { network: { httpServers: [{ name: 'other-http', port: 8000 }], websocketServers: [{ name: 'other-client', host: '127.0.0.1', port: 4000, token: 'other-token' }] } }
    else if (action.endsWith('/SetConfig')) { configured = JSON.parse(body.config); data = null }
    else throw new Error(`Unexpected login API: ${action}`)
  }
  return { ok: true, json: async () => ({ code: 0, data }) }
}
try {
  assert.ok(findNapcat())
  const qr = await loginQQ()
  assert.equal(qr.logged, false); assert.match(qr.qr, /^data:image\/png;base64,/)
  assert.ok(!JSON.stringify(qr).includes('credential'))
  console.log('PASS QQ QR is generated locally without exposing WebUI credentials')
  store.setSettings({ qq: { selfId: '7777777', ownerId: '8888888', url: 'ws://127.0.0.1:3010', token: 'fixture-onebot-token' } })
  logged = true
  const result = await loginQQ()
  assert.equal(result.logged, true); assert.equal(result.selfId, '7777777')
  assert.equal(store.getSettings().qq.enabled, true)
  assert.equal(store.getSettings().qq.autoLaunchNapcat, true)
  assert.equal(configured.network.httpServers[0].name, 'other-http')
  assert.equal(configured.network.websocketServers.find((s) => s.name === 'other-client').token, 'other-token')
  assert.equal(configured.network.websocketServers.find((s) => s.name === 'dsh-qq-whale').host, '127.0.0.1')
  assert.equal(JSON.parse(fs.readFileSync(webui)).autoLoginAccount, '7777777')
  assert.ok(!JSON.stringify(result).includes('fixture-onebot-token'))
  console.log('PASS Scan login binds the account, configures loopback and preserves other transports')
  const before = calls.filter((r) => r.endsWith('/SetConfig')).length
  account = '9999999'
  assert.equal((await loginQQ()).accountMismatch, true)
  assert.equal(calls.filter((r) => r.endsWith('/SetConfig')).length, before)
  console.log('PASS A different scanned account cannot silently replace the saved companion')
  fs.writeFileSync(webui, JSON.stringify({ port: 6099, token: 'fixture-local-webui-token', enable2FA: true }))
  await assert.rejects(loginQQ(), /二次验证/)
  console.log('PASS Existing two-factor authentication is respected')
  assert.equal(startComponents(['not-a-component']).ok, false)
  assert.equal(startComponents([]).ok, false)
  assert.equal(COMPONENTS.length, 7)
  console.log('PASS Tool selection validates the complete optional component catalog')
  const previous = { network: { websocketServers: [{ name: 'dsh-qq-whale', port: 3010 }] } }
  const configuredTwice = onebotConfig(onebotConfig(previous, { port: 3010, token: 'a' }), { port: 3010, token: 'b' })
  assert.equal(configuredTwice.network.websocketServers.length, 1)
  assert.equal(previous.network.websocketServers[0].token, undefined)
  console.log('PASS Repeated login does not duplicate OneBot transports or mutate its source')
  const index = fs.readFileSync(path.join(root, 'index.js'), 'utf8'), client = fs.readFileSync(path.join(root, 'client', 'client.js'), 'utf8')
  assert.ok(!/ScheduleDrawer|mentor:schedule|\/api\/schedule|课表/.test(index + client))
  assert.ok(!fs.existsSync(path.join(root, 'lib', 'schedule.js')))
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).name, 'dsh-qq-whale')
  assert.ok(index.indexOf('  bootQQ()') < index.indexOf('  registerMentorTool(ctx,'))
  console.log('PASS Published package excludes all course modules and initializes QQ before optional tools')
} finally { globalThis.fetch = originalFetch; store.flush() }
console.log('VERIFIED 7 release checks; no real account or message used')
