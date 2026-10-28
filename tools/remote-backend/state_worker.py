"""Private canonical records. Locked CAS batches with crash recovery; no GPU use."""
from pathlib import Path
import os, json, re, base64, hashlib, fcntl, shutil
ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = ROOT / 'archive'
PATTERN = re.compile(r'(?:(?:store|memory|growth|character|autonomy|proactive|social|social-activity|memory-vectors)\.json|(?:diary|journal|tokens|shout|schedule)/[a-zA-Z0-9_.-]+\.(?:json|jsonl|md))\Z')
LIMIT = 24 * 1024 * 1024
def target(name):
    if not isinstance(name, str) or not PATTERN.fullmatch(name):
        raise ValueError('Unsupported archive record')
    file = ARCHIVE / name
    if file.is_symlink() or file.parent.is_symlink() or file.resolve().is_relative_to(ARCHIVE.resolve()) is False:
        raise ValueError('Archive path escapes its directory')
    return file
def digest(data): return hashlib.sha256(data).hexdigest()
def atomic(file, data):
    file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temp = file.with_name(file.name + '.new')
    with temp.open('wb') as output:
        output.write(data); output.flush(); os.fsync(output.fileno())
    os.chmod(temp, 0o600); os.replace(temp, file)
def recover():
    transaction = ARCHIVE / '.transaction.json'
    if not transaction.exists(): return
    for change in json.loads(transaction.read_text())['changes']:
        file = target(change['name'])
        if change['data'] is None: file.unlink(missing_ok=True)
        else: atomic(file, base64.b64decode(change['data'], validate=True))
    transaction.unlink()
def handle(job):
    ARCHIVE.mkdir(mode=0o700, exist_ok=True)
    if ARCHIVE.is_symlink(): raise ValueError('Archive directory must be private')
    with (ARCHIVE / '.state.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX); recover()
        if job['action'] == 'state_snapshot':
            files = {}; total = 0
            for file in sorted(ARCHIVE.rglob('*')):
                name = file.relative_to(ARCHIVE).as_posix()
                if not PATTERN.fullmatch(name): continue
                file = target(name); data = file.read_bytes(); total += len(data)
                if total > LIMIT: raise ValueError('Archive exceeds transfer limit')
                files[name] = dict(data=base64.b64encode(data).decode(), sha256=digest(data), mtimeMs=file.stat().st_mtime_ns // 1000000)
            return dict(files=files)
        changes = job.get('changes')
        if not isinstance(changes, list) or len(changes) > 500: raise ValueError('Invalid archive batch')
        checked = []; seen = set(); hashes = {}; size = 0
        for change in changes:
            name = change['name']; file = target(name)
            if name in seen: raise ValueError('Duplicate archive record')
            seen.add(name)
            data = None if change['data'] is None else base64.b64decode(change['data'], validate=True)
            size += len(data or b'')
            if size > LIMIT: raise ValueError('Archive batch exceeds transfer limit')
            if data is not None and name.endswith('.json'): json.loads(data)
            expected = change.get('expected')
            if expected is not None and not re.fullmatch('[0-9a-f]{64}', expected): raise ValueError('Invalid archive revision')
            current = digest(file.read_bytes()) if file.exists() else None
            updated = digest(data) if data is not None else None
            if current != expected and current != updated: raise RuntimeError('Archive revision conflict: ' + name)
            checked.append(dict(name=name, data=change['data'])); hashes[name] = updated
        existing = sum(p.stat().st_size for p in ARCHIVE.rglob('*') if p.is_file() and PATTERN.fullmatch(p.relative_to(ARCHIVE).as_posix()))
        if existing + size > LIMIT: raise ValueError('Archive storage limit reached')
        if shutil.disk_usage(ROOT).free - size < 110 * 2**30: raise RuntimeError('Preserving official data disk reserve')
        atomic(ARCHIVE / '.transaction.json', json.dumps(dict(changes=checked)).encode())
        recover()
        return dict(hashes=hashes)
