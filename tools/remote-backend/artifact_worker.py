from pathlib import Path
import re, json, hashlib, base64, os, shutil
ROOT = Path(__file__).resolve().parent.parent
def handle(job):
    name = job.get('artifact', '')
    if not re.fullmatch('[0-9a-f]{64}\.[a-zA-Z0-9]{1,8}', name): raise ValueError('Invalid artifact identifier')
    folder = ROOT/'archive/media'; folder.mkdir(mode=0o700, exist_ok=True)
    file = folder/name
    if folder.is_symlink() or file.is_symlink(): raise ValueError('Invalid artifact path')
    if job['action'] in ['artifact_get','artifact_check']:
        data = file.read_bytes()
        if len(data) > 64*1024*1024: raise ValueError('Artifact exceeds transfer limit')
        digest = hashlib.sha256(data).hexdigest()
        if digest != name.split('.')[0]: raise ValueError('Artifact integrity failure')
        return dict(fileData=base64.b64encode(data).decode(), sha256=digest) if job['action']=='artifact_get' else dict(sha256=digest, bytes=len(data))
    data = base64.b64decode(job['data'], validate=True)
    digest = hashlib.sha256(data).hexdigest()
    if len(data) > 64*1024*1024 or digest != name.split('.')[0]: raise ValueError('Artifact integrity/size check failed')
    if file.exists():
        if hashlib.sha256(file.read_bytes()).hexdigest() != digest: raise ValueError('Stored artifact integrity failure')
    else:
        used = sum(f.stat().st_size for f in ROOT.rglob('*') if f.is_file())
        if used+len(data) >= 12*2**30 or shutil.disk_usage(ROOT).free-len(data) < 110*2**30: raise RuntimeError('Data disk quota reached; original preserved')
        temp = file.with_name(file.name+'.'+str(os.getpid())+'.tmp')
        try:
            with temp.open('wb') as stream: stream.write(data); stream.flush(); os.fsync(stream.fileno())
            os.chmod(temp, 0o600); os.replace(temp, file)
        finally: temp.unlink(missing_ok=True)
    return dict(artifact=name, sha256=digest, bytes=len(data))
