import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runMediaProcess as run } from './media-process.js'
import { dataDir, getSettings } from './store.js'
import { downloadMusic, searchMusic } from './music.js'
import { probeMedia } from './media-edit.js'
import { convertSeedVocal } from './seed-sing.js'
import { withAudioGpu } from './audio-gpu.js'
import { releaseCosy } from './cosy-voice.js'
import { stopBreeze } from './breeze.js'
import { remoteMediaConfig, remoteMediaRequest, remoteVoiceAnchor } from './remote-media.js'

const LOCAL_DEFAULTS = {
  repo: path.join(dataDir(), 'runtime', 'rvc', 'repo'),
  python: path.join(dataDir(), 'runtime', 'rvc', process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python'),
  model: path.join(dataDir(), 'runtime', 'rvc', 'model.pth'),
  ffmpeg: path.join(dataDir(), 'runtime', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
}

/** Singing uses only explicitly configured environments and models. */
export function singConfig() {
  const cfg = getSettings().sing || {}
  return {
    engine: cfg.engine === 'seed-vc' ? 'seed-vc' : 'rvc',
    backend: cfg.backend === 'remote' ? 'remote' : 'local',
    pitch: Number.isFinite(Number(cfg.pitch)) ? Number(cfg.pitch) : 0,
    separatorPython: String(cfg.separatorPython || process.env.DSH_MENTOR_SEPARATOR_PYTHON || cfg.localPython || LOCAL_DEFAULTS.python).trim(),
    local: {
      repo: String(cfg.localRepo || LOCAL_DEFAULTS.repo).trim(),
      python: String(cfg.localPython || LOCAL_DEFAULTS.python).trim(),
      model: String(cfg.localModel || LOCAL_DEFAULTS.model).trim(),
      ffmpeg: String(cfg.localFfmpeg || LOCAL_DEFAULTS.ffmpeg).trim(),
    },
    host: String(cfg.host || process.env.DSH_MENTOR_SING_HOST || '').trim(),
    repo: String(cfg.repo || process.env.DSH_MENTOR_SING_REPO || '').trim(),
    python: String(cfg.python || process.env.DSH_MENTOR_SING_PYTHON || '').trim(),
    model: String(cfg.model || process.env.DSH_MENTOR_SING_MODEL || '').trim(),
  }
}

/** 有检索索引就用 0.75，没有就关掉索引（否则 infer.cli 会报 No usable added index）。 */
function indexRateFor(repo, model) {
  try {
    const dir = path.join(repo, 'logs', path.basename(model, '.pth'))
    if (fs.existsSync(dir) && fs.readdirSync(dir).some((name) => name.endsWith('.index'))) return '0.75'
  } catch { /* 找不到就退 0 */ }
  return '0'
}

/** 本机：ffmpeg 切 30 秒段，逐段 RVC，再拼接。8G 显存整曲会 OOM。 */
async function singLocal(cfg, source, localOut, onSegment, instrumental) {
  const { repo, python, model, ffmpeg } = cfg.local
  if (!fs.existsSync(model)) throw new Error(`本机还没放声模：${model}`)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-sing-'))
  try {
    const inputs = path.join(tmp, 'inputs'), outputs = path.join(tmp, 'outputs')
    fs.mkdirSync(inputs); fs.mkdirSync(outputs)
    await run(ffmpeg, ['-y', '-i', source, '-f', 'segment', '-segment_time', '30', '-c:a', 'pcm_s16le', path.join(inputs, 'seg-%03d.wav')])
    const segs = fs.readdirSync(inputs).filter((name) => /^seg-\d+\.wav$/.test(name)).sort()
    if (!segs.length) throw new Error('切段失败，没拿到音频片段')
    const offsets = []; let offset = 0
    for (const name of segs) {
      offsets.push(offset)
      offset += Number((await probeMedia(path.join(inputs, name))).format.duration)
    }
    const outs = segs.map((name) => path.join(outputs, name))
    const environment = { ...process.env, PYTHONPATH: repo, PYTHONIOENCODING: 'utf-8' }
    const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === 'path') || 'PATH'
    environment[pathKey] = `${path.dirname(ffmpeg)}${path.delimiter}${environment[pathKey] || ''}`
    // The CLI accepts a directory and keeps one voice model loaded for every segment.
    await run(python, ['-u', '-m', 'infer.cli', '--model', model, '--input', inputs, '--output', outputs,
      '--pitch', String(cfg.pitch), '--f0-method', 'rmvpe', '--index-rate', indexRateFor(repo, model), '--protect', '0.45', '--format', 'wav'], {
      cwd: repo, env: environment, timeout: 900000,
      onLine: async (line) => {
        const index = outs.findIndex((file) => path.resolve(file) === path.resolve(line.trim()))
        if (index < 0 || !onSegment) return
        const mixed = path.join(tmp, `mixed-${index}.wav`)
        await mixSong(cfg, outs[index], instrumental, mixed, offsets[index])
        await onSegment(mixed, { index: index + 1, total: segs.length })
      },
    })
    if (outs.some((file) => !fs.existsSync(file))) throw new Error('部分人声片段未完成，已保留生成日志')
    const list = path.join(tmp, 'list.txt')
    fs.writeFileSync(list, outs.map((file) => `file '${file.replace(/\\/g, '/')}'`).join('\n'), 'utf8')
    await run(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'pcm_s16le', localOut], { timeout: 300000 })
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* 清理失败不影响结果 */ }
  }
}

