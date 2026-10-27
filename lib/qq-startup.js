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
      // NapCat 还活着、只是 OneBot 服务器没开：重新配置并重连，绝不重启 QQ。
      // 以前不判断这个，插件一重载就让 watchdog 去「拉起」网关，把已登录的 QQ 杀掉重来，
      // 结果每次改代码重载都得重新扫码。
      if (owner.napcatAlive && await owner.napcatAlive()) {
        if (Date.now() - slot.lastAttempt < 20000) return
        slot.lastAttempt = Date.now()
        const result = await owner.reconnect?.()
        if (result && !result.ok) owner.onError?.(result.error)
        return
      }
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
