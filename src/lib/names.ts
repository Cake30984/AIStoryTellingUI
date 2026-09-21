/** 名前照合の相手（キャラクターの id と表示名だけ） */
export interface NamedRef {
  id: string
  name: string
}

/**
 * キャラ名解決: 完全一致 → 前方一致（双方向 startsWith）。
 * レビューの `newCharacters`（発見キャラ）が既知の人物を新キャラと誤検出しないための**唯一の窓口**
 * ＝別名・前方一致の規則をここ1本に保つ。
 */
export function matchCharacterByName(name: string, characters: NamedRef[]): string | undefined {
  const hit =
    characters.find((c) => c.name === name) ??
    characters.find((c) => c.name && (name.startsWith(c.name) || c.name.startsWith(name)))
  return hit?.id
}

/**
 * 人物名として挙がっても「地の文（ナレーション）」として扱う予約語。
 * レビューがナレーターを新しい登場人物として返してしまうケースの救済。
 * ASCII 名の大小文字ゆれを吸収するため小文字で保持し、照合時も toLowerCase する。
 */
export const NARRATION_NAMES = new Set(['地の文', '地文', 'ナレーション', 'ナレーター', 'narration', 'narrator'])
