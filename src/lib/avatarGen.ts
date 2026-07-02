/** アバター・カード画像の生成／正規化ユーティリティ */

/** 名前の頭文字＋背景色からデフォルトアバター画像（PNG blob）を生成する */
export function generateDefaultAvatar(name: string, color: string): Promise<Blob> {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = color
  ctx.fillRect(0, 0, size, size)
  const initial = Array.from(name.trim())[0] ?? '?'
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 128px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(initial, size / 2, size / 2 + 8)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('画像の生成に失敗しました'))
    }, 'image/png')
  })
}

/** 画像 blob を長辺 maxEdge px に収まるよう縮小し PNG に正規化する */
export async function normalizeImage(blob: Blob, maxEdge: number): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b)
      else reject(new Error('画像の正規化に失敗しました'))
    }, 'image/png')
  })
}
