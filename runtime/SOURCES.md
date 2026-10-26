# 本机运行资源

- 视觉：Ollama `qwen3-vl:2b`，保存在本机Ollama模型库，来源 https://ollama.com/library/qwen3-vl:2b 。插件按需启动本机服务，接口仅允许回环地址。
- 识别：SenseVoiceSmall 的 sherpa-onnx INT8 版本，`models/sensevoice/model.int8.onnx` 与 `tokens.txt`；从已有公开预训练模型副本取回本机，没有向服务器传输聊天媒体。项目 https://github.com/QwenAudio/SenseVoice ，推理接口 https://k2-fsa.github.io/sherpa/onnx/sense-voice/index.html 。
- 合成：Breeze-TTS-2（GGUF 量化版 + Windows Vulkan 预编译服务），来源 https://github.com/HoppouAI/Breeze-TTS-2.cpp 与模型 https://huggingface.co/HoppouAI/Breeze-TTS-2.cpp ；程序包和模型放在 `runtime/breeze` 或设置里指定的目录，文字只在本机合成，不向外部发送。上游权重为 BreezeBlue Research and Non-Commercial License，仅限个人研究与非商业使用。
- 剪辑：FFmpeg Windows essentials，来源 https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip ，保留本目录LICENSE；上游 https://ffmpeg.org/ ，构建来源与源码链接 https://www.gyan.dev/ffmpeg/builds/ 。
- Python：本机已有Python环境，验证使用 sherpa-onnx 1.13.4、av 18.0.0、numpy 2.4.3。可配置绝对Python路径，未修改现有共享Python环境。

模型、可执行程序和第三方数据分别保留其上游许可；插件自身的MIT许可不替代这些许可。模型和工具在本机处理，网站创作只在用户要求的任务内按需向选定平台提交提示词及参考素材。
