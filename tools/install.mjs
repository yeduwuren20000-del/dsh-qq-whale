/**
 * 把插件挂进运行中的 DSH profile（或卸掉）。
 *
 * 这个桌面版的 profile 在 data/profiles/<name>（不是 ~/.dsh/profiles），本地插件一律
 * 用 `link:` 挂载。所以这里只做三件可回滚的事：
 *   1. 在 <profile>/node_modules 下建一个目录联接（junction）指向插件源码目录；
 *   2. 在 <profile>/package.json 里登记 `link:` 依赖；
 *   3. 把 dsh-mentor 追加进 dsh.profile.bundles。
 * 每一步改的都是文本清单，写前留 .bak；卸载按相反顺序撤回，档案数据不动。
 *
 * 用法：
 *   node tools/install.mjs --profile-dir "D:/30651/DeepSeekHarness/data/profiles/desktop"
 *   node tools/install.mjs --profile-dir "..." --dry-run
 *   node tools/install.mjs --profile-dir "..." --uninstall
 *   node tools/install.mjs --profile-dir "..." --copy        # 复制而不是挂载
 *   node tools/install.mjs --profile desktop                 # 走 ~/.dsh/profiles/<name>
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG = 'dsh-mentor'
const COPY = ['package.json', 'index.js', 'cordis.patch.yml', 'lib', 'client', 'README.md', 'SKILL.md']

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index < 0) return fallback
  const value = process.argv[index + 1]
  return value && !value.startsWith('--') ? value : true
}

const dryRun = Boolean(arg('dry-run', false))
const uninstall = Boolean(arg('uninstall', false))
const copyMode = Boolean(arg('copy', false))
const explicitDir = arg('profile-dir', undefined)
const profileName = String(arg('profile', 'desktop'))

const profileDir = typeof explicitDir === 'string'
  ? path.resolve(explicitDir)
  : path.join(os.homedir(), '.dsh', 'profiles', profileName)

const manifestPath = path.join(profileDir, 'package.json')
const modulesDir = path.join(profileDir, 'node_modules')
const targetDir = path.join(modulesDir, PKG)

if (!fs.existsSync(manifestPath)) {
  console.error(`找不到 profile：${manifestPath}`)
  process.exit(1)
}

const log = (line) => console.log(line)

function copyTree(from, to) {
  const stat = fs.statSync(from)
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true })
    for (const entry of fs.readdirSync(from)) copyTree(path.join(from, entry), path.join(to, entry))
    return
  }
  fs.copyFileSync(from, to)
}

function removeLink() {
  try {
    const stat = fs.lstatSync(targetDir)
    if (stat.isSymbolicLink() || stat.isDirectory()) fs.rmSync(targetDir, { recursive: true, force: true })
  } catch {
    // 本来就不存在
  }
}

function makeLink() {
  fs.mkdirSync(modulesDir, { recursive: true })
  fs.symlinkSync(ROOT, targetDir, 'junction')
}

function backupThenWrite(file, data) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const backup = `${file}.bak-${stamp}`
  fs.copyFileSync(file, backup)
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
  log(`备份：${backup}`)
}

log(`profile : ${profileDir}`)
log(`packages: ${targetDir}`)
log(`mode    : ${copyMode ? 'copy' : 'link'}`)

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const bundles = manifest.dsh?.profile?.bundles

if (uninstall) {
  if (dryRun) {
    log('（dry-run）将撤掉依赖、bundles 条目与包目录')
    process.exit(0)
  }
  removeLink()
  delete manifest.dependencies?.[PKG]
  if (Array.isArray(bundles)) manifest.dsh.profile.bundles = bundles.filter((name) => name !== PKG)
  backupThenWrite(manifestPath, manifest)
  log('已卸载。学习档案仍在 ~/.dsh/storages/dsh-mentor（要清就手动删）。')
  process.exit(0)
}

if (dryRun) {
  log('（dry-run）将建立包入口，并写入 dependencies / dsh.profile.bundles')
  process.exit(0)
}

removeLink()
if (copyMode) {
  fs.mkdirSync(targetDir, { recursive: true })
  for (const entry of COPY) {
    const from = path.join(ROOT, entry)
    if (!fs.existsSync(from)) continue
    copyTree(from, path.join(targetDir, entry))
  }
  log('包体已复制')
} else {
  makeLink()
  log('已挂载源码目录（改代码后重启宿主即可生效）')
}

manifest.dependencies = manifest.dependencies || {}
manifest.dependencies[PKG] = copyMode
  ? `link:./node_modules/${PKG}`
  : `link:${ROOT.replace(/\\/g, '/')}`
manifest.dsh = manifest.dsh || {}
manifest.dsh.profile = manifest.dsh.profile || {}
const nextBundles = Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles : []
if (!nextBundles.includes(PKG)) nextBundles.push(PKG)
manifest.dsh.profile.bundles = nextBundles

backupThenWrite(manifestPath, manifest)
log('profile 清单已更新')
log('')
log('下一步：重启 DSH 桌面端（关掉重开），刷新页面后按 Ctrl+Shift+M 呼出「学伴」。')
