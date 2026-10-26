"""Offline speech worker. Only local paths and newline-delimited JSON are used."""
import contextlib
import json
import os
import sys
import wave
from pathlib import Path

ROOT = Path(sys.argv[1])
os.chdir(ROOT)
ROOT = Path('.')
ASR = None


def load_audio(file):
    import av
    import numpy as np
    with av.open(file) as container:
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=16000)
        chunks = []
        for frame in container.decode(audio=0):
            chunks.extend(f.to_ndarray().reshape(-1) for f in resampler.resample(frame))
        chunks.extend(f.to_ndarray().reshape(-1) for f in resampler.resample(None))
    samples = np.concatenate(chunks) if chunks else np.array([], dtype=np.float32)
    if len(samples) > 16000 * 180:
        raise ValueError("语音超过3分钟，请分段发送")
    return samples


def run(job):
    global ASR
    if job["action"] == "asr":
        import sherpa_onnx
        if ASR is None:
            model = ROOT / "sensevoice"
            ASR = sherpa_onnx.OfflineRecognizer.from_sense_voice(
                model=str(model / "model.int8.onnx"), tokens=str(model / "tokens.txt"),
                num_threads=4, provider="cpu", use_itn=True,
            )
        stream = ASR.create_stream()
        stream.accept_waveform(16000, load_audio(job["file"]))
        ASR.decode_stream(stream)
        text = stream.result.text.strip()
        if not text:
            raise ValueError("没有听清这条语音")
        return {"text": text}
    if job["action"] == "tts":
        return synthesize(job)
    raise ValueError("未知的语音动作")


def synthesize(job):
    """把文字交给本机 Breeze-TTS-2 服务合成，存成单声道 16bit WAV。"""
    import json as _json
    import urllib.request

    base = str(job.get("breezeUrl") or "").rstrip("/")
    if not base:
        raise ValueError("本地语音后端没有启动")
    payload = {"model": "breeze-tts-2", "input": str(job["text"])}
    instruction = job.get("instruction")
    if instruction:
        payload["instruction"] = str(instruction)
    if job.get("cfgScale"):
        payload["cfg_scale"] = float(job["cfgScale"])
    request = urllib.request.Request(
        base + "/v1/audio/speech",
        data=_json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        pcm = response.read()
        rate = int(response.headers.get("X-Sample-Rate") or 24000)
    if not pcm:
        raise ValueError("语音后端没有返回音频")
    with wave.open(job["file"], "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(pcm)
    return {"file": job["file"], "sampleRate": rate}


for line in sys.stdin:
    job = {}
    try:
        job = json.loads(line)
        with contextlib.redirect_stdout(sys.stderr):
            result = run(job)
        print(json.dumps({"id": job["id"], "ok": True, **result}, ensure_ascii=False), flush=True)
    except Exception as error:
        print(json.dumps({"id": job.get("id"), "ok": False, "error": str(error)}, ensure_ascii=False), flush=True)
