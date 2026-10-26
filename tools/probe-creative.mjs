import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { CREATIVE_PLATFORMS } from '../lib/creative-platforms.js'
import { resolveExecutable } from '../lib/chromium.js'

const browser = await chromium.launch({ executablePath: resolveExecutable(), headless: true })
const results = [], queue = [...CREATIVE_PLATFORMS]
async function work() {
  for (;;) {
    const platform = queue.shift(); if (!platform) return
    const page = await browser.newPage()
    try {
      const response = await page.goto(platform.url, { waitUntil: 'domcontentloaded', timeout: 25000 })
      const body = (await page.locator('body').innerText({ timeout: 5000 })).slice(0, 700)
      const result = { id: platform.id, url: page.url(), status: response?.status(), title: await page.title(), needsAccount: true, publicPageText: body }
      results.push(result); console.log(JSON.stringify({ id: result.id, status: result.status, url: result.url, title: result.title }))
    } catch (error) { results.push({ id: platform.id, url: page.url(), error: error.message.split('\n')[0], needsAccount: true }); console.log(platform.id, 'not verified:', error.message.split('\n')[0]) }
    finally { await page.close() }
  }
}
try { await Promise.all([work(), work()]) }
finally { await browser.close() }
const folder = path.resolve(import.meta.dirname, '..', 'verification-data')
fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(folder, 'creative-probe.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
