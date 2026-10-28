"""Private headless browser leased by the DSH bridge; loopback CDP only."""
from pathlib import Path
import os, sys, json, time, socket, subprocess, signal, fcntl, urllib.request, shutil
ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT/'jobs/browser.json'
LEASE = ROOT/'jobs/browser.lease'
def alive(pid):
    try: return str(ROOT/'source/browser_host.py').encode() in Path('/proc/'+str(int(pid))+'/cmdline').read_bytes()
    except (OSError, ValueError): return False
def memory():
    return int(next(x for x in Path('/proc/meminfo').read_text().splitlines() if x.startswith('MemAvailable:')).split()[1])*1024
def handle(action):
    with (ROOT/'jobs/.browser.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if action == 'browser_stop':
            try:
                state = json.loads(STATE.read_text())
                if alive(state['pid']): os.kill(state['pid'], signal.SIGTERM)
            except (OSError, ValueError, KeyError): pass
            return dict(stopped=True)
        LEASE.touch()
        try:
            state = json.loads(STATE.read_text())
            if alive(state['pid']): return state
        except (OSError, ValueError, KeyError): pass
        if memory() < 3*2**30: raise RuntimeError('Official workloads have priority; browser deferred')
        python = ROOT/'env/voice/bin/python'
        with (ROOT/'logs/browser-host.log').open('wb') as log:
            child = subprocess.Popen([str(python), str(ROOT/'source/browser_host.py'), '--host'], stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        for _ in range(100):
            if child.poll() is not None: raise RuntimeError('Private browser did not start')
            try:
                state = json.loads(STATE.read_text())
                if state['pid'] == child.pid: return state
            except (OSError, ValueError, KeyError): pass
            time.sleep(.1)
        child.terminate(); raise RuntimeError('Private browser startup timed out')
def host():
    os.umask(0o077); os.nice(15)
    for sig in [signal.SIGTERM, signal.SIGINT, signal.SIGHUP]: signal.signal(sig, lambda *_: sys.exit(0))
    with socket.socket() as sock: sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    profile = ROOT/'profiles/browser'; profile.mkdir(mode=0o700, exist_ok=True)
    downloads = ROOT/'jobs/browser-downloads'; downloads.mkdir(mode=0o700, exist_ok=True)
    env = dict(os.environ, TMPDIR=str(ROOT/'tmp'), XDG_CACHE_HOME=str(ROOT/'cache/browser'), XDG_CONFIG_HOME=str(ROOT/'profiles/browser-config'))
    args = [str(ROOT/'bin/chrome-headless-shell-linux64/chrome-headless-shell'), '--remote-debugging-address=127.0.0.1', '--remote-debugging-port='+str(port), '--user-data-dir='+str(profile), '--disk-cache-dir='+str(ROOT/'cache/browser'), '--disk-cache-size=16777216', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--window-size=1280,800', 'about:blank']
    child = subprocess.Popen(args, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        for _ in range(100):
            if child.poll() is not None: raise RuntimeError('Private Chromium failed')
            try:
                with opener.open('http://127.0.0.1:'+str(port)+'/json/version', timeout=.5) as response: json.load(response)
                break
            except (OSError, ValueError): time.sleep(.1)
        else: raise RuntimeError('Private CDP unavailable')
        STATE.write_text(json.dumps(dict(pid=os.getpid(), port=port)))
        while child.poll() is None and time.time()-LEASE.stat().st_mtime < 300 and memory() > 1536*2**20: time.sleep(2)
    finally:
        if child.poll() is None:
            child.terminate()
            try: child.wait(timeout=5)
            except subprocess.TimeoutExpired: child.kill(); child.wait()
        STATE.unlink(missing_ok=True)
        if downloads.resolve() == ROOT/'jobs/browser-downloads': shutil.rmtree(downloads, ignore_errors=True)
def receive_download(job):
    import re, hashlib, base64
    if not re.fullmatch('[0-9a-f-]{36}', job.get('guid', '')) or not re.fullmatch('\.(png|jpe?g|webp|avif|gif|mp4|webm|mov)', job.get('ext', '')): raise ValueError('Invalid browser download')
    file = ROOT/'jobs/browser-downloads'/job['guid']
    try:
        if file.is_symlink() or file.stat().st_size > 48*1024*1024: raise ValueError('Download exceeds bridge limit; split on website')
        data = file.read_bytes(); digest = hashlib.sha256(data).hexdigest()
        from artifact_worker import handle as artifact
        result = artifact(dict(action='artifact_put', artifact=digest+job['ext'], data=base64.b64encode(data).decode()))
        return dict(fileData=base64.b64encode(data).decode(), sha256=digest, artifact=result['artifact'])
    finally: file.unlink(missing_ok=True)
if __name__ == '__main__': host()
