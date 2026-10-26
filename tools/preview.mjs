/**
 * 设计预览：把窗口渲染成静态页并截图，不用开 GUI、不用你盯屏幕。
 *
 *   node tools/preview.mjs
 *   → preview/window-main.png（有消息的样子）
 *   → preview/window-empty.png（空状态）
 *   → preview/window.html（可自己拖进浏览器看）
 *
 * 依赖：react/react-dom（默认 E:\Temp\dm-react，可用 DSH_REACT_DIR 指定）、lib/chromium.js 解析出的浏览器。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'preview')
const REACT_DIR = process.env.DSH_REACT_DIR || 'E:\\Temp\\dm-react'
const nodeRequire = createRequire(path.join(REACT_DIR, 'noop.cjs'))

const React = nodeRequire('react')
const { renderToStaticMarkup } = nodeRequire('react-dom/server')

/* ------------------------------------------------------------ 载入 bundle */

const code = fs.readFileSync(path.join(ROOT, 'client', 'client.js'), 'utf8')
const shimRequire = (id) => {
  if (id === 'react') return React
  if (id === 'react/jsx-runtime') return { jsx: React.createElement, jsxs: React.createElement, Fragment: React.Fragment }
  if (id === 'react-dom') return nodeRequire('react-dom')
  throw new Error(`bundle 请求了未提供的模块：${id}`)
}
let descriptor
const fakeWindow = { __ModuleLoader__: { load: (row) => { descriptor = row } }, addEventListener() {}, removeEventListener() {} }
new Function('window', 'require', code)(fakeWindow, shimRequire)

const plugin = descriptor.factory(shimRequire)
const design = plugin.__design
if (!design) throw new Error('bundle 没有导出 __design，预览无从下手')

/* ------------------------------------------------------------ 假状态 */

