/**
 * lib/qr.js — 纯 JS QR 编码器（零依赖，字节模式，版本 1-8，ECC L/M）。
 *
 * 用途：在 DSH 界面里直接渲染 B站扫码登录的二维码（不用第三方图片服务，
 * 也不把登录 URL 送到站外）。能力边界：只编码字节模式（URL/ASCII 够用），
 * 不做数字/字母数字/汉字混合模式，版本封顶 8（数据容量 194 码字，URL 足够）。
 *
 * 正确性由 test/qr.mjs 双保险验证：
 *   1) 与 python-qrcode 参考实现在「同版本+同ECC+同掩码」下逐模块比对（金标准）；
 *   2) 自洽往返：把自己的矩阵按放置规则逆推回数据码字，比对原始载荷。
 */

// ---- 每版本 ECC 特征表：[块数, 每块 ECC 码字数, 数据码字总数] ----
const ECC_TABLE = {
  L: { 1: [1, 7, 19], 2: [1, 10, 34], 3: [1, 15, 55], 4: [1, 20, 80], 5: [1, 26, 108], 6: [2, 18, 136], 7: [2, 20, 156], 8: [2, 24, 194] },
  M: { 1: [1, 10, 16], 2: [1, 16, 28], 3: [1, 26, 44], 4: [2, 18, 64], 5: [2, 24, 86], 6: [4, 16, 108], 7: [4, 18, 124] },
}
// 校正图形中心坐标（版本 1 没有）
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42] }
// 数据摆放完后剩下的「余料位」位数
const REMAINDER_BITS = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0 }
const ECC_LEVEL_BITS = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 }
const MAX_VERSION = 8

// ---- GF(256)，本原多项式 0x11D，生成元 α=2 ----
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
}
function gmul(a, b) {
  if (a === 0 || b === 0) return 0
  return EXP[LOG[a] + LOG[b]]
}

/** Reed-Solomon 生成多项式，系数高位在前（[1, a, b, ...] 表示 x^n + a·x^(n-1) + ...）。 */
function rsGenerator(ec) {
  let g = [1]
  for (let i = 0; i < ec; i++) {
    const a = EXP[i] // 乘上 (x + α^i)
    const next = new Array(g.length + 1).fill(0)
    for (let k = 0; k < g.length; k++) {
      next[k] ^= g[k] // 高位左移一位
      next[k + 1] ^= gmul(g[k], a)
    }
    g = next
  }
  return g
}

/** 数据块的 RS 纠错码字。 */
function rsRemainder(data, ec) {
  const gen = rsGenerator(ec)
  const res = new Array(ec).fill(0)
  for (const b of data) {
    const factor = b ^ res[0]
    res.shift()
    res.push(0)
    for (let i = 0; i < ec; i++) res[i] ^= gmul(gen[i + 1], factor)
  }
  return res
}

/** UTF-8 编码（字节模式按 UTF-8 字节数计，非 ASCII 也能编）。 */
function toUtf8(text) {
  const out = []
  for (const ch of String(text)) {
    let cp = ch.codePointAt(0)
    if (cp < 0x80) out.push(cp)
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
  }
  return out
}

/** 选版本：先试 M（纠错强），超长再退 L；返回 {version, ecc} 或 null。 */
function pickVersion(byteLen) {
  const need = byteLen + 2 // 模式4位 + 计数8位 = 12 位 ≈ 2 字节
  for (const ecc of ['M', 'L']) {
    const table = ECC_TABLE[ecc]
    for (let v = 1; v <= MAX_VERSION; v++) {
      const row = table[v]
      if (!row) continue
      if (need <= row[2]) return { version: v, ecc }
    }
  }
  return null
}

/**
 * 编码成 QR 矩阵。
 * @param {string} text 载荷（URL 等）
 * @param {{ecc?:'L'|'M', mask?:number}} opts mask 0-7 强制指定；不传则按惩罚分自动选
 * @returns {{size:number, modules:boolean[][], version:number, ecc:string, mask:number}}
 */
