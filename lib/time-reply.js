import { clockParts } from './clock.js'

/** Exact clock questions can be answered from the clock without model inference. */
export function timeReply(input, at = Date.now()) {
  let text = String(input || '').trim()
  const voice = /^\[用户语音转文字：([\s\S]*)\]$/.exec(text)
  if (voice) text = voice[1].trim()
  text = text.replace(/[，。！？?！\s]/g, '').replace(/^(?:大肥鱼|肥鱼|本鲸)[，,:：]?/, '')
  const p = clockParts(at)
  const days = { Monday: '一', Tuesday: '二', Wednesday: '三', Thursday: '四', Friday: '五', Saturday: '六', Sunday: '日' }
  if (/^(?:(?:你那边|你那里|你这边|北京|北京时间|现在|当前))*(?:现在)?(?:几点|几点了|什么时间|几点钟|几点钟了)(?:呀|啊|呢|吗)?$/.test(text)) return `本鲸这边也是北京时间，现在是 ${p.time}。`
  if (/^(?:今天|现在|当前)(?:是)?(?:几号|几月几号|什么日期|哪一天)(?:呀|啊|呢|吗)?$/.test(text)) return `今天是 ${p.date}，星期${days[p.weekday]}，按北京时间算。`
  if (/^今天(?:是)?(?:星期几|周几|礼拜几)(?:呀|啊|呢|吗)?$/.test(text)) return `今天星期${days[p.weekday]}，${p.date}。`
  return null
}