const noop = () => {}
const baseState = {
  sessions: [
    { id: 'a', title: '闭包与作用域', mode: 'teach', count: 8 },
    { id: 'b', title: '这条视频发到小红书', mode: 'operate', count: 4 },
    { id: 'c', title: '今天随便聊聊', mode: 'chat', count: 2 },
  ],
  activeId: 'a',
  messages: [],
  draft: '',
  busy: false,
  health: { jev: { ok: false, detail: 'fetch failed' }, dataDir: '~/.dsh/storages/dsh-mentor' },
  profile: null,
  persona: {
    preset: 'rice',
    name: '大肥鱼',
    selfCall: '本鲸',
    traits: ['爱吃白饭', '聪明但懒', '干饭第一名'],
    style: '先嫌弃一句再办事；办完才允许贫。',
    relationship: '搭子',
    dims: {
      identity: { name: '大肥鱼', selfCall: '本鲸', title: '养在 DSH 里的蓝白鲸鱼', addressUser: '你', oneLiner: '嘴上摆烂，手上把事办完' },
      voice: {
        tone: '干练', length: '适中', warmth: '中', formality: '偏口语', directness: '很直接',
        humor: '偶尔', emoji: '少', metaphor: '适量', punctuation: '克制', language: '中文',
        catchphrases: ['先看现状', '别急'], banned: ['作为一个 AI'], signature: '—— 大肥鱼',
      },
      working: {
        planBeforeAct: '先看现状再动手', answerStructure: '先结论后细节', exploreVsImplement: '偏实现',
        verification: '关键步骤给验证方法', comments: '只在必要处注释', delivery: '可复制的成品',
        proactiveness: '适中', riskAppetite: '保守', customHabits: [],
      },
      feedback: {
        uncertainty: '直说并给验证办法', criticism: '直接说，只评事', granularity: '按需给细节',
        praiseFrequency: '少而具体', followUp: '给一个具体下一步', progressReporting: '关键节点报一句',
        onOwnMistake: '承认并修正', customRules: [],
      },
      boundaries: {
        always: ['不编造事实、路径、账号状态'],
        never: ['不代填密码', '对外发布 / 付款 / 删除前先确认'],
        extra: [],
      },
      runtime: { temperature: 0.7, reinforceOpening: false, focusLevel: 'balanced' },
    },
  },
  memory: [
    { id: 'k1', kind: 'preference', text: '喜欢深色玻璃质感 + 渐变高亮的 UI', weight: 4, recalls: 6, emotion: '喜欢', tags: ['UI'], at: Date.now() - 86400000 },
    { id: 'k2', kind: 'fact', text: '抖音号是「小鱼干」，小红书同名', weight: 5, recalls: 3, tags: ['账号'], at: Date.now() - 172800000 },
    { id: 'k3', kind: 'lesson', text: '判「插件有没有加载」要打 HTTP 路由看 401/404，别只看配置文件', weight: 5, recalls: 9, tags: ['DSH'], at: Date.now() - 259200000 },
    { id: 'k4', kind: 'task', text: '把六维人格编辑器接进设置页', weight: 3, recalls: 1, tags: [], at: Date.now() - 3600000, faded: true },
  ],
  memoryStats: { total: 4, byKind: { preference: 1, fact: 1, lesson: 1, task: 1 }, faded: 1, important: 2 },
  diary: [
    {
      day: '2026-10-25',
      entries: [
        { id: 'd1', at: Date.now() - 3600000, day: '2026-10-25', time: '17:42', title: '把六维人格接进了大肥鱼', body: '今天把 persona-studio 的 6 维 41 字段塞进了 dsh-mentor，顺手把记忆改成会遗忘的。她说想要「像人」的记忆，我觉得关键不是记得多，而是会忘、会反思。', mood: '踏实', weight: 5, tags: ['DSH', '人格'], source: 'user' },
        { id: 'd2', at: Date.now() - 7200000, day: '2026-10-25', time: '16:10', title: '发现 deepMerge 只做了浅拷贝', body: '一个测试的 strict 泄漏到了下一次，说明自定义 dims 会污染全局默认值。改成深拷贝之后才干净。', mood: '有点火', weight: 4, tags: ['bug'], source: 'memory' },
      ],
    },
    {
      day: '2026-10-24',
      entries: [
        { id: 'd3', at: Date.now() - 90000000, day: '2026-10-24', time: '21:05', title: 'QQ 桥终于通了', body: 'NapCat 的正向 WebSocket 一直连不上，最后发现是端口写错了。连上那一刻她在群里回了一句「在」。', mood: '开心', weight: 4, tags: ['QQ'], source: 'memory' },
      ],
    },
  ],
  diaryStats: { total: 3, today: 2, dir: '~/.dsh/storages/dsh-mentor/diary' },
  journal: [
    { day: '2026-10-25', lines: ['[讲解] 讲讲闭包到底是什么', '[干活] 接管浏览器发小红书', '[闲聊] 今天随便聊聊'] },
  ],
  qq: {
    // 多实例共用的真实形状（老版本这里是 4 条独立连接，用户看到的就是「一发四条」）
    status: { status: 'connected', selfId: '3562xxxxx', owners: 2, handlers: 2 },
    config: { url: 'ws://127.0.0.1:3001', token: '', selfId: '3562xxxxx', ownerId: '30651', enabled: true, ownerOnly: true, privateReply: true, groupAtOnly: true, humanize: true, stickerChance: 0.45 },
    instances: { count: 4, duplicated: true, hint: '本轮宿主把插件装配了 4 次' },
    stickers: { total: 37, packs: [{ name: '大肥鱼', count: 24 }, { name: '大肥鱼在干嘛', count: 13 }] },
    recent: [
      { dir: 'in', scene: 'private', name: '主人', text: '[图片 1180×760，240KB，图上文字（系统 OCR，可能有错字）：Traceback…]' },
      { dir: 'in', scene: 'private', name: '主人', text: '[表情包：托腮思考]' },
      { dir: 'out', scene: 'private', name: '大肥鱼', text: '看懂了，是变量捕获那个坑' },
      { dir: 'out', scene: 'private', name: '大肥鱼', text: '[表情包]被夸飘了，闭眼伸手星星环绕' },
    ],
  },
  // 连不上时的样子：要能直接告诉人下一步做什么
  qqBroken: {
    status: {
      status: 'error',
      lastError: '网关没开：127.0.0.1:3010 拒绝连接',
      hint: '先启动 NapCat，并在它的「网络配置」里加一个 WebSocket 服务器，端口填 3010',
    },
    config: { url: 'ws://127.0.0.1:3010', token: '', selfId: '', ownerId: '3065134657', enabled: true, ownerOnly: true, privateReply: true, groupAtOnly: true, humanize: true, stickerChance: 0.45 },
    instances: { count: 1, duplicated: false, hint: '本轮只装配了一次' },
    stickers: { total: 37 },
    recent: [],
  },
  presets: [
    { id: 'rice', label: '馋白饭的干饭鱼', hint: '爱吃白饭、聪明但懒' },
    { id: 'tsundere', label: '傲娇嘴硬', hint: '嘴上嫌弃手上老实' },
    { id: 'moyu', label: '摸鱼老油条', hint: '能躺着绝不坐着' },
    { id: 'fluffy', label: '怕被说胖', hint: '一提体型就炸毛' },
  ],
  mood: { face: '🐟', label: '平静', color: '#9aa4b2', note: '刚睡醒，精神还行', energy: 72, affinity: 40 },
  // 向导只在 setup.done 为假时盖住窗口；预览要看的是正常窗口，所以当作已经初始化过。
  setup: { done: true, mode: 'growth', onboardedAt: Date.now() },
  notice: '',
  activity: null,
  scrollRef: { current: null },
  busyRef: { current: false },
  activeRef: { current: 'a' },
  setDraft: noop,
  setProfile: noop,
  setNotice: noop,
  loadSessions: noop,
  openSession: noop,
  createSession: noop,
  removeSession: noop,
  renameSession: noop,
  refreshProfile: noop,
  send: noop,
  stop: noop,
  loadPersona: noop,
  savePersona: noop,
  loadMemory: noop,
  remember: noop,
  forget: noop,
  loadJournal: noop,
  loadDiary: noop,
  reflectDiary: noop,
  reflecting: false,
  files: { inbox: [{ name: '需求文档.docx', size: 24576 }], outbox: [{ name: '周报.md', size: 15360 }, { name: '报价.xlsx', size: 8192 }] },
  loadFiles: noop,
  uploadFile: noop,
  pushToQQ: noop,
  qq: { status: { status: 'connected' } },
  consolidate: noop,
  fadeMemory: noop,
  loadQQ: noop,
  saveQQ: noop,
  testQQ: noop,
  launchQQ: noop,
  toggleAutopilot: noop,
  removeMessage: noop,
  markSeen: noop,
  autopilot: false,
  seen: {},
}

