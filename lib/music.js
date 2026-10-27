import fs from 'node:fs'
import path from 'node:path'
import { dataDir, getSettings } from './store.js'

/** 大肥鱼对外的音乐平台（DSH 音乐插件 dsh-unm 引擎支持的那些）。 */
export const MUSIC_PLATFORMS = ['netease', 'kuwo', 'kugou', 'bilibili', 'qq', 'qishui', 'audius', 'jamendo', 'ccmixter', 'somafm', 'soundcloud']

const DEFAULT_ENGINE = 'http://127.0.0.1:28375'

export function musicConfig() {
  const cfg = getSettings().music || {}
  const engine = String(cfg.engine || process.env.DSH_MENTOR_MUSIC_ENGINE || DEFAULT_ENGINE).trim().replace(/\/+$/, '')
  return { engine, platform: MUSIC_PLATFORMS.includes(cfg.platform) ? cfg.platform : 'netease' }
}

async function engineJson(route, timeout = 20000) {
  let response
  try {
    response = await fetch(`${musicConfig().engine}${route}`, { signal: AbortSignal.timeout(timeout) })
  } catch (error) {
    throw new Error(`连不上本机音乐引擎：${error.message}。确认DSH音乐插件(dsh-unm)已启用，或设置music.engine地址。`)
  }
  const data = await response.json().catch(() => null)
  if (!data) throw new Error(`音乐引擎返回了无法解析的内容（HTTP ${response.status}）`)
  if (!response.ok || data.ok === false) throw new Error(data.error || `音乐引擎返回 HTTP ${response.status}`)
  return data
}

export async function musicStatus() {
  const data = await engineJson('/api/status', 6000)
  return { engine: data.engine, sources: data.sources || [], platforms: data.platforms || [], proxy: data.proxy || null }
}

/** 搜索：返回统一歌曲结构（id/name/artists/album/duration/platform）。 */
export async function searchMusic(keyword, options = {}) {
  const kw = String(keyword || '').trim()
  if (!kw) throw new Error('先给我一个歌名或歌手名。')
  const platform = MUSIC_PLATFORMS.includes(options.platform) ? options.platform : musicConfig().platform
  const limit = Math.max(1, Math.min(Number(options.limit) || 8, 20))
  const data = await engineJson(`/api/search?kw=${encodeURIComponent(kw)}&platform=${encodeURIComponent(platform)}&limit=${limit}`)
  return {
    platform: data.platform || platform,
    songs: (data.songs || []).map((song) => ({
      id: String(song.id ?? ''),
      name: song.name || '',
      artists: song.artists || song.artist || '',
      album: song.album || '',
      duration: Number(song.duration) || 0,
      platform: song.platform || platform,
      vip: Boolean(song.vip),
      blocked: Boolean(song.blocked),
    })).filter((song) => song.id && song.name),
  }
}

/** 解析某首歌的真实音源地址（交给歌手/播放器用）。网易云走 match 接口，其余平台走 resolve。 */
export async function resolveMusic(platform, id) {
  if (!MUSIC_PLATFORMS.includes(platform)) throw new Error(`不认识的平台：${platform}`)
  const route = platform === 'netease'
    ? `/api/match/${encodeURIComponent(String(id))}`
    : `/api/resolve/${platform}/${encodeURIComponent(String(id))}`
  const data = await engineJson(route, 90000)
  return { ok: true, url: data.url || '', br: Number(data.br) || 0, size: Number(data.size) || 0, source: data.source || platform }
}

export function streamUrl(platform, id) {
  const tail = platform === 'netease' ? String(id) : `${platform}/${encodeURIComponent(String(id))}`
  return `${musicConfig().engine}/stream/${tail}`
}

export async function lyricMusic(platform, id, meta = {}) {
  const params = new URLSearchParams()
  if (meta.name) params.set('name', meta.name)
  if (meta.artist) params.set('artist', meta.artist)
  if (meta.duration) params.set('duration', String(meta.duration))
  const query = params.size ? `?${params}` : ''
  return engineJson(`/api/lyric/${platform}/${encodeURIComponent(String(id))}${query}`)
}

const SAFE = /[\\/:*?"<>|\u0000-\u001f]+/g

/** 把解析出的音源下载到本机，返回文件路径（QQ 发不了在线流时用它交付）。 */
export async function downloadMusic(song) {
  const dir = path.join(dataDir(), 'music')
  fs.mkdirSync(dir, { recursive: true })
  const resolved = song.url ? { url: song.url } : await resolveMusic(song.platform, song.id)
  if (!resolved.url) throw new Error('这首歌没有拿到可下载的音源地址')
  const response = await fetch(resolved.url, { signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`音源下载失败 HTTP ${response.status}`)
  const ext = /\.(flac|m4a|mp3|ogg|wav)(\?|$)/i.exec(resolved.url)?.[1]?.toLowerCase() || 'mp3'
  const base = `${song.artists ? `${song.artists} - ` : ''}${song.name}`.replace(SAFE, '_').slice(0, 80) || `music-${Date.now()}`
  const file = path.join(dir, `${base}.${ext}`)
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()))
  return { file, bytes: fs.statSync(file).size }
}
