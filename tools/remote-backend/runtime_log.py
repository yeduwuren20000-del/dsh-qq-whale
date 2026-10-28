"""Bounded operational metadata, never chat text, media, profile or credentials."""
from pathlib import Path
from datetime import datetime,timezone,timedelta
import os,json,time,fcntl
ROOT=Path(__file__).resolve().parent.parent
OWNER=None
DEFAULTS={'keepDays':7,'maxTotalBytes':20*1024*1024,'maxFileBytes':2*1024*1024}
ALLOWED={'action','stage','ok','durationMs','queueMs','inputBytes','outputBytes','reason','errorType','jobId','deletedFiles','freedBytes'}
def policy():
 try:raw=json.loads((ROOT/'runtime-log-policy.json').read_text())
 except (FileNotFoundError,ValueError):raw={}
 return {'keepDays':max(1,min(30,int(raw.get('keepDays',7)))), 'maxTotalBytes':max(1024*1024,min(100*1024*1024,int(raw.get('maxTotalBytes',DEFAULTS['maxTotalBytes'])))), 'maxFileBytes':DEFAULTS['maxFileBytes']}
def prepare():
 assert (ROOT/'.whale-deployment-owner').is_file()
 folder=ROOT/'logs/runtime';folder.mkdir(exist_ok=True,parents=True,mode=0o700);return folder
def _clean(folder,p,now):
 files=sorted(folder.glob('*.jsonl'),key=lambda f:f.stat().st_mtime);deleted=0;freed=0
 for f in list(files):
  if now-f.stat().st_mtime>p['keepDays']*86400:
   size=f.stat().st_size;f.unlink();files.remove(f);deleted+=1;freed+=size
 total=sum(f.stat().st_size for f in files)
 for f in files:
  if total<=p['maxTotalBytes']:break
  size=f.stat().st_size;f.unlink();total-=size;deleted+=1;freed+=size
 return {'deletedFiles':deleted,'freedBytes':freed}
def cleanup(now=None):
 folder=prepare()
 with (folder/'.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX);return _clean(folder,policy(),time.time() if now is None else now)
def write_event(event,**fields):
 try:
  folder=prepare();p=policy();now=time.time()
  row={'time':datetime.fromtimestamp(now,timezone(timedelta(hours=8))).isoformat(timespec='seconds'),'event':str(event)[:40]}
  row.update({k:v if isinstance(v,(int,float,bool)) else str(v)[:100] for k,v in fields.items() if k in ALLOWED})
  file=folder/(datetime.fromtimestamp(now,timezone(timedelta(hours=8))).strftime('%Y-%m-%d')+'.jsonl')
  with (folder/'.lock').open('a') as lock:
   fcntl.flock(lock,fcntl.LOCK_EX)
   _clean(folder,p,now)
   if file.exists() and file.stat().st_size>=p['maxFileBytes']:
    backup=file.with_name(file.stem+'.1.jsonl');backup.unlink(missing_ok=True);file.rename(backup)
   with file.open('a',encoding='utf-8') as stream:stream.write(json.dumps(row,ensure_ascii=False)+'\n')
   os.chmod(file,0o600);_clean(folder,p,now)
 except (OSError,ValueError):pass
