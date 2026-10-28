import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { dataDir } from './store.js'
import { mediaBinary, probeMedia } from './media-edit.js'
import { runMediaProcess } from './media-process.js'

const ffmpeg = () => mediaBinary('ffmpeg')

/** QQ voice messages stay below 50 seconds and 12MB; the original is preserved. */
export async function songVoiceSegments(source, { seconds = 50 } = {}) {
  const length = Math.max(10, Math.min(50, Number(seconds) || 50))
  const meta = await probeMedia(source)
  if (!meta.streams?.some((row) => row.codec_type === 'audio')) throw new Error('成品没有可发送的音轨')
  const duration = Number(meta.format?.duration)
  if (!(duration > 0)) throw new Error('无法确定歌曲时长')
  const audio = meta.streams.find((row) => row.codec_type === 'audio')
  if (duration <= length + 0.1 && fs.statSync(source).size <= 12 * 1024 * 1024 && audio.sample_rate === '24000' && audio.channels === 1 && audio.codec_name === 'pcm_s16le') return [source]
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-voice-'))
  const output = path.join(dataDir(), 'sing', 'records', randomUUID())
  try {
    await runMediaProcess(ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', source, '-vn', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', '-f', 'segment', '-segment_time', String(length), path.join(work, 'voice-%03d.wav')], { cwd: work })
    const names = fs.readdirSync(work).filter((name) => /^voice-\d+\.wav$/.test(name)).sort()
    if (!names.length) throw new Error('没有生成可发送的语音片段')
    fs.mkdirSync(output, { recursive: true })
    for (const name of names) {
      const file = path.join(work, name), part = await probeMedia(file)
      if (fs.statSync(file).size > 12 * 1024 * 1024 || Number(part.format?.duration) > length + 0.2) throw new Error('语音分段验证失败，原歌曲保留')
      fs.copyFileSync(file, path.join(output, name))
    }
    return names.map((name) => path.join(output, name))
  } finally {
    if (path.dirname(path.resolve(work)) === path.resolve(os.tmpdir())) fs.rmSync(work, { recursive: true, force: true })
  }
}

/** Send only completed segments, in order. A failed send never silently becomes success. */
export function createSongDelivery(sendRecord, { prepare = songVoiceSegments } = {}) {
  let sent = 0, parts = 0, error = ''
  const deliver = async (file, meta = {}) => {
    if (error) return
    try {
      const files = await prepare(file)
      parts = Math.max(parts, meta.total || files.length)
      for (const part of files) {
        if (await sendRecord(part) === false) throw new Error('QQ 暂时限流或未连接')
        sent++
      }
    } catch (e) { error = String(e?.message || e) }
  }
  return {
    onSegment: deliver,
    async finish(file) {
      if (!sent && !error) await deliver(file)
      return { ok: !error, sent, parts, error, file }
    },
  }
}
