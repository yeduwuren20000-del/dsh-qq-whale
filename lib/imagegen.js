/**
 * 生图：本地 ComfyUI（API）+ 网页版即梦 / 豆包（浏览器自动化）。
 *
 * 本地走她已登录的浏览器？不用——ComfyUI 是 loopback HTTP，直接 fetch。
 * 网页版用她自己的浏览器 profile（已登录即梦/豆包）。
 * 生成结果统一落到 dataDir()/generated，返回文件路径，交给 handover 发 QQ。
 */
import fs from 'node:fs'
import path from 'node:path'
import { dataDir, getSettings } from './store.js'
import { act } from './browser.js'

const IMAGE_DEFAULTS = {
  comfyUrl: 'http://127.0.0.1:8188',
  comfyCheckpoint: '',
  timeoutMs: 240000,
}

export function imageConfig() {
  return { ...IMAGE_DEFAULTS, ...(getSettings().image || {}) }
}

function generatedDir() {
  const dir = path.join(dataDir(), 'generated')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`${url} 返回 ${res.status}`)
  return res.json()
}

/* ---------------- 本地 ComfyUI ---------------- */

export async function comfyStatus() {
  const cfg = imageConfig()
  try {
    const res = await fetch(`${cfg.comfyUrl}/system_stats`, { signal: AbortSignal.timeout(2500) })
    return res.ok
  } catch {
    return false
  }
}

async function comfyCheckpoint(cfg) {
  if (cfg.comfyCheckpoint) return cfg.comfyCheckpoint
  const info = await fetchJson(`${cfg.comfyUrl}/object_info/CheckpointLoaderSimple`)
  const list = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || []
  if (!list.length) throw new Error('ComfyUI 里没有可用的 checkpoint')
  return list[0]
}

function comfyWorkflow({ prompt, negative, checkpoint, width, height, steps, cfgScale }) {
  return {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: [1, 1] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: negative || '低质量, 模糊, 变形', clip: [1, 1] } },
    4: { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    5: { class_type: 'KSampler', inputs: { seed: Date.now() % 2147483647, steps, cfg: cfgScale, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: [1, 0], positive: [2, 0], negative: [3, 0], latent_image: [4, 0] } },
    6: { class_type: 'VAEDecode', inputs: { samples: [5, 0], vae: [1, 2] } },
    7: { class_type: 'SaveImage', inputs: { filename_prefix: 'whale', images: [6, 0] } },
  }
}

