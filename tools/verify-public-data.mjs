import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
const root = path.resolve(import.meta.dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const directories = new Set(['.git', '.dsh', 'diary', 'journal', 'voice-profiles', 'verification-data', '.verification-data', 'backups', '__pycache__'])
const names = new Set(['store.json', 'memory.json', 'growth.json', 'character.json', 'courses.json', 'schedule-remote.json', '.env'])
let count = 0
function check(file) {
  const rel = path.relative(root, file)
  assert.ok(!rel.split(path.sep).some(part => directories.has(part)), `Private directory in package: ${rel}`)
  assert.ok(!names.has(path.basename(file)) && !/^cookies.*\.json$/i.test(path.basename(file)), `Private data file in package: ${rel}`)
  assert.ok(!/\.(wav|pth|onnx|gguf|safetensors|pyc)$/i.test(file), `Model or voice data in package: ${rel}`)
  assert.ok(fs.realpathSync(file).startsWith(fs.realpathSync(root) + path.sep), `External package path: ${rel}`)
  if (fs.statSync(file).isDirectory()) { for (const name of fs.readdirSync(file)) check(path.join(file, name)); return }
  count++
}
for (const entry of new Set([...pkg.files, 'package.json', 'package-lock.json'])) {
  const file = path.join(root, entry); if (fs.existsSync(file)) check(file)
}
assert.ok(fs.existsSync(path.join(root, 'GETTING_STARTED.md')))
assert.ok(fs.existsSync(path.join(root, 'VOICE_SETUP.md')))
console.log(`VERIFIED ${count} package source files; personal archives, voices, credentials and test output excluded`)
