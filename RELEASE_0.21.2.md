# 大肥鱼 0.21.2

语音换了个新嗓子：原来用 Kokoro，现在改用 Breeze-TTS-2（本机显卡 Vulkan 合成）。

- 音色从固定编号改成可描述：俏皮清亮、温柔轻软、元气活泼、安静沉稳、清朗少年，她能按场景自己选，也能按描述微调语气和语速。
- 说中文顺耳多了：实测同一句里「B 站」「蓝白鲸」这类词不再念错，英文回读一字不差。
- 速度：语音服务热着的时候两秒内出声；第一次用要加载约 3.4GB 模型，冷启动大约半分钟。十五分钟没人说话会释放显卡显存，下次再加载。
- 要独立显卡（Vulkan）。没有显卡会自动退到纯 CPU，但那样慢到不实用，等于没有语音。

怎么装语音后端：从 https://github.com/HoppouAI/Breeze-TTS-2.cpp/releases 下载 Windows Vulkan 包、从 https://huggingface.co/HoppouAI/Breeze-TTS-2.cpp 下载 `breeze-tts-2-q8_0.gguf`（约 3.4GB），放进插件的 `runtime/breeze` 目录，或在高级设置里填已安装目录。程序不会自动下载，因为体积大且要选对显卡版本。语音文字只在本机处理，不传到外部；上游权重是 BreezeBlue Research and Non-Commercial License，仅限个人研究与非商业使用。

听写没动，还是 SenseVoice。旧的 Kokoro 模型和代码已移除，升级后第一次用语音会走上面这套新后端。

本次保留所有聊天、人格、记忆、账号及已有工作。升级后需要重新加载插件（或重启 DSH）才生效；聊天记录、网站登录和 QQ 登录都不受影响。
