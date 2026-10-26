/**
 * 接管抖音 / B站 / 小红书：用户贴分享链接时，去把内容「捞」回来，让大肥鱼能讨论/总结。
 *
 * 三个平台的难度天差地别：
 * - B站：有公开 JSON 接口（api.bilibili.com/x/web-interface/view），无需登录，能稳定拿到
 *   标题/UP主/时长/播放量/简介/封面。最香。
 * - 抖音 / 小红书：强反爬，纯 fetch 拿不到正文（要么跳登录、要么返回空壳 HTML）。
 *   这种情况我们 best-effort 抠一下 <meta property="og:title"> 这类分享标签，
 *   抠不到就老实说「抓不到正文，你把文字贴给我」，绝不编数据。
 *
 * 所有取数走可注入的 `get`（默认全局 fetch + 浏览器 UA + 12s 超时），方便单测塞假响应。
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

async function defaultGet(url, { timeout = 12000, headers = {} } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/json,*/*', referer: url, ...headers },
      signal: ctrl.signal,
      redirect: 'follow',
    })
    return {
      ok: res.ok,
      status: res.status,
      finalUrl: res.url,
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

/** 认平台：返回 'bilibili' | 'douyin' | 'xiaohongshu' | null。 */
export function detectPlatform(url) {
  const s = String(url || '').toLowerCase()
  if (!/^https?:\/\//.test(s)) return null
  if (s.includes('bilibili.com') || s.includes('b23.tv')) return 'bilibili'
  if (s.includes('douyin.com') || s.includes('v.douyin.com') || s.includes('iesdouyin')) return 'douyin'
  if (s.includes('xiaohongshu.com') || s.includes('xhslink.com')) return 'xiaohongshu'
  return null
}

function extractBvid(url) {
  const s = String(url || '')
  const m = s.match(/BV[0-9A-Za-z]+/)
  if (m) return m[0]
  // b23.tv 短链：fetch 会跟随重定向，finalUrl 里通常有 BV 号。
  return null
}

function fmtDur(sec) {
  sec = Number(sec) || 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h) return `${h}时${m}分`
  if (m) return `${m}分${s}秒`
  return `${s}秒`
}

function fmtCount(n) {
  n = Number(n) || 0
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`
  return String(n)
}

const PLATFORM_CN = { bilibili: 'B站', douyin: '抖音', xiaohongshu: '小红书' }

function pickOg(html) {
  const get = (prop) => {
    const m = html.match(new RegExp(`<meta[^>]+(property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i')) ||
      html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(property|name)=["']${prop}["']`, 'i'))
    return m ? m[2] : null
  }
  const title = get('og:title') || get('title') || null
  const desc = get('og:description') || get('description') || null
  const author = get('og:author') || get('author') || null
  return { title, desc, author }
}

async function fetchBilibili(url, get, cookies) {
  const cookie = cookies?.bilibili || ''
  let bvid = extractBvid(url)
  let resolved = url
  if (!bvid) {
    // 短链：先跟随重定向拿到真实地址。
    try {
      const r = await get(url)
      resolved = r.finalUrl || url
      bvid = extractBvid(resolved)
    } catch {
      /* ignore */
    }
  }
  if (!bvid) return { ok: false, platform: 'bilibili', error: '没从链接里认出 BV 号，确认是不是 B站 视频链接？' }

  const api = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`
  let body
  try {
    const r = await get(api, { headers: { referer: 'https://www.bilibili.com', ...(cookie ? { Cookie: cookie } : {}) } })
    if (!r.ok) return { ok: false, platform: 'bilibili', error: `B站接口没响应（${r.status}）。` }
    body = await r.json()
  } catch {
    return { ok: false, platform: 'bilibili', error: '联网查 B站 失败了，检查一下网络。' }
  }
  if (body?.code !== 0 || !body?.data) {
    return { ok: false, platform: 'bilibili', error: body?.message ? `B站说：${body.message}` : 'B站返回了空数据，视频可能下架或需登录。' }
  }
  const d = body.data
  const stat = d.stat || {}
  return {
    ok: true,
    platform: 'bilibili',
    url: resolved,
    title: d.title,
    author: d.owner?.name,
    desc: d.desc && d.desc !== '-' ? d.desc : '',
    meta: {
      bvid: d.bvid,
      duration: fmtDur(d.duration),
      pubdate: d.pubdate ? new Date(d.pubdate * 1000).toISOString().slice(0, 10) : '',
      views: fmtCount(stat.view),
      likes: fmtCount(stat.like),
      coins: fmtCount(stat.coin),
      favorites: fmtCount(stat.favorite),
      danmaku: fmtCount(stat.danmaku),
      pic: d.pic,
    },
    bestEffort: false,
    text: buildText('bilibili', {
      title: d.title,
      author: d.owner?.name,
      desc: d.desc && d.desc !== '-' ? d.desc : '',
      meta: {
        duration: fmtDur(d.duration),
        pubdate: d.pubdate ? new Date(d.pubdate * 1000).toISOString().slice(0, 10) : '',
        views: fmtCount(stat.view),
        likes: fmtCount(stat.like),
      },
    }),
  }
}

async function fetchBestEffort(platform, url, get, cookies) {
  const cookie = cookies?.[platform] || ''
  let html
  try {
    const r = await get(url, cookie ? { headers: { Cookie: cookie } } : {})
    if (!r.ok) return { ok: false, platform, error: `${PLATFORM_CN[platform]}链接打不开（${r.status}）。` }
    // 有些返回的是 JSON（例如 xhslink 短链重定向后是 JSON），优先试 JSON。
    try {
      const j = await r.json()
      const data = j?.data || j
      return {
        ok: true,
        platform,
        url: r.finalUrl || url,
        title: data?.title || data?.note_card?.title || null,
        author: data?.author?.nickname || data?.note_card?.user?.nickname || null,
        desc: data?.desc || data?.note_card?.desc || '',
        meta: {},
        bestEffort: true,
        text: buildText(platform, {
          title: data?.title || data?.note_card?.title,
          author: data?.author?.nickname || data?.note_card?.user?.nickname,
          desc: data?.desc || data?.note_card?.desc || '',
          meta: {},
        }),
      }
    } catch {
      html = await r.text()
    }
  } catch {
    return { ok: false, platform, error: `联网查 ${PLATFORM_CN[platform]} 失败了，检查一下网络。` }
  }
  const og = pickOg(html || '')
  const ok = !!(og.title || og.desc)
  return {
    ok,
    platform,
    url: url,
    title: og.title,
    author: og.author,
    desc: og.desc || '',
    meta: {},
    bestEffort: true,
    note: ok
      ? '这是尽力从分享标签里抠出来的；抖音/小红书把正文藏起来了，想要完整内容你把文字/要点贴给我。'
      : `这个 ${PLATFORM_CN[platform]} 链接我抓不到正文（被反爬挡了）。把文字/要点贴给我，我一样能帮你总结或讨论。`,
    text: buildText(platform, { title: og.title, author: og.author, desc: og.desc || '', meta: {}, fallback: !ok }),
  }
}

function buildText(platform, info) {
  const cn = PLATFORM_CN[platform] || platform
  const title = info?.title
  const author = info?.author
  const desc = info?.desc || ''
  const meta = info?.meta || {}
  if (!title && !author && !desc) {
    return `[${cn}] 没取到内容。`
  }
  const head = `【${cn}】${title || '（无标题）'}${author ? ` · ${author}` : ''}`
  const mid = []
  if (meta.duration) mid.push(`时长 ${meta.duration}`)
  if (meta.views) mid.push(`播放 ${meta.views}`)
  if (meta.likes) mid.push(`赞 ${meta.likes}`)
  if (meta.pubdate) mid.push(`发布 ${meta.pubdate}`)
  const body = desc ? `\n\n${desc.slice(0, 600)}${desc.length > 600 ? '…' : ''}` : ''
  return [head, mid.length ? `（${mid.join('，')}）` : '', body].filter(Boolean).join('')
}

/**
 * 入口：给一个链接，返回结构化内容。认不出平台或没给链接 → { ok:false, error }。
 * @param {string} url
 * @param {{ get?: Function, cookies?: { bilibili?: string, douyin?: string, xiaohongshu?: string } }} opts
 */
export async function fetchMedia(url, { get = defaultGet, cookies } = {}) {
  const platform = detectPlatform(url)
  if (!platform) {
    return { ok: false, error: '这不像抖音/B站/小红书的链接；目前只接管这三个平台。' }
  }
  if (platform === 'bilibili') return fetchBilibili(url, get, cookies)
  return fetchBestEffort(platform, url, get, cookies)
}
