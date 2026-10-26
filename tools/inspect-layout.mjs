/**
 * 量一下预览页里关键元素的真实尺寸——调布局时比看截图靠谱。
 *
 *   node tools/inspect-layout.mjs            # 默认量 window.html
 *   node tools/inspect-layout.mjs window-empty.html
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = process.argv[2] || 'window.html'
process.env.DSH_MENTOR_DATA = path.join(ROOT, 'preview', '.data')

const browser = await import('../lib/browser.js')
const url = `${pathToFileURL(path.join(ROOT, 'preview', file)).href}?t=${Date.now()}`

await browser.act('open', { url, headless: true })
await browser.act('viewport', { width: 1180, height: 760 })

const script = `(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), maxW: s.maxWidth, padding: s.padding }
  }
  return JSON.stringify({
    panel: pick('.dm-panel'),
    rail: pick('.dm-rail'),
    scroll: pick('.dm-scroll'),
    col: pick('.dm-col'),
    bubble: pick('.dm-bubble'),
    composer: pick('.dm-composer'),
    shell: pick('.dm-composer-shell'),
    mentorCol: pick('.dm-mentor .dm-col'),
    mentorBubble: pick('.dm-mentor .dm-bubble'),
    row: pick('.dm-mentor'),
  }, null, 2)
})()`

const result = await browser.act('eval', { script })
console.log(result.text)
await browser.act('close', {})
