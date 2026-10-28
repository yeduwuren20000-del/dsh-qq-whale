# 可选语音与唱歌

基础插件不包含大型模型、个人音色和训练素材。图片与语音默认只在本机处理；调试服务器不会自动成为日常媒体后端。

| 用途 | 方案 | 准备方式 |
|---|---|---|
| 听 QQ 语音 | SenseVoice INT8 / sherpa-onnx | 在工具准备选择听写，自动准备独立环境 |
| 日常说话 | [Breeze-TTS-2](https://github.com/HoppouAI/Breeze-TTS-2.cpp) | 单独安装 Windows Vulkan 程序与 GGUF 模型，约3.4GB；需支持参考音色接口 |
| 细腻语气 | [CosyVoice 3](https://github.com/QwenAudio/CosyVoice) | 官方 Fun-CosyVoice3-0.5B-2512 模型，约5GB；单独 Python 环境，运行依赖按官方说明安装 |
| 参考音色唱歌 | [Seed-VC](https://github.com/Plachtaa/seed-vc) | 44.1k、F0 条件模型及 Whisper-small、BigVGAN、RMVPE、CAMPPlus，合计约2.3GB；单独环境 |
| 自己训练的唱歌音色 | [RVC](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI) | 自备兼容模型及支持目录输入输出的 infer.cli 环境 |
| 分离人声与伴奏 | [Demucs](https://github.com/facebookresearch/demucs) | 独立环境安装 htdemucs，再设置分离环境路径 |

Breeze 日常响应较快；CosyVoice 的语气选择更多，但在笔记本上可能等待较久。QQ 面板可以选择说话方案。首次试听建立本机固定参考；情绪改变表达，继续复用同一音色。

Seed-VC 只转换已分离的人声，保留旋律，默认不自动改变整曲音高。内部缩小处理窗口并沿用上游交叠拼接，降低显存和 Windows 内存峰值。缺少权重、配置不匹配或分离失败时直接报错，不把原曲伴奏送入换声。

高级配置使用本机档案 store.json 的 settings 分组；先退出 DSH 并备份文件，再填自己的绝对路径，勿复制作者机器路径或服务器账号。不要删除其他分组：

```json
{
  "perception": { "ttsBackend": "breeze", "voice": "breeze-lazy" },
  "cosyVoice": { "python": "你的独立环境的python.exe", "repo": "CosyVoice源码目录", "model": "Fun-CosyVoice3模型目录" },
  "seedVoice": { "python": "你的独立环境的python.exe", "repo": "Seed-VC源码目录", "models": "唱歌模型根目录", "steps": 30 },
  "sing": { "engine": "seed-vc", "backend": "local", "separatorPython": "分离环境的python.exe", "localFfmpeg": "ffmpeg.exe的绝对路径" }
}
```

Seed-VC 模型根目录下使用这五个子目录：`Plachta--Seed-VC`、`lj1995--VoiceConversionWebUI`、`funasr--campplus`、`nvidia--bigvgan_v2_44khz_128band_512x`、`openai--whisper-small`。主模型文件为 `DiT_seed_v2_uvit_whisper_base_f0_44k_bigvgan_pruned_ft_ema_v2.pth`，配套配置 `config_dit_mel_seed_uvit_whisper_base_f0_44k.yml`。其他目录放官方对应权重和配置。CosyVoice 使用官方完整目录结构。安装各项目官方依赖，避免覆盖现有语音识别环境。

本次验证使用 CosyVoice 源码 074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc、Seed-VC 源码 51383efd921027683c89e5348211d93ff12ac2a8。兼容层会核对训练参数和编码器权重，不静默忽略缺失参数。新版本上游若改变入口布局，需要重新验证。

资源规划：仅聊天与网页操作不要求独立显卡。加本地语音和唱歌建议16GB系统内存起、32GB更稳，GPU模型按需轮流运行；8GB显卡需控制任务并发。耗时和音质受机器、参考音色与源歌曲影响，试听后选择适合的方案。Breeze权重及各工具分别遵守上游许可；不把插件MIT许可视为模型许可。
