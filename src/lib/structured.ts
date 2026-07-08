import { EMOTIONS, type EmotionId } from '../types'

/** 構造化本文の1行。dialogue 以外はすべて narration（graceful degradation の要） */
export type StructuredLine =
  | {
      kind: 'narration'
      text: string
      /** 行頭 @地の文(感情) 等のラベルを剥がして地の文に落とした行か（レンダラ分岐・ラベル非表示用） */
      fromTag?: boolean
    }
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

/**
 * 話者名として書かれても「地の文（ナレーション）」として扱う予約語。
 * モデルが地の文行にまで @地の文(感情)「…」 とラベルを付けてしまうケースの救済（ラベルを描画しない）。
 * ASCII 名の大小文字ゆれを吸収するため小文字で保持し、照合時も toLowerCase する。
 */
const NARRATION_NAMES = new Set(['地の文', '地文', 'ナレーション', 'ナレーター', 'narration', 'narrator'])

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
  // 「地の文」等が話者名として書かれた行は地の文扱い。@地の文(感情) ラベルを描画せず本文（rest）だけ残す
  if (NARRATION_NAMES.has(name.toLowerCase())) return { kind: 'narration', text: rest, fromTag: true }
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
 * @美咲(joy)「やった」 → 美咲「やった」。@地の文(感情)「…」 → 「…」（ラベルを剥がした本文）。
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
