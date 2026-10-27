#!/bin/bash
# 用法: sing-remote.sh <输入音频> <输出音频> <模型路径> <python> <repo> <pitch>
# 分段跑 RVC，避免 12G 显存整曲推理 OOM。
set -e
IN="$1"; OUT="$2"; MODEL="$3"; PY="$4"; REPO="$5"; PITCH="${6:-0}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export PYTHONPATH="$REPO"
cd "$REPO"

"$PY" - "$IN" "$TMP" <<'PYEOF'
import sys, os
import soundfile as sf
inp, outdir = sys.argv[1], sys.argv[2]
data, sr = sf.read(inp, always_2d=True)
if data.shape[1] > 1:
    data = data.mean(axis=1, keepdims=True)
step = 30 * sr
for i in range(0, len(data), step):
    sf.write(os.path.join(outdir, f"seg-{i // step:03d}.wav"), data[i:i + step], sr)
PYEOF

for f in "$TMP"/seg-*.wav; do
  "$PY" -m infer.cli --model "$MODEL" --input "$f" --output "${f%.wav}-out.wav" --pitch "$PITCH" --f0-method rmvpe --index-rate 0.75 --protect 0.33 --format wav >/dev/null
done

"$PY" - "$TMP" "$OUT" <<'PYEOF'
import sys, glob, os
import numpy as np
import soundfile as sf
tmp, out = sys.argv[1], sys.argv[2]
files = sorted(glob.glob(os.path.join(tmp, "seg-*-out.wav")))
chunks, sr = [], 44100
for f in files:
    d, s = sf.read(f)
    sr = s
    chunks.append(d if d.ndim == 1 else d.mean(axis=1))
sf.write(out, np.concatenate(chunks), sr)
PYEOF
echo "done $(ls -l "$OUT" | awk '{print $5}')"
