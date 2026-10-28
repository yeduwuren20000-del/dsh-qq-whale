import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { dataDir, getSettings } from './store.js'
import { mediaBinary, probeMedia } from './media-edit.js'
import { runMediaProcess } from './media-process.js'

export const AUTO_EDITOR = { version: '31.7.2', url: 'https://github.com/WyattBlue/auto-editor/releases/download/31.7.2/auto-editor-windows-x86_64.exe', sha256: 'c5dd8d44a92e9b5fbce13aacea92d02436ea24f9f4c6177a6a9d851801fb74c3' }
export function autoEditorPath() { return getSettings().editing?.autoEditor || path.join(dataDir(), 'runtime', process.platform === 'win32' ? 'auto-editor.exe' : 'auto-editor') }
export async function autoCut(args = {}) {
  const input = String(args.file || '')
  if (!path.isAbsolute(input) || !fs.existsSync(input) || !fs.statSync(input).isFile()) throw new Error('需要现有的本地视频绝对路径')
  const executable = autoEditorPath()
  if (!fs.existsSync(executable)) throw new Error('请先在工具准备中勾选 Auto-Editor 自动粗剪')
  const threshold = Number(args.threshold ?? -35), margin = Number(args.margin ?? .2)
  if (!Number.isFinite(threshold) || threshold < -80 || threshold > -5 || !Number.isFinite(margin) || margin < 0 || margin > 3) throw new Error('静音阈值范围 -80 到 -5 dB，前后留白 0 到 3 秒')
  const stat = fs.statSync(input), key = createHash('sha256').update(JSON.stringify([fs.realpathSync(input), stat.size, stat.mtimeMs, threshold, margin, AUTO_EDITOR.version])).digest('hex').slice(0, 20)
  const folder = path.join(dataDir(), 'generated'); fs.mkdirSync(folder, { recursive: true })
  const output = path.join(folder, `autocut-${key}.mp4`)
  const result = async (cached) => {
    const meta = await probeMedia(output)
    return { ok: true, file: output, cached, bytes: fs.statSync(output).size, text: `${cached ? '复用已验证成品' : '本地自动去静音粗剪完成'}：${output}，${Number(meta.format?.duration || 0).toFixed(2)}秒。可用handover交付。自动粗剪依据音量，不代表已理解或挑出精彩内容。` }
  }
  if (fs.existsSync(output)) return result(true)
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-autocut-'))
  try {
    const staged = path.join(work, 'result.mp4')
    await runMediaProcess(executable, [input, '--edit', `audio:${threshold}dB`, '--margin', `${margin}s`, '--no-open', '--output', staged], { cwd: work, timeout: 600000, env: { ...process.env, PATH: path.dirname(mediaBinary('ffmpeg')) + path.delimiter + process.env.PATH } })
    const verified = await probeMedia(staged)
    if (!(Number(verified.format?.duration) > 0)) throw new Error('没有可交付片段，原视频保留')
    fs.copyFileSync(staged, output)
    return result(false)
  } finally { if (path.dirname(work) === os.tmpdir()) fs.rmSync(work, { recursive: true, force: true }) }
}
