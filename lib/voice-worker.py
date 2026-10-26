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
TTS = None


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
    global ASR, TTS
    import sherpa_onnx
    if job["action"] == "asr":
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
        if TTS is None:
            model = ROOT / "kokoro-multi-lang-v1_0"
            kokoro = sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=str(model / "model.onnx"), voices=str(model / "voices.bin"),
                tokens=str(model / "tokens.txt"), data_dir=str(model / "espeak-ng-data"),
                lexicon=",".join(str(model / n) for n in ["lexicon-us-en.txt", "lexicon-zh.txt"]),
                dict_dir=str(model / "dict"),
            )
            config = sherpa_onnx.OfflineTtsConfig(
                model=sherpa_onnx.OfflineTtsModelConfig(kokoro=kokoro, num_threads=4, provider="cpu"),
                rule_fsts=",".join(str(model / n) for n in ["date-zh.fst", "number-zh.fst", "phone-zh.fst"]),
                max_num_sentences=2,
            )
            TTS = sherpa_onnx.OfflineTts(config)
        audio = TTS.generate(job["text"], sid=int(job.get("sid", 47)), speed=float(job.get("speed", 1)))
        import numpy as np
        with wave.open(job["file"], "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(audio.sample_rate)
            out.writeframes((np.clip(audio.samples, -1, 1) * 32767).astype("<i2").tobytes())
        return {"file": job["file"], "sampleRate": audio.sample_rate}
    raise ValueError("未知的语音动作")


for line in sys.stdin:
    job = {}
    try:
        job = json.loads(line)
        with contextlib.redirect_stdout(sys.stderr):
            result = run(job)
        print(json.dumps({"id": job["id"], "ok": True, **result}, ensure_ascii=False), flush=True)
    except Exception as error:
        print(json.dumps({"id": job.get("id"), "ok": False, "error": str(error)}, ensure_ascii=False), flush=True)