async function mixSong(cfg, vocal, instrumental, output, start = 0) {
  await run(cfg.local.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', vocal, '-ss', String(start), '-i', instrumental,
    '-filter_complex', '[0:a]volume=1.0[v];[1:a]volume=0.8[b];[v][b]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95:latency=1[a]',
    '-map', '[a]', '-c:a', 'pcm_s16le', output])
}

/** Optional user-configured server backend. */
async function singRemote(cfg, source, localOut) {
  if (![cfg.host, cfg.repo, cfg.python, cfg.model].every(Boolean)) throw new Error('请先配置自己的远程唱歌环境')
  const stamp = Date.now()
  const remoteIn = `/tmp/whale-sing-${stamp}.wav`
  const remoteOut = `/tmp/whale-sing-${stamp}-out.wav`
  try {
    await run('scp', ['-q', source, `${cfg.host}:${remoteIn}`], { timeout: 180000 })
    const script = `${cfg.repo}/../sing-remote.sh`
    await run('ssh', [cfg.host, `bash ${script} ${remoteIn} ${remoteOut} ${cfg.model} ${cfg.python} ${cfg.repo} ${cfg.pitch}`], { timeout: 900000 })
    await run('scp', ['-q', `${cfg.host}:${remoteOut}`, localOut], { timeout: 180000 })
  } finally {
    try { await run('ssh', [cfg.host, `rm -f ${remoteIn} ${remoteOut}`], { timeout: 20000 }) } catch { /* 清理失败不影响结果 */ }
  }
}

/**
 * 唱一首歌：音乐引擎搜歌 → 下载原始音源 → RVC 换成她自己的声模 → 输出 wav。
 * @returns {Promise<{ok:true,file:string,song:object,seconds:number,backend:string}>}
 */
export function singSong(songName, options = {}) { return withAudioGpu(() => singLocalSong(songName, options)) }
async function singLocalSong(songName, { onSegment } = {}) {
  const keyword = String(songName || '').trim()
  if (!keyword) throw new Error('想唱哪首歌？给我个歌名。')
  const listed = await searchMusic(keyword, { limit: 5 })
  const song = listed.songs[0]
  if (!song) throw new Error(`没搜到「${keyword}」，换个歌名或补上歌手名试试。`)

  const started = Date.now()
  const { file: source } = await downloadMusic(song)
  const cfg = singConfig()
  const dir = path.join(dataDir(), 'sing')
  fs.mkdirSync(dir, { recursive: true })
  const localOut = path.join(dir, `${(song.name || 'song').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40)}-her.wav`)

  if (remoteMediaConfig().enabled) {
    const voice = getSettings().perception?.voice || 'breeze-sweet'
    const result = await remoteMediaRequest({ action: 'song', sourceAudio: fs.readFileSync(source).toString('base64'), pitch: cfg.pitch, ...remoteVoiceAnchor(voice) })
    fs.writeFileSync(localOut, result.buffer)
    return { ok: true, file: localOut, song, seconds: Math.round((Date.now() - started) / 1000), backend: 'ssh' }
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-stems-'))
  try {
    await releaseCosy()
    stopBreeze()
    const worker = fileURLToPath(new URL('./separate-vocals.py', import.meta.url))
    try { await run(cfg.separatorPython, [worker, source, work], { timeout: 600000 }) }
    catch (error) { throw new Error(`人声分离未完成，已停止；不会把伴奏送进声模。请检查独立 Demucs 环境：${error.message}`) }
    const vocal = path.join(work, 'vocals.wav'), instrumental = path.join(work, 'instrumental.wav')
    if (cfg.engine === 'seed-vc') await convertSeedVocal(vocal, localOut, cfg.pitch)
    else if (cfg.backend === 'remote') await singRemote(cfg, vocal, localOut)
    else await singLocal(cfg, vocal, localOut, onSegment, instrumental)
    const mixed = path.join(work, 'song-mixed.wav')
    await mixSong(cfg, localOut, instrumental, mixed)
    fs.copyFileSync(mixed, localOut)
  } finally {
    if (path.dirname(path.resolve(work)) === path.resolve(os.tmpdir())) fs.rmSync(work, { recursive: true, force: true })
  }

  return { ok: true, file: localOut, song, seconds: Math.round((Date.now() - started) / 1000), backend: cfg.engine === 'seed-vc' ? 'seed-vc-local' : cfg.backend }
}
