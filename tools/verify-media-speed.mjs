import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { runMediaProcess } from '../lib/media-process.js'
import { withTaskProgress } from '../lib/task-progress.js'

const root = path.resolve(import.meta.dirname, '..')
fs.mkdirSync(path.join(root, 'verification-data'), { recursive: true })
process.env.DSH_MENTOR_DATA = fs.mkdtempSync(path.join(root, 'verification-data', 'media-speed-'))
if (process.env.DSH_TEST_MEDIA_RUNTIME) {
  const runtime = path.join(process.env.DSH_MENTOR_DATA, 'runtime'); fs.mkdirSync(runtime)
  for (const name of ['ffmpeg', 'ffprobe']) {
    const binary = name + (process.platform === 'win32' ? '.exe' : '')
    fs.copyFileSync(path.join(process.env.DSH_TEST_MEDIA_RUNTIME, binary), path.join(runtime, binary))
  }
}
const { prepareAudioDelivery, editMedia, probeMedia } = await import('../lib/media-edit.js')
const { MAX_FILE, handover } = await import('../lib/files.js')
const { setSettings } = await import('../lib/store.js')
if (process.env.DSH_TEST_MEDIA_RUNTIME) setSettings({ sing: { localFfmpeg: path.join(process.env.DSH_MENTOR_DATA, 'runtime', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg') } })
const { songVoiceSegments, createSongDelivery } = await import('../lib/song-delivery.js')
let checks = 0
async function test(name, fn) { await fn(); checks++; console.log('PASS', name) }

await test('A slow media process leaves the event loop responsive', async () => {
  let ticks = 0
  const timer = setInterval(() => ticks++, 15)
  try {
    const output = await runMediaProcess(process.execPath, ['-e', "setTimeout(()=>process.stdout.write('ready'),250)"])
    assert.equal(output, 'ready'); assert.ok(ticks >= 5)
  } finally { clearInterval(timer) }
})
await test('Failed and timed-out processes reject cleanly', async () => {
  await assert.rejects(runMediaProcess(process.execPath, ['-e', "process.stderr.write('fixture-failure');process.exit(2)"]), /fixture-failure/)
  await assert.rejects(runMediaProcess(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { timeout: 50 }), /超时/)
})
await test('Batch media output waits for ordered asynchronous segment delivery', async () => {
  const lines = []
  await runMediaProcess(process.execPath, ['-e', "process.stdout.write('first\\nsec');setTimeout(()=>process.stdout.write('ond\\nthird'),20)"], {
    onLine: async (line) => { await new Promise((r) => setTimeout(r, 15)); lines.push(line) },
  })
  assert.deepEqual(lines, ['first', 'second', 'third'])
  await assert.rejects(runMediaProcess(process.execPath, ['-e', "console.log('part');setTimeout(()=>{},10000)"], { onLine() { throw new Error('delivery failed') } }), /delivery failed/)
})
await test('Real task progress starts before work and stops on completion or failure', async () => {
  const notes = []
  const entry = { onProgress: (text) => notes.push(text) }
  await withTaskProgress(entry, '测试任务', async () => { assert.equal(notes.length, 1); await new Promise((r) => setTimeout(r, 55)) }, { intervalMs: 20 })
  assert.ok(notes.length >= 2)
  const done = notes.length; await new Promise((r) => setTimeout(r, 40)); assert.equal(notes.length, done)
  await assert.rejects(withTaskProgress(entry, '失败任务', async () => { throw new Error('fixture') }, { intervalMs: 20 }), /fixture/)
  const failed = notes.length; await new Promise((r) => setTimeout(r, 40)); assert.equal(notes.length, failed)
})
await test('A notification failure does not discard a finished media job', async () => {
  assert.equal(await withTaskProgress({ onProgress() { throw new Error('offline') } }, '测试任务', async () => 42), 42)
})

const file = path.join(process.env.DSH_MENTOR_DATA, 'oversized.wav')
const bytes = 280 * 48000 * 2
const wav = Buffer.alloc(44 + bytes)
wav.write('RIFF'); wav.writeUInt32LE(36 + bytes, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16)
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28)
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(bytes, 40)
fs.writeFileSync(file, wav)
const hash = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const originalHash = hash(file)
await test('An audio file over 24MB is converted locally and can be handed over', async () => {
  assert.ok(fs.statSync(file).size > MAX_FILE)
  const result = await prepareAudioDelivery(file, '鲸鱼唱歌.wav')
  assert.equal(result.converted, true); assert.equal(result.name, '鲸鱼唱歌.mp3')
  assert.ok(fs.statSync(result.file).size < MAX_FILE)
  assert.ok(Math.abs(Number((await probeMedia(result.file)).format.duration) - 280) < 1)
  const delivered = handover(result.file, result.name)
  assert.ok(delivered.size < MAX_FILE); assert.equal(hash(file), originalHash)
})
await test('Audio extraction publishes a verified copy without altering its input', async () => {
  const result = await editMedia({ action: 'audio', file })
  const meta = await probeMedia(result.file)
  assert.equal(meta.streams[0].sample_rate, '16000')
  assert.equal(meta.streams[0].channels, 1)
  assert.equal(hash(file), originalHash)
})
await test('Small files keep their existing format and filename', async () => {
  const small = path.join(process.env.DSH_MENTOR_DATA, 'note.txt'); fs.writeFileSync(small, 'fixture')
  const result = await prepareAudioDelivery(small, '说明.txt')
  assert.equal(result.converted, false); assert.equal(result.file, small); assert.equal(result.name, '说明.txt')
})
await test('Long songs split into short QQ voice messages without losing duration', async () => {
  const parts = await songVoiceSegments(file)
  assert.equal(parts.length, 6)
  let duration = 0
  for (const part of parts) {
    const meta = await probeMedia(part)
    assert.ok(Number(meta.format.duration) <= 50.2)
    assert.equal(meta.streams[0].sample_rate, '24000'); assert.equal(meta.streams[0].channels, 1)
    assert.ok(fs.statSync(part).size < 12 * 1024 * 1024)
    duration += Number(meta.format.duration)
  }
  assert.ok(Math.abs(duration - 280) < 0.1)
  assert.equal(hash(file), originalHash)
})
await test('Completed local segments send immediately and finish does not duplicate them', async () => {
  const sent = [], delivery = createSongDelivery(async (file) => { sent.push(file); return true }, { prepare: async (file) => [file] })
  await delivery.onSegment('part1', { index: 1, total: 2 }); assert.deepEqual(sent, ['part1'])
  await delivery.onSegment('part2', { index: 2, total: 2 })
  const result = await delivery.finish('whole-song')
  assert.deepEqual(sent, ['part1', 'part2']); assert.equal(result.sent, 2); assert.equal(result.ok, true)
})
await test('A completed remote song sends its voice segments in order', async () => {
  const sent = [], delivery = createSongDelivery(async (file) => { sent.push(file); return true }, { prepare: async () => ['part1', 'part2', 'part3'] })
  const result = await delivery.finish('whole-song')
  assert.deepEqual(sent, ['part1', 'part2', 'part3']); assert.equal(result.sent, 3)
})
await test('Partial voice delivery reports the exact count and does not repeat earlier parts', async () => {
  const sent = [], delivery = createSongDelivery(async (file) => { sent.push(file); return file !== 'part2' }, { prepare: async () => ['part1', 'part2', 'part3'] })
  const result = await delivery.finish('whole-song')
  assert.equal(result.ok, false); assert.equal(result.sent, 1); assert.equal(result.parts, 3)
  assert.match(result.error, /限流|未连接/); assert.deepEqual(sent, ['part1', 'part2'])
})
console.log(`VERIFIED ${checks} media speed and delivery checks; no real account or message used`)
