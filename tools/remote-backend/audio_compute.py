from pathlib import Path
import os,sys,json,base64,hashlib,logging,contextlib,subprocess,signal
ROOT=Path(__file__).resolve().parent.parent
assert (ROOT/'.whale-deployment-owner').is_file(), 'Deploy only inside an owned whale directory'
os.umask(0o077)
def interrupted(*_): raise InterruptedError('Media job stopped')
signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGHUP,interrupted)
input_file=Path(sys.argv[1]).resolve();assert input_file.is_relative_to(ROOT/'jobs')
folder=input_file.parent;job=json.loads(input_file.read_text());logging.disable(logging.CRITICAL)
sys.path.insert(0,str(ROOT/'source'))
def profile_file(job):
 import re
 voice_id=str(job.get('voiceId') or '')
 registry=ROOT/'profiles/voices';registry.mkdir(exist_ok=True,mode=0o700)
 metadata=registry/(voice_id+'.json') if re.fullmatch(r'[a-zA-Z0-9_-]{1,64}',voice_id) else None
 if job.get('referenceAudio'):
  reference=base64.b64decode(job['referenceAudio'],validate=True);assert 44<len(reference)<=12*1024*1024
  digest=hashlib.sha256(reference).hexdigest();assert digest==job['referenceSha256']
  transcript=str(job.get('referenceText') or '')[:2000]
  profile=ROOT/'profiles'/digest;profile.mkdir(exist_ok=True,mode=0o700)
  ref=profile/'reference.wav'
  if not ref.exists():
   temp=profile/'reference.tmp';temp.write_bytes(reference);os.replace(temp,ref)
  if metadata:
   temp=metadata.with_suffix('.tmp');temp.write_text(json.dumps({'sha256':digest,'text':transcript}));os.replace(temp,metadata)
 else:
  assert metadata and metadata.is_file(),'Fixed voice has not been enrolled on this server'
  saved=json.loads(metadata.read_text());digest=saved['sha256'];assert re.fullmatch(r'[a-f0-9]{64}',digest)
  ref=ROOT/'profiles'/digest/'reference.wav';transcript=saved['text']
 assert hashlib.sha256(ref.read_bytes()).hexdigest()==digest
 return ref,transcript

def input_audio(job):
 audio=base64.b64decode(job['sourceAudio'],validate=True);assert 0<len(audio)<=64*1024*1024
 source=folder/'source.audio';source.write_bytes(audio);return source

def separate(source):
 import torch,numpy as np,soundfile as sf,yaml
 from demucs.hf import load_safetensors_model
 from demucs.apply import apply_model,BagOfModels
 from demucs.audio import convert_audio
 torch.set_num_threads(2)
 meta=yaml.safe_load((ROOT/'models/demucs/htdemucs.yaml').read_text())
 nets=[load_safetensors_model(ROOT/'models/demucs'/(sig+'.safetensors')) for sig in meta['models']]
 model=BagOfModels(nets,meta.get('weights'),meta.get('segment')).eval()
 audio,rate=sf.read(source,dtype='float32',always_2d=True)
 assert len(audio)/rate<=600,'Music exceeds ten minutes'
 wav=convert_audio(torch.from_numpy(audio.T.copy()),rate,model.samplerate,model.audio_channels)
 reference=wav.mean(0);mean=reference.mean();std=reference.std().clamp_min(1e-8)
 with torch.inference_mode():sources=apply_model(model,((wav-mean)/std)[None],device='cuda',split=True,segment=5,overlap=.25,shifts=1,progress=False)[0].cpu()*std
 vocals=sources[model.sources.index('vocals')]
 # The residual is computed from the original waveform; it never enters SVC.
 accompaniment=wav-vocals
 for name,data in [('vocals',vocals),('instrumental',accompaniment)]:sf.write(folder/(name+'.wav'),data.numpy().T,model.samplerate,subtype='FLOAT')
 return folder/'vocals.wav',folder/'instrumental.wav'

def recognize(source):
 import av,numpy as np,sherpa_onnx
 chunks=[];resampler=av.AudioResampler(format='fltp',layout='mono',rate=16000)
 with av.open(source) as container:
  for frame in container.decode(audio=0):chunks.extend(f.to_ndarray().reshape(-1) for f in resampler.resample(frame))
  chunks.extend(f.to_ndarray().reshape(-1) for f in resampler.resample(None))
 samples=np.concatenate(chunks) if chunks else np.array([],dtype=np.float32)
 assert 0<len(samples)<=16000*180,'Voice must be within three minutes'
 model=ROOT/'models/sensevoice'
 engine=sherpa_onnx.OfflineRecognizer.from_sense_voice(model=str(model/'model.int8.onnx'),tokens=str(model/'tokens.txt'),num_threads=2,provider='cpu',use_itn=True)
 stream=engine.create_stream();stream.accept_waveform(16000,samples);engine.decode_stream(stream)
 text=stream.result.text.strip();assert text,'No speech recognized';return {'text':text}

output=folder/'result.wav'
with contextlib.redirect_stdout(sys.stderr):
 if job['action'] in ['edit','animation']:
  from edit_compute import run
  result=run(job,folder)
 elif job['action'] in ['vision','embed']:
  from ollama_job import run_ollama
  result=run_ollama(job,folder)
 elif job['action']=='asr':result=recognize(input_audio(job))
 elif job['action']=='tts':
  ref,transcript=profile_file(job)
  from cosy_runtime import VoiceEngine
  engine=VoiceEngine(ROOT/'source/cosy',ROOT/'models/cosy')
  result=engine.synthesize({'text':job['text'],'referenceFile':str(ref),'referenceText':transcript,'mood':job.get('mood'),'speed':job.get('speed',1),'file':str(output)})
 elif job['action'] in ['sing','song']:
  ref,_=profile_file(job);source=input_audio(job);instrumental=None
  if job['action']=='song':
   source,instrumental=separate(source)
   import gc,torch
   gc.collect();torch.cuda.empty_cache()
  from seed_worker import convert
  import argparse
  vocal=folder/'vocal-converted.wav' if instrumental else output
  result=convert(argparse.Namespace(repo=str(ROOT/'source/seed'),models=str(ROOT/'models/seed'),source=str(source),reference=str(ref),output=str(vocal),steps=30,pitch=int(job.get('pitch',0))))
  if instrumental:
   subprocess.run(['/usr/bin/ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y','-threads','2','-i',str(vocal),'-i',str(instrumental),'-filter_complex','[0:a]volume=1.0[v];[1:a]volume=0.8[b];[v][b]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]','-map','[a]','-ar','24000','-ac','1','-c:a','pcm_s16le',str(output)],check=True)
 else:raise ValueError('Unsupported media action')
if job['action'] in ['asr','vision','embed','edit','animation']:print(json.dumps(result,ensure_ascii=False),flush=True)
else:
 data=output.read_bytes();assert len(data)<=64*1024*1024
 print(json.dumps({'audio':base64.b64encode(data).decode(),'sha256':hashlib.sha256(data).hexdigest(),'metrics':result}),flush=True)
