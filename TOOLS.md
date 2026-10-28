# 可选工具清单

| 功能 | 工具 | 是否必须 | 准备方式 |
| --- | --- | --- | --- |
| 基础对话、性格、情绪、关键词记忆 | 使用者的 DSH 对话模型 | 必须有 DSH 对话模型 | 在 DSH 中配置 |
| QQ 扫码和消息桥 | [NapCat](https://github.com/NapNeko/NapCatQQ) + [QQ](https://im.qq.com/) | 用 QQ 时需要 | 工具准备中勾选，自动解包便携版 |
| 网页操作 | [Playwright](https://playwright.dev/) + [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/) | 用网站时需要 | 勾选后自动准备；已有浏览器可复用 |
| 图片、表情包理解 | [Ollama](https://ollama.com/) + [Qwen3-VL 2B](https://ollama.com/library/qwen3-vl) | 可选 | 勾选后下载到本机，模型约 2 GB |
| 语义记忆 | [BGE-M3](https://ollama.com/library/bge-m3) | 可选 | 勾选后通过本机 Ollama 下载，约 1.2 GB |
| QQ 语音识别 | [SenseVoice / sherpa-onnx](https://k2-fsa.github.io/sherpa/onnx/sense-voice/index.html) | 可选 | 自动准备独立 Python 与模型；INT8 模型约 240 MB，下载包可能更大 |
| QQ 语音合成 | [Kokoro / sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models) | 可选 | 自动准备独立 Python 与多音色中文模型 |
| 本地剪辑 | [FFmpeg Windows essentials](https://www.gyan.dev/ffmpeg/builds/) | 可选 | 自动解包，保留许可 |
| 图片生成 | [豆包](https://www.doubao.com/chat/)、[即梦](https://jimeng.jianying.com/ai-tool/home/)、[可灵](https://kling.ai/app/)、[通义万相](https://tongyi.aliyun.com/wan/) | 自选网站 | 平台登录中选择并登录 |
| 视频生成 | [即梦](https://jimeng.jianying.com/ai-tool/home/)、[可灵](https://kling.ai/app/)、[海螺](https://hailuoai.com/)、[Vidu](https://www.vidu.com/zh)、[通义万相](https://tongyi.aliyun.com/wan/) | 自选网站 | 根据当前账号可用入口操作 |
| 在线/客户端剪辑 | [剪映](https://www.capcut.cn/) | 可选 | 在线入口以实际页面为准，无入口时用客户端或 FFmpeg |

自动准备还会按需使用 [uv](https://github.com/astral-sh/uv) 下载隔离 Python；下载 QQ 时使用官方包内的 7-Zip 解包工具。插件不会自动创建付费账号或购买积分。QQ 与网站需要本人完成扫码、验证和账号授权。

首次下载需联网与足够磁盘空间。没有选择的模型不会下载；下载失败不影响已就绪工具。组件、模型和第三方素材的许可证随各工具保留，插件的 MIT 不替代上游许可。

### 可选唱歌与额外音色

- RVC：使用自己的声模与兼容 infer.cli 的 Python 环境（需支持目录输入/输出），在 settings.sing 中设置 localRepo、localPython、localModel、localFfmpeg。它不属于默认下载项，不内置作者的模型。
- Demucs：在独立 Python 环境安装人声分离工具，并设置 settings.sing.separatorPython。只对人声换声，再混回原伴奏。
- Breeze-TTS-2：需要支持 /v1/voices 参考音色接口的本地版本，在设置中指定安装目录与模型。参考音色只存在本机数据目录；情绪改变语气、节奏与力度，不随机更换说话人。
- 远程训练与推理：仅使用使用者明确配置的服务器，不预置作者服务器。夜间训练脚本、账号及素材不随插件发布。
