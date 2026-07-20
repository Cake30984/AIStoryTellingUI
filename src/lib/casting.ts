import type {
  Character,
  IntroTag,
  IntroTagBinding,
  Persona,
  RoleAssignment,
  Session,
  World,
  WorldRole,
} from '../types'

export type CastingIssueKind = 'missing-role-assignment' | 'unbound-tag' | 'unresolved-tag-binding'

/** 開始・導入文解決を妨げる配役・置換タグ束縛の不足 */
export interface CastingIssue {
  kind: CastingIssueKind
  roleId?: string
  roleName?: string
  tag?: string
}

/** カード・バックアップからの入力を最小限に正規化する（不正な行は読み捨てる） */
export function normalizeWorldRoles(raw: unknown): WorldRole[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((role) => {
    if (!role || typeof role !== 'object') return []
    const r = role as Record<string, unknown>
    if (typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.description !== 'string') return []
    return [{ id: r.id, name: r.name, description: r.description, ...(r.required === true ? { required: true } : {}) }]
  })
}

/** カード・バックアップからの配役を最小限に正規化する（参照先の存在確認は利用時に行う） */
export function normalizeRoleAssignments(raw: unknown): RoleAssignment[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((assignment) => {
    if (!assignment || typeof assignment !== 'object') return []
    const a = assignment as Record<string, unknown>
    return typeof a.roleId === 'string' && typeof a.characterId === 'string'
      ? [{ roleId: a.roleId, characterId: a.characterId }]
      : []
  })
}

/** カード・バックアップからの置換タグ定義を最小限に正規化する（A-1） */
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
    if (b.kind === 'persona') result.push({ tag: b.tag, kind: 'persona' })
    else if (b.kind === 'character' && typeof b.characterId === 'string') {
      result.push({ tag: b.tag, kind: 'character', characterId: b.characterId })
    }
  }
  return result
}

function usableRoles(roles: WorldRole[] | undefined): WorldRole[] {
  return (roles ?? []).filter((role) => role.id.trim() && role.name.trim())
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

/**
 * ロールグループのメンバーを解決する（多対多。A-2）。roleId → 配役されたキャラ配列
 * （参加キャラ順を保つため、渡す characters の順序を維持する）。
 */
export function roleMembers(
  roles: WorldRole[] | undefined,
  assignments: RoleAssignment[] | undefined,
  characters: Character[],
  allowedCharacterIds?: Set<string>,
): Map<string, Character[]> {
  const validRoleIds = new Set(usableRoles(roles).map((role) => role.id))
  const charactersById = new Map(characters.map((character) => [character.id, character]))
  const memberIdsByRole = new Map<string, Set<string>>()
  for (const assignment of assignments ?? []) {
    if (!validRoleIds.has(assignment.roleId)) continue
    const character = charactersById.get(assignment.characterId)
    if (!character || !character.name.trim()) continue
    if (allowedCharacterIds && !allowedCharacterIds.has(character.id)) continue
    const set = memberIdsByRole.get(assignment.roleId) ?? new Set<string>()
    set.add(character.id)
    memberIdsByRole.set(assignment.roleId, set)
  }
  const result = new Map<string, Character[]>()
  for (const [roleId, ids] of memberIdsByRole) {
    result.set(roleId, characters.filter((character) => ids.has(character.id)))
  }
  return result
}

/** 置換タグの束縛先を解決する（persona/character の実名。未解決なら undefined） */
function resolveTagName(
  binding: IntroTagBinding | undefined,
  characters: Character[],
  persona: Persona | undefined,
): string | undefined {
  if (!binding) return undefined
  if (binding.kind === 'persona') return persona?.name.trim() || undefined
  const character = characters.find((c) => c.id === binding.characterId)
  return character?.name.trim() || undefined
}

/**
 * 配役・置換タグ束縛の検証。必要な項目だけを開始ブロッカーとして扱い、古い無効参照は
 * 保存したまま無視する（旧 validateCasting の後継。A-1/A-2）。
 */
export function validateCasting(
  session: Session,
  world: World | undefined,
  characters: Character[],
  personas: Persona[],
): CastingIssue[] {
  const issues: CastingIssue[] = []
  const participantIds = new Set(session.characterIds)
  const participants = characters.filter((c) => participantIds.has(c.id))
  const persona = session.personaId ? personas.find((p) => p.id === session.personaId) : undefined

  const tags = usableTags(session.story.introTags)
  const usedTags = findIntroTagRefs(session.story.opening, tags)
  const bindingByTag = new Map((session.introBindings ?? []).map((b) => [b.tag, b]))
  for (const tagName of usedTags) {
    const binding = bindingByTag.get(tagName)
    if (!binding) {
      issues.push({ kind: 'unbound-tag', tag: tagName })
      continue
    }
    if (!resolveTagName(binding, participants, persona)) {
      issues.push({ kind: 'unresolved-tag-binding', tag: tagName })
    }
  }

  const roles = usableRoles(world?.roles)
  const members = roleMembers(roles, session.roleAssignments, characters, participantIds)
  for (const role of roles) {
    if (!role.required) continue
    if (!(members.get(role.id)?.length)) {
      issues.push({ kind: 'missing-role-assignment', roleId: role.id, roleName: role.name })
    }
  }
  return issues
}

export function castingIssueLabel(issue: CastingIssue): string {
  if (issue.kind === 'unbound-tag') return `置換タグ「@${issue.tag}」の対応付けが未設定です。`
  if (issue.kind === 'unresolved-tag-binding') {
    return `置換タグ「@${issue.tag}」の対応先（ペルソナ/参加キャラ）が未解決です。`
  }
  return `「${issue.roleName ?? '無名のロール'}」が未配役です。`
}

/** 導入文の置換タグを実名へ解決する。置換済みの名前を再処理しない単一パス方式（A-1） */
export function resolveIntroText(
  text: string,
  args: {
    tags: IntroTag[] | undefined
    bindings: IntroTagBinding[] | undefined
    characters: Character[]
    persona?: Persona
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
    if (!resolveTagName(binding, args.characters, args.persona)) {
      issues.push({ kind: 'unresolved-tag-binding', tag: tagName })
    }
  }
  if (issues.length > 0) return { content: text, issues }

  const pattern = tagPattern(tags)
  if (!pattern) return { content: text, issues: [] }
  const content = text.replace(pattern, (source, name: string) => {
    const resolved = resolveTagName(bindingByTag.get(name), args.characters, args.persona)
    return resolved ? `@${resolved}` : source
  })
  return { content, issues: [] }
}
