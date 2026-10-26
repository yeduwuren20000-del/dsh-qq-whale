/**
 * 桌面窗口控制的 Node 侧：起一个 python 子进程跑 desktop.py，拿回一行 JSON。
 * 参数走 argv，不拼 shell 字符串，所以中文和引号都不会出问题。
 */
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, 'desktop.py')
const PYTHON = process.env.DSH_MENTOR_PYTHON || 'python'

/**
 * @param {string} action - windows/focus/shot/type/hotkey/click
 * @param {object} params
 * @returns {Promise<{ok: boolean, text: string, [key: string]: unknown}>}
 */
export function act(action, params = {}) {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, [SCRIPT, action, JSON.stringify(params)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // 已经退了。
      }
      resolve({ ok: false, text: '桌面操作超时（20 秒）' })
    }, 20000)
    child.stdout.on('data', (chunk) => {
      out += chunk
    })
    child.stderr.on('data', (chunk) => {
      err += chunk
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, text: `起不了 python（${PYTHON}）：${error.message}` })
    })
    child.on('close', () => {
      clearTimeout(timer)
      try {
        const parsed = JSON.parse(out.trim() || '{}')
        resolve(parsed)
      } catch {
        resolve({ ok: false, text: `桌面脚本没有返回 JSON：${(err || out).slice(0, 400)}` })
      }
    })
  })
}

export function status() {
  return { python: PYTHON, script: SCRIPT }
}
