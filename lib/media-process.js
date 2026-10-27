import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

/** Media work must not block QQ, HTTP, cancellation timers or the desktop. */
export function runMediaProcess(command, args, { timeout = 180000, cwd, env, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const decoder = new StringDecoder('utf8')
    let output = '', errors = '', settled = false, lines = '', pending = Promise.resolve(), callbackError
    const enqueue = (line) => {
      pending = pending.then(() => { if (!callbackError) return onLine(line) }).catch((error) => { callbackError = error; child.kill() })
    }
    const finish = async (error) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      try { await pending; if (callbackError || error) throw callbackError || error; resolve(output) }
      catch (failure) { reject(failure) }
    }
    const timer = setTimeout(() => { child.kill(); finish(new Error('本地媒体处理超时，原素材保留')) }, timeout)
    child.stdout.on('data', (data) => {
      const text = decoder.write(data)
      output = (output + text).slice(-50000)
      if (!onLine) return
      lines += text
      let end
      while ((end = lines.indexOf('\n')) >= 0) {
        const line = lines.slice(0, end).replace(/\r$/, '')
        lines = lines.slice(end + 1)
        enqueue(line)
      }
    })
    child.stderr.on('data', (data) => { errors = (errors + data).slice(-4000) })
    child.on('error', (error) => finish(new Error(`媒体程序启动失败：${error.message}`)))
    child.on('close', (code) => {
      lines += decoder.end()
      if (onLine && lines) enqueue(lines)
      void finish(code === 0 ? null : new Error(`本地媒体处理失败：${errors.slice(-1200) || `退出码 ${code}`}`))
    })
  })
}
