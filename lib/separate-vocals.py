"""Local music separation. No media or text is uploaded to a service."""
import argparse
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('input')
    parser.add_argument('output')
    parser.add_argument('--device', default='auto')
    args = parser.parse_args()
    import numpy as np
    import soundfile as sf
    import torch
    from demucs.pretrained import get_model
    from demucs.apply import apply_model
    from demucs.audio import convert_audio
    device = ('cuda' if torch.cuda.is_available() else 'cpu') if args.device == 'auto' else args.device
    model = get_model('htdemucs').eval()
    audio, sr = sf.read(args.input, dtype='float32', always_2d=True)
    wav = convert_audio(torch.from_numpy(audio.T.copy()), sr, model.samplerate, model.audio_channels)
    reference = wav.mean(0)
    mean, std = reference.mean(), reference.std().clamp_min(1e-8)
    with torch.inference_mode():
        sources = apply_model(model, ((wav - mean) / std)[None], device=device, split=True, segment=5, overlap=.25, shifts=1, progress=False)[0].cpu() * std
    index = model.sources.index('vocals')
    vocals = sources[index]
    accompaniment = sources.sum(0) - vocals + mean
    out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
    for name, data in [('vocals', vocals), ('instrumental', accompaniment)]:
        array = data.numpy().T
        if not np.isfinite(array).all(): raise RuntimeError('Nonfinite separated audio')
        sf.write(str(out / (name + '.wav')), array, model.samplerate, subtype='FLOAT')
    print(str(out / 'vocals.wav'))

if __name__ == '__main__': main()
