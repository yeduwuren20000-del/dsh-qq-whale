/** Keep inherited tool schemas out of ordinary chat; discover and load them on demand. */
export function installToolAccess(agentCtx, agent) {
  const tools = agentCtx.get?.('tools') || agentCtx.tools
  if (!tools?.restrict || !tools?.schemas) throw new Error('宿主缺少按会话加载工具的能力，请更新 DSH')
  const catalog = tools.schemas(agent).filter((row) => row.name !== 'run_code')
  const enabled = new Set()
  const deferred = new Map(), loaded = new Map()
  let release = tools.restrict({ allow: [] })
  const localNames = () => new Set(tools.schemas(agent).filter((row) => !enabled.has(row.name)).map((row) => row.name))
  const stats = () => {
    const visible = tools.schemas(agent)
    return { available: catalog.length + deferred.size, enabled: [...enabled, ...loaded.keys()], visible: visible.length, schemaBytes: Buffer.byteLength(JSON.stringify(visible)) }
  }
  // Register capabilities only when requested. The real SDK's per-tool disposer
  // removes their schemas again after the turn; other agents are unaffected.
  const registration = { register(definition) {
    if (['handover', 'memory', 'companion'].includes(definition.name)) return tools.register(definition)
    deferred.set(definition.name, definition)
  } }
  stats.context = { tools: registration, get: (key) => key === 'tools' ? registration : agentCtx.get?.(key) }
  stats.reset = () => {
    for (const dispose of loaded.values()) dispose?.()
    loaded.clear()
    if (!enabled.size) return
    const nextRelease = tools.restrict({ allow: [] })
    release(); release = nextRelease; enabled.clear()
  }
  tools.register({
    name: 'toolAccess',
    description: '按需加载工具，省下闲聊用量。search搜索剪辑、动画、浏览器、桌面、天气、文件等；enable指定返回的名字后即可调用；release卸载。可直接enable已知工具名，如mediaEdit、animation、browser。权限和审批由宿主管理。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['action'],
      properties: {
        action: { type: 'string', enum: ['search', 'enable', 'release'] },
        query: { type: 'string', description: '工具名或功能关键词，多个关键词用空格分开。' },
        names: { type: 'array', items: { type: 'string' }, maxItems: 8 },
      },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute(args = {}) {
      const own = localNames()
      if (args.action === 'search') {
        const terms = String(args.query || '').toLowerCase().split(/\s+/).filter(Boolean)
        const matches = [...deferred.values(), ...catalog.filter((row) => !own.has(row.name) && !deferred.has(row.name))].map((row) => {
          const name = row.name.toLowerCase(), desc = String(row.description || '').toLowerCase()
          return { row, score: terms.reduce((n, term) => n + (name.includes(term) ? 5 : desc.includes(term) ? 1 : 0), 0) }
        }).filter((item) => !terms.length || item.score > 0).sort((a, b) => b.score - a.score)
        return { ok: true, total: matches.length, tools: matches.slice(0, 8).map(({ row }) => ({ name: row.name, description: String(row.description || '').slice(0, 200) })) }
      }
      if (!['enable', 'release'].includes(args.action)) return { ok: false, error: '未知操作' }
      const names = [...new Set(Array.isArray(args.names) ? args.names : [])]
      if (names.length > 8 || names.some((name) => (!deferred.has(name) && (own.has(name) || !catalog.some((row) => row.name === name))))) return { ok: false, error: '请使用搜索返回的工具名；每次最多选择8个。' }
      const local = names.filter((name) => deferred.has(name))
      const inherited = names.filter((name) => !deferred.has(name))
      if (args.action === 'release') {
        for (const name of names.length ? local : [...loaded.keys()]) { loaded.get(name)?.(); loaded.delete(name) }
      } else {
        for (const name of local) if (!loaded.has(name)) loaded.set(name, tools.register(deferred.get(name)))
      }
      const next = new Set(enabled)
      if (args.action === 'release') {
        if (names.length) inherited.forEach((name) => next.delete(name))
        else next.clear()
      } else inherited.forEach((name) => next.add(name))
      // Install before releasing the old mask, so a failure never exposes the full catalog.
      const nextRelease = tools.restrict({ allow: [...next] })
      release()
      release = nextRelease
      enabled.clear(); next.forEach((name) => enabled.add(name))
      return { ok: true, ...stats() }
    },
  })
  return stats
}

/** One-shot JSON reflections have no tool work to do. Scope-owned cleanup is handled by DSH. */
export function restrictReflectionTools(agentCtx) {
  const tools = agentCtx.get?.('tools') || agentCtx.tools
  if (!tools?.restrict) throw new Error('宿主缺少按会话限制工具的能力，请更新 DSH')
  tools.restrict({ allow: [] })
}
