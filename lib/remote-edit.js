import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { dataDir } from './store.js'
import { remoteMediaRequest } from './remote-media.js'
export async function remoteEdit(action, args) {
  const files = [], clean = { ...args }; let bytes = 0
  function upload(key, value) {
    const file = String(value || ''), ext = path.extname(file).toLowerCase()
    if (!path.isAbsolute(file) || !fs.existsSync(file) || !fs.statSync(file).isFile() || !/^\.[a-z0-9]{1,8}$/.test(ext)) throw new Error('需要现有素材文件绝对路径和有效扩展名')
    bytes += fs.statSync(file).size; if (bytes > 64*1024*1024) throw new Error('远端单次素材总量最多64MB，请先分段')
    const data = fs.readFileSync(file)
    files.push({ key, ext, data: data.toString('base64'), sha256: createHash('sha256').update(data).digest('hex') })
  }
  for (const key of ['file','music','subtitles']) if (clean[key]) { upload(key, clean[key]); delete clean[key] }
  if (clean.files) { for (const file of clean.files) upload('files', file); delete clean.files }
  const result = await remoteMediaRequest({ action, args: clean, files }, { timeout: 1100000 })
  if (!result.fileData) return result
  const data = Buffer.from(result.fileData, 'base64')
  if (createHash('sha256').update(data).digest('hex') !== result.sha256 || !/^\.[a-z0-9]{1,8}$/.test(result.ext)) throw new Error('远端成品校验失败')
  const folder = path.join(dataDir(), 'generated'); fs.mkdirSync(folder, { recursive: true })
  const file = path.join(folder, `remote-${Date.now()}-${randomUUID().slice(0,8)}${result.ext}`)
  fs.writeFileSync(file, data)
  return { ok: true, file, bytes: data.length, remoteArtifact: result.artifact, text: `远端制作完成并已校验：${file}。成品已存远端，本机副本供预览和QQ交付。可用handover交付。` }
}
