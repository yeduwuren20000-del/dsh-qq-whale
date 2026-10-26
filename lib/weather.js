/**
 * 天气接口（Open-Meteo，免 key、免登录，CORS 友好）。
 *
 * 两个步骤：
 *   1) 地理编码：城市名 → 经纬度（geocoding-api.open-meteo.com）
 *   2) 预报：经纬度 → 当前 + 未来几天的温度/天气码/风力（api.open-meteo.com）
 *
 * 天气码是 WMO 标准码，要自己映射成中文 + 图标，否则模型也看不懂那个数字。
 *
 * 设计取舍：
 * - 默认用全局 fetch（宿主是 Node≥18，自带）。但所有取数都走一个可注入的 `get`，
 *   这样单测可以塞假响应，不真联网。
 * - 取不到（城市拼错、没网、接口挂）一律优雅降级：返回 ok:false + 人话错误，
 *   让 fish 照着说「查不到」，而不是崩。
 */
import { dataDir } from './store.js'

const GEO = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST = 'https://api.open-meteo.com/v1/forecast'

// WMO 天气码 → 中文 + 图标。覆盖 Open-Meteo 会用到的全部码。
const WMO = {
  0: ['晴', '☀️'],
  1: ['晴间多云', '🌤️'],
  2: ['多云', '⛅'],
  3: ['阴', '☁️'],
  45: ['雾', '🌫️'],
  48: ['雾凇', '🌫️'],
  51: ['小毛毛雨', '🌦️'],
  53: ['毛毛雨', '🌦️'],
  55: ['大毛毛雨', '🌦️'],
  56: ['冻毛毛雨', '🌧️'],
  57: ['冻毛毛雨', '🌧️'],
  61: ['小雨', '🌧️'],
  63: ['中雨', '🌧️'],
  65: ['大雨', '🌧️'],
  66: ['冻雨', '🌧️'],
  67: ['冻雨', '🌧️'],
  71: ['小雪', '🌨️'],
  73: ['中雪', '🌨️'],
  75: ['大雪', '🌨️'],
  77: ['雪粒', '🌨️'],
  80: ['阵雨', '🌦️'],
  81: ['阵雨', '🌧️'],
  82: ['强阵雨', '🌧️'],
  85: ['阵雪', '🌨️'],
  86: ['强阵雪', '🌨️'],
  95: ['雷阵雨', '⛈️'],
  96: ['雷阵雨伴冰雹', '⛈️'],
  99: ['强雷暴伴冰雹', '⛈️'],
}

function wmo(code) {
  return WMO[code] || ['未知', '❓']
}

// 浏览器 UA：Open-Meteo 不挑 UA，但统一带一个，方便以后换源。
const UA = 'Mozilla/5.0 (compatible; dsh-mentor/1.0; +weather)'

/** 默认取数：全局 fetch + 12s 超时 + UA。返回 { ok, status, json(), text() } 这种最小契约。 */
async function defaultGet(url, { timeout = 12000 } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ctrl.signal })
    return {
      ok: res.ok,
      status: res.status,
      async json() {
        return res.json()
      },
      async text() {
        return res.text()
      },
    }
  } finally {
    clearTimeout(timer)
  }
}

/** 城市名 → { lat, lon, name, admin1, country }，找不到返回 null。 */
export async function geocode(city, { get = defaultGet } = {}) {
  const q = encodeURIComponent(String(city || '').trim())
  if (!q) return null
  const url = `${GEO}?name=${q}&count=1&language=zh&format=json`
  let body
  try {
    const res = await get(url)
    if (!res.ok) return null
    body = await res.json()
  } catch {
    return null
  }
  const r = body?.results?.[0]
  if (!r) return null
  return {
    lat: r.latitude,
    lon: r.longitude,
    name: r.name,
    admin1: r.admin1 || '',
    country: r.country || '',
  }
}

/**
 * 取天气。city 是城市名（先地理编码），days 是预报天数（1-7）。
 * 返回 { ok, city, current, daily[], text }，失败 { ok:false, error }。
 */
export async function fetchWeather(city, { days = 1, get = defaultGet } = {}) {
  const place = await geocode(city, { get })
  if (!place) return { ok: false, error: `没找到「${city}」这个地方的天气，换个写法试试（比如「北京」「上海」「Hangzhou」）。` }
  const d = Math.min(7, Math.max(1, Number(days) || 1))
  const url =
    `${FORECAST}?latitude=${place.lat}&longitude=${place.lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
    `&timezone=auto&forecast_days=${d}`
  let body
  try {
    const res = await get(url)
    if (!res.ok) return { ok: false, error: `天气接口没响应（状态码 ${res.status}），一会儿再试。` }
    body = await res.json()
  } catch {
    return { ok: false, error: '联网查天气失败，检查一下网络，或者一会儿再问我。' }
  }
  const cur = body?.current
  if (!cur) return { ok: false, error: '天气数据缺当前这一项，接口可能变了，跟开发说一声。' }

  const [curText, curIcon] = wmo(cur.weather_code)
  const current = {
    time: cur.time,
    temp: Math.round(cur.temperature_2m),
    feels: Math.round(cur.apparent_temperature),
    humidity: cur.relative_humidity_2m,
    wind: Math.round(cur.wind_speed_10m),
    code: cur.weather_code,
    text: curText,
    icon: curIcon,
  }

  const daily = []
  const times = body?.daily?.time || []
  const codes = body?.daily?.weather_code || []
  const maxs = body?.daily?.temperature_2m_max || []
  const mins = body?.daily?.temperature_2m_min || []
  for (let i = 0; i < times.length; i += 1) {
    const [t, ic] = wmo(codes[i])
    daily.push({
      date: times[i],
      code: codes[i],
      text: t,
      icon: ic,
      max: Math.round(maxs[i]),
      min: Math.round(mins[i]),
    })
  }

  return { ok: true, city: place, current, daily, text: buildText(place, current, daily) }
}

function buildText(place, cur, daily) {
  const where = [place.name, place.admin1, place.country].filter(Boolean).join('·')
  const lines = [`${where} 现在 ${cur.icon} ${cur.text}，${cur.temp}℃（体感 ${cur.feels}℃），湿度 ${cur.humidity}%，风 ${cur.wind} km/h。`]
  if (daily.length > 1) {
    lines.push('未来几天：')
    for (const x of daily.slice(1, 4)) {
      lines.push(`- ${x.date}: ${x.icon} ${x.text}，${x.min}~${x.max}℃`)
    }
  }
  // 一句实用建议：雨/雷提醒带伞，冷提醒添衣，热/晴提醒防晒。
  let tip = ''
  if ([61, 63, 65, 80, 81, 82, 95, 96, 99].includes(cur.code)) tip = '今天有雨，出门带伞。'
  else if (cur.temp <= 5) tip = '挺冷的，多穿点。'
  else if (cur.temp >= 32) tip = '挺热，注意防晒补水。'
  else if (cur.code === 0 || cur.code === 1) tip = '天气不错，适合出门走走。'
  if (tip) lines.push(tip)
  return lines.join('\n')
}

export { WMO }
