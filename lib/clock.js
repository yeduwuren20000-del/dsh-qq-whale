/** All companion calendar decisions use the user's Beijing timezone. */
export const TIME_ZONE = 'Asia/Shanghai'
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'long',
})

export function clockParts(at = Date.now()) {
  const p = Object.fromEntries(formatter.formatToParts(new Date(at)).map(({ type, value }) => [type, value]))
  return { ...p, date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}`, hourNumber: Number(p.hour) }
}

export function dayKey(at = Date.now()) { return clockParts(at).date }
export function localTime(at = Date.now()) { return clockParts(at).time }
export function localHour(at = Date.now()) { return clockParts(at).hourNumber }
export function clockBlock(at = Date.now()) {
  const p = clockParts(at)
  const weekdays = { Monday: '一', Tuesday: '二', Wednesday: '三', Thursday: '四', Friday: '五', Saturday: '六', Sunday: '日' }
  const phase = p.hourNumber < 6 ? '凌晨' : p.hourNumber < 11 ? '上午' : p.hourNumber < 14 ? '中午' : p.hourNumber < 18 ? '下午' : '晚上'
  return `当前真实时间：${p.date} ${p.time}，星期${weekdays[p.weekday]}，${phase}，北京时间（Asia/Shanghai，UTC+08:00）。\n这是本次请求的实时校时快照，覆盖之前所有时间快照。今天、明天、早晚、作息和日记均以此为准；旧对话、日记和工具结果中的时间不代表现在。涉及当前时间必须读取这条快照，不能声称自己还停留在昨晚。`
}
