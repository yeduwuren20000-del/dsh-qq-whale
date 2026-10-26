/**
 * 回归：会话重载后还能不能继续聊（同名 DSH 会话冲突的修复）。
 *   node tools/test-session-reload.mjs [baseUrl]
 */
const base = process.argv[2] || 'http://127.0.0.1:57161/dsh-mentor/api'
const idFile = new URL('./test-session.txt', import.meta.url)

async function chat(id, text) {
  const r = await fetch(`${base}/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: id, text }),
  })
  const body = await r.text()
  const done = (body.match(/event: done/g) || []).length
  const deltas = [...body.matchAll(/event: delta\ndata: (.+)/g)].map((m) => m[1]).join('')
  return { status: r.status, done, text: deltas.replace(/\\n/g, ' ').slice(0, 80), raw: body.slice(-200) }
}

const fs = await import('node:fs')
const existing = fs.existsSync(idFile) ? fs.readFileSync(idFile, 'utf8').trim() : ''

if (existing) {
  // 第二阶段：重载后继续同一个会话
  console.log('重载后继续会话:', existing)
  const r = await chat(existing, '再回一个字：好')
  console.log('结果:', JSON.stringify(r))
} else {
  const s = await (await fetch(`${base}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '测试-重载冲突' }),
  })).json()
  const id = s.session.id
  console.log('新会话:', id)
  fs.writeFileSync(idFile, id)
  const r = await chat(id, '回一个字：好')
  console.log('第一轮:', JSON.stringify(r))
}
