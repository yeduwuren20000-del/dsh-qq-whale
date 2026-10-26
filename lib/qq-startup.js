/** Shared watchdog: retries failed launches without creating duplicate gateways. */
const SLOT = Symbol.for('dsh-mentor.qq.startup')

export function createStartupWatchdog(options) {
  const slot = globalThis[SLOT] ||= { owners: [], timer: null, busy: false, lastAttempt: 0 }
  slot.owners.push(options)
  async function tick() {
    const owner = slot.owners.at(-1)
    if (!owner || slot.busy) return
    const cfg = owner.getConfig()
    if (!cfg.enabled) return
    const status = owner.getStatus().status
    if (status === 'connected') return
    slot.busy = true
    try {
      if (await owner.isGatewayUp(cfg.url)) return
      if (!cfg.autoLaunchNapcat || Date.now() - slot.lastAttempt < 60000) return
      slot.lastAttempt = Date.now()
      const result = await owner.launch()
      if (!result.ok) owner.onError?.(result.error)
    } catch (error) { owner.onError?.(error.message) }
    finally { slot.busy = false }
  }
  if (!slot.timer) {
    slot.timer = setInterval(() => { void tick() }, 15000)
    slot.timer.unref?.()
  }
  void tick()
  return () => {
    const i = slot.owners.indexOf(options)
    if (i >= 0) slot.owners.splice(i, 1)
    if (!slot.owners.length) { clearInterval(slot.timer); slot.timer = null; slot.lastAttempt = 0 }
  }
}