export function encodeQR(text, opts = {}) {
  const bytes = toUtf8(text)
  const pick = pickVersion(bytes.length)
  if (!pick) {
    throw new Error(`内容太长（${bytes.length} 字节），QR 只支持到 ${MAX_VERSION} 版`)
  }
  const version = pick.version
  const ecc = opts.ecc && ECC_TABLE[opts.ecc]?.[version] ? opts.ecc : pick.ecc
  const [blocks, ecPer, dataTotal] = ECC_TABLE[ecc][version]

  // 1) 数据码字：模式(0100) + 字节数(8位) + 数据 + 终止 + 填充
  const bits = []
  const push = (val, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1)
  }
  push(0b0100, 4) // 字节模式
  push(bytes.length, 8) // 版本 1-9 计数位宽 8
  for (const b of bytes) push(b, 8)
  push(0, Math.min(4, dataTotal * 8 - bits.length)) // 终止位（最多 4 个 0）
  while (bits.length % 8 !== 0) bits.push(0)
  const dataCw = []
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]
    dataCw.push(v)
  }
  const PADS = [0xec, 0x11]
  for (let i = 0; dataCw.length < dataTotal; i++) dataCw.push(PADS[i % 2])

  // 2) 分块 + RS + 交错。前 (dataTotal % blocks) 块多分一个码字；整除时全部等长。
  const extra = dataTotal % blocks
  const perBlock = Math.floor(dataTotal / blocks)
  const dataBlocks = []
  const eccBlocks = []
  let pos = 0
  for (let b = 0; b < blocks; b++) {
    const len = perBlock + (b < extra ? 1 : 0)
    const chunk = dataCw.slice(pos, pos + len)
    pos += len
    dataBlocks.push(chunk)
    eccBlocks.push(rsRemainder(chunk, ecPer))
  }
  const interleaved = []
  for (let i = 0; i < perBlock + (extra > 0 ? 1 : 0); i++) {
    for (const blk of dataBlocks) if (i < blk.length) interleaved.push(blk[i])
  }
  for (let i = 0; i < ecPer; i++) {
    for (const blk of eccBlocks) interleaved.push(blk[i])
  }

  // 3) 建矩阵
  const size = 17 + 4 * version
  const modules = Array.from({ length: size }, () => new Array(size).fill(false))
  const isFn = Array.from({ length: size }, () => new Array(size).fill(false))
  const setFn = (x, y, dark) => {
    modules[y][x] = dark
    isFn[y][x] = true
  }

  // 定位图形 + 分隔符
  for (const [cx, cy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || x >= size || y < 0 || y >= size) continue
        const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3))
        setFn(x, y, ring !== 2 && ring <= 3)
      }
    }
  }
  // 定时图形（第 6 行/列）
  for (let i = 8; i < size - 8; i++) {
    setFn(i, 6, i % 2 === 0)
    setFn(6, i, i % 2 === 0)
  }
  // 校正图形（跳过与定位图形重叠的三个角）
  const centers = ALIGN[version]
  for (const cy of centers) {
    for (const cx of centers) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
        }
      }
    }
  }
  // 格式信息占位。注意 row/col 6 是定时图形，不能覆盖；
  // row 8 / col 8 的中段（cols/rows 9..size-9）是数据位，也不占。
  for (let i = 0; i <= 5; i++) {
    setFn(8, i, false) // 竖条：col 8, rows 0-5
    setFn(i, 8, false) // 横条：row 8, cols 0-5
  }
  setFn(8, 7, false) // col 8, row 7
  setFn(7, 8, false) // row 8, col 7
  setFn(8, 8, false) // 角
  for (let i = 0; i < 8; i++) {
    setFn(8, size - 1 - i, false) // 竖条：col 8, rows size-8..size-1
    setFn(size - 1 - i, 8, false) // 横条：row 8, cols size-8..size-1
  }
  setFn(8, size - 8, true) // 固定黑模块
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      setFn(a, b, false)
      setFn(b, a, false)
    }
  }

  // 4) 摆放数据位（从右往左两列一组，上下交替，跳过第 6 列）
  const total = dataTotal * 8 + ECC_TABLE[ecc][version][1] * blocks * 8
  void total
  let bitIdx = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!isFn[y][x] && bitIdx < interleaved.length * 8) {
          const byte = interleaved[bitIdx >>> 3]
          modules[y][x] = ((byte >>> (7 - (bitIdx & 7))) & 1) === 1
          bitIdx++
        }
      }
    }
  }
  // 余料位保持亮（false）

  // 5) 掩码 + 惩罚分选最优
  const maskFns = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ]
  let best = null
  for (let m = 0; m < 8; m++) {
    if (opts.mask !== undefined && m !== opts.mask) continue
    applyMask(modules, isFn, maskFns[m])
    const fmt = formatBits(ecc, m)
    drawFormat(modules, size, fmt)
    if (version >= 7) drawVersion(modules, size, version)
    const score = penalty(modules)
    if (!best || score < best.score) best = { score, mask: m }
    // 还原，便于试下一个
    applyMask(modules, isFn, maskFns[m])
    if (opts.mask !== undefined) break
  }
  const mask = opts.mask !== undefined ? opts.mask : best.mask
  applyMask(modules, isFn, maskFns[mask])
  drawFormat(modules, size, formatBits(ecc, mask))
  if (version >= 7) drawVersion(modules, size, version)

  return { size, modules, version, ecc, mask, fnMap: isFn }
}

