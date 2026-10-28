/** One-time cleanup after the new plugin has successfully loaded remote records. */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { bridgeConfig, remoteState, flushRemoteState, LOCAL_DATA } from './remote-state.js'
import { remoteMediaStatus, remoteMediaRequest } from './remote-media.js'
const sha = data => createHash('sha256').update(data).digest('hex')
const progress = { stage: 'not_requested', freedBytes: 0, error: '' }
let task
export const remoteCleanupStatus = () => ({ ...progress })
async function treeSize(folder, root) {
  const resolved = await fs.promises.realpath(folder)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error('清理路径越界，已保留')
  let size = 0
  for (const row of await fs.promises.readdir(folder, { withFileTypes: true })) {
    if (row.isSymbolicLink()) throw new Error('目录内存在链接，已保留')
    const file = path.join(folder, row.name)
    size += row.isDirectory() ? await treeSize(file, root) : (await fs.promises.stat(file)).size
  }
  return size
}
export function finalizeRemoteMigration() {
  const cfg = bridgeConfig()
  if (!cfg?.cleanupPlan || !remoteState.active) return Promise.resolve()
  if (task) return task
  task = (async () => {
    progress.stage = 'checking'
    await flushRemoteState()
    const status = await remoteMediaStatus()
    if (!status.ready || !cfg.modelsVerified || !status.voices?.includes(cfg.cleanupPlan.voiceId)) throw new Error('远端模型或固定音色未确认，保留本机文件')
    for (const profile of cfg.cleanupPlan.voiceProfiles || []) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(profile.id)) throw new Error('音色档案路径无效')
      const folder = path.join(LOCAL_DATA, 'voice-profiles', profile.id), file = path.join(folder, 'reference.wav')
      if (!fs.existsSync(file)) continue
      const check = await remoteMediaRequest({ action: 'voice_check', voiceId: profile.id })
      const data = await fs.promises.readFile(file)
      if (sha(data) !== profile.sha256 || check.sha256 !== profile.sha256) throw new Error('固定音色校验不符，已保留本机参考')
      if ((await fs.promises.readdir(folder)).some(name => !['reference.wav','profile.json'].includes(name))) throw new Error('音色目录含未迁移文件，已保留')
      const root = await fs.promises.realpath(folder)
      if (root.toLowerCase() !== folder.toLowerCase()) throw new Error('音色目录包含链接，已保留')
      const size = await treeSize(root, root); await fs.promises.rm(root, { recursive: true }); progress.freedBytes += size
    }
    for (const item of cfg.cleanupPlan.ownedDirectories || []) {
      const folder = path.resolve(item.path)
      if (!fs.existsSync(folder)) continue
      const root = await fs.promises.realpath(folder)
      if (root.toLowerCase() !== folder.toLowerCase() || folder === path.parse(folder).root || folder.split(path.sep).length < 3) throw new Error('专用目录路径不符合清理条件')
      if (!/^[a-zA-Z0-9_.-]+$/.test(item.marker) || (await fs.promises.readFile(path.join(root, item.marker), 'utf8')).trim() !== item.owner) throw new Error('专用目录所有权标记不符，已保留')
      const size = await treeSize(root, root)
      progress.stage = 'removing_owned_models'
      await fs.promises.rm(root, { recursive: true, force: false }); progress.freedBytes += size
    }
    for (const [name, expected] of remoteState.localVerified) {
      const file = path.join(LOCAL_DATA, name)
      if (!fs.existsSync(file)) continue
      const data = await fs.promises.readFile(file)
      if (sha(data) === expected) { await fs.promises.unlink(file); progress.freedBytes += data.length }
    }
    // Remove only exact, verified copies of already archived authored media.
    for (const row of cfg.artifacts || []) {
      if (!/^(voice|sing|generated|outbox)\//.test(row.name) || row.name.split('/').includes('..')) continue
      const file = path.resolve(LOCAL_DATA, row.name)
      if (!file.startsWith(LOCAL_DATA+path.sep) || !fs.existsSync(file)) continue
      const data = await fs.promises.readFile(file)
      if (sha(data) !== row.sha256) continue
      const check = await remoteMediaRequest({ action: 'artifact_check', artifact: row.artifact })
      if (check.sha256 !== row.sha256 || check.bytes !== data.length) throw new Error('远端媒体校验失败，本机副本已保留')
      await fs.promises.unlink(file); progress.freedBytes += data.length
    }
    for (const name of cfg.cleanupPlan.storageCaches || []) {
      if (!['browsers','music','shots'].includes(name)) throw new Error('缓存目录不在清理范围')
      const folder = path.resolve(LOCAL_DATA, name)
      if (!fs.existsSync(folder)) continue
      const root = await fs.promises.realpath(folder)
      if (root.toLowerCase() !== folder.toLowerCase() || !root.startsWith(LOCAL_DATA+path.sep)) throw new Error('缓存目录路径异常，已保留')
      const size = await treeSize(root, root); await fs.promises.rm(root, { recursive: true, force: false }); progress.freedBytes += size
    }
    progress.stage = 'completed'
  })().catch(error => { progress.stage = 'preserved'; progress.error = error.message; console.error('[dsh-mentor] 迁移清理未完成，剩余文件已保留：', error.message) })
  return task
}
