import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { createCosyClient } from '../lib/cosy-voice.js'

let launches = 0, killed = 0, mode = 'reply'
const sent = []
function spawnProcess(python, args, options) {
  launches++
  assert.equal(python, 'local-python')
  assert.ok(args.includes('local-model'))
  assert.equal(options.windowsHide, true)
  assert.equal(options.env.HF_HUB_OFFLINE, '1')
  const child = new EventEmitter()
  child.stdout = new PassThrough(); child.stderr = new PassThrough()
  child.kill = () => { killed++; child.emit('exit', 0) }
  child.stdin = new Writable({ write(data, encoding, done) {
    const job = JSON.parse(data.toString()); sent.push(job); done()
    if (mode === 'hang') return
    if (mode === 'crash') { queueMicrotask(() => child.emit('exit', 2)); return }
    const result = mode === 'error' ? { id: job.id, ok: false, error: '模型拒绝本次请求' } : { id: job.id, ok: true, text: '声音没有换人', ready: true }
    const line = Buffer.from(JSON.stringify(result) + '\n')
    const split = line.indexOf(Buffer.from('声音')) + 1
    queueMicrotask(() => { child.stdout.write(line.subarray(0, split)); child.stdout.write(line.subarray(split)) })
  } })
  return child
}
const config = () => ({ python: 'local-python', repo: 'local-repo', model: 'local-model', device: 'auto' })
const client = createCosyClient({ config, spawnProcess, timeoutMs: 150, idleMs: 30 })
try {
  const rows = await Promise.all([client.request({ action: 'warm' }), client.request({ action: 'tts', mood: 'happy', referenceFile: 'same-reference.wav' })])
  assert.equal(launches, 1); assert.equal(rows[1].text, '声音没有换人')
  assert.equal(sent[1].referenceFile, 'same-reference.wav')
  assert.notEqual(sent[0].id, sent[1].id)
  mode = 'error'
  await assert.rejects(client.request({ action: 'tts' }), /模型拒绝/)
  mode = 'reply'
  await client.request({ action: 'warm' }); assert.equal(launches, 1)
  await new Promise(resolve => setTimeout(resolve, 60)); assert.equal(killed, 1)
  mode = 'crash'
  await assert.rejects(client.request({ action: 'tts' }), /已退出/)
  assert.equal(launches, 2)
  mode = 'hang'
  const outcomes = await Promise.allSettled([client.request({ action: 'tts' }), client.request({ action: 'tts' })])
  assert.ok(outcomes.every(result => result.status === 'rejected' && /超时/.test(result.reason.message)))
  assert.equal(launches, 3); assert.equal(killed, 3)
  console.log('VERIFIED persistent worker, concurrent correlation, UTF-8, error recovery, idle release, crash and timeout cleanup')
} finally { client.stop() }
