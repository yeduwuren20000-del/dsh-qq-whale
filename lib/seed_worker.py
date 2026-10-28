"""Local singing conversion using official Seed-VC's F0-conditioned 44.1k model."""
from pathlib import Path
import argparse, os, sys, json, tempfile, time, struct, importlib.util

def convert(args):
    output = Path(args.output).resolve(); output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='whale-seed-code-', dir=output.parent) as temporary:
        return convert_runtime(args, Path(temporary))

def convert_runtime(args, compatibility):
    repo, models = Path(args.repo).resolve(), Path(args.models).resolve()
    source_file, reference_file = Path(args.source).resolve(), Path(args.reference).resolve()
    assert source_file.is_file() and reference_file.is_file(), 'Source or voice reference is missing'
    output = Path(args.output).resolve()
    sys.path.insert(0, str(repo)); os.chdir(repo)
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    os.environ['TOKENIZERS_PARALLELISM'] = 'false'
    import torch, torchaudio, soundfile as sf, numpy as np, yaml
    torch.set_num_threads(1)
    def save(file, audio, sample_rate, **kwargs):
        sf.write(file, audio.detach().float().cpu().numpy().T, sample_rate, subtype='PCM_16')
    torchaudio.save = save
    # Inference only uses Whisper's encoder. Loading the decoder first can
    # exhaust Windows commit while DSH and other work remain open.
    from transformers import WhisperModel, WhisperConfig
    from transformers.models.whisper.modeling_whisper import WhisperEncoder
    class EncoderOnly(torch.nn.Module):
        def __init__(self, folder):
            super().__init__()
            self.encoder = WhisperEncoder(WhisperConfig.from_pretrained(folder, local_files_only=True)).half().eval()
            self.decoder = torch.nn.Identity()
            file = Path(folder) / 'model.safetensors'
            with file.open('rb') as stream:
                header_size = struct.unpack('<Q', stream.read(8))[0]
                assert 0 < header_size <= 16 * 1024 * 1024
                header = json.loads(stream.read(header_size))
                expected = self.encoder.state_dict(); loaded = set()
                for name, info in header.items():
                    name = name.removeprefix('model.')
                    if not name.startswith('encoder.'): continue
                    key = name[len('encoder.'):]
                    assert key in expected and list(expected[key].shape) == info['shape']
                    dtype = {'F32': torch.float32, 'F16': torch.float16, 'BF16': torch.bfloat16}[info['dtype']]
                    start, end = info['data_offsets']
                    assert 0 <= start < end <= file.stat().st_size - 8 - header_size
                    stream.seek(8 + header_size + start)
                    data = bytearray(stream.read(end - start)); assert len(data) == end - start
                    tensor = torch.frombuffer(data, dtype=dtype).reshape(info['shape'])
                    with torch.no_grad(): expected[key].copy_(tensor)
                    loaded.add(key)
                assert loaded == set(expected), 'Whisper encoder weights are incomplete: ' + str(sorted(set(expected) - loaded)[:8])
        def _mask_input_features(self, features, attention_mask=None): return features
    WhisperModel.from_pretrained = classmethod(lambda cls, folder, **kwargs: EncoderOnly(folder))
    # Bound acoustic chunks on 8GB Windows GPUs. Use a temporary compatibility
    # copy, retaining upstream overlap/crossfade; never edit the installed repo.
    original = (repo / 'inference.py').read_text(encoding='utf-8')
    window = 'max_context_window = sr // hop_length * 30'
    reference_limit = 'ref_audio[:sr * 25]'
    assert original.count(window) == 1 and original.count(reference_limit) == 1, 'Unsupported Seed-VC inference layout'
    adapted = original.replace(window, 'max_context_window = sr // hop_length * 18').replace(reference_limit, 'ref_audio[:sr * 10]')
    module_file = compatibility / 'inference.py'; module_file.write_text(adapted, encoding='utf-8')
    spec = importlib.util.spec_from_file_location('whale_seed_inference', module_file)
    inference = importlib.util.module_from_spec(spec); spec.loader.exec_module(inference)
    skipped = {}
    def checked_checkpoint(model, optimizer, path, **kwargs):
        state = torch.load(path, map_location='cpu', weights_only=True)['net']
        for name, module in model.items():
            supplied = {key.removeprefix('module.'): value for key, value in state[name].items()}
            required = dict(module.named_parameters())
            missing = [key for key, value in required.items() if key not in supplied or supplied[key].shape != value.shape]
            assert not missing, 'Singing checkpoint/config mismatch: ' + str(missing[:8])
            current = module.state_dict()
            selected = {key: value for key, value in supplied.items() if key in current and current[key].shape == value.shape}
            skipped[name] = [key for key in supplied if key not in selected]
            module.load_state_dict(selected, strict=False, assign=True); module.eval()
        return model, optimizer, 0, 0
    inference.load_checkpoint = checked_checkpoint
    def local_asset(repo_id, model_filename='pytorch_model.bin', config_filename=None):
        folder = (models / repo_id.replace('/', '--')).resolve()
        assert folder.is_relative_to(models)
        file = (folder / model_filename).resolve()
        assert file.is_relative_to(folder) and file.is_file(), 'Missing local model: ' + model_filename
        if config_filename:
            config = folder / config_filename
            assert config.is_file()
            return str(file), str(config)
        return str(file)
    inference.load_custom_model_from_hf = local_asset
    model_folder = models / 'Plachta--Seed-VC'
    config = yaml.safe_load((model_folder / 'config_dit_mel_seed_uvit_whisper_base_f0_44k.yml').read_text())
    config['model_params']['vocoder']['name'] = str(models / 'nvidia--bigvgan_v2_44khz_128band_512x')
    config['model_params']['speech_tokenizer']['name'] = str(models / 'openai--whisper-small')
    output.parent.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix='whale-seed-', dir=output.parent) as temporary:
        temp = Path(temporary)
        cfg = temp / 'singing.yml'; cfg.write_text(yaml.safe_dump(config))
        options = argparse.Namespace(source=str(source_file), target=str(reference_file), output=str(temp),
            checkpoint=str(model_folder / 'DiT_seed_v2_uvit_whisper_base_f0_44k_bigvgan_pruned_ft_ema_v2.pth'), config=str(cfg),
            diffusion_steps=max(30, min(50, args.steps)), length_adjust=1.0, inference_cfg_rate=0.7,
            f0_condition=True, auto_f0_adjust=False, semi_tone_shift=args.pitch, fp16=True)
        with torch.inference_mode(): inference.main(options)
        files = list(temp.glob('vc_*.wav'))
        assert len(files) == 1, 'Singing engine produced no unique result'
        audio, rate = sf.read(files[0], dtype='float32', always_2d=True)
        assert rate == 44100 and len(audio) and np.isfinite(audio).all(), 'Invalid singing output'
        source = sf.info(source_file)
        duration = len(audio) / rate
        assert abs(duration - source.duration) < max(0.5, source.duration * .01), 'Singing timeline changed'
        peak = float(np.max(np.abs(audio)))
        if peak > .98: audio *= .98 / peak
        staged = output.with_name(output.name + '.tmp.wav')
        sf.write(staged, audio, rate, subtype='PCM_16'); os.replace(staged, output)
    return {'file': str(output), 'sampleRate': rate, 'duration': duration, 'seconds': time.perf_counter() - started,
        'pitch': args.pitch, 'autoPitch': False, 'steps': options.diffusion_steps, 'peak': peak, 'unusedCheckpointKeys': skipped,
        'gpuPeakMb': torch.cuda.max_memory_allocated() / 2**20 if torch.cuda.is_available() else 0}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ['repo', 'models', 'source', 'reference', 'output']: parser.add_argument('--' + name, required=True)
    parser.add_argument('--steps', type=int, default=30); parser.add_argument('--pitch', type=int, default=0)
    result = convert(parser.parse_args()); print(json.dumps(result, ensure_ascii=False), flush=True)
