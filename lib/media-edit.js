import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dataDir } from './store.js'

const RUNTIME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'runtime')
const binary = (name) => { const file = `${name}${process.platform === 'win32' ? '.exe' : ''}`; const bundled = path.join(RUNTIME, file); return fs.existsSync(bundled) ? bundled : path.join(dataDir(), 'runtime', file) }
function localFile(value) {
  const file = String(value || '')
  if (!path.isAbsolute(file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('需要一个存在的本地素材文件绝对路径')
  return fs.realpathSync(file)
}
function run(command, args, { cwd, timeout = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('本地剪辑超时，已保留原素材')) }, timeout)
    child.stdout.on('data', (b) => { out = (out + b).slice(-50000) })
    child.stderr.on('data', (b) => { err = (err + b).slice(-4000) })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`剪辑失败：${err.slice(-1200)}`)) })
  })
}
export async function probeMedia(file) {
  return JSON.parse(await run(binary('ffprobe'), ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_format', '-show_streams', '-of', 'json', localFile(file)]))
}
export function editingStatus() { return { ready: fs.existsSync(binary('ffmpeg')) && fs.existsSync(binary('ffprobe')), engine: 'FFmpeg', localOnly: true } }

export async function editMedia(args) {
  if (!editingStatus().ready) throw new Error('本地剪辑工具尚未就绪')
  const input = localFile(args.file || args.files?.[0])
  if (args.action === 'probe') return { ok: true, text: JSON.stringify(await probeMedia(input)) }
  const folder = path.join(dataDir(), 'generated'); fs.mkdirSync(folder, { recursive: true })
  const stem = `edit-${Date.now()}-${randomUUID().slice(0, 6)}`
  const ext = args.action === 'thumbnail' ? '.jpg' : args.action === 'audio' ? '.wav' : '.mp4'
  const output = path.join(folder, `${stem}${ext}`)
  const base = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n']
  const infile = (file) => ['-protocol_whitelist', 'file,pipe', '-i', file]
  const encode = ['-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-threads', '4']
  let command = [...base], temporary = ''
  const meta = await probeMedia(input)
  const hasAudio = meta.streams.some((s) => s.codec_type === 'audio')
  switch (args.action) {
    case 'trim': {
      const start = Math.max(0, Number(args.start) || 0), duration = Number(args.duration)
      if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new Error('裁剪时长需要在0到3600秒之间')
      command.push('-ss', String(start), ...infile(input), '-t', String(duration), ...encode); break
    }
    case 'mute': command.push(...infile(input), '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'); break
    case 'resize': {
      const width = Math.round(Number(args.width) / 2) * 2, height = Math.round(Number(args.height) / 2) * 2
      if (![width, height].every((n) => Number.isFinite(n) && n >= 64 && n <= 3840)) throw new Error('宽高需要在64到3840之间')
      command.push(...infile(input), '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`, ...encode); break
    }
    case 'music': {
      const music = localFile(args.music), volume = Math.max(0, Math.min(2, Number(args.volume ?? 0.3)))
      command.push(...infile(input), '-stream_loop', '-1', ...infile(music))
      const filter = hasAudio && args.mix !== false ? `[1:a]volume=${volume}[bg];[0:a][bg]amix=inputs=2:duration=first[a]` : `[1:a]volume=${volume}[a]`
      command.push('-filter_complex', filter, '-map', '0:v:0', '-map', '[a]', '-shortest', ...encode); break
    }
    case 'subtitles': {
      const subtitles = localFile(args.subtitles)
      if (!/\.(srt|ass|vtt)$/i.test(subtitles)) throw new Error('字幕需要是SRT、ASS或VTT文件')
      const ext = path.extname(subtitles).toLowerCase()
      temporary = path.join(folder, `${stem}-subtitles${ext}`); fs.copyFileSync(subtitles, temporary)
      command.push(...infile(input), '-vf', `subtitles=filename='${path.basename(temporary)}'`, ...encode); break
    }
    case 'thumbnail': command.push('-ss', String(Math.max(0, Number(args.start) || 0)), ...infile(input), '-frames:v', '1', '-q:v', '2'); break
    case 'audio': command.push(...infile(input), '-vn', '-c:a', 'pcm_s16le', '-ar', '16000', '-ac', '1'); break
    case 'concat': {
      const files = (args.files || []).map(localFile)
      if (files.length < 2 || files.length > 12) throw new Error('每次拼接2到12个片段')
      const metas = await Promise.all(files.map(probeMedia))
      const video = metas[0].streams.find((s) => s.codec_type === 'video')
      const width = Math.min(1920, Math.floor((video?.width || 1280) / 2) * 2), height = Math.min(1920, Math.floor((video?.height || 720) / 2) * 2)
      for (const file of files) command.push(...infile(file))
      const audioIndexes = []; let nextInput = files.length
      metas.forEach((m, index) => {
        if (m.streams.some((s) => s.codec_type === 'audio')) audioIndexes.push(index)
        else {
          const duration = Number(m.format.duration)
          if (!(duration > 0 && duration <= 3600)) throw new Error('片段时长不可用或超过一小时')
          command.push('-f', 'lavfi', '-t', String(duration), '-i', 'anullsrc=r=48000:cl=stereo'); audioIndexes.push(nextInput++)
        }
      })
      const filters = files.map((_, i) => `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,setpts=PTS-STARTPTS[v${i}];[${audioIndexes[i]}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`)
      filters.push(files.map((_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${files.length}:v=1:a=1[v][a]`)
      command.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[a]', ...encode); break
    }
    default: throw new Error('不支持的剪辑操作')
  }
  command.push(output)
  try { await run(binary('ffmpeg'), command, { cwd: folder }) }
  finally { if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary) }
  const verified = await probeMedia(output)
  const bytes = fs.statSync(output).size
  return { ok: true, file: output, bytes, text: `本机剪辑完成并已验证：${output}\n${Math.round(bytes / 1024)}KB，时长${verified.format?.duration || '单帧'}秒。下载：/dsh-mentor/api/generated/${encodeURIComponent(path.basename(output))}。可继续用handover交付。` }
}

export function registerEditingTool(ctx) {
  const tools = ctx.get?.('tools') || ctx.tools
  if (!tools?.register) return
  tools.register({
    name: 'mediaEdit', description: '当前电脑本地处理图片/视频/音频，不上传素材，不覆盖原件。probe查看实际媒体信息；trim按秒裁剪；concat拼接2到12段并统一格式；resize等比缩放加留白到目标尺寸；mute去声；music配乐（默认保留原声混音）；subtitles烧录SRT/ASS/VTT字幕；thumbnail取封面；audio提取16k单声道WAV，可供本地语音识别。每次输出新文件，验证后交付。',
    parameters: { type: 'object', additionalProperties: false, required: ['action'], properties: {
      action: { type: 'string', enum: ['probe', 'trim', 'concat', 'resize', 'mute', 'music', 'subtitles', 'thumbnail', 'audio'] },
      file: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, start: { type: 'number' }, duration: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, music: { type: 'string' }, volume: { type: 'number' }, mix: { type: 'boolean' }, subtitles: { type: 'string' },
    } },
    output: { schema: { type: 'object', additionalProperties: true, required: ['ok', 'text'], properties: { ok: { type: 'boolean' }, text: { type: 'string' } } }, render: (_a, v) => [{ type: 'text', text: v.text }] },
    async execute(args) { try { return await editMedia(args) } catch (error) { return { ok: false, text: error.message } } },
  })
}
