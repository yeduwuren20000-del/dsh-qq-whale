import { execFile } from 'node:child_process'
export function stateRequest(cfg, job) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/.test(cfg.host || '') || !/^\/[a-zA-Z0-9_./-]+$/.test(cfg.root || '') || cfg.root.split('/').includes('..')) throw new Error('远端档案连接配置无效')
  return new Promise((resolve, reject) => {
    const child = execFile('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', cfg.host, `python3 -u '${cfg.root}/source/resource_worker.py'`], { windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 45000 }, (error, stdout) => {
      try { const result = JSON.parse(stdout); if (!result.ok) throw new Error(result.error || '远端档案未保存'); if (error) throw error; resolve(result) }
      catch (failure) { reject(new Error(failure.message)) }
    })
    child.stdin.on('error', reject); child.stdin.end(JSON.stringify(job))
  })
}
