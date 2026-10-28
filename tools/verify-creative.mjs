import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-creative-'))
process.env.DSH_MENTOR_DATA = scratch
const { setSettings } = await import('../lib/store.js')
const { mediaBinary, editMedia, probeMedia } = await import('../lib/media-edit.js')
const { runMediaProcess: run } = await import('../lib/media-process.js')
const { createAnimation, animationHTML } = await import('../lib/animation.js')
const { autoCut, AUTO_EDITOR } = await import('../lib/auto-editor.js')
const skipAuto = process.argv.includes('--without-autocut'), onlyAuto = process.argv.includes('--autocut-only')
if (!process.env.DSH_TEST_FFMPEG || (!skipAuto && !process.env.DSH_TEST_AUTO_EDITOR)) throw new Error('Set DSH_TEST_FFMPEG and DSH_TEST_AUTO_EDITOR to verified local executables')
setSettings({ sing: { localFfmpeg: process.env.DSH_TEST_FFMPEG }, editing: { autoEditor: process.env.DSH_TEST_AUTO_EDITOR } })
if (!skipAuto) assert.equal(createHash('sha256').update(fs.readFileSync(process.env.DSH_TEST_AUTO_EDITOR)).digest('hex'), AUTO_EDITOR.sha256)
const input = path.join(scratch, 'source.mp4')
await run(mediaBinary('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=15:d=5', '-f', 'lavfi', '-i', "aevalsrc=if(between(t\\,1\\,2)+between(t\\,3\\,4)\\,0.4*sin(2*PI*440*t)\\,0):s=48000:d=5", '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-shortest', input], { cwd: scratch })
const hash = createHash('sha256').update(fs.readFileSync(input)).digest('hex')
let checks = 0
async function test(name, fn) { await fn(); checks++; console.log('PASS', name) }
if (!onlyAuto) await test('Multiple cuts are processed in one local export, in requested order', async () => {
  const result = await editMedia({ action: 'cutList', file: input, clips: [{ start: 3, duration: .8 }, { start: 1, duration: .7 }] })
  const meta = await probeMedia(result.file)
  assert.ok(Math.abs(Number(meta.format.duration) - 1.5) < .2)
  assert.ok(meta.streams.some((s) => s.codec_type === 'audio'))
  await assert.rejects(editMedia({ action: 'cutList', file: input, clips: [{ start: 4, duration: 3 }] }), /时长/)
})
if (!onlyAuto) await test('Fast trim and speed conversion create verified playable results', async () => {
  const fast = await editMedia({ action: 'losslessTrim', file: input, start: 0, duration: 2 })
  assert.match(fast.text, /关键帧/)
  const speed = await editMedia({ action: 'speed', file: input, speed: 2 })
  assert.ok(Math.abs(Number((await probeMedia(speed.file)).format.duration) - 2.5) < .2)
})
if (!skipAuto) await test('Official Auto-Editor removes synthetic silence and reuses the result', async () => {
  const result = await autoCut({ file: input, threshold: -35, margin: .1 })
  const duration = Number((await probeMedia(result.file)).format.duration)
  assert.ok(duration > 1.8 && duration < 3.5, String(duration))
  assert.equal((await autoCut({ file: input, threshold: -35, margin: .1 })).cached, true)
  await assert.rejects(autoCut({ file: input, threshold: 'bad' }), /阈值/)
})
if (!onlyAuto) await test('HTML animation is self contained and escapes script injection in scene text', async () => {
  const result = await createAnimation({ action: 'html', title: '</script><img src=x>', text: '海边的安静片刻' })
  const html = fs.readFileSync(result.file, 'utf8')
  assert.ok(html.includes('window.whaleSeek'))
  assert.ok(!html.includes('<img src=x>'))
  assert.ok(!/<script[^>]+src=/i.test(html))
  assert.throws(() => animationHTML({ scenes: [{ duration: 80 }] }), /总长/)
})
if (!onlyAuto) await test('Deterministic HTML animation exports to MP4 and cached export is reused', async () => {
  const args = { action: 'render', width: 640, height: 360, fps: 10, scenes: [{ title: '大肥鱼', text: '喜欢有留白的表达', duration: 1.5 }, { title: '一起把事情做好', text: '想法可以不同，决定交给你', duration: 1.5 }] }
  const result = await createAnimation(args), meta = await probeMedia(result.file)
  assert.ok(Math.abs(Number(meta.format.duration) - 3) < .1)
  assert.equal(meta.streams[0].width, 640)
  assert.equal((await createAnimation(args)).cached, true)
  console.log('ANIMATION PREVIEW', result.file)
})
assert.equal(createHash('sha256').update(fs.readFileSync(input)).digest('hex'), hash)
if (!onlyAuto) await test('Custom HTML with a seek hook renders offline without altering its source', async () => {
  const file = path.join(scratch, 'custom.html')
  const source = '<!doctype html><html><head><meta charset="utf-8"></head><body style="background:#112233;color:white"><div class="box">自己写的动画</div><script>const t=anime.createTimeline({autoplay:false});t.add(".box",{translateX:[0,100],duration:1000});window.whaleDuration=1;window.whaleSeek=s=>{t.pause();t.seek(s*1000)}</script></body></html>'
  fs.writeFileSync(file, source)
  const result = await createAnimation({ action: 'renderHTML', file, width: 320, height: 180, fps: 5 })
  assert.ok(Number((await probeMedia(result.file)).format.duration) >= 1)
  assert.equal(fs.readFileSync(file, 'utf8'), source)
})
console.log(`VERIFIED ${checks} creative checks; source untouched, no network media or QQ sends; outputs ${scratch}`)
