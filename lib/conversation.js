/** Short, local turn cues. They guide this response and never become stored personality facts. */
export function buildConversationBlock(input, messages = [], now = Date.now()) {
  const clean = (value) => String(value || '')
    .replace(/\[(?:图片|表情包|视频)内容[\s\S]*/g, '')
    .replace(/[“「『"].*?[”」』"]/g, '')
  const current = clean(input)
  const resolved = /(?:已经|现在)(?:没事|不困|不累|不难过|不烦|好多|好些)|没事了|已经好了|好多了|不用担心我/.test(current)
  const recent = resolved ? [] : messages.filter((row) => row.role === 'user' && Number.isFinite(row.at) && now - row.at >= 0 && now - row.at <= 30 * 60000).slice(-3).map((row) => clean(row.text))
  const source = [...recent, current].join('\n').replace(/不(?:困|累|难过|委屈|烦躁|难受)|没(?:有)?(?:困|累|难过|委屈|烦躁|难受)/g, '')
  const lines = []
  if (/我.{0,5}(?:困|累)|困死|累死|好困|好累|^困[。！!\s]*$/.test(source)) {
    lines.push(/上课|上班|开会|考试|赶(?:作业|报告|进度)/.test(source)
      ? '用户说困或累，近期还提到上课或工作。结合他已经说明的安排回应，别一律催睡、替他决定旷课或放下正事。'
      : '用户说困或累，先自然接住，少追问、少连发；给建议时也尊重他自己的安排。')
  }
  if (/我.{0,5}(?:难过|委屈|烦躁|不开心)|烦死|很烦|心情不好|难受/.test(source)) lines.push('用户在表达难受或烦躁。先回应具体发生的事，暂时收起讨白饭和逗趣，不急着给一串方案，也不假称自己经历过同样的事。')
  if (/(?:你|刚才|之前).{0,18}(?:说错|算错|不对|弄错|乱说|错了)/.test(current)) lines.push('用户在纠正具体问题。先核对并修正事实，不把纠正当成关系变差，也别用撒娇或委屈来岔开。')
  return lines.length ? `本轮交流参考：\n${lines.join('\n')}\n这只是近期状态，不推断长期性格；用户的新说明优先。` : ''
}