function applyMask(modules, isFn, fn) {
  const size = modules.length
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isFn[y][x] && fn(x, y)) modules[y][x] = !modules[y][x]
    }
  }
}

/** 15 位格式信息：ECC 级(2) + 掩码(3) + BCH(0x537) + 异或 0x5412。 */
function formatBits(ecc, mask) {
  const data = (ECC_LEVEL_BITS[ecc] << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((data << 10) | (rem & 0x3ff)) ^ 0x5412
}

function drawFormat(modules, size, bits) {
  const bit = (i) => ((bits >>> i) & 1) === 1
  // 竖条（col 8）：bit0-5 → rows 0-5；bit6 → row 7；bit7 → row 8；bit8-14 → rows size-7..size-1
  for (let i = 0; i <= 5; i++) modules[i][8] = bit(i)
  modules[7][8] = bit(6)
  modules[8][8] = bit(7)
  for (let i = 8; i < 15; i++) modules[size - 15 + i][8] = bit(i)
  // 横条（row 8）：bit0-7 → cols size-1..size-8；bit8 → col 7；bit9-14 → cols 5..0
  for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = bit(i)
  modules[8][7] = bit(8)
  for (let i = 9; i < 15; i++) modules[8][14 - i] = bit(i)
  modules[size - 8][8] = true
}

/** 18 位版本信息：版本号(6) + BCH(0x1F25)。 */
function versionBits(version) {
  let rem = version
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return (version << 12) | (rem & 0xfff)
}

function drawVersion(modules, size, version) {
  const bits = versionBits(version)
  for (let i = 0; i < 18; i++) {
    const bit = ((bits >>> i) & 1) === 1
    const a = size - 11 + (i % 3)
    const b = Math.floor(i / 3)
    modules[b][a] = bit
    modules[a][b] = bit
  }
}

/** 四条惩罚规则，选掩码用。 */
function penalty(modules) {
  const size = modules.length
  let result = 0
  // 规则1：同色连续 ≥5
  for (let y = 0; y < size; y++) {
    let color = false
    let run = 0
    for (let x = 0; x < size; x++) {
      if (modules[y][x] === color) {
        run++
        if (run === 5) result += 3
        else if (run > 5) result++
      } else {
        run = 1
        color = modules[y][x]
      }
    }
  }
  for (let x = 0; x < size; x++) {
    let color = false
    let run = 0
    for (let y = 0; y < size; y++) {
      if (modules[y][x] === color) {
        run++
        if (run === 5) result += 3
        else if (run > 5) result++
      } else {
        run = 1
        color = modules[y][x]
      }
    }
  }
  // 规则2：2x2 同色块
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x]
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) result += 3
    }
  }
  // 规则3：类定位图形 1:1:3:1:1 前后各 4 个亮块
  const PAT = [true, false, true, true, true, false, true, false, false, false, false]
  const PATR = [...PAT].reverse()
  const matchAt = (get, start) => {
    for (let i = 0; i < 11; i++) if (get(start + i) !== PAT[i]) return false
    return true
  }
  const matchAtR = (get, start) => {
    for (let i = 0; i < 11; i++) if (get(start + i) !== PATR[i]) return false
    return true
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x <= size - 11; x++) {
      const get = (i) => modules[y][i]
      if (matchAt(get, x) || matchAtR(get, x)) result += 40
    }
  }
  for (let x = 0; x < size; x++) {
    for (let y = 0; y <= size - 11; y++) {
      const get = (i) => modules[i][x]
      if (matchAt(get, y) || matchAtR(get, y)) result += 40
    }
  }
  // 规则4：深色模块占比偏离 50%
  let dark = 0
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) dark++
  const total = size * size
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1
  result += k * 10
  return result
}

/** 生成 SVG 字符串（quiet zone 4 模块）。供前端直接 innerHTML。 */
export function toSvg(modules, { dark = '#000', light = '#fff', scale = 8 } = {}) {
  const n = modules.length
  const dim = (n + 8) * scale
  let rects = ''
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (modules[y][x]) rects += `<rect x="${(x + 4) * scale}" y="${(y + 4) * scale}" width="${scale}" height="${scale}"/>`
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="${light}"/><g fill="${dark}">${rects}</g></svg>`
}

/** ASCII 预览，调试/测试肉眼核对定位图形用。 */
export function toAscii(modules) {
  return modules.map((row) => row.map((v) => (v ? '##' : '  ')).join('')).join('\n')
}
