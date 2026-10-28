// Runs only inside a disposable remote job directory, using existing plugin tools.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
const request = path.resolve(process.argv[2]), folder = path.dirname(request), job = JSON.parse(fs.readFileSync(request))
process.env.DSH_MENTOR_DATA = path.join(folder, 'state')
process.env.DSH_MENTOR_BRIDGE_CONFIG = path.join(folder, 'disabled-bridge.json')
const { setSettings, flush } = await import('./plugin/lib/store.js')
setSettings({ sing: { localFfmpeg: '/usr/bin/ffmpeg' } })
try {
 const args = { ...job.args }
 const uploads = []
 let total = 0
 for (const [i, item] of (job.files || []).entries()) {
  if (!/^(file|files|music|subtitles)$/.test(item.key) || !/^\.[a-zA-Z0-9]{1,8}$/.test(item.ext)) throw new Error('Invalid remote media input')
  const data = Buffer.from(item.data, 'base64'); total += data.length
  if (total > 64*1024*1024 || createHash('sha256').update(data).digest('hex') !== item.sha256) throw new Error('Media input integrity/size check failed')
  const file = path.join(folder, 'input-'+i+item.ext); fs.writeFileSync(file, data)
  if (item.key === 'files') uploads.push(file); else args[item.key] = file
 }
 if (uploads.length) args.files = uploads
 let result
 if (job.action === 'animation') result = await (await import('./plugin/lib/animation.js')).createAnimation(args)
 else {
  const { editMedia, probeMedia } = await import('./plugin/lib/media-edit.js')
  if (args.action === 'autoCut') {
   const threshold = Number(args.threshold ?? -35), margin = Number(args.margin ?? .2), input = args.file || args.files?.[0]
   if (!(threshold >= -80 && threshold <= -5 && margin >= 0 && margin <= 3)) throw new Error('Invalid silence detection settings')
   const meta = await probeMedia(input), duration = Number(meta.format?.duration)
   if (!(duration > 0 && duration <= 1800) || !meta.streams.some(s => s.codec_type === 'video') || !meta.streams.some(s => s.codec_type === 'audio')) throw new Error('远端去静音需要30分钟内、含音轨的视频')
   const check = spawnSync('/usr/bin/ffmpeg', ['-hide_banner','-nostdin','-threads','2','-i',input,'-vn','-af',`silencedetect=noise=${threshold}dB:d=0.3`,'-f','null','-'], { encoding: 'utf8', timeout: 180000, maxBuffer: 4*1024*1024 })
   if (check.error || check.status) throw new Error('远端静音检测未完成')
   let cursor = 0, start; const intervals = []
   for (const match of check.stderr.matchAll(/silence_(start|end):\s*([0-9.]+)/g)) {
    if (match[1] === 'start') start = Number(match[2])
    else if (start !== undefined) { intervals.push([start, Number(match[2])]); start = undefined }
   }
   if (start !== undefined) intervals.push([start, duration])
   const clips = []
   for (const [a,b] of intervals) {
    const end = Math.min(duration, a+margin)
    if (end-cursor > .08) clips.push({ start: cursor, duration: end-cursor })
    cursor = Math.max(cursor, b-margin)
   }
   if (duration-cursor > .08) clips.push({ start: cursor, duration: duration-cursor })
   if (!clips.length || clips.length > 24) throw new Error('去静音后片段为空或超过24段，请先分段；原视频保留')
   args.action = 'cutList'; args.clips = clips
  }
  result = await editMedia(args)
 }
 if (!result.ok) throw new Error(result.text || 'Media processing failed')
 if (result.file) {
  const file = path.resolve(result.file)
  if (!file.startsWith(folder+path.sep)) throw new Error('Media output outside job directory')
  const data = fs.readFileSync(file)
  if (data.length > 48*1024*1024) throw new Error('Media output too large; compress or split first')
  console.log(JSON.stringify({ ok: true, fileData: data.toString('base64'), sha256: createHash('sha256').update(data).digest('hex'), ext: path.extname(file), bytes: data.length }))
 } else console.log(JSON.stringify(result))
} finally { flush() }
