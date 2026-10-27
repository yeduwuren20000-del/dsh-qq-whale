import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { dataDir, getSettings } from './store.js'
import { downloadMusic, searchMusic } from './music.js'

const LOCAL_DEFAULTS = {
  repo: 'E:\\Tools\\rvc\\repo',
  python: 'E:\\Tools\\rvc\\.venv312\\Scripts\\python.exe',
  model: 'E:\\Tools\\rvc\\repo\\assets\\weights\\her-lazy.pth',
  ffmpeg: 'E:\\Tools\\ffmpeg\\ffmpeg-9.0.2-essentials_build\\bin\\ffmpeg.exe',
}

/** 唱歌后端：默认在本机 5060 上跑 RVC 声模；settings.sing.backend='remote' 才用 3080Ti。 */
export function singConfig() {
  const cfg = getSettings().sing || {}
  return {
    backend: cfg.backend === 'remote' ? 'remote' : 'local',
    pitch: Number.isFinite(Number(cfg.pitch)) ? Number(cfg.pitch) : 0,
    local: {
      repo: String(cfg.localRepo || LOCAL_DEFAULTS.repo).trim(),
      python: String(cfg.localPython || LOCAL_DEFAULTS.python).trim(),
      model: String(cfg.localModel || LOCAL_DEFAULTS.model).trim(),
      ffmpeg: String(cfg.localFfmpeg || LOCAL_DEFAULTS.ffmpeg).trim(),
    },
    host: String(cfg.host || process.env.DSH_MENTOR_SING_HOST || 'ssh3080ti').trim(),
    repo: String(cfg.repo || process.env.DSH_MENTOR_SING_REPO || '/home/panfei/rvc-repo').trim(),
    python: String(cfg.python || process.env.DSH_MENTOR_SING_PYTHON || '/home/panfei/rvc-venv/bin/python').trim(),
    model: String(cfg.model || process.env.DSH_MENTOR_SING_MODEL || '/home/panfei/rvc-repo/assets/weights/her-lazy.pth').trim(),
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { windowsHide: true, encoding: 'utf8', timeout: options.timeout || 180000, ...options })
  if (result.error) throw new Error(`${command} 启动失败：${result.error.message}`)
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().split(/\r?\n/).slice(-4).join(' / ')
    throw new Error(`${command} 退出码 ${result.status}${detail ? `：${detail}` : ''}`)
  }
  return String(result.stdout || '')
}

/** 有检索索引就用 0.75，没有就关掉索引（否则 infer.cli 会报 No usable added index）。 */
function indexRateFor(repo, model) {
  try {
    const dir = path.join(repo, 'logs', path.basename(model, '.pth'))
    if (fs.existsSync(dir) && fs.readdirSync(dir).some((name) => name.endsWith('.index'))) return '0.75'
  } catch { /* 找不到就退 0 */ }
  return '0'
}

/** 本机 5060：ffmpeg 切 30 秒段，逐段 RVC，再拼接。8G 显存整曲会 OOM。 */
function singLocal(cfg, source, localOut) {
  const { repo, python, model, ffmpeg } = cfg.local
  if (!fs.existsSync(model)) throw new Error(`本机还没放声模：${model}`)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-sing-'))
  try {
    run(ffmpeg, ['-y', '-i', source, '-f', 'segment', '-segment_time', '30', '-c:a', 'pcm_s16le', path.join(tmp, 'seg-%03d.wav')], { timeout: 180000 })
    const segs = fs.readdirSync(tmp).filter((name) => /^seg-\d+\.wav$/.test(name)).sort()
    if (!segs.length) throw new Error('切段失败，没拿到音频片段')
    const outs = []
    for (const seg of segs) {
      const input = path.join(tmp, seg)
      const output = path.join(tmp, seg.replace(/\.wav$/, '-out.wav'))
      run(python, ['-m', 'infer.cli', '--model', model, '--input', input, '--output', output,
        '--pitch', String(cfg.pitch), '--f0-method', 'rmvpe', '--index-rate', indexRateFor(repo, model), '--protect', '0.33', '--format', 'wav'],
      { cwd: repo, env: { ...process.env, PYTHONPATH: repo }, timeout: 300000 })
      outs.push(output)
    }
    const list = path.join(tmp, 'list.txt')
    fs.writeFileSync(list, outs.map((file) => `file '${file.replace(/\\/g, '/')}'`).join('\n'), 'utf8')
    run(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'pcm_s16le', localOut], { timeout: 300000 })
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* 清理失败不影响结果 */ }
  }
}

/** 3080Ti：把输入传过去，用服务器上的分段脚本跑，再传回来。 */
function singRemote(cfg, source, localOut) {
  const stamp = Date.now()
  const remoteIn = `/tmp/whale-sing-${stamp}.wav`
  const remoteOut = `/tmp/whale-sing-${stamp}-out.wav`
  try {
    run('scp', ['-q', source, `${cfg.host}:${remoteIn}`], { timeout: 180000 })
    const script = `${cfg.repo}/../sing-remote.sh`
    run('ssh', [cfg.host, `bash ${script} ${remoteIn} ${remoteOut} ${cfg.model} ${cfg.python} ${cfg.repo} ${cfg.pitch}`], { timeout: 900000 })
    run('scp', ['-q', `${cfg.host}:${remoteOut}`, localOut], { timeout: 180000 })
  } finally {
    try { run('ssh', [cfg.host, `rm -f ${remoteIn} ${remoteOut}`], { timeout: 20000 }) } catch { /* 清理失败不影响结果 */ }
  }
}

/**
 * 唱一首歌：音乐引擎搜歌 → 下载原始音源 → RVC 换成她自己的声模 → 输出 wav。
 * @returns {Promise<{ok:true,file:string,song:object,seconds:number,backend:string}>}
 */
export async function singSong(songName) {
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

  if (cfg.backend === 'remote') singRemote(cfg, source, localOut)
  else singLocal(cfg, source, localOut)

  return { ok: true, file: localOut, song, seconds: Math.round((Date.now() - started) / 1000), backend: cfg.backend }
}
