// 用她固定的懒音色（breeze-lazy）重录训练语料，拼成一段 wav，给 3080Ti 重训唱歌声模用。
import fs from 'node:fs'
import path from 'node:path'
import { synthesizeVoice } from '../lib/perception.js'

const texts = JSON.parse(fs.readFileSync('E:/Tools/rvc-data/texts.json', 'utf8'))
const outDir = 'E:/Tools/rvc-data/lazy-parts'
fs.mkdirSync(outDir, { recursive: true })

const RATE = 24000
const gap = Buffer.alloc(Math.round(RATE * 2 * 0.35)) // 每段间 0.35s 静音

function pcmOf(buf) {
  // 标准 wav：找 data chunk，避免依赖固定 44 字节头
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return buf
  let off = 12
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'data') return buf.subarray(off + 8, Math.min(off + 8 + size, buf.length))
    off += 8 + size + (size % 2)
  }
  return buf
}

const parts = []
for (let i = 0; i < texts.length; i += 1) {
  const text = String(texts[i] || '').trim()
  if (!text) continue
  const r = await synthesizeVoice(text, { voice: 'breeze-lazy', speed: 1.0 })
  fs.writeFileSync(path.join(outDir, `${i}.wav`), r.buffer)
  parts.push(pcmOf(r.buffer), gap)
  console.log(`[${i + 1}/${texts.length}] ${r.buffer.length} bytes  ${text.slice(0, 18)}`)
}

const data = Buffer.concat(parts)
const head = Buffer.alloc(44)
head.write('RIFF', 0)
head.writeUInt32LE(36 + data.length, 4)
head.write('WAVE', 8)
head.write('fmt ', 12)
head.writeUInt32LE(16, 16)
head.writeUInt16LE(1, 20)
head.writeUInt16LE(1, 22)
head.writeUInt32LE(RATE, 24)
head.writeUInt32LE(RATE * 2, 28)
head.writeUInt16LE(2, 32)
head.writeUInt16LE(16, 34)
head.write('data', 36)
head.writeUInt32LE(data.length, 40)
const out = 'E:/Tools/rvc-data/corpus-lazy.wav'
fs.writeFileSync(out, Buffer.concat([head, data]))
console.log('done', out, (data.length / (RATE * 2)).toFixed(1), 'seconds')