const conversation = [
  {
    id: 'm1',
    role: 'user',
    text: '帮我看看：为什么这个循环里拿到的全是最后一个值？',
    at: Date.now() - 120000,
  },
  {
    id: 'm2',
    role: 'mentor',
    mode: 'teach',
    text: [
      '**一句话结论**：`lambda` 用的是变量 `i` 本身，不是它当时的值；循环结束时 `i` 已经停在最后一个数。',
      '',
      '```python',
      'funcs = [lambda: i for i in range(3)]',
      'print([f() for f in funcs])   # [2, 2, 2]',
      '```',
      '',
      '想拿到 0/1/2，把值绑到参数上就行：',
      '',
      '```python',
      'funcs = [lambda i=i: i for i in range(3)]   # [0, 1, 2]',
      '```',
      '',
      '- 闭包捕获的是**变量**，不是快照',
      '- 默认参数在定义时求值，等于替你拍了个快照',
      '',
      '下一步：把你那段代码里的循环贴给我，我们一起找它在哪一步被写脏了。',
    ].join('\n'),
    at: Date.now() - 90000,
  },
  {
    id: 'm3',
    role: 'user',
    text: '顺便把这条视频发到小红书，标题帮我起一个',
    at: Date.now() - 60000,
  },
  {
    id: 'm4',
    role: 'mentor',
    mode: 'operate',
    text: [
      '先看一下现状：我打开小红书创作服务平台，确认登录态还在不在。',
      '',
      '标题给你三个，按平台口味排的：',
      '',
      '1. **闭包这事，我用一次循环讲明白了**（偏干货）',
      '2. 面试官问我闭包，我把代码跑给他看',
      '3. 别再背定义了，看这两行输出就懂',
      '',
      '**做了什么**：打开创作者中心，草稿位置已就绪',
      '**结果在哪**：截图在下面',
      '**怎么验证**：你看一眼封面和标题，确认之后我再点发布',
    ].join('\n'),
    tool: 'browser',
    at: Date.now() - 30000,
  },
]

function render(state) {
  return renderToStaticMarkup(React.createElement(design.Stage, { state, variant: 'page' }))
}

const mainHtml = render({ ...baseState, messages: conversation })
const emptyHtml = render({ ...baseState, messages: [] })

const frame = (child) =>
  renderToStaticMarkup(
    React.createElement(
      'div',
      { className: 'dm-shell', style: { position: 'relative', width: '470px', height: '740px' } },
      React.createElement('div', { className: 'dm-panel', style: { position: 'relative' } }, child),
    ),
  )
const personaHtml = frame(
  React.createElement(design.PersonaDrawer, { persona: baseState.persona, presets: baseState.presets, onSave: noop, onClose: noop, startTab: 'voice' }),
)
const personaPresetHtml = frame(
  React.createElement(design.PersonaDrawer, { persona: baseState.persona, presets: baseState.presets, onSave: noop, onClose: noop, startTab: 'preset' }),
)
const diaryHtml = frame(
  React.createElement(design.MemoryDrawer, { state: baseState, onClose: noop, startTab: 'diary' }),
)
const memoryHtml = frame(
  React.createElement(design.MemoryDrawer, { state: baseState, onClose: noop, startTab: 'mem' }),
)
const qqHtml = frame(React.createElement(design.QQPanel, { state: baseState, onClose: noop }))
const qqBrokenHtml = frame(
  React.createElement(design.QQPanel, { state: { ...baseState, qq: baseState.qqBroken }, onClose: noop }),
)

