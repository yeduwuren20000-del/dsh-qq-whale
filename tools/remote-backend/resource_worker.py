"""One SSH request. No listening socket, no resident model, official work first."""
from pathlib import Path
import os,sys,json,time,subprocess,fcntl,signal,shutil,tempfile,base64
ROOT=Path(__file__).resolve().parent.parent
assert (ROOT/'.whale-deployment-owner').is_file(), 'Deploy only inside an owned whale directory'
from runtime_log import write_event
os.umask(0o077);os.nice(15)
def disconnected(signum, frame):raise InterruptedError('SSH request was interrupted')
for sig in [signal.SIGHUP,signal.SIGTERM,signal.SIGINT]:signal.signal(sig,disconnected)
def parent_death_signal():
 import ctypes
 ctypes.CDLL(None).prctl(1,signal.SIGTERM)
def memory_available():
 return int(next(x for x in Path('/proc/meminfo').read_text().splitlines() if x.startswith('MemAvailable:')).split()[1])*1024
def descendant(pid,parent):
 for _ in range(24):
  if pid==parent:return True
  if pid<=1:return False
  try:pid=int(next(x for x in Path('/proc/'+str(pid)+'/status').read_text().splitlines() if x.startswith('PPid:')).split()[1])
  except (FileNotFoundError,StopIteration,ValueError,ProcessLookupError):return False
 return False

def other_gpu_memory(group=None):
 rows=subprocess.check_output(['nvidia-smi','--query-compute-apps=pid,used_gpu_memory','--format=csv,noheader,nounits'],timeout=5).decode().splitlines()
 total=0
 for row in rows:
  try:
   pid,size=[int(x.strip()) for x in row.split(',')]
   if group is not None and (os.getpgid(pid)==group or descendant(pid,group)):continue
   total+=size
  except (ValueError,ProcessLookupError):continue
 return total
def stop_owned(child):
 if child.poll() is not None:return
 assert os.getpgid(child.pid)==child.pid
 os.killpg(child.pid,signal.SIGTERM)
 try:child.wait(timeout=4)
 except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
def run(job):
 action=job.get('action');assert action in ['tts','sing','song','asr','vision','embed','status','state_snapshot','state_commit','browser_start','browser_stop','browser_download','edit','animation','artifact_put','artifact_get','artifact_check','voice_check'],'Unsupported remote action'
 if action=='voice_check':
  import re,hashlib
  name=job.get('voiceId','');assert re.fullmatch('[a-zA-Z0-9_-]{1,64}',name)
  profile=json.loads((ROOT/'profiles/voices'/(name+'.json')).read_text());digest=profile['sha256'];assert re.fullmatch('[a-f0-9]{64}',digest)
  assert hashlib.sha256((ROOT/'profiles'/digest/'reference.wav').read_bytes()).hexdigest()==digest
  return {'sha256':digest}
 if action=='browser_download':
  from browser_host import receive_download
  return receive_download(job)
 if action in ['artifact_put','artifact_get','artifact_check']:
  from artifact_worker import handle
  return handle(job)
 if action in ['browser_start','browser_stop']:
  from browser_host import handle
  return handle(action)
 if action in ['state_snapshot','state_commit']:
  from state_worker import handle
  return handle(job)
 if action=='status':return {'ready':(ROOT/'setup-status.json').exists() and json.loads((ROOT/'setup-status.json').read_text())['stage']=='voice engines ready','availableRamGiB':round(memory_available()/2**30,2),'otherGpuMemoryMiB':other_gpu_memory(),'localDiskGiB':round(sum(f.stat().st_size for f in ROOT.rglob('*') if f.is_file())/2**30,2),'idleResidentModel':False,'asr':(ROOT/'models/sensevoice/model.int8.onnx').is_file(),'vision':(ROOT/'models/ollama/manifests/registry.ollama.ai/library/qwen3-vl/2b').is_file(),'memory':(ROOT/'models/ollama/manifests/registry.ollama.ai/library/bge-m3/latest').is_file(),'voices':[f.stem for f in (ROOT/'profiles/voices').glob('*.json')]}
 assert shutil.disk_usage(ROOT).free>=110*2**30,'Data disk reserve reached; preserving official workloads'
 assert sum(f.stat().st_size for f in ROOT.rglob('*') if f.is_file())<12*2**30,'Companion data quota reached'
 lock=(ROOT/'jobs/.compute.lock').open('a');deadline=time.monotonic()+120;queue_started=time.monotonic()
 while True:
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);break
  except BlockingIOError:
   if time.monotonic()>deadline:raise RuntimeError('Companion audio is busy; try again later')
   time.sleep(.25)
 with lock:
  while (action not in ['asr','edit','animation'] and other_gpu_memory()>1200) or memory_available()<(768*2**20 if action=='asr' else 3*2**30 if action in ['edit','animation'] else 5*2**30):
   if time.monotonic()>deadline:raise RuntimeError('Official workloads have priority; waiting for idle resources')
   time.sleep(1)
  write_event('job_started',action=action,queueMs=round((time.monotonic()-queue_started)*1000))
  with tempfile.TemporaryDirectory(prefix='job-',dir=ROOT/'jobs') as folder:
   folder=Path(folder);input_file=folder/'request.json';input_file.write_text(json.dumps(job,ensure_ascii=False));os.chmod(input_file,0o600)
   env=dict(os.environ,TMPDIR=str(ROOT/'tmp'),HF_HOME=str(ROOT/'cache/hf'),TORCH_HOME=str(ROOT/'cache/torch'),MODELSCOPE_CACHE=str(ROOT/'cache/modelscope'),PYTHONPYCACHEPREFIX=str(ROOT/'cache/pycache'),OMP_NUM_THREADS='2',MKL_NUM_THREADS='2',PYTHONIOENCODING='utf-8',HF_HUB_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1')
   out_file=folder/'response.json';log_file=folder/'compute.log'
   with out_file.open('wb') as output,log_file.open('wb') as log:
    child=subprocess.Popen([str(ROOT/'env/voice/bin/python'),'-u',str(ROOT/'source/audio_compute.py'),str(input_file)],cwd=ROOT,env=env,stdout=output,stderr=log,start_new_session=True,preexec_fn=parent_death_signal)
    limit=time.monotonic()+900
    try:
     while child.poll() is None:
      if time.monotonic()>limit:raise RuntimeError('Audio job timed out')
      if (action not in ['asr','edit','animation'] and other_gpu_memory(child.pid)>1400) or memory_available()<(512*2**20 if action=='asr' else 1536*2**20):raise RuntimeError('Official workload started; companion audio yielded its resources')
      time.sleep(.5)
    except BaseException:stop_owned(child);raise
   if child.returncode:raise RuntimeError('Remote audio failed: '+log_file.read_text(errors='replace')[-1200:])
   return json.loads(out_file.read_text())
started=time.monotonic();job={}
try:
 raw=sys.stdin.buffer.read(128*1024*1024+1)
 assert len(raw)<=128*1024*1024,'Remote input exceeds size limit'
 job=json.loads(raw);result=run(job)
 write_event('job_finished',action=job.get('action','unknown'),ok=True,durationMs=round((time.monotonic()-started)*1000),inputBytes=len(raw))
 print(json.dumps({'ok':True,**result},ensure_ascii=False),flush=True)
except Exception as error:
 write_event('job_failed',action=job.get('action','unknown'),ok=False,durationMs=round((time.monotonic()-started)*1000),errorType=type(error).__name__)
 print(json.dumps({'ok':False,'error':str(error)},ensure_ascii=False),flush=True)
 sys.exit(1)
