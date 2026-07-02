/** PNG の tEXt チャンク読み書き（自前実装）。SillyTavern 互換カードの入出力に使う */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

// CRC-32 テーブル（多項式 0xEDB88320）
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function checkSignature(bytes: Uint8Array): void {
  if (bytes.length < 8 || !SIGNATURE.every((b, i) => bytes[i] === b)) {
    throw new Error('PNG ではありません')
  }
}

function latin1Encode(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

// チャンク分割で変換する（1バイトずつの文字列連結は数MB級ペイロードで極端に遅くなる）
function latin1Decode(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let s = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[])
  }
  return s
}

function readU32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}

function u32Bytes(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff])
}

function concat(segments: Uint8Array[]): Uint8Array {
  const total = segments.reduce((n, s) => n + s.length, 0)
  const out = new Uint8Array(total)
  let pos = 0
  for (const s of segments) {
    out.set(s, pos)
    pos += s.length
  }
  return out
}

/** PNG バイト列から tEXt チャンクを列挙する */
export function readTextChunks(bytes: Uint8Array): { keyword: string; text: string }[] {
  checkSignature(bytes)
  const chunks: { keyword: string; text: string }[] = []
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length = readU32(bytes, offset)
    const type = latin1Decode(bytes.subarray(offset + 4, offset + 8))
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > bytes.length) break
    if (type === 'tEXt') {
      const data = bytes.subarray(dataStart, dataEnd)
      const nullIdx = data.indexOf(0)
      if (nullIdx >= 0) {
        const keyword = latin1Decode(data.subarray(0, nullIdx))
        const text = latin1Decode(data.subarray(nullIdx + 1))
        chunks.push({ keyword, text })
      }
    }
    if (type === 'IEND') break
    offset = dataEnd + 4
  }
  return chunks
}

/**
 * 同 keyword の既存 tEXt を除去し、IEND 直前に新しい tEXt を挿入した新バイト列を返す。
 * ※ セグメント連結方式で組み立てる（push(...spread) は数MB級チャンクでスタックオーバーフローするため禁止）
 */
export function writeTextChunk(bytes: Uint8Array, keyword: string, text: string): Uint8Array {
  checkSignature(bytes)
  const segments: Uint8Array[] = [new Uint8Array(SIGNATURE)]
  let offset = 8
  let iendChunk: Uint8Array | null = null

  while (offset + 8 <= bytes.length) {
    const length = readU32(bytes, offset)
    const type = latin1Decode(bytes.subarray(offset + 4, offset + 8))
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const chunkEnd = dataEnd + 4
    if (chunkEnd > bytes.length) break

    const isTargetTExt =
      type === 'tEXt' &&
      (() => {
        const data = bytes.subarray(dataStart, dataEnd)
        const nullIdx = data.indexOf(0)
        return nullIdx >= 0 && latin1Decode(data.subarray(0, nullIdx)) === keyword
      })()

    if (type === 'IEND') {
      iendChunk = bytes.subarray(offset, chunkEnd)
    } else if (!isTargetTExt) {
      segments.push(bytes.subarray(offset, chunkEnd))
    }
    offset = chunkEnd
  }

  // 新しい tEXt チャンクを組み立てる
  const keywordBytes = latin1Encode(keyword)
  const textBytes = latin1Encode(text)
  const data = new Uint8Array(keywordBytes.length + 1 + textBytes.length)
  data.set(keywordBytes, 0)
  data[keywordBytes.length] = 0
  data.set(textBytes, keywordBytes.length + 1)

  const typeAndData = new Uint8Array(4 + data.length)
  typeAndData.set(latin1Encode('tEXt'), 0)
  typeAndData.set(data, 4)
  const crc = crc32(typeAndData)

  segments.push(u32Bytes(data.length), typeAndData, u32Bytes(crc))
  if (iendChunk) segments.push(iendChunk)

  return concat(segments)
}