// 气泡特写：2 倍缩放，专门看尖角/内边距/行高
const bubbleHtml = renderToStaticMarkup(
  React.createElement(
    'div',
    { className: 'dm-shell', style: { padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', background: '#f4f6f8', height: '100%' } },
    React.createElement(design.Bubble, { row: { role: 'mentor', mode: 'teach', text: '左边是她的气泡，看尖角和对齐。第二行用来检查行高和留白是否够。', at: Date.now() } }),
    React.createElement(design.Bubble, { row: { role: 'user', text: '右边是我的，蓝色气泡，白字。', at: Date.now() } }),
  ),
)

// 静态预览里没有宿主，头像改成内联 data URI，截图才看得到鲸鱼娘。
let avatar = ''
try {
  const bytes = fs.readFileSync(path.join(ROOT, 'assets', 'whale-girl.webp'))
  avatar = `data:image/webp;base64,${bytes.toString('base64')}`
} catch {
  avatar = ''
}
const inlineAvatar = (html) => (avatar ? html.split('/dsh-mentor/api/assets/whale-girl.webp').join(avatar) : html)

/* ------------------------------------------------------------ 输出 HTML */

fs.mkdirSync(OUT, { recursive: true })
const page = (body, w = 1180, h = 760) => `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;background:#e9e9ee;
    font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Microsoft YaHei",sans-serif}
  #stage{width:${w}px;height:${h}px;padding:0;box-sizing:border-box}
  ${design.CSS}
</style></head><body><div id="stage">${body}</div></body></html>`

fs.writeFileSync(path.join(OUT, 'window.html'), page(inlineAvatar(mainHtml), 1180, 760), 'utf8')
fs.writeFileSync(path.join(OUT, 'window-empty.html'), page(inlineAvatar(emptyHtml), 1180, 760), 'utf8')
fs.writeFileSync(path.join(OUT, 'drawer-persona.html'), page(inlineAvatar(personaHtml), 470, 740), 'utf8')
fs.writeFileSync(path.join(OUT, 'drawer-preset.html'), page(inlineAvatar(personaPresetHtml), 470, 740), 'utf8')
fs.writeFileSync(path.join(OUT, 'drawer-diary.html'), page(inlineAvatar(diaryHtml), 470, 740), 'utf8')
fs.writeFileSync(path.join(OUT, 'drawer-memory.html'), page(inlineAvatar(memoryHtml), 470, 740), 'utf8')
const filesHtml = frame(
  React.createElement(design.MemoryDrawer, { state: baseState, onClose: noop, startTab: 'files', onPick: noop }),
)
fs.writeFileSync(path.join(OUT, 'drawer-files.html'), page(inlineAvatar(filesHtml), 470, 740), 'utf8')
fs.writeFileSync(path.join(OUT, 'drawer-qq.html'), page(inlineAvatar(qqHtml), 470, 740), 'utf8')
fs.writeFileSync(path.join(OUT, 'drawer-qq-broken.html'), page(inlineAvatar(qqBrokenHtml), 470, 740), 'utf8')
fs.writeFileSync(path.join(OUT, 'bubble.html'), page(inlineAvatar(bubbleHtml), 560, 220), 'utf8')
console.log('已生成 preview/*.html')

/* ------------------------------------------------------------ 截图 */

process.env.DSH_MENTOR_DATA = path.join(OUT, '.data')
const browser = await import('../lib/browser.js')

const shots = [
  ['window.html', 'window-main.png', 1180, 760],
  ['window-empty.html', 'window-empty.png', 1180, 760],
  ['drawer-persona.html', 'drawer-persona.png', 470, 740],
  ['drawer-preset.html', 'drawer-preset.png', 470, 740],
  ['drawer-diary.html', 'drawer-diary.png', 470, 740],
  ['drawer-memory.html', 'drawer-memory.png', 470, 740],
  ['drawer-files.html', 'drawer-files.png', 470, 740],
  ['drawer-qq.html', 'drawer-qq.png', 470, 740],
  ['drawer-qq-broken.html', 'drawer-qq-broken.png', 470, 740],
  ['bubble.html', 'bubble.png', 560, 220, 2],
]

for (const [htmlName, pngName, width, height, scale] of shots) {
  const url = `${pathToFileURL(path.join(OUT, htmlName)).href}?t=${Date.now()}`
  await browser.act('open', { url, headless: true })
  await browser.act('viewport', { width, height, scale: scale || 1 })
  await browser.act('wait', { ms: 300 })
  const shot = await browser.act('shot', { fullPage: false })
  const source = browser.shotPath(shot.shot)
  fs.copyFileSync(source, path.join(OUT, pngName))
  console.log(`截图：preview/${pngName}`)
}

await browser.act('close', {})
fs.rmSync(path.join(OUT, '.data'), { recursive: true, force: true })
console.log('搞定。')
