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
