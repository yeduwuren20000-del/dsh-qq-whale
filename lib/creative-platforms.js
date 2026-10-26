/** Verified official entrypoints; account features are checked on the live page. */
export const CREATIVE_PLATFORMS = [
  { id: 'doubao', name: '豆包', url: 'https://www.doubao.com/chat/', domain: '.doubao.com', capabilities: '图片生成、参考图创作', entry: '对话页的图片生成入口', note: '视频能力以当前账号实际入口为准。' },
  { id: 'jimeng', name: '即梦', url: 'https://jimeng.jianying.com/ai-tool/home/', domain: '.jianying.com', capabilities: '图片生成、文生视频、图生视频、智能画布', entry: '图片生成 / 视频生成 / 智能画布', note: '先查看可用积分、模型、比例、张数或时长，再开始生成。' },
  { id: 'kling', name: '可灵', url: 'https://kling.ai/app/', domain: '.kling.ai', capabilities: '图片与视频生成、参考创作', entry: 'Generate / Omni / Canvas', note: '原官方app.klingai.com现跳转此入口。按账号可用功能创作；中文站与全球站登录不保证互通。' },
  { id: 'hailuo', name: '海螺', url: 'https://hailuoai.com/', domain: '.hailuoai.com', capabilities: 'AI视频、参考图与视频创作', entry: '创作 / 我的', note: '等待真实成片完成，再从作品页面下载。' },
  { id: 'vidu', name: 'Vidu', url: 'https://www.vidu.com/zh', domain: '.vidu.com', capabilities: '文生视频、图生视频、参考生视频、AI视频编辑', entry: '创作 / 视频编辑', note: '支持以视频、参考图和提示词进行创作，按页面实际参数设置。' },
  { id: 'wan', name: '通义万相', url: 'https://tongyi.aliyun.com/wan/', domain: '.aliyun.com', capabilities: 'AI图像与视频生成', entry: '万相创作页面', note: '以当前账号界面为准；保存账号登录后再生成和下载。' },
  { id: 'capcut', name: '剪映', url: 'https://www.capcut.cn/', domain: '.capcut.cn', capabilities: '视频剪辑、字幕、配音、模板', entry: '官网可用的在线创作入口；如仅提供客户端，则使用本机剪映', note: '先检查当前网页是否提供在线编辑；没有就用本地mediaEdit完成常规剪辑。不要声称官网首页就是可操作的时间线。' },
]
