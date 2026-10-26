import fs from 'node:fs'

const cfgPath = process.argv[2]
const token = process.argv[3]
const port = Number(process.argv[4] || 3010)

const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
raw.network = raw.network || {}
raw.network.websocketServers = [
  {
    name: 'dsh-mentor',
    enable: true,
    host: '127.0.0.1',
    port,
    messagePostFormat: 'array',
    reportSelfMessage: false,
    token,
    enableForcePushEvent: true,
    debug: false,
    heartInterval: 30000,
  },
]
raw.network.httpServers = raw.network.httpServers || []
raw.network.httpClients = raw.network.httpClients || []
raw.network.websocketClients = raw.network.websocketClients || []
fs.writeFileSync(cfgPath, JSON.stringify(raw, null, 2), 'utf8')
console.log(`已写入 WS 服务端：127.0.0.1:${port}（token 长度 ${token.length}）`)
