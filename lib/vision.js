/**
 * QQ 图片落盘 + 本地 OCR。
 *
 * 为什么要有这个：QQ 桥上收到的 `image` 段只有一个 CDN 链接，模型看不见画面。
 * 而聊天里发图，八成是截图（报错、代码、聊天记录）。这些图里的**字**才是最要紧的信息。
 *
 * 所以走一条零依赖的路：图片下载到本地 → 用 Windows 系统自带的 OCR（Windows.Media.Ocr）
 * 把字抠出来 → 当成文本喂给模型。不联网、不装包、不要 key。
 *
 * 三个边界：
 * 1. 只认截图这类"有字"的图。照片抠不出字，那就只报尺寸，让模型知道自己确实看不见画面，
 *    别硬编内容。
 * 2. OCR 会认错字（尤其小字号）。所以注入时要说明「这是 OCR 结果，可能有错」，让模型自己判断。
 * 3. 任何一步失败都不能影响主流程——图片处理是增值的，不是必需的。
 */
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const MAX_BYTES = 12 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15000
const OCR_TIMEOUT_MS = 25000
/** OCR 放大倍数：小字号放大 3 倍后识别率明显上去，再大就只是慢。 */
const OCR_SCALE = 3

const EXT_BY_TYPE = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
}

/**
 * OCR 脚本只写一次。PowerShell 5.1 下 WinRT 异步要靠反射取 AsTask，所以脚本没法再短。
 * 反引号在 JS 模板里会截断字符串，所以统一写成 __BT__ 再替换。
 */
const OCR_SCRIPT_SRC = String.raw`
param([string]$Img, [int]$Scale = 3)
$ErrorActionPreference = 'Stop'
# 不设这一行，stdout 会按系统 ANSI 代码页（简中＝GBK）吐出来，Node 按 UTF-8 读就是一堆 �。
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$OutputEncoding = [Console]::OutputEncoding
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

$src = [System.Drawing.Image]::FromFile($Img)
$w = [int]($src.Width * $Scale); $h = [int]($src.Height * $Scale)
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($src, 0, 0, $w, $h)
$g.Dispose(); $src.Dispose()
$tmp = [System.IO.Path]::Combine($env:TEMP, 'dmocr_' + [guid]::NewGuid().ToString('N') + '.png')
$bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation__BT__1'
})[0]
function Await($op, $t) {
  $task = $asTaskGeneric.MakeGenericMethod($t).Invoke($null, @($op))
  $task.Wait(15000) | Out-Null
  return $task.Result
}
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($tmp)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { Write-Output '__NO_ENGINE__'; exit 0 }
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
foreach ($line in $result.Lines) { Write-Output $line.Text }
Remove-Item $tmp -Force -ErrorAction SilentlyContinue
`.replaceAll('__BT__', String.fromCharCode(96))

const OCR_SCRIPT = OCR_SCRIPT_SRC

function scriptPath(dir) {
  return path.join(dir, '.ocr.ps1')
}

/** 把 OCR 脚本落到数据目录，避免每次拼一坨参数。内容变了会重写。 */
function ensureScript(dir) {
  const file = scriptPath(dir)
  const want = createHash('sha256').update(OCR_SCRIPT).digest('hex')
  try {
    if (fs.existsSync(file)) {
      const have = createHash('sha256').update(fs.readFileSync(file)).digest('hex')
      if (have === want) return file
    }
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, OCR_SCRIPT, 'utf8')
    return file
  } catch {
    return null
  }
}

function extOf(contentType, name) {
  const byType = EXT_BY_TYPE[String(contentType || '').split(';')[0].trim().toLowerCase()]
  if (byType) return byType
  const byName = path.extname(String(name || '')).toLowerCase()
  if (/^\.(png|jpg|jpeg|webp|gif|bmp)$/.test(byName)) return byName === '.jpeg' ? '.jpg' : byName
  return '.img'
}

/**
 * 下载一张图并落盘。
 * @returns {{ ok: boolean, file?: string, bytes?: number, contentType?: string, error?: string }}
 */
