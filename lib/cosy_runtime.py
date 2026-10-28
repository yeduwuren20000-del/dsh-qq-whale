from pathlib import Path
import os,sys,time,hashlib,json,gc

class VoiceEngine:
 def __init__(self, repo, model, device='auto'):
  sys.path[:0]=[str(Path(repo)),str(Path(repo)/'third_party/Matcha-TTS')]
  os.environ.setdefault('TOKENIZERS_PARALLELISM','false')
  os.environ.setdefault('HF_HUB_OFFLINE','1')
  # CosyVoice 3 handles numbers itself. Disable optional download-on-import
  # frontends inside this dedicated worker; text is never sent to a service.
  sys.modules['wetext']=None
  import numpy as np,torch,torchaudio,soundfile as sf
  self.np,self.torch,self.sf=np,torch,sf
  def wav_load(file,*args,**kwargs):
   data,rate=sf.read(file,dtype='float32',always_2d=True);return torch.from_numpy(data.T.copy()),rate
  torchaudio.load=wav_load
  torch.set_num_threads(1)
  try:torch.set_num_interop_threads(1)
  except RuntimeError:pass
  if device=='cpu':os.environ['CUDA_VISIBLE_DEVICES']=''
  from cosyvoice.cli.cosyvoice import AutoModel
  self.started=time.perf_counter()
  self.model=AutoModel(model_dir=str(model),fp16=torch.cuda.is_available() and device!='cpu')
  self.tokenizer_path=str(Path(model)/'speech_tokenizer_v3.onnx')
  self.load_seconds=time.perf_counter()-self.started
  self.cache={}
 def synthesize(self,job):
  np,torch,sf=self.np,self.torch,self.sf
  text=str(job.get('text') or '').strip()
  if not text or len(text)>600:raise ValueError('Speech requires 1 to 600 characters')
  reference=Path(job['referenceFile']);transcript=str(job['referenceText'])
  if not reference.is_file() or reference.stat().st_size>12*1024*1024:raise ValueError('Invalid voice reference')
  data=reference.read_bytes();key=hashlib.sha256(data+transcript.encode()).hexdigest()
  cached=key in self.cache
  if not cached:
   base_id='voice-'+key[:20]
   if self.model.frontend.speech_tokenizer_session is None:
    import onnxruntime as ort
    settings=ort.SessionOptions();settings.intra_op_num_threads=1
    self.model.frontend.speech_tokenizer_session=ort.InferenceSession(self.tokenizer_path,sess_options=settings,providers=['CPUExecutionProvider'])
   try:
    self.model.add_zero_shot_spk('You are a helpful assistant.<|endofprompt|>'+transcript,str(reference),base_id)
   finally:
    # This large encoder is only needed when enrolling a reference. The
    # speaker features remain cached; retaining it can exhaust Windows commit.
    self.model.frontend.speech_tokenizer_session=None
    gc.collect()
   self.cache[key]={'base':base_id,'styles':{}}
  entry=self.cache[key]
  directions={'happy':'轻松开心，带一点笑意，不要夸张。','calm':'自然平静，像熟悉的朋友日常聊天，不要播音腔。','proud':'轻轻有点得意，但不要夸张。','tired':'稍微疲惫但清楚，语速略慢，不拖长每个字。','annoyed':'略有不满但克制，清楚表达，不迁怒。','worried':'关切认真，语气柔和而清楚。','curious':'带一点好奇，语气轻松自然。','开心':'轻松开心，带一点笑意，不要夸张。','撒娇':'亲近轻松，稍微俏皮，不要夹嗓子。','温柔':'温和自然，不要耳语。','兴奋':'开心有精神，不要尖叫。','疲惫':'稍微疲惫但清楚，语速略慢，不拖长每个字。','委屈':'有一点低落，克制自然，不要哭喊。','调侃':'轻松带笑，稍微俏皮。','认真':'认真稳重，表达清楚。'}
  direction=directions.get(str(job.get('mood') or ''),directions['calm'])
  speed=max(.8,min(1.2,float(job.get('speed') or 1)))
  instruction='You are a helpful assistant. 用普通话表达，'+direction+' 保持参考说话人的音色。<|endofprompt|>'
  if instruction not in entry['styles']:
   style_id=entry['base']+'-'+str(len(entry['styles']))
   tokens,length=self.model.frontend._extract_text_token(instruction)
   self.model.frontend.spk2info[style_id]={**self.model.frontend.spk2info[entry['base']],'prompt_text':tokens,'prompt_text_len':length}
   entry['styles'][instruction]=style_id
  torch.manual_seed(int(job.get('seed',42)));np.random.seed(int(job.get('seed',42)))
  if torch.cuda.is_available():torch.cuda.reset_peak_memory_stats()
  started=time.perf_counter();first=None;chunks=[]
  with torch.inference_mode():
   for chunk in self.model.inference_instruct2(text,instruction,str(reference),zero_shot_spk_id=entry['styles'][instruction],stream=speed==1, speed=speed, text_frontend=False):
    if first is None:first=time.perf_counter()-started
    chunks.append(chunk['tts_speech'].detach().float().cpu().numpy().reshape(-1))
  if not chunks:raise RuntimeError('No audio generated')
  audio=np.concatenate(chunks)
  if not len(audio) or not np.isfinite(audio).all():raise RuntimeError('Invalid generated audio')
  peak=float(np.max(np.abs(audio)));clipped=float(np.mean(np.abs(audio)>=.999))
  if peak>.98:audio*=.98/peak
  output=Path(job['file']);output.parent.mkdir(parents=True,exist_ok=True)
  temp=output.with_name(output.name+'.tmp.wav');sf.write(temp,audio,self.model.sample_rate,subtype='PCM_16');os.replace(temp,output)
  elapsed=time.perf_counter()-started;duration=len(audio)/self.model.sample_rate
  metrics={'file':str(output),'sampleRate':self.model.sample_rate,'duration':duration,'seconds':elapsed,'rtf':elapsed/duration,'firstAudio':first,'reference':key,'cacheHit':cached,'peak':peak,'clipFraction':clipped,'gpuPeakMb':torch.cuda.max_memory_allocated()/2**20 if torch.cuda.is_available() else 0}
  if job.get('measureSpeaker'):
   a=self.model.frontend._extract_spk_embedding(str(reference)).detach().float().cpu().numpy().reshape(-1)
   b=self.model.frontend._extract_spk_embedding(str(output)).detach().float().cpu().numpy().reshape(-1)
   metrics['speakerSimilarity']=float(np.dot(a,b)/(np.linalg.norm(a)*np.linalg.norm(b)))
  # Variable emotional deliveries create different CUDA workspaces. Release
  # unused allocations between messages on smaller Windows laptop GPUs.
  if torch.cuda.is_available():torch.cuda.empty_cache()
  return metrics
