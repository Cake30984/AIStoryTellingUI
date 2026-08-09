import type { ArtStyle, PromptStyle } from '../types'

/**
 * prompt に pins のタグ（カンマ区切り）が欠けていれば末尾に補う。
 * 比較はトークン単位の完全一致（trim・小文字）。起案（LLM）がプロンプトを全文置換した際に、
 * LoRA トリガー・表情タグ等の固定タグが消えるのを防ぐために使う。
 */
export function ensureTags(prompt: string, pins: string): string {
  const have = new Set(
    prompt.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
  )
  const missing = pins
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && !have.has(t.toLowerCase()))
  if (missing.length === 0) return prompt
  return prompt ? `${prompt}, ${missing.join(', ')}` : missing.join(', ')
}

/**
 * 画風をプロンプトへ足す文字列を返す。**プロンプトスタイルで形が変わる**ので、
 * 生の `realistic` / `anime style` を直接結合してはいけない（自然文モードで浮く）。
 * 対応表はここ4行だけ（docs/設計_画像生成の簡易化.md §5.3）。
 */
export function artStyleText(
  style: PromptStyle,
  art: ArtStyle | undefined,
  custom: string | undefined,
): string {
  if (art === 'custom') return (custom ?? '').trim()
  if (!art) return ''
  if (style === 'tags') return art === 'anime' ? 'anime style, anime screencap' : 'photorealistic, realistic'
  return art === 'anime'
    ? 'Drawn in a Japanese anime illustration style.'
    : 'Rendered as a photorealistic photograph.'
}

/**
 * 画風をプロンプト本文に合成する。
 * - `tags`   … 先頭にタグとして結合（重複はトークン単位で除去）
 * - `natural`… **末尾に1文として添える**（前置きにすると起案文の主語より前に出て文が壊れる）
 */
export function applyArtStyle(style: PromptStyle, prompt: string, artText: string): string {
  const t = artText.trim()
  if (!t) return prompt.trim()
  if (style === 'tags') return combineWithDefaults(t, prompt)
  const p = prompt.trim()
  if (!p) return t
  return /[.!?]$/.test(p) ? `${p} ${t}` : `${p}. ${t}`
}

/**
 * 接続先のデフォルトタグ（品質・画風・LoRA トリガー等）をユーザープロンプトの先頭に結合する。
 * ユーザー側にデフォルトと同一のタグ（カンマ区切りトークン単位・trim・小文字の完全一致）が
 * 既に含まれていれば除去してから結合する（"masterpiece, masterpiece" のような重複を防ぐ）。
 * defaults が空/未設定なら user を trim して返すだけ。
 */
export function combineWithDefaults(defaults: string | undefined, user: string): string {
  const d = (defaults ?? '').trim().replace(/,\s*$/, '')
  if (!d) return user.trim()
  const defaultTokens = new Set(
    d.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
  )
  const rest = user
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && !defaultTokens.has(t.toLowerCase()))
    .join(', ')
  return rest ? `${d}, ${rest}` : d
}
