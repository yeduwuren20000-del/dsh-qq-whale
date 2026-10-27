import { clockBlock } from './clock.js'
import { VOICES, perceptionConfig, perceptionStatus, transcribeAudio, understandImage } from './perception.js'
import { getSettings, setSettings } from './store.js'
import { listQzoneFeeds, likeQzoneFeed, listQzoneComments, makePostDraft, publishQzone, replyConfig, replyQuota, replyQzoneComment, saveShare, socialState } from './social.js'
import { biliLoginState, likeVideo } from './bili-like.js'
import { act } from './browser.js'
import { CREATIVE_PLATFORMS } from './creative-platforms.js'
import { MUSIC_PLATFORMS, lyricMusic, musicStatus, resolveMusic, searchMusic, streamUrl } from './music.js'
import { IMAGE_PLATFORMS, drawImage, imageStatus } from './imagegen.js'
import { singSong } from './sing.js'
import { nextCourse, summarize as summarizeCourses, todayCourses, tomorrowCourses } from './schedule.js'

export function registerCompanionTools(ctx, { entry, qqId }) {
  const tools = ctx.get?.('tools') || ctx.tools
  if (!tools?.register) return
  tools.register({
    name: 'companion',
    description: '大肥鱼自己的状态、声音和社交。time读取实时北京时间。look在本机理解图片或动图；listen在本机转写音频或视频中的声音。voices列出本地音色；chooseVoice由你自己选常用音色；replyVoice决定本轮用语音回QQ（不用传正文，最终回答会合成为语音），replyText决定本轮只回文字。draw自己画一张图（本地 ComfyUI 或网页版即梦/豆包，prompt 写你要的画面；画完用 handover 发出去）。qzoneDraft写一条QQ空间说说草稿；qzonePublish发布草稿（用户开启自动发表或明确确认后）；spaceComments读空间里别人给你说说的评论；replyComment回复评论（每天有次数上限，超了会拒绝）；spaceFeeds列自己的说说和feedKey；likePost给一条空间说说点赞（oper=0取消）；likeVideo给B站视频点赞（bvid=BV号）。shareVideo存一条想分享给主人的抖音视频，独立账号尚未配置时如实保留待发。openCreative打开已接入的创作平台开始用户要求的图片或视频任务，后续用browser操作和download交付。musicSearch搜歌（网易云/酷我/酷狗/B站/QQ等）；musicPlay拿歌的播放地址；musicStatus看音乐引擎在不在。sing用你自己的声模（3080Ti 上训练的那个女声）唱一首歌：song 传歌名，她自己搜原曲、换声、几分钟内出成品，再用 handover 发到 QQ。schedule查课表：今天、明天有什么课，下一节课是哪节在哪。',
    parameters: { type: 'object', additionalProperties: false, required: ['action'], properties: {
      action: { type: 'string', enum: ['time', 'status', 'look', 'listen', 'voices', 'chooseVoice', 'replyVoice', 'replyText', 'draw', 'sing', 'qzoneDraft', 'qzonePublish', 'spaceComments', 'replyComment', 'spaceFeeds', 'likePost', 'likeVideo', 'shareVideo', 'openCreative', 'musicSearch', 'musicPlay', 'musicLyric', 'musicStatus', 'schedule'] },
      file: { type: 'string', description: 'look/listen：本地图片或音视频文件绝对路径。全部在当前电脑处理。' },
      voice: { type: 'string', description: 'voices里返回的音色id。' },
      speed: { type: 'number', description: '语速0.8到1.2。' },
      mood: { type: 'string', enum: ['开心', '撒娇', '温柔', '兴奋', '疲惫', '委屈', '调侃', '认真'], description: '本轮语音的情绪基调，会改变声音的轻重缓急和语气，不传就是平常语气。' },
      text: { type: 'string', description: '说说正文或分享附言。公开说说只写你自己的日常感受，不公开用户的私人事实、聊天原话、日记、账号或行程。' },
      id: { type: 'string', description: '说说草稿id。' },
      commentId: { type: 'string', description: 'spaceComments 返回的评论 id。' },
      postId: { type: 'string', description: 'spaceComments 返回的说说 id（回复评论时用）。' },
      confirm: { type: 'boolean', description: '用户已明确确认发表这条草稿。' },
      url: { type: 'string', description: '要分享的抖音视频链接。' },
      reason: { type: 'string', description: '你为什么喜欢、为什么想分享这个视频。' },
      platform: { type: 'string', enum: CREATIVE_PLATFORMS.map((p) => p.id) },
      keyword: { type: 'string', description: 'musicSearch：歌名或歌手，例如「晴天 周杰伦」。' },
      musicPlatform: { type: 'string', enum: MUSIC_PLATFORMS, description: 'musicSearch/musicPlay/musicLyric 的平台，默认网易云。' },
      songId: { type: 'string', description: 'musicSearch 返回的歌曲 id。' },
      songName: { type: 'string', description: '歌曲名（展示用，可选）。' },
      artists: { type: 'string', description: '歌手名（展示用，可选）。' },
      feedKey: { type: 'string', description: 'spaceFeeds 返回的说说 feedKey，likePost 用。' },
      ownerUin: { type: 'string', description: '说说主人的 QQ 号，默认是你自己的。' },
      bvid: { type: 'string', description: 'B 站视频号（BV 开头），likeVideo 用。' },
      like: { type: 'boolean', description: 'likeVideo：true 点赞（默认），false 取消赞。' },
      imagePlatform: { type: 'string', enum: IMAGE_PLATFORMS, description: 'draw：画图后端。comfyui=本地（默认，没启动会自动换即梦）；jimeng=网页版即梦；doubao=网页版豆包。' },
      prompt: { type: 'string', description: 'draw：画面描述（中文也行），越具体越好。' },
      song: { type: 'string', description: 'sing：要唱的歌名，可带歌手（如「See You Again」「晴天 周杰伦」）。' },
    } },
    output: { schema: { type: 'object', additionalProperties: true, required: ['ok', 'text'], properties: { ok: { type: 'boolean' }, text: { type: 'string' } } }, render: (_args, value) => [{ type: 'text', text: value.text }] },
    async execute(args) {
      try {
        switch (args.action) {
          case 'time': return { ok: true, text: clockBlock() }
          case 'schedule': {
            const today = todayCourses()
            const tomorrow = tomorrowCourses()
            const next = nextCourse()
            const parts = [summarizeCourses(today, '今天'), summarizeCourses(tomorrow, '明天')]
            if (next) {
              const when = next.dayOffset === 0 ? '今天' : `还有 ${next.dayOffset} 天`
              parts.push(`${when}下一节：${next.course.period} ${next.course.name}${next.course.location ? ` @${next.course.location}` : ''}${next.course.note ? `（${next.course.note}）` : ''}`)
            }
            return { ok: true, text: parts.join('\n') }
          }
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
            entry.replyVoice = { voice: args.voice, speed: args.speed, mood: args.mood }
            entry.replyText = false
            return { ok: true, text: '本轮最终回答将自动合成为QQ语音。现在正常写出你要说的完整回复，不需要标记或重复发送。' }
          case 'replyText': entry.replyText = true; entry.replyVoice = null; return { ok: true, text: '本轮只发送文字。' }
          case 'draw': {
            const result = await drawImage(String(args.prompt || args.text || ''), { platform: args.imagePlatform || 'comfyui' })
            return { ok: true, file: result.file, text: `画好了：${result.file}\n（${result.platform}）要给主人看就用 handover 发这个文件，QQ 会收到。` }
          }
          case 'sing': {
            const result = await singSong(String(args.song || args.keyword || ''))
            return { ok: true, file: result.file, text: `唱好了：《${result.song.name}》— ${result.song.artists}，用了 ${result.seconds} 秒。\n录好的文件：${result.file}\n用 handover 发这个文件，主人就能在 QQ 里听到。` }
          }
          case 'qzoneDraft': {
            const draft = makePostDraft(args.text)
            return { ok: true, text: `空间说说草稿已保存：${draft.id}\n${draft.text}\n这是草稿，尚未发表。` }
          }
          case 'spaceComments': {
            const listed = await listQzoneComments(qqId())
            if (!listed.ok) return { ok: false, text: listed.error || '读取空间评论失败' }
            const cfg = listed.config || replyConfig()
            const lines = listed.comments.map((c) => `[${c.commentId}] ${c.name || c.uin}：「${c.text}」${c.postText ? `（说说是：${c.postText}）` : ''}`)
            return {
              ok: true,
              text: `自动回复${cfg.enabled ? '开着' : '关着'}，今天还能回 ${listed.quota}/${cfg.maxPerDay} 条。\n${lines.length ? lines.join('\n') : '最近没有别人留的新评论。'}`,
            }
          }
          case 'replyComment': {
            const result = await replyQzoneComment({ postId: String(args.postId || ''), commentId: String(args.commentId || ''), text: args.text }, qqId())
            return { ...result, text: result.ok ? `已回复空间评论：「${args.text}」；今天还剩 ${result.quota} 条额度。` : result.error }
          }
          case 'spaceFeeds': {
            const listed = await listQzoneFeeds(qqId())
            if (!listed.ok) return { ok: false, text: listed.error || '读取空间说说失败' }
            const lines = listed.feeds.map((f) => `${f.liked ? '已赞' : '未赞'} · ${f.likes}赞 · [key ${f.key}] ${f.text || '（无文字）'}`)
            return { ok: true, text: lines.length ? `你空间最近 ${lines.length} 条说说：\n${lines.join('\n')}\n想点赞就用 likePost 带上 feedKey。` : '空间里还没有说说。' }
          }
          case 'likePost': {
            const result = await likeQzoneFeed({ feedKey: String(args.feedKey || ''), ownerUin: String(args.ownerUin || qqId()), oper: Number(args.like) === 0 ? 0 : 1 }, qqId())
            return { ...result, text: result.ok ? `空间说说已${result.oper}` : result.error }
          }
          case 'likeVideo': {
            const state = biliLoginState()
            if (!state.logged) return { ok: false, text: 'B 站还没登录，点赞前先在平台登录面板扫码登录一次 B 站。' }
            const result = await likeVideo({ bvid: String(args.bvid || ''), like: args.like !== false })
            return { ...result, text: result.text || result.error }
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
          case 'musicStatus': {
            const status = await musicStatus()
            return { ok: true, text: `本机音乐引擎在跑：${status.engine}；可用平台 ${status.platforms.join('/')}。` }
          }
          case 'musicSearch': {
            const keyword = String(args.keyword || args.text || '').trim()
            const found = await searchMusic(keyword, { platform: args.musicPlatform })
            if (!found.songs.length) return { ok: false, text: `「${keyword}」在${found.platform}没搜到，换个关键词或平台试试。` }
            const lines = found.songs.map((song, i) => `${i + 1}. ${song.name} — ${song.artists}${song.album ? `（${song.album}）` : ''}  [id ${song.id}]`)
            return { ok: true, text: `「${keyword}」在${found.platform}找到：\n${lines.join('\n')}\n想放哪首就用 musicPlay 带上 songId。` }
          }
          case 'musicPlay': {
            const id = String(args.songId || '').trim()
            if (!id) return { ok: false, text: '先用 musicSearch 拿到歌曲 id。' }
            const platform = MUSIC_PLATFORMS.includes(args.musicPlatform) ? args.musicPlatform : 'netease'
            const resolved = await resolveMusic(platform, id)
            if (!resolved.url) return { ok: false, text: '这首歌暂时拿不到音源，换一首或换平台试试。' }
            const title = args.songName ? `${args.songName}${args.artists ? ` - ${args.artists}` : ''}` : `歌曲 ${id}`
            return { ok: true, text: `能放：${title}\n在本机播放地址：${streamUrl(platform, id)}\n音源 ${resolved.source}，码率 ${Math.round(resolved.br / 1000)}kbps。这个链接适合在电脑上点开播；QQ 聊天里发不了在线播放，只能说一句“去听”。` }
          }
          case 'musicLyric': {
            const platform = MUSIC_PLATFORMS.includes(args.musicPlatform) ? args.musicPlatform : 'netease'
            const id = String(args.songId || '').trim()
            if (!id) return { ok: false, text: '先用 musicSearch 拿到歌曲 id。' }
            const data = await lyricMusic(platform, id, { name: args.songName, artist: args.artists })
            const parts = []
            if (data.lrc) parts.push(`歌词：\n${String(data.lrc).slice(0, 1200)}`)
            if (data.tlyric) parts.push(`翻译：\n${String(data.tlyric).slice(0, 600)}`)
            return { ok: true, text: parts.length ? parts.join('\n\n') : '这首歌没拿到歌词。' }
          }
          default: return { ok: false, text: '不支持的操作。' }
        }
      } catch (error) { return { ok: false, text: error.message } }
    },
  })
}
