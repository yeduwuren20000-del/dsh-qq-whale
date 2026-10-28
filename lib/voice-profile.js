import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { dataDir } from './store.js'

const REFERENCE_TEXT = '我在呢，别着急。有什么想说的就慢慢讲，我会听着，也会陪你把事情一件一件做好。'
const pending = new Map()

/** Keep the actual voice reference on disk; register it again after engine restarts. */
export async function ensureVoiceProfile({ base, voice, generate, request = fetch }) {
  const endpoint = new URL(base)
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw new Error('参考音色仅允许交给本机语音引擎')
  const key = `${base}:${voice.id}`
  if (pending.has(key)) return pending.get(key)
  const work = (async () => {
    const folder = path.join(dataDir(), 'voice-profiles', voice.id.replace(/[^a-zA-Z0-9_-]/g, '_'))
    const file = path.join(folder, 'reference.wav')
    fs.mkdirSync(folder, { recursive: true })
    if (!fs.existsSync(file)) {
      const staged = path.join(folder, `reference-${process.pid}.wav`)
      await generate({ text: REFERENCE_TEXT, file: staged, instruction: voice.instruction, seed: 42, cfgScale: 2 })
      if (!fs.existsSync(staged) || fs.statSync(staged).size < 44) throw new Error('参考音色没有生成有效音频')
      fs.renameSync(staged, file)
      fs.writeFileSync(path.join(folder, 'profile.json'), JSON.stringify({ version: 1, voice: voice.id, text: REFERENCE_TEXT, seed: 42, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') }, null, 2))
    }
    const form = new FormData()
    form.append('ref_audio', new Blob([fs.readFileSync(file)], { type: 'audio/wav' }), 'reference.wav')
    form.append('ref_text', REFERENCE_TEXT)
    const response = await request(`${base}/v1/voices`, { method: 'POST', body: form, signal: AbortSignal.timeout(60000) })
    const data = await response.json()
    if (!response.ok || !data.id) throw new Error('固定参考音色注册失败，已停止随机换音色')
    return { id: data.id, file, seed: 42 }
  })().finally(() => pending.delete(key))
  pending.set(key, work)
  return work
}

export function speechDirection({ speed, mood } = {}) {
  const pace = Number(speed) > 1.08 ? 'Speak a little faster.' : Number(speed) < .92 ? 'Speak a little slower.' : 'Speak at a natural pace.'
  const hints = {
    happy: 'Sound happy and smiling.', calm: 'Sound calm and relaxed.', proud: 'Sound quietly pleased.',
    tired: 'Sound tired and a little slower.', annoyed: 'Sound slightly annoyed.', worried: 'Sound concerned.', curious: 'Sound interested.',
    开心: 'Sound happy and smiling.', 撒娇: 'Sound playful and affectionate.', 温柔: 'Sound gentle and warm.', 兴奋: 'Sound excited and lively.',
    疲惫: 'Sound tired and a little slower.', 委屈: 'Sound a little sad.', 调侃: 'Sound teasing and amused.', 认真: 'Sound serious and steady.',
  }
  return `Keep the same speaker identity and vocal timbre as the reference. ${pace} ${hints[mood] || ''}`.trim()
}
