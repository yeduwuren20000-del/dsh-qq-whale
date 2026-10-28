import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { bridgeConfig, LOCAL_DATA } from './remote-state.js'
import { remoteMediaRequest } from './remote-media.js'
const waiting = new Map()
export async function ensureRemoteArtifact(file) {
  const full = path.resolve(String(file || ''))
  if (fs.existsSync(full) || !full.startsWith(LOCAL_DATA+path.sep)) return
  const name = path.relative(LOCAL_DATA, full).split(path.sep).join('/')
  const row = bridgeConfig()?.artifacts?.find(item => item.name === name)
  if (!row) return
  if (waiting.has(full)) return waiting.get(full)
  const task = (async () => {
    const result = await remoteMediaRequest({ action: 'artifact_get', artifact: row.artifact })
    const data = Buffer.from(result.fileData, 'base64')
    if (createHash('sha256').update(data).digest('hex') !== row.sha256) throw new Error('远端归档成品校验失败')
    await fs.promises.mkdir(path.dirname(full), { recursive: true })
    const temp = full+'.restore.tmp'; await fs.promises.writeFile(temp, data); await fs.promises.rename(temp, full)
  })().finally(() => waiting.delete(full))
  waiting.set(full, task); return task
}
