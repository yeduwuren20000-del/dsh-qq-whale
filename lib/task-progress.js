/** Report only real running jobs, at most once a minute after the initial notice. */
export async function withTaskProgress(entry, label, work, { intervalMs = 60000 } = {}) {
  const started = Date.now()
  const notify = (text) => Promise.resolve().then(() => entry.onProgress?.(text)).catch(() => {})
  await notify(`${label}，完成后发给你。`)
  const timer = setInterval(() => { void notify(`${label}，还在处理中，已用 ${Math.floor((Date.now() - started) / 1000)} 秒。`) }, intervalMs)
  timer.unref?.()
  try { return await work() }
  finally { clearInterval(timer) }
}
