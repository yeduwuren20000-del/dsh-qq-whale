/** Remote canonical records, RAM read cache, temporary durable pending writes. */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { stateRequest } from './state-transport.js'
export const LOCAL_DATA = path.resolve(process.env.DSH_MENTOR_DATA || path.join(os.homedir(), '.dsh/storages/dsh-mentor'))
const configFile = process.env.DSH_MENTOR_BRIDGE_CONFIG || (!process.env.DSH_MENTOR_DATA ? path.join(os.homedir(), '.dsh/dsh-qq-whale-bridge.json') : '')
const pendingFile = configFile ? configFile + '.pending' : ''
export const archiveFiles = /^(?:store|memory|growth|character|autonomy|proactive|social|social-activity|memory-vectors)\.json$|^(?:diary|journal|tokens|shout|schedule)\/(?:[a-zA-Z0-9_.-]+)\.(?:json|jsonl|md)$/
export const remoteState = { active: false, files: new Map(), hashes: new Map(), dirty: new Map(), localVerified: new Map(), sequence: 0, lastError: '', syncedAt: 0 }
export function sanitizeArchivedStore(data, config = bridgeConfig()) {
  const value = JSON.parse(data.toString('utf8'))
  // Machine paths and QQ transport credentials stay in the local bridge file.
  for (const [group, fields] of Object.entries(config?.localSettingKeys || {})) {
    if (fields === true) delete value.settings?.[group]
    else for (const key of fields) if (value.settings?.[group]) delete value.settings[group][key]
  }
  return Buffer.from(JSON.stringify(value, null, 2))
}
let cfg, timer, sending, initializing
export function bridgeConfig() {
  if (!configFile) return null
  try { const value = JSON.parse(fs.readFileSync(configFile, 'utf8')); return value.enabled && value.state ? value : null } catch { return null }
}
export function archiveRelative(file) {
  const value = path.relative(LOCAL_DATA, path.resolve(String(file))).split(path.sep).join('/')
  if (value.startsWith('../') || path.isAbsolute(value)) return null
  const final = value.replace(/(?:\.\d+)?\.tmp$/, '')
  return archiveFiles.test(final) ? { name: value, final, temporary: final !== value } : null
}
const sha = data => createHash('sha256').update(data).digest('hex')
function savePending() {
  if (!pendingFile) return
  if (!remoteState.dirty.size) { try { fs.unlinkSync(pendingFile) } catch {} return }
  const changes = [...remoteState.dirty].map(([name, row]) => ({ name, expected: remoteState.hashes.get(name) || null, data: row.data === null ? null : row.data.toString('base64') }))
  fs.mkdirSync(path.dirname(pendingFile), { recursive: true })
  const temp = pendingFile + '.tmp'; fs.writeFileSync(temp, JSON.stringify({ host: cfg.host, root: cfg.root, changes }), { mode: 0o600 }); fs.renameSync(temp, pendingFile)
}
export function changed(name, data) {
  remoteState.dirty.set(name, { data, seq: ++remoteState.sequence }); savePending()
  clearTimeout(timer); timer = setTimeout(() => { void flushRemoteState().catch(() => {}) }, 800); timer.unref?.()
}
export async function flushRemoteState() {
  clearTimeout(timer)
  if (!remoteState.active || !remoteState.dirty.size) return
  if (sending) { await sending; return flushRemoteState() }
  const batch = [...remoteState.dirty].map(([name, row]) => ({ name, seq: row.seq, expected: remoteState.hashes.get(name) || null, data: row.data === null ? null : row.data.toString('base64') }))
  sending = (async () => {
    try {
      const result = await stateRequest(cfg, { action: 'state_commit', changes: batch.map(({ seq, ...row }) => row) })
      for (const row of batch) {
        remoteState.hashes.set(row.name, result.hashes[row.name])
        if (remoteState.dirty.get(row.name)?.seq === row.seq) remoteState.dirty.delete(row.name)
      }
      remoteState.lastError = ''; remoteState.syncedAt = Date.now(); savePending()
    } catch (error) {
      remoteState.lastError = error.message; savePending()
      timer = setTimeout(() => { void flushRemoteState().catch(() => {}) }, 15000); timer.unref?.(); throw error
    }
  })().finally(() => { sending = undefined })
  await sending
  if (remoteState.dirty.size) return flushRemoteState()
}
export function runtimeSettingsOverlay() { return bridgeConfig()?.settings || {} }
export function saveBridgeSettings(patch) {
  const config = bridgeConfig(); if (!config) return
  for (const [group, fields] of Object.entries(config.localSettingKeys || {})) {
    if (!(group in (patch || {}))) continue
    if (fields === true) config.settings[group] = patch[group]
    else for (const key of fields) if (Object.hasOwn(patch[group] || {}, key)) (config.settings[group] ||= {})[key] = patch[group][key]
  }
  const temp = configFile + '.tmp'; fs.writeFileSync(temp, JSON.stringify(config, null, 2), { mode: 0o600 }); fs.renameSync(temp, configFile)
}
export function remoteStateStatus() { return { remote: remoteState.active, pendingFiles: remoteState.dirty.size, syncedAt: remoteState.syncedAt, error: remoteState.lastError } }
export function initializeRemoteState() {
  if (initializing) return initializing
  cfg = bridgeConfig(); if (!cfg) return Promise.resolve(false)
  initializing = (async () => {
    remoteState.files.clear(); remoteState.hashes.clear(); remoteState.dirty.clear(); remoteState.localVerified.clear(); remoteState.active = false
    const localStore = path.join(LOCAL_DATA, 'store.json')
    if (fs.existsSync(localStore)) saveBridgeSettings(JSON.parse(fs.readFileSync(localStore, 'utf8')).settings || {})
    let snapshot = await stateRequest(cfg, { action: 'state_snapshot' })
    // Import only new changes written by the old local process since migration.
    const late = []
    const localNames = new Set(Object.keys(cfg.migrationBaseHashes || {}))
    if (fs.existsSync(LOCAL_DATA)) for (const entry of fs.readdirSync(LOCAL_DATA, { withFileTypes: true })) {
      if (archiveFiles.test(entry.name)) localNames.add(entry.name)
      if (entry.isDirectory() && /^(diary|journal|tokens|shout|schedule)$/.test(entry.name)) for (const name of fs.readdirSync(path.join(LOCAL_DATA, entry.name))) if (archiveFiles.test(`${entry.name}/${name}`)) localNames.add(`${entry.name}/${name}`)
    }
    for (const name of localNames) {
      const baseline = cfg.migrationBaseHashes?.[name] || null
      const file = path.join(LOCAL_DATA, name)
      if (!fs.existsSync(file)) continue
      const original = fs.readFileSync(file), hash = sha(original), current = snapshot.files[name]?.sha256 || null
      const data = name === 'store.json' ? sanitizeArchivedStore(original, cfg) : original
      if (hash === baseline || sha(data) === current) continue
      if (current !== (cfg.migrationRemoteHashes?.[name] || baseline)) throw new Error(`档案存在并发改动，原文件已保留：${name}`)
      late.push({ name, data: data.toString('base64'), expected: current })
    }
    if (late.length) { await stateRequest(cfg, { action: 'state_commit', changes: late }); snapshot = await stateRequest(cfg, { action: 'state_snapshot' }) }
    for (const name of localNames) {
      const file = path.join(LOCAL_DATA, name)
      if (!fs.existsSync(file)) continue
      const data = fs.readFileSync(file), rawHash = sha(data), exported = name === 'store.json' ? sanitizeArchivedStore(data, cfg) : data
      if (sha(exported) === snapshot.files[name]?.sha256 || (rawHash === cfg.migrationBaseHashes?.[name] && snapshot.files[name]?.sha256 === cfg.migrationRemoteHashes?.[name])) remoteState.localVerified.set(name, rawHash)
    }
    for (const [name, row] of Object.entries(snapshot.files)) {
      if (!archiveFiles.test(name)) throw new Error('远端档案名称无效')
      const data = Buffer.from(row.data, 'base64'); if (sha(data) !== row.sha256) throw new Error('远端档案校验失败')
      remoteState.files.set(name, { data, mtimeMs: row.mtimeMs }); remoteState.hashes.set(name, row.sha256)
    }
    if (fs.existsSync(pendingFile)) {
      const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'))
      if (pending.host !== cfg.host || pending.root !== cfg.root) throw new Error('待同步档案属于另一台服务器')
      for (const row of pending.changes) {
        if (!archiveFiles.test(row.name)) throw new Error('待同步档案名称无效')
        const data = row.data === null ? null : Buffer.from(row.data, 'base64'), current = remoteState.hashes.get(row.name) || null
        if (data && sha(data) === current) continue
        if (current !== row.expected) throw new Error(`离线档案存在冲突，已保留：${row.name}`)
        if (data === null) remoteState.files.delete(row.name); else remoteState.files.set(row.name, { data, mtimeMs: Date.now() })
        remoteState.dirty.set(row.name, { data, seq: ++remoteState.sequence })
      }
    }
    remoteState.active = true; await flushRemoteState()
    remoteState.syncedAt = Date.now()
    // No local archive copies remain after verified hydration. Media/QQ bridge
    // files outside the explicit state whitelist are unaffected.
    for (const name of cfg.cleanupVerifiedState ? remoteState.files.keys() : []) {
      const file = path.join(LOCAL_DATA, name)
      if (fs.existsSync(file) && sha(fs.readFileSync(file)) === remoteState.hashes.get(name)) fs.unlinkSync(file)
    }
    return true
  })().catch(error => { initializing = undefined; remoteState.active = false; remoteState.lastError = error.message; throw error })
  return initializing
}
