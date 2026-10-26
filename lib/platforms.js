/**
 * 常用平台入口表。
 *
 * 大肥鱼不认得「小红书」的 DOM，但它不需要认得——它需要知道「发布入口在哪一页」。
 * 这张表就是给它的地图：进哪个网址、点哪个入口、这个平台有什么脾气。
 * 网址写错的代价是它在一个不存在的页面上瞎点，所以这里只收有把握的。
 */

import { CREATIVE_PLATFORMS } from './creative-platforms.js'
export const PLATFORMS = [
  ...CREATIVE_PLATFORMS.map((p) => ({ ...p, accepts: p.capabilities, note: `${p.note} 用户要求创作后使用已有额度；不自动购买充值。结果生成后用browser download取回真实图片或视频，再交付。` })),
  {
    id: 'douyin',
    name: '抖音',
    url: 'https://creator.douyin.com/',
    entry: '创作者中心 → 发布视频（左侧「发布作品」）',
    accepts: '视频',
    note: '上传后要等转码；标题/话题/封面都要填。发布键在右下，点了就发出去了。',
  },
  {
    id: 'xiaohongshu',
    name: '小红书',
    url: 'https://creator.xiaohongshu.com/',
    entry: '创作服务平台 → 发布笔记（图片或视频二选一）',
    accepts: '图文 / 视频',
    note: '图文最多 18 张图；标题 20 字、正文 1000 字；话题用 # 加。审核比抖音严，搬运和硬广容易被限流。',
  },
  {
    id: 'bilibili',
    name: 'B站',
    url: 'https://member.bilibili.com/platform/upload/video/frame',
    entry: '创作中心 → 投稿 → 视频投稿',
    accepts: '视频',
    note: '要选分区和标签，封面单独传。分P和多标题格式别弄混。',
  },
  {
    id: 'weixin-mp',
    name: '公众号',
    url: 'https://mp.weixin.qq.com/',
    entry: '内容与互动 → 草稿箱 → 新的创作 → 图文消息',
    accepts: '图文',
    note: '必须登录态；编辑器是富文本 iframe，优先用「导入 Word/粘贴 Markdown」而不是逐字敲。群发一天一次，别拿它测试。',
  },
  {
    id: 'channels',
    name: '视频号',
    url: 'https://channels.weixin.qq.com/',
    entry: '视频号助手 → 内容管理 → 发表动态',
    accepts: '视频',
    note: '要微信扫码；发布后进入审核。',
  },
  {
    id: 'weibo',
    name: '微博',
    url: 'https://weibo.com/',
    entry: '首页输入框直接发；长文走「头条文章」',
    accepts: '图文 / 视频',
    note: '140 字上限已放开但超长会折叠；带链接容易限流。',
  },
  {
    id: 'zhihu',
    name: '知乎',
    url: 'https://zhuanlan.zhihu.com/write',
    entry: '写文章',
    accepts: '图文',
    note: '编辑器是 Draft.js，逐字敲很慢；优先用 Markdown 导入或粘贴。',
  },
  {
    id: 'kuaishou',
    name: '快手',
    url: 'https://cp.kuaishou.com/',
    entry: '创作者服务平台 → 发布作品',
    accepts: '视频',
    note: '与抖音类似，审核偏严；新号前几条内容风险最高。',
  },
  {
    id: 'qqmail',
    name: 'QQ 邮箱',
    url: 'https://mail.qq.com/',
    entry: '写信',
    accepts: '邮件',
    note: '群发容易进垃圾箱；给单个人发最稳。',
  },
]

const BY_ID = new Map(PLATFORMS.map((row) => [row.id, row]))

export function getPlatform(id) {
  return BY_ID.get(String(id || ''))
}

/** 从一句话里认出平台（模型通常已经说了，这里用于提示与兜底）。 */
export function detectPlatform(text) {
  const value = String(text || '')
  for (const row of PLATFORMS) {
    if (value.includes(row.name)) return row
  }
  if (/b站|哔哩|bilibili/i.test(value)) return getPlatform('bilibili')
  if (/公众号|微信公众/.test(value)) return getPlatform('weixin-mp')
  if (/小红书|红书|xhs/i.test(value)) return getPlatform('xiaohongshu')
  return undefined
}

/** 干活模式里附在提示词后面的地图。 */
export function buildPlatformBlock() {
  const rows = PLATFORMS.map(
    (row) => `- ${row.name}：${row.url}\n  入口：${row.entry}；可发：${row.accepts}。${row.note}`,
  )
  return [
    '常用平台入口（要动手时先看这张表，别自己猜网址）：',
    ...rows,
    '',
    '发布流程：打开入口 → 确认登录态 → 上传 → 填标题/正文/话题 → 按用户授权发布。创作流程：打开豆包/即梦 → 确认登录、参数和额度 → 填提示词/上传参考图 → 生成 → 等真实结果 → 下载原文件 → 交付；生成不等于对外发布。',
  ].join('\n')
}
