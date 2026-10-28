from pathlib import Path
import os, json, subprocess, hashlib, base64, shutil
ROOT = Path(__file__).resolve().parent.parent
def run(job, folder):
    env = dict(os.environ, TMPDIR=str(folder), DSH_MENTOR_CHROME=str(ROOT/'bin/chrome-headless-shell-linux64/chrome-headless-shell'), OMP_NUM_THREADS='2')
    node = ROOT/'env/voice/lib/python3.10/site-packages/playwright/driver/node'
    with (folder/'node.log').open('wb') as log:
        result = subprocess.run([str(node), '--max-old-space-size=256', str(ROOT/'source/media_job.mjs'), str(folder/'request.json')], env=env, stdout=subprocess.PIPE, stderr=log, timeout=600)
    if result.returncode: raise RuntimeError('Remote editing failed: '+(folder/'node.log').read_text(errors='replace')[-900:])
    data = json.loads(result.stdout)
    if data.get('fileData'):
        raw = base64.b64decode(data['fileData'], validate=True); digest = hashlib.sha256(raw).hexdigest()
        assert digest == data['sha256']
        output = ROOT/'archive/media'/ (digest + data['ext']); output.parent.mkdir(mode=0o700, exist_ok=True)
        if not output.exists():
            used = sum(p.stat().st_size for p in ROOT.rglob('*') if p.is_file())
            if used + len(raw) >= 12*2**30 or shutil.disk_usage(ROOT).free-len(raw) < 110*2**30: raise RuntimeError('Remote archive quota reached; original inputs preserved')
            temp = output.with_suffix('.tmp'); temp.write_bytes(raw); os.replace(temp, output)
        data['artifact'] = output.relative_to(ROOT).as_posix()
    return data