export async function saveImage({ url, name }, dir) {
  if (!url) return { ok: false, error: '没有图片地址' }
  let res
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  timer.unref?.()
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // QQ 图床对 UA/Referer 有要求，缺了会 403。
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        Referer: 'https://im.qq.com/',
      },
    })
  } catch (error) {
    clearTimeout(timer)
    return { ok: false, error: `下载失败：${error?.message || error}` }
  }
  clearTimeout(timer)
  if (!res?.ok) return { ok: false, error: `下载失败：HTTP ${res?.status}` }

  const contentType = res.headers.get('content-type') || ''
  let buffer
  try {
    buffer = Buffer.from(await res.arrayBuffer())
  } catch (error) {
    return { ok: false, error: `读图片失败：${error?.message || error}` }
  }
  if (buffer.length > MAX_BYTES) return { ok: false, error: `图片太大（${buffer.length} 字节）` }
  if (!buffer.length) return { ok: false, error: '图片是空的' }

  const digest = createHash('sha256').update(buffer).digest('hex').slice(0, 16)
  const ext = extOf(contentType, name)
  try {
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${digest}${ext}`)
    if (!fs.existsSync(file)) fs.writeFileSync(file, buffer)
    return { ok: true, file, bytes: buffer.length, contentType }
  } catch (error) {
    return { ok: false, error: `存图片失败：${error?.message || error}` }
  }
}

/** 解码子进程输出：优先 UTF-8；若出现大量替换字符，说明是系统代码页（简中 GBK），再兜一次。 */
function decodeText(buffer) {
  const utf8 = buffer.toString('utf8')
  const bad = (utf8.match(/\uFFFD/g) || []).length
  if (bad <= Math.max(2, utf8.length * 0.02)) return utf8
  for (const label of ['gbk', 'gb18030']) {
    try {
      const alt = new TextDecoder(label, { fatal: false }).decode(buffer)
      const altBad = (alt.match(/\uFFFD/g) || []).length
      if (altBad < bad) return alt
    } catch {
      // 这个运行时没带该编码，试下一个。
    }
  }
  return utf8
}

/**
 * 读图片宽高，用来判断「这是截图还是照片」。
 *
 * 为什么自己解析：为了几个字节的宽高去装 sharp/jimp 不值当，起一次 PowerShell 更不值当。
 * PNG/GIF/BMP/JPEG/WebP 的文件头都是固定的，几十行就够，而且能脱离宿主单测。
 */
export function readImageInfo(file) {
  let head
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.alloc(64 * 1024)
      const n = fs.readSync(fd, buf, 0, buf.length, 0)
      head = buf.subarray(0, n)
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return null
  }
  return parseImageInfo(head)
}

/** 纯函数：从文件头字节里抠宽高。认不出就返回 null，不猜。 */
export function parseImageInfo(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || [])
  if (b.length < 12) return null

  // PNG：89 50 4E 47，IHDR 里宽高是大端 32 位。
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) {
    return { format: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
  }

  // GIF：逻辑屏幕宽高是小端 16 位。
  if (b.toString('ascii', 0, 4) === 'GIF8' && b.length >= 10) {
    return { format: 'gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8) }
  }

  // BMP：宽高是有符号小端 32 位，高度为负表示自上而下。
  if (b[0] === 0x42 && b[1] === 0x4d && b.length >= 26) {
    return { format: 'bmp', width: Math.abs(b.readInt32LE(18)), height: Math.abs(b.readInt32LE(22)) }
  }

  // WebP：RIFF 容器，三种编码各有各的取法。
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' && b.length >= 30) {
    const kind = b.toString('ascii', 12, 16)
    if (kind === 'VP8X') {
      return { format: 'webp', width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 }
    }
    if (kind === 'VP8 ') {
      const at = b.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20)
      if (at > 0 && at + 7 <= b.length) {
        return {
          format: 'webp',
          width: b.readUInt16LE(at + 3) & 0x3fff,
          height: b.readUInt16LE(at + 5) & 0x3fff,
        }
      }
    }
    if (kind === 'VP8L' && b.length >= 25) {
      const packed = b.readUInt32LE(21)
      return {
        format: 'webp',
        width: (packed & 0x3fff) + 1,
        height: ((packed >>> 14) & 0x3fff) + 1,
      }
    }
  }

  // JPEG：扫到 SOFn 段，高度在前、宽度在后。
  if (b[0] === 0xff && b[1] === 0xd8) {
    let p = 2
    while (p + 9 < b.length) {
      if (b[p] !== 0xff) {
        p += 1
        continue
      }
      const marker = b[p + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        p += 2
        continue
      }
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSof) {
        return { format: 'jpeg', width: b.readUInt16BE(p + 7), height: b.readUInt16BE(p + 5) }
      }
      const len = b.readUInt16BE(p + 2)
      if (len < 2) return null
      p += 2 + len
    }
  }

  return null
}

const OCR_CACHE_VERSION = 1

function ocrCachePath(file) {
  return `${file}.ocr.json`
}

function readOcrCache(file) {
  try {
    const row = JSON.parse(fs.readFileSync(ocrCachePath(file), 'utf8'))
    if (!row || row.v !== OCR_CACHE_VERSION || typeof row.ok !== 'boolean') return null
    return row
  } catch {
    return null
  }
}

function writeOcrCache(file, row) {
  try {
    fs.writeFileSync(ocrCachePath(file), JSON.stringify({ v: OCR_CACHE_VERSION, at: Date.now(), ...row }), 'utf8')
  } catch {
    // 缓存写不进去只是慢一点，不影响结果。
  }
}

/**
 * 用 Windows 自带 OCR 抠图里的字。非 Windows / 没语言包 / 超时，都返回 ok:false。
 *
 * 结果按图片文件缓存（文件名就是内容哈希），同一张图第二次进来直接命中，
 * 省掉一次 PowerShell 冷启动。
 * @returns {Promise<{ ok: boolean, text?: string, error?: string, cached?: boolean }>}
 */
export function ocrImage(file, dir, options = {}) {
  const useCache = options.cache !== false
  if (useCache) {
    const hit = readOcrCache(file)
    if (hit) return Promise.resolve({ ok: hit.ok, text: hit.text, error: hit.error, cached: true })
  }
  return runOcr(file, dir).then((result) => {
    // 环境被关掉/没有语言包这类失败别缓存，否则修好环境也不会重试。
    const transient = /关闭|非 Windows|没装|写不下去/.test(String(result.error || ''))
    if (!transient) writeOcrCache(file, { ok: result.ok, text: result.text, error: result.error })
    return result
  })
}

function runOcr(file, dir) {
  return new Promise((resolve) => {
    // 杀软拦 PowerShell、或者机器太慢想省点开销时，一眼就能关掉。
    if (process.env.DSH_MENTOR_OCR === '0') {
      resolve({ ok: false, error: 'OCR 已按设置关闭（DSH_MENTOR_OCR=0）' })
      return
    }
    if (process.platform !== 'win32') {
      resolve({ ok: false, error: '非 Windows，没有系统 OCR' })
      return
    }
    const script = ensureScript(dir)
    if (!script) {
      resolve({ ok: false, error: 'OCR 脚本写不下去' })
      return
    }
    let out = ''
    const outChunks = []
    let err = ''
    let child
    try {
      child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, file, String(OCR_SCALE)],
        { windowsHide: true },
      )
    } catch (error) {
      resolve({ ok: false, error: `起 OCR 失败：${error?.message || error}` })
      return
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // 已经退了
      }
      resolve({ ok: false, error: 'OCR 超时' })
    }, OCR_TIMEOUT_MS)
    timer.unref?.()
    child.stdout?.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      outChunks.push(buf)
      out = decodeText(Buffer.concat(outChunks))
    })
    child.stderr?.on('data', (chunk) => {
      err += String(chunk)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, error: `OCR 进程出错：${error?.message || error}` })
    })
    child.on('close', () => {
      clearTimeout(timer)
      if (out.includes('__NO_ENGINE__')) {
        resolve({ ok: false, error: '系统没装 OCR 语言包' })
        return
      }
      const text = out
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length >= 2)
        .join('\n')
        .trim()
      if (!text) {
        resolve({ ok: false, error: err.trim().slice(0, 120) || '没认出字' })
        return
      }
      resolve({ ok: true, text })
    })
  })
}

/** 粗略压一下 OCR 的重复空行，别把一大坨塞进提示词。 */
export function tidyOcr(text, maxChars = 1200) {
  const rows = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const seen = new Set()
  const out = []
  for (const row of rows) {
    if (seen.has(row)) continue
    seen.add(row)
    out.push(row)
    if (out.join('\n').length > maxChars) break
  }
  return out.join('\n').slice(0, maxChars)
}

/**
 * 把「一张图处理完的结果」拼成给模型看的一句话。
 *
 * 单独拎出来是为了能测：这段话的语气很重要——认不出就明说认不出，
 * 不能让模型以为自己在看画面然后编内容。
 */
export function describeSaved(options = {}) {
  const { index = 0, total = 1, bytes = 0, info = null, ocr = null, sticker = false, summary = '' } = options
  const tag = total > 1 ? `图${index + 1} ` : ''
  const kb = Math.max(1, Math.round((Number(bytes) || 0) / 1024))
  const size = info?.width && info?.height ? `${info.width}×${info.height}，` : ''

  if (sticker) {
    return `[${tag}表情包 ${kb}KB${summary ? `，标签：${summary}` : ''}]`
  }

  if (ocr?.ok && String(ocr.text || '').trim()) {
    return `[${tag}图片 ${size}${kb}KB，图上文字（系统 OCR，可能有错字）：\n${tidyOcr(ocr.text)}\n]`
  }

  // 没读出字要分清是「图里本来就没字」还是「OCR 本身出了问题」，不然模型和人都一头雾水。
  const reason = String(ocr?.error || '')
  const broken = /关闭|非 Windows|没装|超时|失败|出错|写不下去/.test(reason)
  const why = broken ? reason : '像照片或纯图形，本来就没字'
  return `[${tag}图片 ${size}${kb}KB，没读出文字（${why}）——你看不见画面内容，别编]`
}

