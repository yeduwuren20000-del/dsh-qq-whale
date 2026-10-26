/**
 * 对着正在运行的 GUI 做一次真机体检。
 *
 *   node tools/live-check.mjs                 # 只查宿主与前端接线
 *   node tools/live-check.mjs "讲讲闭包"       # 顺带跑一轮真对话（走模型、走工具）
 *
 * 端口默认取 DSH_GUI_URL，否则 http://127.0.0.1:61917。
 */
const base = (process.env.DSH_GUI_URL || 'http://127.0.0.1:61917').replace(/\/+$/, '')
const question = process.argv[2]

function line(label, ok, extra = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
  return ok
}

async function main() {
  let pass = 0
  let fail = 0
  const check = (label, ok, extra) => {
    if (line(label, ok, extra)) pass += 1
    else fail += 1
    return ok
  }

  // 1. 宿主插件
  const healthRes = await fetch(`${base}/dsh-mentor/api/health`).catch(() => undefined)
  if (!healthRes) {
    check('宿主路由可达', false, base)
    console.log('\n宿主没起来，或者插件没装上。先跑 tools/install.mjs，再重启 DSH。')
    process.exit(1)
  }
  const health = await healthRes.json().catch(() => ({}))
  check('宿主路由可达', healthRes.status === 200)
  check('agent 服务就绪', health.agents === 'ready', health.agents)
  check('路由引擎已报告', typeof health.jev?.detail === 'string', health.jev?.detail)
  check('模式表完整', Array.isArray(health.modes) && health.modes.length === 6, (health.modes || []).join('/'))

  // 2. 前端接线（/ 需要 dsh web 的 token，所以从宿主服务读 boot 图，不抓页面）
  const client = health.client || {}
  check('宿主暴露 clientModules', client.available !== false, client.available === false ? '不可用' : 'ok')
  check('客户端模块已进 boot 图', client.inGraph === true, client.inGraph ? '' : `图里 ${client.entries?.length ?? 0} 个条目，没有 dsh-mentor`)
  if (client.inGraph !== true && Array.isArray(client.entries)) {
    console.log(`     图内条目：${client.entries.slice(0, 12).join(', ')} …`)
  }
  // 心跳不是失败项：页面没刷新过就会一直是空的，但它是远程判断「前端活没活」的唯一证据。
  const beat = client.beat
  console.log(
    beat
      ? `     前端心跳：v${beat.payload?.v ?? '?'} ${beat.payload?.event ?? '?'} @ ${new Date(beat.at).toLocaleTimeString()}`
      : '     前端心跳：还没收到（页面没加载过本插件，刷新一次即可）',
  )

  // 3. 可选：真跑一轮
  if (question) {
    console.log('\n--- 真对话 ---')
    const created = await (
      await fetch(`${base}/dsh-mentor/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).json()
    const sessionId = created.session?.id
    check('新建会话', Boolean(sessionId), sessionId)

    const started = Date.now()
    const res = await fetch(`${base}/dsh-mentor/api/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, text: question }),
    })
    check('turn 开流', res.status === 200)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let answer = ''
    const events = new Set()
    const tools = new Set()
    let route
    let error
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let cut
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        let event = 'message'
        let data = ''
        for (const l of block.split('\n')) {
          if (l.startsWith('event:')) event = l.slice(6).trim()
          else if (l.startsWith('data:')) data += l.slice(5).trim()
        }
        if (!data) continue
        events.add(event)
        const payload = JSON.parse(data)
        if (event === 'route') route = payload
        else if (event === 'delta') answer += payload.text
        else if (event === 'tool') tools.add(payload.name)
        else if (event === 'error') error = payload.message
      }
    }
    check('先给模式判定', Boolean(route), route ? `${route.label} ${(route.confidence * 100).toFixed(0)}%` : '')
    check('有正文流', answer.length > 0, `${answer.length} 字 / ${((Date.now() - started) / 1000).toFixed(1)}s`)
    check('没有报错帧', !error, error || '')
    if (tools.size) console.log(`     用过工具：${[...tools].join(', ')}`)
    console.log('\n--- 回答开头 ---')
    console.log(answer.slice(0, 400))
  }

  console.log(`\n结果：${pass} 通过，${fail} 失败`)
  process.exitCode = fail === 0 ? 0 : 1
}

main().catch((error) => {
  console.log('FATAL', error.message)
  process.exitCode = 1
})
