import type { Character, Persona, RoleAssignment, Session, World, WorldRole } from '../types'

export type CastingIssueKind = 'missing-persona' | 'missing-role-assignment' | 'invalid-assignment'

/** 導入文の実名解決・開始可否を妨げる配役の不足 */
export interface CastingIssue {
  kind: CastingIssueKind
  roleId?: string
  roleName?: string
}

export interface CastingRefs {
  usesPersona: boolean
  roleIds: string[]
  /** 未知の @名前 は通常の本文として扱うため、検出・報告しない */
  unknownNames: string[]
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

function usableRoles(roles: WorldRole[] | undefined): WorldRole[] {
  return (roles ?? []).filter((role) => role.id.trim() && role.name.trim())
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 配役記法に使うキーを長い名前順の単一正規表現にする（前方一致事故を防ぐ） */
function castingPattern(roles: WorldRole[]): RegExp | undefined {
  const names = [...new Set(['ペルソナ', ...roles.map((role) => role.name.trim()).filter(Boolean)])]
    .sort((a, b) => b.length - a.length)
  if (names.length === 0) return undefined
  return new RegExp(`[@＠](${names.map(escapeRegExp).join('|')})`, 'g')
}

/** 本文中で使われている予約記法を検出する。未知の @名前は通常文として無視する。 */
export function findCastingRefs(text: string, roles: WorldRole[] | undefined): CastingRefs {
  const usable = usableRoles(roles)
  const pattern = castingPattern(usable)
  if (!pattern) return { usesPersona: false, roleIds: [], unknownNames: [] }
  const roleByName = new Map(usable.map((role) => [role.name.trim(), role]))
  const roleIds = new Set<string>()
  let usesPersona = false
  for (const match of text.matchAll(pattern)) {
    const name = match[1]
    if (name === 'ペルソナ') usesPersona = true
    else {
      const role = roleByName.get(name)
      if (role) roleIds.add(role.id)
    }
  }
  return { usesPersona, roleIds: [...roleIds], unknownNames: [] }
}

function assignmentByRole(
  roles: WorldRole[],
  assignments: RoleAssignment[] | undefined,
  characters: Character[],
  allowedCharacterIds?: Set<string>,
): Map<string, Character> {
  const validRoleIds = new Set(roles.map((role) => role.id))
  const charactersById = new Map(characters.map((character) => [character.id, character]))
  const resolved = new Map<string, Character>()
  for (const assignment of assignments ?? []) {
    if (!validRoleIds.has(assignment.roleId)) continue
    const character = charactersById.get(assignment.characterId)
    if (!character || !character.name.trim() || (allowedCharacterIds && !allowedCharacterIds.has(character.id))) {
      resolved.delete(assignment.roleId)
      continue
    }
    // 同 roleId の重複は後勝ち（v1 は1ロール1人）
    resolved.set(assignment.roleId, character)
  }
  return resolved
}

/** 配役の検証。必要なロールだけを開始ブロッカーとして扱い、古い無効参照は保存したまま無視する。 */
export function validateCasting(
  session: Session,
  world: World | undefined,
  characters: Character[],
  personas: Persona[],
): CastingIssue[] {
  const roles = usableRoles(world?.roles)
  const refs = findCastingRefs(session.story.opening, roles)
  const issues: CastingIssue[] = []
  const persona = session.personaId ? personas.find((p) => p.id === session.personaId) : undefined
  if (refs.usesPersona && (!persona || !persona.name.trim())) issues.push({ kind: 'missing-persona' })

  const requiredRoleIds = new Set([
    ...refs.roleIds,
    ...roles.filter((role) => role.required).map((role) => role.id),
  ])
  const assignments = assignmentByRole(
    roles,
    session.roleAssignments,
    characters,
    new Set(session.characterIds),
  )
  const rawAssignmentByRole = new Map<string, RoleAssignment>()
  for (const assignment of session.roleAssignments ?? []) rawAssignmentByRole.set(assignment.roleId, assignment)
  for (const role of roles) {
    if (!requiredRoleIds.has(role.id) || assignments.has(role.id)) continue
    issues.push({
      kind: rawAssignmentByRole.has(role.id) ? 'invalid-assignment' : 'missing-role-assignment',
      roleId: role.id,
      roleName: role.name,
    })
  }
  return issues
}

export function castingIssueLabel(issue: CastingIssue): string {
  if (issue.kind === 'missing-persona') return '導入文で使うペルソナが未設定です。'
  if (issue.kind === 'invalid-assignment') return `「${issue.roleName ?? '無名のロール'}」の配役が参加キャラに含まれていません。`
  return `「${issue.roleName ?? '無名のロール'}」が未配役です。`
}

/** 導入文を実名へ解決する。置換済みの名前を再処理しない単一パス方式。 */
export function resolveCasting(
  text: string,
  args: {
    roles: WorldRole[] | undefined
    assignments: RoleAssignment[] | undefined
    characters: Character[]
    persona?: Persona
  },
): { content: string; issues: CastingIssue[] } {
  const roles = usableRoles(args.roles)
  const refs = findCastingRefs(text, roles)
  const issues: CastingIssue[] = []
  if (refs.usesPersona && !args.persona?.name.trim()) issues.push({ kind: 'missing-persona' })

  const byRole = assignmentByRole(roles, args.assignments, args.characters)
  const requiredRoleIds = new Set([
    ...refs.roleIds,
    ...roles.filter((role) => role.required).map((role) => role.id),
  ])
  for (const role of roles) {
    if (requiredRoleIds.has(role.id) && !byRole.has(role.id)) {
      issues.push({ kind: 'missing-role-assignment', roleId: role.id, roleName: role.name })
    }
  }
  if (issues.length > 0) return { content: text, issues }

  const roleByName = new Map(roles.map((role) => [role.name.trim(), role]))
  const pattern = castingPattern(roles)
  if (!pattern) return { content: text, issues: [] }
  const content = text.replace(pattern, (source, name: string) => {
    if (name === 'ペルソナ') return `@${args.persona?.name.trim() ?? ''}`
    const role = roleByName.get(name)
    const character = role ? byRole.get(role.id) : undefined
    return character ? `@${character.name.trim()}` : source
  })
  return { content, issues: [] }
}
