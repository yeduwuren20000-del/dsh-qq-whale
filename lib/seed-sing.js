/** Optional, local-only 44.1k singing conversion. Original accompaniment stays separate. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSettings } from './store.js'
import { readVoiceProfile } from './voice-profile.js'
import { releaseCosy } from './cosy-voice.js'
import { runMediaProcess } from './media-process.js'

export function seedConfig() {
  const cfg = getSettings().seedVoice || {}
  return { python: String(cfg.python || ''), repo: String(cfg.repo || ''), models: String(cfg.models || ''), steps: Math.max(30, Math.min(50, Number(cfg.steps) || 30)) }
}
export function seedStatus() {
  const cfg = seedConfig()
  const files = [cfg.python, path.join(cfg.repo || '.', 'inference.py'),
    path.join(cfg.models || '.', 'Plachta--Seed-VC/DiT_seed_v2_uvit_whisper_base_f0_44k_bigvgan_pruned_ft_ema_v2.pth'),
    path.join(cfg.models || '.', 'openai--whisper-small/model.safetensors'),
    path.join(cfg.models || '.', 'nvidia--bigvgan_v2_44khz_128band_512x/bigvgan_generator.pt')]
  return { available: files.every(file => file && fs.existsSync(file)), localOnly: true }
}
export async function convertSeedVocal(source, output, pitch = 0) {
  const cfg = seedConfig(), voice = { id: getSettings().perception?.voice || 'breeze-sweet' }
  if (!seedStatus().available) throw new Error('请先安装并配置本机 Seed-VC 唱歌模型')
  const profile = readVoiceProfile(voice)
  if (!profile) throw new Error('请先试听并保存常用音色，再用同一音色唱歌')
  await releaseCosy()
  const log = await runMediaProcess(cfg.python, ['-u', fileURLToPath(new URL('./seed_worker.py', import.meta.url)),
    '--repo', cfg.repo, '--models', cfg.models, '--source', path.resolve(source), '--reference', profile.file,
    '--output', path.resolve(output), '--steps', String(cfg.steps), '--pitch', String(Math.round(Number(pitch) || 0))], {
    timeout: 900000, cwd: cfg.repo, env: { ...process.env, PYTHONIOENCODING: 'utf-8', HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1' },
  })
  const result = JSON.parse(log.trim().split(/\r?\n/).at(-1))
  if (!fs.existsSync(output) || result.sampleRate !== 44100) throw new Error('唱歌结果未通过采样率和文件检查')
  return result
}
