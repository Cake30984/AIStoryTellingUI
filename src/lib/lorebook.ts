import type { LoreEntry, Message, World } from '../types'

/** 直近の会話テキストを走査する際に見る最大メッセージ数 */
const SCAN_DEPTH = 6

/**
 * 世界観から、現在注入すべきロア項目を選ぶ。
 * - alwaysOn の項目は常に対象
 * - それ以外は、直近の会話にキーワードが含まれる項目のみ
 */
export function selectLoreEntries(world: World | undefined, messages: Message[]): LoreEntry[] {
  if (!world) return []
  const recent = messages
    .slice(-SCAN_DEPTH)
    .map((m) => m.content)
    .join('\n')
    .toLowerCase()

  const matched = world.entries.filter((e) => {
    if (!e.enabled) return false
    if (e.alwaysOn) return true
    return e.keys.some((k) => {
      const key = k.trim().toLowerCase()
      return key.length > 0 && recent.includes(key)
    })
  })

  return matched.sort((a, b) => a.order - b.order)
}
