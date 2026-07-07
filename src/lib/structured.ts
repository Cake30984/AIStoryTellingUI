import { EMOTIONS, type EmotionId } from '../types'

/** 構造化本文の1行。dialogue 以外はすべて narration（graceful degradation の要） */
export type StructuredLine =
  | { kind: 'narration'; text: string }
  | {
      kind: 'dialogue'
      /** 行頭 @ の直後に書かれた名前（未解決でもそのまま保持＝モブ対応） */
      name: string
      /** 参加キャラに解決できた場合のみ */
      characterId?: string
      /** 6値に解決できた場合のみ */
      emotion?: EmotionId
      /** セリフ本文（通常「」込み） */
      text: string
      /** 元の行全文（編集・フォールバック表示用） */
      raw: string
    }

export interface ParseCharacter {
  id: string
  name: string
}

/** キャラ名解決: 完全一致 → 前方一致（双方向 startsWith）。resolveEmotionUpdates と同一規則 */
export function matchCharacterByName(name: string, characters: ParseCharacter[]): string | undefined {
  const hit =
    characters.find((c) => c.name === name) ??
    characters.find((c) => c.name && (name.startsWith(c.name) || c.name.startsWith(name)))
  return hit?.id
}

/** 感情トークンを EmotionId に解決（id の大小文字ゆれ・日本語ラベルも受理）。不明は undefined */
export function resolveEmotionToken(token: string): EmotionId | undefined {
  const t = token.trim().toLowerCase()
  const byId = EMOTIONS.find((e) => e.id === t)
  if (byId) return byId.id
  const byLabel = EMOTIONS.find((e) => e.label === token.trim())
  return byLabel?.id
}

/** 1行をパースする。@ 行でなければ narration */
export function parseLine(line: string, characters: ParseCharacter[]): StructuredLine {
  if (!line.startsWith('@')) return { kind: 'narration', text: line }
  const body = line.slice(1)
  // 名前 = 最初の ( / （ / 「 まで。どれも無い行・名前が空/長すぎる行は narration に落とす（D-1 の原則）
  const m = body.match(/^([^(（「]{1,24})([(（]([^)）]{0,12})[)）])?/)
  const name = m?.[1]?.trim() ?? ''
  if (!name) return { kind: 'narration', text: line }
  const emotionToken = m?.[3]
  const rest = body.slice((m?.[0] ?? '').length).trim()
  // セリフ本文が空（@名前 だけの行）は情報が無いので narration 扱い
  if (!rest) return { kind: 'narration', text: line }
  return {
    kind: 'dialogue',
    name,
    characterId: matchCharacterByName(name, characters),
    emotion: emotionToken ? resolveEmotionToken(emotionToken) : undefined,
    text: rest,
    raw: line,
  }
}

/** 本文全体をパースする。空行は narration（text=''）としてそのまま保持（段落区切りをレンダラが使う） */
export function parseStructured(content: string, characters: ParseCharacter[]): StructuredLine[] {
  return content.split('\n').map((line) => parseLine(line, characters))
}

/** dialogue 行を1行でも含むか（レンダラのレガシー・フォールバック判定用） */
export function hasStructuredLines(content: string, characters: ParseCharacter[]): boolean {
  return parseStructured(content, characters).some((l) => l.kind === 'dialogue')
}

/**
 * マークアップを自然な日本語表記に落とす（裏方 LLM の文脈・チェックポイントラベル用。ST3 で使用）。
 * @美咲(joy)「やった」 → 美咲「やった」。narration はそのまま。
 */
export function plainTextOf(content: string): string {
  return content
    .split('\n')
    .map((line) => {
      const parsed = parseLine(line, [])
      return parsed.kind === 'dialogue' ? `${parsed.name}${parsed.text}` : line
    })
    .join('\n')
}

/**
 * 確定行（＝末尾の未完行を除いた行）から立ち絵の感情更新を抽出する（ST2 のストリーミング監視用）。
 * 同一キャラが複数回発言していれば後勝ち。characterId と emotion の両方が解決できた行のみ。
 */
export function emotionUpdatesOf(
  completedLines: string[],
  characters: ParseCharacter[],
): { characterId: string; emotion: EmotionId }[] {
  const map = new Map<string, EmotionId>()
  for (const line of completedLines) {
    const p = parseLine(line, characters)
    if (p.kind === 'dialogue' && p.characterId && p.emotion) map.set(p.characterId, p.emotion)
  }
  return [...map.entries()].map(([characterId, emotion]) => ({ characterId, emotion }))
}
