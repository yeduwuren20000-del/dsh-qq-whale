import native from 'node:fs'
import path from 'node:path'
import { remoteState as state, archiveRelative, changed, LOCAL_DATA } from './remote-state.js'
const managed = file => state.active ? archiveRelative(file) : null
function missing(file) { return Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' }) }
function row(file) { const key = managed(file); if (!key) return null; const value = state.files.get(key.name); if (!value) throw missing(file); return value }
function directory(file) {
  if (!state.active) return null
  const rel = path.relative(LOCAL_DATA, path.resolve(String(file))).split(path.sep).join('/')
  return /^(diary|journal|tokens|shout|schedule)$/.test(rel) ? rel : null
}
const methods = {
  existsSync(file) { const key = managed(file); return key ? state.files.has(key.name) : directory(file) ? true : native.existsSync(file) },
  readFileSync(file, options) { const value = row(file); if (!value) return native.readFileSync(file, options); const encoding = typeof options === 'string' ? options : options?.encoding; return encoding ? value.data.toString(encoding) : Buffer.from(value.data) },
  writeFileSync(file, data, options) { const key = managed(file); if (!key) return native.writeFileSync(file, data, options); const value = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(String(data), typeof options === 'string' ? options : options?.encoding || 'utf8'); state.files.set(key.name, { data: value, mtimeMs: Date.now() }); if (!key.temporary) changed(key.name, value) },
  appendFileSync(file, data, options) { const key = managed(file); if (!key) return native.appendFileSync(file, data, options); methods.writeFileSync(file, Buffer.concat([state.files.get(key.name)?.data || Buffer.alloc(0), Buffer.from(data, typeof options === 'string' ? options : options?.encoding || 'utf8')])) },
  renameSync(from, to) { const a = managed(from), b = managed(to); if (!a && !b) return native.renameSync(from, to); if (!a || !b) throw new Error('不允许跨档案边界移动'); const value = row(from); state.files.set(b.name, { data: value.data, mtimeMs: Date.now() }); state.files.delete(a.name); if (!b.temporary) changed(b.name, value.data); if (!a.temporary && a.name !== b.name) changed(a.name, null) },
  unlinkSync(file) { const key = managed(file); if (!key) return native.unlinkSync(file); if (!state.files.delete(key.name)) throw missing(file); if (!key.temporary) changed(key.name, null) },
  mkdirSync(file, options) { return directory(file) ? undefined : native.mkdirSync(file, options) },
  statSync(file) { const value = row(file); return value ? { size: value.data.length, mtimeMs: value.mtimeMs, mtime: new Date(value.mtimeMs), isFile: () => true, isDirectory: () => false } : directory(file) ? { size: 0, mtimeMs: 0, isFile: () => false, isDirectory: () => true } : native.statSync(file) },
  readdirSync(file, options) { const dir = directory(file); if (!dir) return native.readdirSync(file, options); const names = [...new Set([...state.files.keys()].filter(name => name.startsWith(dir + '/')).map(name => name.slice(dir.length + 1).split('/')[0]))]; return options?.withFileTypes ? names.map(name => ({ name, isFile: () => true, isDirectory: () => false })) : names },
}
export default new Proxy(native, { get: (target, key) => methods[key] || target[key] })
