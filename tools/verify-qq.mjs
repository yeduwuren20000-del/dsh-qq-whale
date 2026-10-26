import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { WebSocketServer } from 'ws'

const root = path.resolve(import.meta.dirname, '..')
const scratch = fs.mkdtempSync(path.join(root, 'verification-data', 'qq-'))
process.env.DSH_MENTOR_DATA = scratch
const { synthesizeVoice, stopPerception } = await import('../lib/perception.js')
const { createQQBridge, DEFAULT_QQ } = await import('../lib/qq.js')
const audio = await synthesizeVoice('你好，今天是星期一，我们下午三点见。')
const server = http.createServer((req, res) => {
  const buffer = fs.readFileSync(path.join(root, 'assets', 'stickers', 'dafeiyu-001__confused__wenhao.jpg'))
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buffer.length }); res.end(buffer)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const wsServer = new WebSocketServer({ server })
const port = server.address().port
let socket, connectionCount = 0, recordSent
wsServer.on('connection', (s) => {
  socket = s; connectionCount++
  s.on('message', (raw) => {
    const request = JSON.parse(String(raw))
    let data = {}
    if (request.action === 'get_login_info') data = { user_id: 77777 }
    if (request.action === 'get_record') data = { file: audio.file }
    if (request.action === 'send_private_msg') { recordSent = request.params; data = { message_id: 99999 } }
    s.send(JSON.stringify({ status: 'ok', retcode: 0, echo: request.echo, data }))
  })
})
const config = { ...DEFAULT_QQ, enabled: true, autoLaunchNapcat: false, url: `ws://127.0.0.1:${port}`, ownerId: '12345', humanize: false }
const received = []
const options = { getConfig: () => config, mediaDir: path.join(scratch, 'qq-media'), onMessage: (m) => { received.push(m) }, log() {} }
const first = createQQBridge(options), second = createQQBridge(options)
first.start(); second.start()
async function waitFor(predicate, max = 120000) {
  const start = Date.now()
  while (!predicate()) { if (Date.now() - start > max) throw new Error('QQ mock test timed out'); await new Promise((r) => setTimeout(r, 100)) }
}
try {
  await waitFor(() => socket && first.status().status === 'connected')
  assert.equal(connectionCount, 1)
  socket.send(JSON.stringify({ post_type: 'message', message_type: 'private', self_id: 77777, user_id: 12345, message_id: 1, sender: { nickname: '测试' }, message: [{ type: 'record', data: { file: 'fixture.wav' } }] }))
  await waitFor(() => received.length === 1)
  assert.equal(received[0].voice, true)
  assert.match(received[0].text, /语音转文字/)
  assert.match(received[0].text, /你好|星期|下午/)
  console.log('PASS QQ record -> local SenseVoice -> transcribed conversation')
  socket.send(JSON.stringify({ post_type: 'message', message_type: 'private', self_id: 77777, user_id: 12345, message_id: 2, sender: { nickname: '测试' }, message: [{ type: 'mface', data: { url: `http://127.0.0.1:${port}/test.jpg`, summary: '动画表情' } }] }))
  await waitFor(() => received.length === 2)
  assert.match(received[1].text, /本地视觉识别/)
  assert.match(received[1].text, /疑惑|困惑|问号|惊讶/)
  console.log('PASS QQ market sticker -> local vision -> visual understanding')
  assert.equal(await first.sendRecord('private', '12345', audio.file), true)
  assert.equal(recordSent.message[0].type, 'record')
  assert.ok(recordSent.message[0].data.file.startsWith('base64://'))
  console.log('PASS Local synthesized audio -> OneBot voice message; single shared connection')
} finally {
  first.stop(); second.stop(); stopPerception()
  for (const s of wsServer.clients) s.terminate()
  await new Promise((r) => wsServer.close(r)); await new Promise((r) => server.close(r))
}
console.log('VERIFIED local QQ media round trips; no real QQ account contacted')
