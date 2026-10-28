# 远端运行程序（高级、可选）

这些文件供自己的 Linux 服务器使用。插件默认不开启远端；普通用户仍可按初始化教程选择本机工具。发布包不提供作者的服务器或模型托管服务。

建议 Python 3.10、FFmpeg/ffprobe、支持 CUDA 的 PyTorch，以及数据盘上的独立虚拟环境。所有路径应放到自己的数据目录，避免修改已有 ComfyUI、Ollama 或其他公务环境。

部署目录约定：

```text
<root>/
  .whale-deployment-owner       # 自己创建，内容用自己的 UUID
  source/                      # 此目录里的 Python/MJS 文件
    plugin/lib/                # 插件的 lib/*.js
    plugin/assets/anime/       # 插件内 Anime.js
    plugin/node_modules/playwright-core/
  env/voice/                   # 自己的 Python 虚拟环境
  models/{cosy,seed,sensevoice,demucs,ollama}/
  profiles/voices/
  archive/
  jobs/
  tmp/
  cache/
  logs/runtime/
```

`source/package.json` 与 `source/plugin/package.json` 设为 `{"type":"module","private":true}`。剪辑任务复用 Python Playwright 包中 `playwright/driver/node`；`plugin/node_modules/playwright-core` 可指向其 `driver/package`，也可使用自行安装且验证过的 playwright-core。独立浏览器默认放在 `bin/chrome-headless-shell-linux64/chrome-headless-shell`。

语音环境需按上游项目准备依赖和模型。固定模型路径与调用参数可在 `audio_compute.py`、`cosy_runtime.py`、`seed_worker.py`、`ollama_job.py` 中核对。模型来源：[CosyVoice](https://github.com/FunAudioLLM/CosyVoice)、[Seed-VC](https://github.com/Plachtaa/seed-vc)、[SenseVoice](https://github.com/FunAudioLLM/SenseVoice)、[Demucs](https://github.com/adefossez/demucs)、[Ollama](https://github.com/ollama/ollama)。请遵守各自模型许可，使用自己的参考音色。

当前适配器使用 CosyVoice 3、Seed-VC 44.1k/F0、SenseVoice INT8 ONNX、HTDemucs safetensors、Ollama `qwen3-vl:2b` 与 `bge-m3:latest`。模型不在发布包中；必须从官方来源下载并独立校验，不要把模型或参考音频提交到仓库。

准备完成后先通过 SSH 标准输入调用 `resource_worker.py` 的 `status`、公开样例识图/语音任务，确认结束后没有自己的模型进程残留。全部准备好才写 `setup-status.json` 的 `stage` 为 `voice engines ready`。不要用这个标志代替实际测试。

默认限制为 12 GiB 自用空间，数据盘保留 110 GiB 空闲；公务 GPU 作业或内存压力出现时退出自己的计算。不同服务器应审查并调整程序中的资源阈值，不能直接假定适合所有机器。浏览器只监听本机回环地址，客户端经 SSH 隧道连接。

日志清理由 `log_maintenance.py` 执行，可通过自己的用户级 systemd timer 每小时运行。日志默认七天、20 MiB 总量，且不记录聊天正文。目录权限设为 0700，文件 0600；共享服务器管理员仍可能读取。

档案迁移需先调用 `state_snapshot`，再以 `state_commit` 提交白名单文件并校验 SHA256，保留原件直到新插件实际加载。QQ 连接 token、SSH 私钥与旧浏览器 Cookie 应留在本机连接配置，不作为聊天档案上传。详细行为见仓库根目录 REMOTE_SETUP.md。
