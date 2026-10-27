/**
 * 大肥鱼用的浏览器从哪来：自带 Chrome for Testing，不指望用户机器上装了 Chrome。
 *
 * 为什么自带而不是借系统的：借系统的等于「她的手」攥在别人手里——用户卸载 Chrome、
 * 浏览器自动升到某个新版、或者 DSH 跑到没装浏览器的机器上，功能就断了；而且版本不受控，
 * 出问题时没法复现。自带之后浏览器版本跟着插件走，profile 也在自己目录下。
 *
 * 为什么还留一层系统兜底：自带的那份要联网从 Chrome for Testing CDN 下载（约 150–200MB，
 * 国内可能很慢甚至下不动）。没下成就直接报错会把能用的功能一起废掉，所以退回系统
 * Chrome/Edge，并在 status 里说清楚现在用的是哪一个。
 *
 * 优先级：DSH_MENTOR_CHROME（用户钉死的路径）→ 自带 → 系统 Chrome/Edge。
 *
 * 目录：<dataDir>/browsers 只放浏览器二进制（@puppeteer/browsers 的缓存布局），
 * 和 <dataDir>/browser（登录用的持久 profile）是两个东西，别搞混。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from './store.js'

const CACHE_DIR = path.join(dataDir(), 'browsers')

const SYSTEM_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
].filter(Boolean)

let lib

/** 懒加载 @puppeteer/browsers：没装/装坏时不该拖垮插件其他功能。 */
async function getLib() {
  if (lib) return lib
  lib = await import('@puppeteer/browsers')
  return lib
}

function exists(p) {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

/**
 * buildId 是四段版本号（141.0.7390.54），库里自带的 getVersionComparator 走 semver，
 * 遇到四段会直接抛「not a valid semver」，所以自己按段比。
 */
function isNewer(a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d > 0
  }
  return false
}

/**
 * 各平台下 <安装目录> 里可执行文件的相对路径（照 @puppeteer/browsers 的解压布局列，
 * zip 顶层带 chrome-<平台> 文件夹，所以不能只看安装目录本身）。
 */
const REL_EXE = [
  'chrome-win64/chrome.exe',
  'chrome-win32/chrome.exe',
  'chrome-linux64/chrome',
  'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
]

/** 同步：本机已下载的自带浏览器，取版本最新的那个；没有返回 null。 */
function bundledExecutable() {
  try {
    const root = path.join(CACHE_DIR, 'chrome')
    const found = []
    for (const dir of fs.readdirSync(root)) {
      const buildId = dir.slice(dir.indexOf('-') + 1)
      if (!dir.includes('-') || !/^\d/.test(buildId)) continue
      for (const rel of REL_EXE) {
        const exe = path.join(root, dir, rel)
        if (exists(exe)) {
          found.push({ buildId, exe })
          break
        }
      }
    }
    if (!found.length) return null
    return found.reduce((a, b) => (isNewer(b.buildId, a.buildId) ? b : a)).exe
  } catch {
    // 目录还没建，等于没下载过
    return null
  }
}

/** 同步：按优先级给出可用浏览器。返回 { path, source }，一个都没有返回 null。 */
export function findExecutable() {
  const pinned = process.env.DSH_MENTOR_CHROME
  if (pinned && exists(pinned)) return { path: pinned, source: 'pinned' }
  const bundled = bundledExecutable()
  if (bundled) return { path: bundled, source: 'bundled' }
  for (const candidate of SYSTEM_CANDIDATES) {
    if (exists(candidate)) return { path: candidate, source: 'system' }
  }
  return null
}

/** 要能跑就抛错的那种：调用方不用自己写错误文案。 */
export function resolveExecutable() {
  const hit = findExecutable()
  if (hit) return hit.path
  throw new Error(
    '没有可用的浏览器。请在工具准备中选择浏览器，' +
      '或者设 DSH_MENTOR_CHROME 指向本机 chrome.exe。',
  )
}

export function status() {
  const hit = findExecutable()
  return {
    exe: hit?.path || null,
    source: hit?.source || null,
    cacheDir: CACHE_DIR,
    bundled: bundledExecutable(),
  }
}

/**
 * Windows 上不能直接叫 `tar`：PATH 里可能先撞上 Git 带来的 GNU tar——它不认 zip，
 * 还会把 `C:\...` 当成远程主机去连（实测报 "Cannot connect to C: resolve failed"）。
 * System32 那个是 bsdtar，认 zip。
 */
function tarCommand() {
  if (process.platform !== 'win32') return 'tar'
  const system = path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe')
  return exists(system) ? system : 'tar'
}

/**
 * 自己解压，不用库默认的 extract-zip：实测它在 Node 24 + Windows 上解压这份 200MB
 * 包时放出 3 个文件就再也不动（进程以 unsettled top-level await 退出，留个半成品目录）。
 * 系统自带的 tar（Win10+ / macOS / Linux 都有，Windows 上是 bsdtar）认 zip，又快又稳。
 */
function extractZip(archive, outDir) {
  fs.rmSync(outDir, { recursive: true, force: true }) // 清掉上次中断留下的半成品
  fs.mkdirSync(outDir, { recursive: true })
  try {
    execFileSync(tarCommand(), ['-xf', archive, '-C', outDir], { stdio: 'inherit' })
  } catch (error) {
    throw new Error(
      `解压自带 Chromium 失败（${error.message}）。zip 留在 ${archive}，` +
        `手动解压到 ${outDir} 再重试即可；或者继续用系统 Chrome。`,
    )
  }
}

/**
 * 下载自带 Chrome for Testing。已经下过就只补解压，不重复下载。
 * onProgress(downloadedBytes, totalBytes) 用来打进度条。
 */
export async function install({ buildId: pinnedBuild, onProgress } = {}) {
  const { Browser, Cache, detectBrowserPlatform, install: download, resolveBuildId } = await getLib()
  const platform = detectBrowserPlatform()
  if (!platform) throw new Error('识别不出当前系统的浏览器平台，下载不了自带 Chromium')

  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const cache = new Cache(CACHE_DIR)
  const buildId = pinnedBuild || (await resolveBuildId(Browser.CHROME, platform, 'stable'))
  const exe = cache.computeExecutablePath({ browser: Browser.CHROME, buildId, platform })
  if (exists(exe)) return { exe, buildId, downloaded: false }

  // unpack:false：只让它下 zip，解压交给上面的 extractZip（zip 已存在时不会重复下载）。
  const archive = await download({
    cacheDir: CACHE_DIR,
    browser: Browser.CHROME,
    buildId,
    platform,
    unpack: false,
    downloadProgressCallback: (downloadedBytes, totalBytes) => onProgress?.(downloadedBytes, totalBytes),
  })
  extractZip(archive, cache.installationDir(Browser.CHROME, platform, buildId))
  fs.rmSync(archive, { force: true })
  if (!exists(exe)) throw new Error(`解压完成但还是找不到可执行文件：${exe}`)
  return { exe, buildId, downloaded: true }
}
