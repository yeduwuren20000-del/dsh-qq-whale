/** User delivery instructions take precedence over the model's default habits. */
export function replyPreference(input) {
  const text = String(input || '')
  if (/别发语音|不要(?:发)?语音|不用(?:发)?语音|不方便听|别说话/.test(text)) return 'text'
  if (/用语音|发(?:一?(?:条|个|段))?语音|语音(?:回复|回我|说|讲|呢|给我)|我的语音|读给我听|念给我听|别(?:打字|发文字)|不要(?:发)?文字/.test(text)) return 'voice'
  if (/(?:只|用|发)文字|文字(?:回复|就行)/.test(text)) return 'text'
  return 'auto'
}

export function speechChunks(text, limit = 180) {
  let rest = String(text || '').trim()
  const out = []
  while (rest.length > limit) {
    let cut = Math.max(...['。', '！', '？', '\n', '，', ' '].map((mark) => rest.lastIndexOf(mark, limit - 1)))
    cut = cut >= limit / 3 ? cut + 1 : limit
    out.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim()
  }
  if (rest) out.push(rest)
  return out
}

/** Successful speech has no preceding duplicate text; only unsent content falls back. */
export async function deliverQQReply({ text, voicePlan, voiceEnabled = true, song }, { synthesize, sendRecord, sendText }) {
  if (song?.ok) return { channel: 'song', sent: song.sent || 0 }
  if (!voicePlan || !voiceEnabled) { await sendText(text); return { channel: 'text', sent: 1 } }
  const chunks = speechChunks(text)
  let sent = 0
  try {
    for (const chunk of chunks) {
      const audio = await synthesize(chunk, voicePlan)
      if (await sendRecord(audio.file) === false) throw new Error('QQ 语音未发送成功')
      sent++
    }
    return { channel: 'voice', sent }
  } catch (error) {
    const remaining = chunks.slice(sent).join('')
    const notice = sent ? '后面的语音暂时没发出去，剩下的用文字补上：' : '语音暂时没发成功，我先用文字回复：'
    await sendText(notice + remaining)
    return { channel: 'fallback', sent, error: String(error?.message || error) }
  }
}
