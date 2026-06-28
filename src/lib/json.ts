/**
 * モデル出力から最初の JSON（オブジェクト/配列）を抜き出して解釈する。
 * コードフェンスや前後の余計な文章があっても可能な範囲で復元する。
 */
export function extractJson<T = unknown>(text: string): T | null {
  if (!text) return null
  // ```json ... ``` を優先
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidates: string[] = []
  if (fence) candidates.push(fence[1])
  candidates.push(text)

  for (const c of candidates) {
    const trimmed = c.trim()
    // そのまま試す
    try {
      return JSON.parse(trimmed) as T
    } catch {
      /* fall through */
    }
    // 最初の { または [ から対応する閉じ括弧までを抽出
    const start = trimmed.search(/[[{]/)
    if (start === -1) continue
    const open = trimmed[start]
    const close = open === '{' ? '}' : ']'
    let depth = 0
    let inStr = false
    let esc = false
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i]
      if (inStr) {
        if (esc) esc = false
        else if (ch === '\\') esc = true
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') inStr = true
      else if (ch === open) depth++
      else if (ch === close) {
        depth--
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(start, i + 1)) as T
          } catch {
            break
          }
        }
      }
    }
  }
  return null
}
