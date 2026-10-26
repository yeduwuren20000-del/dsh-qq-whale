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
  return `当前真实时间：${p.date} ${p.time}，星期${weekdays[p.weekday]}，北京时间（Asia/Shanghai，UTC+08:00）。\n这条由宿主实时提供，每轮刷新。今天、明天、早晚、作息和日记均以此为准；历史消息里的日期不代表现在。`
}
