/** 探一下 3001 上的 OneBot 服务：拿登录号、昵称，顺便看 token 是不是必须的。 */
import WebSocket from 'ws'

const url = process.argv[2] || 'ws://127.0.0.1:3001'
const token = process.argv[3] || ''

function probe(withToken) {
  return new Promise((resolve) => {
    const target = withToken && token ? `${url}?access_token=${encodeURIComponent(token)}` : url
    const ws = new WebSocket(target)
    const timer = setTimeout(() => {
      try {
        ws.close()
      } catch {}
      resolve({ ok: false, error: '超时' })
    }, 5000)
    ws.on('open', () => {
      ws.send(JSON.stringify({ action: 'get_login_info', params: {}, echo: 'p1' }))
    })
    ws.on('message', (raw) => {
      const data = JSON.parse(String(raw))
      if (data.echo === 'p1') {
        clearTimeout(timer)
        ws.close()
        resolve({ ok: true, data })
      }
    })
    ws.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, error: String(error.message || error) })
    })
  })
}

const withToken = await probe(true)
console.log('带 token:', JSON.stringify(withToken).slice(0, 300))
if (!withToken.ok) {
  const noToken = await probe(false)
  console.log('不带 token:', JSON.stringify(noToken).slice(0, 300))
}
