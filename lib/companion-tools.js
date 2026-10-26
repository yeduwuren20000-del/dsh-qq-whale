import { clockBlock } from './clock.js'
import { VOICES, perceptionConfig, perceptionStatus, transcribeAudio, understandImage } from './perception.js'
import { getSettings, setSettings } from './store.js'
import { makePostDraft, publishQzone, saveShare, socialState } from './social.js'
import { act } from './browser.js'
import { CREATIVE_PLATFORMS } from './creative-platforms.js'

export function registerCompanionTools(ctx, { entry, qqId }) {
  const tools = ctx.get?.('tools') || ctx.tools
  if (!tools?.register) return
  tools.register({
    name: 'companion',
    description: '大肥鱼自己的状态、声音和社交。time读取实时北京时间。look在本机理解图片或动图；listen在本机转写音频或视频中的声音。voices列出本地音色；chooseVoice由你自己选常用音色；replyVoice决定本轮用语音回QQ（不用传正文，最终回答会合成为语音），replyText决定本轮只回文字。qzoneDraft写一条QQ空间说说草稿；qzonePublish发布草稿（用户开启自动发表或明确确认后）；shareVideo存一条想分享给主人的抖音视频，独立账号尚未配置时如实保留待发。openCreative打开已接入的创作平台开始用户要求的图片或视频任务，后续用browser操作和download交付。',
    parameters: { type: 'object', additionalProperties: false, required: ['action'], properties: {
      action: { type: 'string', enum: ['time', 'status', 'look', 'listen', 'voices', 'chooseVoice', 'replyVoice', 'replyText', 'qzoneDraft', 'qzonePublish', 'shareVideo', 'openCreative'] },
      file: { type: 'string', description: 'look/listen：本地图片或音视频文件绝对路径。全部在当前电脑处理。' },
      voice: { type: 'string', description: 'voices里返回的音色id。' },
      speed: { type: 'number', description: '语速0.8到1.2。' },
      text: { type: 'string', description: '说说正文或分享附言。公开说说只写你自己的日常感受，不公开用户的私人事实、聊天原话、日记、账号或行程。' },
      id: { type: 'string', description: '说说草稿id。' },
      confirm: { type: 'boolean', description: '用户已明确确认发表这条草稿。' },
      url: { type: 'string', description: '要分享的抖音视频链接。' },
      reason: { type: 'string', description: '你为什么喜欢、为什么想分享这个视频。' },
      platform: { type: 'string', enum: CREATIVE_PLATFORMS.map((p) => p.id) },
    } },
    output: { schema: { type: 'object', additionalProperties: true, required: ['ok', 'text'], properties: { ok: { type: 'boolean' }, text: { type: 'string' } } }, render: (_args, value) => [{ type: 'text', text: value.text }] },
    async execute(args) {
      try {
        switch (args.action) {
          case 'time': return { ok: true, text: clockBlock() }
          case 'look': { const result = await understandImage(String(args.file || '')); return { ...result, text: result.text || result.error } }
          case 'listen': return { ok: true, text: await transcribeAudio(String(args.file || '')) }
          case 'status': return { ok: true, text: JSON.stringify({ time: clockBlock(), perception: await perceptionStatus(), social: socialState() }) }
          case 'voices': return { ok: true, text: `全部在本机离线合成，当前常用：${perceptionConfig().voice || '还没选，你可以自己决定'}。\n${VOICES.map((v) => `${v.id}：${v.label}`).join('\n')}` }
          case 'chooseVoice': {
            const voice = VOICES.find((v) => v.id === args.voice)
            if (!voice) return { ok: false, text: '先从 voices 返回的音色里选择。' }
            setSettings({ perception: { ...(getSettings().perception || {}), voice: voice.id } })
            return { ok: true, text: `常用音色已选择：${voice.label}。可以逐渐形成习惯，也可以在确有新偏好时再换。` }
          }
          case 'replyVoice':
            if (entry.scene?.type !== 'qq') return { ok: false, text: '当前不在QQ聊天，这轮请直接用文字回答。' }
            entry.replyVoice = { voice: args.voice, speed: args.speed }
            entry.replyText = false
            return { ok: true, text: '本轮最终回答将自动合成为QQ语音。现在正常写出你要说的完整回复，不需要标记或重复发送。' }
          case 'replyText': entry.replyText = true; entry.replyVoice = null; return { ok: true, text: '本轮只发送文字。' }
          case 'qzoneDraft': {
            const draft = makePostDraft(args.text)
            return { ok: true, text: `空间说说草稿已保存：${draft.id}\n${draft.text}\n这是草稿，尚未发表。` }
          }
          case 'qzonePublish': {
            const shout = getSettings().qq?.shout || {}
            if (args.confirm !== true && !(shout.enabled && shout.mode === 'qzone' && shout.autoPublish)) return { ok: false, text: '草稿已保留。需要用户明确确认这条内容，或在QQ面板开启允许自动发表空间说说。' }
            const result = await publishQzone(args.id, qqId())
            return { ...result, text: result.ok ? `已在空间动态中确认发表：${result.text}\n${result.url}` : result.error }
          }
          case 'shareVideo': {
            const share = saveShare({ url: args.url, comment: args.text, reason: args.reason })
            return { ok: true, text: `想分享的视频已保存。她的独立抖音号尚未配置，当前未发送；账号准备好后再绑定主人的会话。${share.url}` }
          }
          case 'openCreative': {
            const platform = CREATIVE_PLATFORMS.find((p) => p.id === args.platform)
            if (!platform) return { ok: false, text: '请从已接入的创作平台中选择。' }
            const result = await act('newtab', { url: platform.url })
            return { ...result, text: `${result.text}\n接着用browser read/inspect确认当前页面与登录态，按用户需求生图或视频；完成后用download取回真实文件。` }
          }
          default: return { ok: false, text: '不支持的操作。' }
        }
      } catch (error) { return { ok: false, text: error.message } }
    },
  })
}
