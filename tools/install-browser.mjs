/**
 * 给大肥鱼下载自带的 Chrome for Testing（约 150–200MB），装到 <dataDir>/browsers。
 *
 *   node tools/install-browser.mjs
 *   node tools/install-browser.mjs --build 141.0.7390.54   # 钉一个版本（配合镜像/离线包）
 *   node tools/install-browser.mjs --status                # 只看现在用的是哪一个
 *
 * 装完不用重启 DSH：lib/chromium.js 每次解析浏览器路径都现扫缓存目录。
 * 下载走 Chrome for Testing 官方 CDN，国内连不上或太慢时——挂代理，
 * 或者干脆继续用系统 Chrome（现在的兜底路径就是它，功能不受影响）。
 */
import { install, status } from '../lib/chromium.js'

const argv = process.argv.slice(2)

if (argv.includes('--status')) {
  console.log(JSON.stringify(status(), null, 2))
  process.exit(0)
}

const buildIndex = argv.indexOf('--build')
const buildId = buildIndex >= 0 ? argv[buildIndex + 1] : undefined
if (buildIndex >= 0 && !buildId) {
  console.error('--build 后面要跟版本号，例如 --build 141.0.7390.54')
  process.exit(1)
}

const mb = (n) => (n / 1024 / 1024).toFixed(1)
console.log(`开始下载${buildId ? ` Chrome for Testing ${buildId}` : ' 最新版 Chrome for Testing'}…`)

const result = await install({
  buildId,
  onProgress: (downloaded, total) => {
    const pct = total ? Math.min(100, Math.round((downloaded / total) * 100)) : 0
    process.stdout.write(`\r下载中 ${pct}%（${mb(downloaded)} / ${mb(total)} MB）    `)
  },
})

process.stdout.write('\r')
if (result.downloaded) console.log(`下载完成：${result.exe}`)
else console.log(`已经装过了，不用重复下载：${result.exe}`)
console.log(`版本 ${result.buildId}`)
