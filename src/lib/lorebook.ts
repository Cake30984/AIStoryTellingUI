import type { LoreEntry, Message, World } from '../types'

/** 直近の会話テキストを走査する際に見る最大メッセージ数 */
const SCAN_DEPTH = 6

/**
 * 世界観のロア項目を、注入先が違う2つに分けて返す。
 * - `always`: `alwaysOn` の項目＝会話の内容によらず常に入る＝**シーン中は不変**
 * - `matched`: 直近 SCAN_DEPTH 件にキーワードが含まれる項目＝スライディングウィンドウで**毎ターン入れ替わる**
 *
 * 分ける理由（PC1+PC4）: プロンプトキャッシュの粒度はメッセージ単位なので、
 * system に `matched` を混ぜると1項目の出入りで **system 全体が無効**になる（実測ヒット率 2%）。
 * `matched` は messages 側の深さ3へ出す。`docs/詳細設計_プロンプト構造とキャッシュ.md` §5.2
 *
 * 並び順（`order` 昇順）は両方で維持する。
 */
export function splitLoreEntries(
  world: World | undefined,
  messages: Message[],
): { always: LoreEntry[]; matched: LoreEntry[] } {
  if (!world) return { always: [], matched: [] }
  const recent = messages
    .slice(-SCAN_DEPTH)
    .map((m) => m.content)
    .join('\n')
    .toLowerCase()

  const always: LoreEntry[] = []
  const matched: LoreEntry[] = []
  for (const e of world.entries) {
    if (!e.enabled) continue
    if (e.alwaysOn) {
      always.push(e)
      continue
    }
    const hit = e.keys.some((k) => {
      const key = k.trim().toLowerCase()
      return key.length > 0 && recent.includes(key)
    })
    if (hit) matched.push(e)
  }
  const byOrder = (a: LoreEntry, b: LoreEntry) => a.order - b.order
  return { always: always.sort(byOrder), matched: matched.sort(byOrder) }
}