export async function drawWithComfy(prompt, { width = 1024, height = 1024, negative = '', steps = 28, cfgScale = 7 } = {}) {
  const cfg = imageConfig()
  if (!(await comfyStatus())) throw new Error(`连不上本机 ComfyUI：${cfg.comfyUrl}。先启动 ComfyUI，或在设置里把 image.comfyUrl 指到正确地址。`)
  const checkpoint = await comfyCheckpoint(cfg)
  const created = await fetchJson(`${cfg.comfyUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: comfyWorkflow({ prompt, negative, checkpoint, width, height, steps, cfgScale }) }),
  }).catch((error) => { throw new Error(`提交给 ComfyUI 失败：${error.message}`) })
  const promptId = created.prompt_id
  if (!promptId) throw new Error('ComfyUI 没有返回 prompt_id')
  const deadline = Date.now() + cfg.timeoutMs
  while (Date.now() < deadline) {
    await sleep(2500)
    let history
    try {
      history = await fetchJson(`${cfg.comfyUrl}/history/${promptId}`)
    } catch {
      continue
    }
    const entry = history?.[promptId]
    if (!entry) continue
    const outputs = entry.outputs || {}
    for (const node of Object.values(outputs)) {
      const images = node?.images || []
      if (!images.length) continue
      const image = images[0]
      const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'output' })
      const res = await fetch(`${cfg.comfyUrl}/view?${query}`)
      if (!res.ok) continue
      const file = path.join(generatedDir(), `${Date.now()}-comfy.png`)
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
      return { ok: true, file, platform: 'comfyui', prompt }
    }
  }
  throw new Error('ComfyUI 超时没出图')
}

/* ---------------- 网页版即梦 ---------------- */

const JIMENG_URL = 'https://jimeng.jianying.com/ai-tool/generate'

/** 取页面上所有生成图的地址（即梦结果图在 dreamina-sign.byteimg.com 域名下）。 */
async function jimengImages() {
  const result = await act('eval', {
    script: `(() => {
      const list = [...document.querySelectorAll('img')]
        .filter((img) => /dreamina|byteimg\\.com\\/tos-cn-i/.test(String(img.currentSrc || img.src)) || /^blob:/.test(String(img.currentSrc || img.src)))
        .map((img) => ({ src: String(img.currentSrc || img.src), w: img.naturalWidth || 0, h: img.naturalHeight || 0 }))
        .filter((img) => img.w >= 200 && img.h >= 200)
      return JSON.stringify(list.slice(-8))
    })()`,
  })
  try { return JSON.parse(result.text || '[]') } catch { return [] }
}

async function downloadImage(url, { referer } = {}) {
  const res = await fetch(url, { headers: referer ? { Referer: referer } : {}, signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`下载生成图失败：HTTP ${res.status}`)
  const type = res.headers.get('content-type') || 'image/png'
  const ext = type.includes('webp') ? '.webp' : type.includes('jpeg') ? '.jpg' : '.png'
  const file = path.join(generatedDir(), `${Date.now()}-web${ext}`)
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  return file
}

export async function drawWithJimeng(prompt, { timeoutMs = 180000 } = {}) {
  const before = new Set((await jimengImages()).map((row) => row.src))
  await act('open', { url: JIMENG_URL })
  await act('wait', { ms: 2500 })
  await act('click', { selector: '.ProseMirror' })
  await act('type', { text: prompt.slice(0, 800) })
  await act('press', { key: 'Enter' })
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(6000)
    const images = await jimengImages()
    const fresh = images.filter((row) => !before.has(row.src)).sort((a, b) => b.w * b.h - a.w * a.h)
    if (!fresh.length) continue
    const file = await downloadImage(fresh[0].src, { referer: 'https://jimeng.jianying.com/' })
    return { ok: true, file, platform: '即梦', prompt }
  }
  throw new Error('即梦三分钟没出图（可能在排队或积分不足，或者页面状态变了）')
}

/* ---------------- 网页版豆包 ---------------- */

const DOUBAO_URL = 'https://www.doubao.com/chat/'

async function doubaoImages() {
  const result = await act('eval', {
    script: `(() => {
      const list = [...document.querySelectorAll('img')]
        .map((img) => ({ src: String(img.currentSrc || img.src), w: img.naturalWidth || 0, h: img.naturalHeight || 0 }))
        .filter((img) => img.w >= 300 && img.h >= 300 && !/avatar|emoji|icon/i.test(img.src))
      return JSON.stringify(list.slice(-8))
    })()`,
  })
  try { return JSON.parse(result.text || '[]') } catch { return [] }
}

export async function drawWithDoubao(prompt, { timeoutMs = 180000 } = {}) {
  const before = new Set((await doubaoImages()).map((row) => row.src))
  await act('open', { url: DOUBAO_URL })
  await act('wait', { ms: 2500 })
  const entered = await act('eval', {
    script: `(() => {
      const box = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]')
      if (!box) return 'no-box'
      box.focus()
      return box.tagName === 'TEXTAREA' ? 'textarea' : 'editable'
    })()`,
  })
  const kind = String(entered.text || '')
  if (kind === 'no-box') throw new Error('没找到豆包的输入框')
  if (kind === 'textarea') await act('type', { selector: 'textarea', text: prompt.slice(0, 800) })
  else await act('type', { selector: '[contenteditable="true"]', text: prompt.slice(0, 800) })
  await act('press', { key: 'Enter' })
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(6000)
    const images = await doubaoImages()
    const fresh = images.filter((row) => !before.has(row.src)).sort((a, b) => b.w * b.h - a.w * a.h)
    if (!fresh.length) continue
    const file = await downloadImage(fresh[0].src, { referer: 'https://www.doubao.com/' })
    return { ok: true, file, platform: '豆包', prompt }
  }
  throw new Error('豆包三分钟没出图')
}

/* ---------------- 对外统一入口 ---------------- */

export const IMAGE_PLATFORMS = ['comfyui', 'jimeng', 'doubao']

/**
 * 画一张图。
 * @param {string} prompt
 * @param {{ platform?: 'comfyui'|'jimeng'|'doubao', width?: number, height?: number }} options
 */
export async function drawImage(prompt, { platform = 'comfyui', width = 1024, height = 1024 } = {}) {
  const text = String(prompt || '').trim()
  if (!text) throw new Error('先给我一个画面描述。')
  if (platform === 'jimeng') return drawWithJimeng(text)
  if (platform === 'doubao') return drawWithDoubao(text)
  // 默认本地；本地没起就退回网页（即梦可用时）。
  if (await comfyStatus()) return drawWithComfy(text, { width, height })
  return { ...(await drawWithJimeng(text)), platform: '即梦（本地 ComfyUI 没启动，自动改用网页版）' }
}

export async function imageStatus() {
  const cfg = imageConfig()
  const comfy = await comfyStatus()
  return { comfyui: { url: cfg.comfyUrl, ready: comfy }, jimeng: true, doubao: true }
}
