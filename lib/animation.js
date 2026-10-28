/** Offline HTML animation and deterministic browser-to-video export. */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright-core'
import { dataDir } from './store.js'
import { resolveExecutable } from './chromium.js'
import { mediaBinary, probeMedia } from './media-edit.js'
import { runMediaProcess } from './media-process.js'

const asset = path.resolve(import.meta.dirname, '../assets/anime/anime.umd.min.js')
const escape = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
export function animationHTML(args = {}) {
  const scenes = Array.isArray(args.scenes) ? args.scenes : [{ title: args.title || '大肥鱼的片刻', text: args.text || '', duration: args.duration || 4 }]
  if (!scenes.length || scenes.length > 12) throw new Error('动画需要1到12个分镜')
  const clean = scenes.map((s) => ({ title: String(s.title || '').slice(0, 100), text: String(s.text || '').slice(0, 240), duration: Number(s.duration ?? 4) }))
  if (clean.some((s) => !Number.isFinite(s.duration) || s.duration < 1 || s.duration > 20) || clean.reduce((n, s) => n + s.duration, 0) > 60) throw new Error('每个分镜1到20秒，总长最多60秒')
  const accent = /^#[a-f0-9]{6}$/i.test(args.accent || '') ? args.accent : '#4fc4ef'
  const json = JSON.stringify(clean).replace(/</g, '\\u003c')
  const engine = fs.readFileSync(asset, 'utf8').replace(/<\/script/gi, '<\\/script')
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(clean[0].title)}</title>
<style>*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden}body{background:#091923;color:#f1f8fb;font-family:"Microsoft YaHei",system-ui,sans-serif}main{position:relative;width:100%;height:100%}.scene{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:9%;opacity:0}.line{width:12%;height:6px;background:${accent};margin-bottom:5vh}h1{font-size:clamp(30px,6vw,100px);line-height:1.2;letter-spacing:-.03em;margin:0 0 4vh;overflow-wrap:anywhere}p{color:#b7c9d4;font-size:clamp(18px,2.8vw,46px);line-height:1.6;white-space:pre-wrap;margin:0;overflow-wrap:anywhere}.counter{position:absolute;right:5%;bottom:5%;font-size:16px;color:#8aa2b1}button{position:absolute;left:4%;bottom:4%;border:1px solid #496574;background:#091923;color:#cfe8f4;border-radius:6px;padding:8px 14px;cursor:pointer}body.export button{display:none}</style>
<main>${clean.map((s, i) => `<section class="scene s${i}"><div class="line"></div><h1>${escape(s.title)}</h1><p>${escape(s.text)}</p><span class="counter">${i + 1} / ${clean.length}</span></section>`).join('')}</main><button id="toggle" aria-label="播放或暂停">播放 / 暂停</button>
<script>${engine}</script><script>const scenes=${json};const timeline=anime.createTimeline({autoplay:false});let offset=0;scenes.forEach((s,i)=>{timeline.add('.s'+i,{opacity:[0,1],translateY:[28,0],duration:500,ease:'outQuad'},offset);timeline.add('.s'+i,{opacity:[1,0],duration:350,ease:'linear'},offset+s.duration*1000-350);offset+=s.duration*1000});window.whaleDuration=offset/1000;window.whaleSeek=(seconds)=>{timeline.pause();timeline.seek(Math.max(0,Math.min(offset,seconds*1000)))};document.querySelector('#toggle').onclick=()=>timeline.paused?timeline.play():timeline.pause();timeline.play();</script></html>`
}
export async function createAnimation(args = {}) {
  if (args.action === 'guide') return { ok: true, text: '简单动画：action=html或render，scenes=[{title,text,duration}]，accent=#RRGGBB。复杂动画：先写自包含HTML文件，再action=renderHTML传file绝对路径；内置Anime.js会先注入，勿引用CDN。HTML必须定义window.whaleDuration（秒）和window.whaleSeek(seconds)；例如const t=anime.createTimeline({autoplay:false});t.add(".box",{translateX:[0,300],duration:3000});window.whaleDuration=3;window.whaleSeek=s=>{t.pause();t.seek(s*1000)}。可用内联SVG/Canvas及data图片，导出阻止外网请求；不得依赖实际时钟、随机数或自动播放。导出最长60秒900帧。' }
  const width = Number(args.width ?? 1280), height = Number(args.height ?? 720), fps = Number(args.fps ?? 15)
  if (![width, height].every((v) => Number.isInteger(v) && v >= 128 && v <= 1920 && v % 2 === 0) || width * height > 2073600 || !Number.isInteger(fps) || fps < 5 || fps > 30) throw new Error('动画宽高为128到1920的偶数，像素总量不超过1080p；帧率5到30')
  let html
  if (args.action === 'renderHTML') {
    const input = String(args.file || '')
    if (!path.isAbsolute(input) || !/\.html?$/i.test(input) || !fs.existsSync(input) || fs.statSync(input).size > 1024 * 1024) throw new Error('需要不超过1MB的本地HTML文件绝对路径')
    const engine = fs.readFileSync(asset, 'utf8').replace(/<\/script/gi, '<\\/script')
    const source = fs.readFileSync(input, 'utf8')
    html = source.replace(/<head[^>]*>/i, (head) => `${head}<script>${engine}</script>`)
    if (html === source) html = `<script>${engine}</script>` + source
  } else html = animationHTML(args)
  const render = ['render', 'renderHTML'].includes(args.action)
  const key = createHash('sha256').update(html).update(JSON.stringify([width, height, fps])).digest('hex').slice(0, 20)
  const folder = path.join(dataDir(), 'generated'); fs.mkdirSync(folder, { recursive: true })
  const file = path.join(folder, `animation-${key}.html`), video = path.join(folder, `animation-${key}.mp4`)
  fs.writeFileSync(file, html, 'utf8')
  const result = (cached) => ({ ok: true, file: render ? video : file, html: file, cached, text: `${cached ? '复用本地成品' : '本地生成完成'}：${render ? video : file}。HTML可离线播放；用handover交付。无需让模型逐帧生成。` })
  if (!render) return result(false)
  if (fs.existsSync(video)) { await probeMedia(video); return result(true) }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-animation-'))
  let browser
  try {
    browser = await chromium.launch({ executablePath: resolveExecutable(), headless: true })
    // A new context has no QQ/platform cookies; export never fetches the network.
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, serviceWorkers: 'block' })
    await context.route('**/*', (route) => route.abort())
    const page = await context.newPage()
    await page.setContent(html, { waitUntil: 'load', timeout: 15000 })
    await page.evaluate(() => {
      if (typeof window.whaleSeek !== 'function') throw new Error('HTML需要定义window.whaleSeek(seconds)，可先调用animation guide')
      document.body.classList.add('export'); window.whaleSeek(0)
    })
    await page.evaluate(() => document.fonts.ready)
    const duration = await page.evaluate(() => window.whaleDuration)
    if (!(duration > 0 && duration <= 60) || Math.ceil(duration * fps) > 900) throw new Error('动画最多60秒、900帧')
    for (let frame = 0; frame < Math.ceil(duration * fps); frame++) {
      await page.evaluate((time) => window.whaleSeek(time), frame / fps)
      await page.screenshot({ path: path.join(work, `frame-${String(frame).padStart(5, '0')}.png`), timeout: 15000 })
    }
    const staged = path.join(work, 'result.mp4')
    await runMediaProcess(mediaBinary('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-framerate', String(fps), '-i', path.join(work, 'frame-%05d.png'), '-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-threads', '4', staged], { cwd: work, timeout: 180000 })
    await probeMedia(staged)
    fs.copyFileSync(staged, video)
    return result(false)
  } finally {
    await browser?.close()
    if (path.dirname(work) === os.tmpdir()) fs.rmSync(work, { recursive: true, force: true })
  }
}
export function registerAnimationTool(ctx) {
  const tools = ctx.get?.('tools') || ctx.tools
  tools?.register({ name: 'animation', description: '本地Anime.js生成离线HTML动画或MP4。简单片头/字幕卡用分镜JSON：html导出网页、render导出视频；复杂动画先guide看接口，自己写HTML再renderHTML导出。完成后handover交付。最多60秒900帧，导出复用缓存，不必逐帧描述。',
    parameters: { type: 'object', additionalProperties: false, required: ['action'], properties: {
      action: { type: 'string', enum: ['html', 'render', 'renderHTML', 'guide'] }, file: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' }, duration: { type: 'number' }, accent: { type: 'string' }, width: { type: 'integer' }, height: { type: 'integer' }, fps: { type: 'integer' },
      scenes: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, text: { type: 'string' }, duration: { type: 'number' } } } },
    } }, output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: v.text }] },
    async execute(args) { try { return await createAnimation(args) } catch (e) { return { ok: false, text: e.message } } },
  })
}
