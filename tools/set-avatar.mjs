/**
 * 把鲸鱼娘头像设成 QQ 号的头像（NapCat 的 set_qq_avatar）。
 *   node tools/set-avatar.mjs [wsUrl] [token]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const url = process.argv[2] || 'ws://127.0.0.1:3010'
const token = process.argv[3] || ''
const file = path.join(ROOT, 'assets', 'whale-girl.webp')
const base64 = fs.readFileSync(file).toString('base64')

const target = token ? `${url}?access_token=${encodeURIComponent(token)}` : url
const ws = new WebSocket(target)

const timer = setTimeout(() => {
  console.log('超时：网关没回话')
  process.exit(1)
}, 30000)

ws.on('open', () => {
  console.log('已连上网关，上传头像…')
  ws.send(JSON.stringify({ action: 'set_qq_avatar', params: { file: `base64://${base64}` }, echo: 'avatar' }))
})

ws.on('message', (raw) => {
  const data = JSON.parse(String(raw))
  if (data.echo !== 'avatar') return
  clearTimeout(timer)
  console.log('结果:', JSON.stringify({ status: data.status, retcode: data.retcode, wording: data.wording || '' }))
  ws.close()
  process.exit(data.status === 'ok' ? 0 : 1)
})

ws.on('error', (error) => {
  clearTimeout(timer)
  console.log('连接失败:', error.message)
  process.exit(1)
})
