import type { Character, IntroTag, IntroTagBinding, Session } from '../types'

export type CastingIssueKind = 'unbound-tag' | 'unresolved-tag-binding'

/** 導入文解決を妨げる置換タグ束縛の不足 */
export interface CastingIssue {
  kind: CastingIssueKind
  tag?: string
}

/** カード・バックアップからの入力を最小限に正規化する（不正な行は読み捨てる） */
export function normalizeIntroTags(raw: unknown): IntroTag[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((tag) => {
    if (!tag || typeof tag !== 'object') return []
    const t = tag as Record<string, unknown>
    if (typeof t.id !== 'string' || typeof t.tag !== 'string' || !t.tag.trim()) return []
    return [{ id: t.id, tag: t.tag, ...(typeof t.note === 'string' && t.note ? { note: t.note } : {}) }]
  })
}

/** カード・バックアップからの置換タグ束縛を最小限に正規化する（A-1） */
export function normalizeIntroBindings(raw: unknown): IntroTagBinding[] {
  if (!Array.isArray(raw)) return []
  const result: IntroTagBinding[] = []
  for (const binding of raw) {
    if (!binding || typeof binding !== 'object') continue
    const b = binding as Record<string, unknown>
    if (typeof b.tag !== 'string' || !b.tag) continue
    if (typeof b.characterId === 'string' && b.characterId) {
      result.push({ tag: b.tag, characterId: b.characterId })
    }
  }
  return result
}

function usableTags(tags: IntroTag[] | undefined): IntroTag[] {
  return (tags ?? []).filter((tag) => tag.tag.trim())
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 置換タグに使うキーを長い名前順の単一正規表現にする（前方一致事故を防ぐ） */
function tagPattern(tags: IntroTag[]): RegExp | undefined {
  const names = [...new Set(tags.map((tag) => tag.tag.trim()).filter(Boolean))].sort((a, b) => b.length - a.length)
  if (names.length === 0) return undefined
  return new RegExp(`[@＠](${names.map(escapeRegExp).join('|')})`, 'g')
}

/** 本文中で使われている置換タグ名を検出する。未定義の @文字列は通常文として無視する（A-1） */
export function findIntroTagRefs(text: string, tags: IntroTag[] | undefined): string[] {
  const usable = usableTags(tags)
  const pattern = tagPattern(usable)
  if (!pattern) return []
  const known = new Set(usable.map((tag) => tag.tag.trim()))
  const found = new Set<string>()
  for (const match of text.matchAll(pattern)) {
    if (known.has(match[1])) found.add(match[1])
  }
  return [...found]
}

/** 置換タグの束縛先を解決する（参加キャラの実名。未解決なら undefined） */
function resolveTagName(
  binding: IntroTagBinding | undefined,
  characters: Character[],
): string | undefined {
  if (!binding) return undefined
  const character = characters.find((c) => c.id === binding.characterId)
  return character?.name.trim() || undefined
}

/**
 * 置換タグ束縛の検証。必要な項目だけを開始ブロッカーとして扱い、古い無効参照は
 * 保存したまま無視する（A-1）。
 */
export function validateCasting(session: Session, characters: Character[]): CastingIssue[] {
  const issues: CastingIssue[] = []
  const participantIds = new Set(session.characterIds)
  const participants = characters.filter((c) => participantIds.has(c.id))

  const tags = usableTags(session.story.introTags)
  const usedTags = findIntroTagRefs(session.story.opening, tags)
  const bindingByTag = new Map((session.introBindings ?? []).map((b) => [b.tag, b]))
  for (const tagName of usedTags) {
    const binding = bindingByTag.get(tagName)
    if (!binding) {
      issues.push({ kind: 'unbound-tag', tag: tagName })
      continue
    }
    if (!resolveTagName(binding, participants)) {
      issues.push({ kind: 'unresolved-tag-binding', tag: tagName })
    }
  }

  return issues
}

export function castingIssueLabel(issue: CastingIssue): string {
  if (issue.kind === 'unbound-tag') return `置換タグ「@${issue.tag}」の対応付けが未設定です。`
  return `置換タグ「@${issue.tag}」の対応先（参加キャラ）が未解決です。`
}

/** 導入文の置換タグを実名へ解決する。置換済みの名前を再処理しない単一パス方式（A-1） */
export function resolveIntroText(
  text: string,
  args: {
    tags: IntroTag[] | undefined
    bindings: IntroTagBinding[] | undefined
    characters: Character[]
  },
): { content: string; issues: CastingIssue[] } {
  const tags = usableTags(args.tags)
  const usedTags = findIntroTagRefs(text, tags)
  const bindingByTag = new Map((args.bindings ?? []).map((b) => [b.tag, b]))
  const issues: CastingIssue[] = []
  for (const tagName of usedTags) {
    const binding = bindingByTag.get(tagName)
    if (!binding) {
      issues.push({ kind: 'unbound-tag', tag: tagName })
      continue
    }
    if (!resolveTagName(binding, args.characters)) {
      issues.push({ kind: 'unresolved-tag-binding', tag: tagName })
    }
  }
  if (issues.length > 0) return { content: text, issues }

  const pattern = tagPattern(tags)
  if (!pattern) return { content: text, issues: [] }
  const content = text.replace(pattern, (source, name: string) => {
    const resolved = resolveTagName(bindingByTag.get(name), args.characters)
    return resolved ? `@${resolved}` : source
  })
  return { content, issues: [] }
}
