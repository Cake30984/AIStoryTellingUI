// R10 要件②: 画像1枚で完結する形（X はテキストより画像のほうが伸び、長文は畳まれるため）。
// 全文の画像化はしない（不可能）。挿絵＋本文の抜粋（excerptOf）＋タイトルを1枚に合成する。

export interface StoryCardInput {
  title: string
  excerpt: string
  attribution: string
  /** 挿絵（省略時はテキストのみのカードになる） */
  illustration?: Blob
}

const CARD_W = 1080
const CARD_H = 1350

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('挿絵の読み込みに失敗しました。'))
    }
    img.src = url
  })
}

/** object-fit: cover 相当で描画する */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.width, h / img.height)
  const sw = w / scale
  const sh = h / scale
  const sx = (img.width - sw) / 2
  const sy = (img.height - sh) / 2
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}

/** 日本語は語区切りが無いため文字単位で折り返す（1段落ぶん） */
function wrapParagraph(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (!text) return ['']
  const lines: string[] = []
  let line = ''
  for (const ch of text) {
    const test = line + ch
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line)
      line = ch
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  return text.split('\n').flatMap((para) => wrapParagraph(ctx, para, maxWidth))
}

/** 物語カード（PNG）を1枚合成する */
export async function renderStoryCard(input: StoryCardInput): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('画像の合成に失敗しました（canvas 非対応）。')

  const pad = 64

  // 背景
  ctx.fillStyle = '#17151d'
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  let textTop = 72
  if (input.illustration) {
    const img = await loadImage(input.illustration)
    const imgH = Math.round(CARD_H * 0.56)
    drawCover(ctx, img, 0, 0, CARD_W, imgH)
    const grad = ctx.createLinearGradient(0, imgH - 220, 0, imgH)
    grad.addColorStop(0, 'rgba(23,21,29,0)')
    grad.addColorStop(1, 'rgba(23,21,29,1)')
    ctx.fillStyle = grad
    ctx.fillRect(0, imgH - 220, CARD_W, 220)
    textTop = imgH - 40
  }

  ctx.textBaseline = 'top'

  // タイトル（最大2行）
  ctx.font = 'bold 56px "Hiragino Sans", "Yu Gothic", sans-serif'
  ctx.fillStyle = '#f5f2e8'
  let y = textTop + 16
  const titleLines = wrapText(ctx, input.title, CARD_W - pad * 2).slice(0, 2)
  for (const l of titleLines) {
    ctx.fillText(l, pad, y)
    y += 68
  }

  // 抜粋本文
  y += 20
  ctx.font = '34px "Hiragino Sans", "Yu Gothic", sans-serif'
  ctx.fillStyle = '#d9d5c8'
  const bodyBottom = CARD_H - 90
  const bodyLines = wrapText(ctx, input.excerpt, CARD_W - pad * 2)
  for (const l of bodyLines) {
    if (y > bodyBottom - 44) break
    ctx.fillText(l, pad, y)
    y += 46
  }

  // 出典
  ctx.font = '26px "Hiragino Sans", "Yu Gothic", sans-serif'
  ctx.fillStyle = '#8d8975'
  ctx.fillText(input.attribution, pad, CARD_H - 58)

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('画像の書き出しに失敗しました。'))), 'image/png')
  })
}
