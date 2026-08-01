/** 構造化本文の1行。dialogue 以外はすべて narration（graceful degradation の要） */
export type StructuredLine =
  | {
      kind: 'narration'
      text: string
      /** 行頭 @地の文 等のラベルを剥がして地の文に落とした行か（レンダラ分岐・ラベル非表示用） */
      fromTag?: boolean
    }
  | {
      kind: 'dialogue'
      /** 行頭 @ の直後に書かれた名前（未解決でもそのまま保持＝モブ対応） */
      name: string
      /** 参加キャラに解決できた場合のみ */
      characterId?: string
      /** セリフ本文（通常「」込み） */
      text: string
      /** 元の行全文（編集・フォールバック表示用） */
      raw: string
    }

export interface ParseCharacter {
  id: string
  name: string
}

/** キャラ名解決: 完全一致 → 前方一致（双方向 startsWith） */
export function matchCharacterByName(name: string, characters: ParseCharacter[]): string | undefined {
  const hit =
    characters.find((c) => c.name === name) ??
    characters.find((c) => c.name && (name.startsWith(c.name) || c.name.startsWith(name)))
  return hit?.id
}

/**
 * 話者名として書かれても「地の文（ナレーション）」として扱う予約語。
 * モデルが地の文行にまで @地の文「…」 とラベルを付けてしまうケースの救済（ラベルを描画しない）。
 * ASCII 名の大小文字ゆれを吸収するため小文字で保持し、照合時も toLowerCase する。
 */
export const NARRATION_NAMES = new Set(['地の文', '地文', 'ナレーション', 'ナレーター', 'narration', 'narrator'])

/** 1行をパースする。@ 行でなければ narration */
export function parseLine(line: string, characters: ParseCharacter[]): StructuredLine {
  if (!line.startsWith('@')) return { kind: 'narration', text: line }
  const body = line.slice(1)
  // 名前 = 最初の ( / （ / 「 まで。どれも無い行・名前が空/長すぎる行は narration に落とす（D-1 の原則）
  // 名前の直後の括弧は読み捨てる: 感情タグ（@美咲(joy)）を書かせるのは立ち絵と一緒に廃止したが、
  // 旧メッセージには残っており、履歴の few-shot でモデルが真似ることもあるため受理だけは続ける。
  const m = body.match(/^([^(（「]{1,24})(?:[(（][^)）]{0,12}[)）])?/)
  const name = m?.[1]?.trim() ?? ''
  if (!name) return { kind: 'narration', text: line }
  const rest = body.slice((m?.[0] ?? '').length).trim()
  // 「地の文」等が話者名として書かれた行は地の文扱い。@地の文 ラベルを描画せず本文（rest）だけ残す
  if (NARRATION_NAMES.has(name.toLowerCase())) return { kind: 'narration', text: rest, fromTag: true }
  // セリフ本文が空（@名前 だけの行）は情報が無いので narration 扱い
  if (!rest) return { kind: 'narration', text: line }
  return {
    kind: 'dialogue',
    name,
    characterId: matchCharacterByName(name, characters),
    text: rest,
    raw: line,
  }
}

/** 本文全体をパースする。空行は narration（text=''）としてそのまま保持（段落区切りをレンダラが使う） */
export function parseStructured(content: string, characters: ParseCharacter[]): StructuredLine[] {
  return content.split('\n').map((line) => parseLine(line, characters))
}

/**
 * 構造化マークアップ（dialogue 行 or @地の文ラベル由来の narration 行）を1行でも含むか。
 * レンダラのレガシー・フォールバック判定用。@地の文 だけの全 narration メッセージも構造化レンダラ
 * （＝ラベル非表示）に載せるため fromTag も真とみなす。
 */
export function hasStructuredLines(content: string, characters: ParseCharacter[]): boolean {
  return parseStructured(content, characters).some(
    (l) => l.kind === 'dialogue' || (l.kind === 'narration' && l.fromTag === true),
  )
}

/**
 * マークアップを自然な日本語表記に落とす（裏方 LLM の文脈・チェックポイントラベル用。ST3 で使用）。
 * @美咲「やった」 → 美咲「やった」。@地の文「…」 → 「…」（ラベルを剥がした本文）。
 * 通常の地の文（@ なし）は parsed.text === 元の行なので不変。
 */
export function plainTextOf(content: string): string {
  return content
    .split('\n')
    .map((line) => {
      const parsed = parseLine(line, [])
      return parsed.kind === 'dialogue' ? `${parsed.name}${parsed.text}` : parsed.text
    })
    .join('\n')
}
