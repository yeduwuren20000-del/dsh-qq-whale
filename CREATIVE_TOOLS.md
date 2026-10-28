# 创作工具与低用量个性方案

查询与验证日期：2026-10-28。优先使用本机确定性工具，模型只负责理解要求、选择素材和给出简短参数；没有逐帧模型调用或新增常驻反思模型。

| 项目 | 本版接入 | 适合什么 | 准备方式 |
| --- | --- | --- | --- |
| [FFmpeg](https://github.com/FFmpeg/FFmpeg) | mediaEdit | 精确裁剪、批量片段拼接、变速、无损快剪、字幕、配乐、音轨 | 工具准备选择“本地剪辑”，也可复用自己配置的 FFmpeg |
| [Auto-Editor](https://github.com/WyattBlue/auto-editor) | mediaEdit autoCut，固定31.7.2 | 口播、讲课等素材按音量去静音，先做粗剪 | 工具准备选择“自动视频粗剪”，官方Windows包约45MB并校验SHA256；缺少剪辑组件时一并准备 |
| [Anime.js](https://github.com/juliangarnier/anime) | animation，固定4.5.0 | HTML/SVG/Canvas动画、分镜字幕卡、片头与网页转MP4 | MIT动画引擎随插件离线提供；HTML播放不需联网，视频导出复用浏览器与剪辑组件 |

Auto-Editor的去静音依据音量，不等同于理解内容或自动挑出精彩镜头。FFmpeg无损快剪受关键帧限制，需要帧级准确时选精确裁剪。所有操作保留源文件，成品验证后才交付。

其他已评估项目：[LosslessCut](https://github.com/mifi/lossless-cut)适合人工检查无损快剪；[Motion Canvas](https://github.com/motion-canvas/motion-canvas)适合较复杂的程序化讲解动画；[Remotion](https://github.com/remotion-dev/remotion)适合React视频工程，有自己的授权条件。本版选择依赖较少的FFmpeg、Auto-Editor与Anime.js链路；其他项目没有伪装成已经安装的能力。

## 怎样使用

可以直接对大肥鱼说：“把这个视频的静音剪掉，留一点喘气的间隔”“把第3到8秒、第15到20秒接起来”“做一段三个分镜的HTML动画，再导出MP4”。模型通过toolAccess按需启用mediaEdit或animation，普通聊天不携带这些工具的完整参数。

- mediaEdit autoCut：file素材绝对路径；threshold默认-35dB；margin默认0.2秒。相同素材路径、大小、修改时间与参数复用已验证的成品。
- mediaEdit cutList：clips为[{start,duration}]，一次最多24段；一个本地进程处理并拼接，避免一段一轮工具交互。
- animation html/render：给scenes分镜数组，每段{title,text,duration}，无需重写页面。最多12段、60秒；导出最多900帧，默认15fps。
- animation guide：复杂HTML动画先读这个简短指南，再自行写本地HTML；用renderHTML传file导出。HTML定义window.whaleDuration与window.whaleSeek(seconds)，工具注入离线Anime.js。浏览器导出使用全新无登录档案的上下文，阻止网络和外部文件请求；素材用内联SVG或data图片。
- 成品用handover交付。导出结果会按HTML内容、画幅和帧率缓存；下载或交付失败时保留已有成品，不重复生成。

## 个性与用量

参考[Letta的持久身份记忆](https://github.com/letta-ai/letta-code)与[Mem0的相关记忆检索](https://github.com/mem0ai/mem0)思路，复用插件已有本地存储；没有引入第二套Agent服务或云端记忆账户，也不使用上游宣传的节省比例当成本插件的实测数据。

- 六维底卡维持身份和边界，成长认识补充实际相处习惯；每次请求动态读取，不依赖已经过时的提示词变量。
- 新增character.json，保存她自己选择的具体偏好，和用户事实分开。memory self用slot主题、text偏好、evidence理由写入。相同内容不重写，同主题12小时内不反复改，最多16项，当前仅注入相关的3项。
- 未形成看法时可以做一个诚实的主观选择，不能编造见闻。已有喜好持续影响音乐、视频、动画等选择；用户决定后照办，不把“有个性”变成反复争辩。
- 日常聊天不再强制“下一步”，减少通用助手话术和每轮写日记冲动；正式做事仍保留完整六维工作要求。
- 普通聊天仅携带toolAccess、memory、companion、handover四个入口。其余本地与宿主工具按需加载，用完卸载，其他DSH会话不受影响。
- 空成长记录不再插入占位说明，不每轮带入整套日记、文件交付规则和平台教程。旧记忆、日记、成长全文仍在原处保留。
- 以上变化不增加每轮模型调用。真实用量继续优先采用宿主返回，含重试和缓存；工具说明的字节下降不代表账单会按相同比例下降。

个性是否自然需要实际相处反馈；本版验证的是喜好能够稳定保存和参与下一轮上下文，而非宣称产生了人的意识。
