/** JSON 文字列のエスケープ（`\uXXXX` は別扱い） */
const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  '"': '"',
  '\\': '\\',
  '/': '/',
}

/**
 * ストリーミング途中の未完成 JSON から、指定キーの文字列値を「読めるところまで」取り出す（PC-A A-1）。
 * 閉じ引用符が未到達ならそこまでを返す（＝タイプライタ表示に使える）。
 * 値が文字列でない（配列・数値等）ときと、キーが未到達のときは undefined。
 */
export function partialString(buf: string, key: string): string | undefined {
  const needle = `"${key}"`
  const ki = buf.indexOf(needle)
  if (ki === -1) return undefined
  let i = ki + needle.length
  const skipWs = () => {
    while (i < buf.length && /\s/.test(buf[i])) i++
  }
  skipWs()
  if (buf[i] !== ':') return undefined
  i++
  skipWs()
  // バッファが尽きた＝まだ値が来ていない／文字列以外の値は対象外
  if (i >= buf.length || buf[i] !== '"') return undefined
  i++
  let out = ''
  while (i < buf.length) {
    const ch = buf[i]
    if (ch === '\\') {
      const nx = buf[i + 1]
      if (nx === undefined) break // エスケープの途中でバッファが尽きた
      if (nx === 'u') {
        const hex = buf.slice(i + 2, i + 6)
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) break
        out += String.fromCharCode(parseInt(hex, 16))
        i += 6
        continue
      }
      out += ESCAPES[nx] ?? nx
      i += 2
      continue
    }
    if (ch === '"') break // 値の終端
    out += ch
    i++
  }
  return out
}

/**
 * JSON として不正だが意図は明らかな崩れを直す（`extractJson` の最終手段）。
 * 実測で頻出する2種だけを対象にする——**モデルが最もよくやる間違い**であり、
 * どちらも復元しても意味が変わらないため:
 *
 * 1. **文字列の中に生の改行・タブが入っている**（「改行は \\n で書く」という指示に従い損ねる。
 *    あらすじのような複数段落の値で特に多い）→ 正しいエスケープに置き換える
 * 2. **末尾カンマ**（`{"a":1,}` / `[1,2,]`）→ 取り除く
 *
 * これに当たらない壊れ方（途中で切れている等）は直さない＝黙って誤魔化さない。
 */
export function repairJsonText(s: string): string {
  let out = ''
  let inStr = false
  let esc = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) {
        out += ch
        esc = false
        continue
      }
      if (ch === '\\') {
        out += ch
        esc = true
        continue
      }
      if (ch === '"') {
        out += ch
        inStr = false
        continue
      }
      // 文字列内の生の制御文字はエスケープへ（JSON.parse はここで必ず失敗する）
      if (ch === '\n') out += '\\n'
      else if (ch === '\r') out += '\\r'
      else if (ch === '\t') out += '\\t'
      else if (ch < ' ') out += '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')
      else out += ch
      continue
    }
    if (ch === '"') {
      out += ch
      inStr = true
      continue
    }
    if (ch === ',') {
      // 次の非空白が } または ] なら末尾カンマ＝落とす
      let j = i + 1
      while (j < s.length && /\s/.test(s[j])) j++
      if (s[j] === '}' || s[j] === ']') continue
    }
    out += ch
  }
  return out
}

/** そのまま → 崩れを直して、の順に解釈を試みる */
function tryParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T
  } catch {
    /* 崩れているかもしれないので修復して再挑戦 */
  }
  try {
    return JSON.parse(repairJsonText(s)) as T
  } catch {
    return null
  }
}

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
    const whole = tryParse<T>(trimmed)
    if (whole !== null) return whole
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
          const span = tryParse<T>(trimmed.slice(start, i + 1))
          if (span !== null) return span
          break
        }
      }
    }
  }
  return null
}
