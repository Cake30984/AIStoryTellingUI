import { useMemo } from 'react'
import { findCastingRefs, resolveCasting, validateCasting } from '../lib/casting'
import type { Character, Persona, RoleAssignment, Session, World } from '../types'

interface Props {
  session: Pick<Session, 'characterIds' | 'personaId' | 'roleAssignments' | 'story'>
  world?: World
  characters: Character[]
  personas: Persona[]
  onChange: (assignments: RoleAssignment[]) => void
}

/** セッション設定・カセット・開始時モーダルで共有する配役入力欄 */
export default function CastingFields({ session, world, characters, personas, onChange }: Props) {
  const roles = world?.roles ?? []
  const refs = findCastingRefs(session.story.opening, roles)
  const participants = session.characterIds
    .map((id) => characters.find((character) => character.id === id))
    .filter((character): character is Character => !!character)
  const persona = session.personaId ? personas.find((p) => p.id === session.personaId) : undefined
  const assignments = session.roleAssignments ?? []
  const assignmentByRole = useMemo(() => {
    const map = new Map<string, string>()
    for (const assignment of assignments) map.set(assignment.roleId, assignment.characterId)
    return map
  }, [assignments])
  const issues = validateCasting(session as Session, world, characters, personas)
  const issueRoleIds = new Set(issues.flatMap((issue) => (issue.roleId ? [issue.roleId] : [])))
  const roleUseIds = new Set(refs.roleIds)
  const characterRoleCounts = new Map<string, number>()
  for (const roleId of assignmentByRole.keys()) {
    const characterId = assignmentByRole.get(roleId)
    if (characterId && participants.some((character) => character.id === characterId)) {
      characterRoleCounts.set(characterId, (characterRoleCounts.get(characterId) ?? 0) + 1)
    }
  }
  const doubled = participants.filter((character) => (characterRoleCounts.get(character.id) ?? 0) > 1)
  const preview = resolveCasting(session.story.opening, {
    roles,
    assignments,
    characters: participants,
    persona,
  })

  if (roles.length === 0 && !refs.usesPersona) return null

  const setRole = (roleId: string, characterId: string) => {
    const rest = assignments.filter((assignment) => assignment.roleId !== roleId)
    onChange(characterId ? [...rest, { roleId, characterId }] : rest)
  }

  return (
    <div className="casting-fields">
      <div className="casting-fields-head">
        <label>配役</label>
        <p className="desc">世界観が定めた立ち位置へ、参加キャラを配役します。同じキャラを複数の役にできます。</p>
      </div>

      {roles.map((role) => {
        const selected = assignmentByRole.get(role.id) ?? ''
        const needed = role.required || roleUseIds.has(role.id)
        const unresolved = issueRoleIds.has(role.id)
        return (
          <div key={role.id} className={'casting-role' + (unresolved ? ' unresolved' : '')}>
            <div className="casting-role-copy">
              <strong>{role.name || '（ロール名を入力）'}</strong>
              <span className={role.required ? 'badge warn' : 'badge'}>
                {role.required ? '開始に必須' : roleUseIds.has(role.id) ? '導入で使用中' : '任意'}
              </span>
              {role.description.trim() && <p>{role.description.trim()}</p>}
            </div>
            <select value={selected} onChange={(event) => setRole(role.id, event.target.value)}>
              <option value="">{needed ? '（未配役）' : '（配役しない）'}</option>
              {participants.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name || '無名のキャラ'}
                </option>
              ))}
            </select>
          </div>
        )
      })}

      {refs.usesPersona && (
        <p className={'casting-persona' + (!persona?.name.trim() ? ' unresolved' : '')}>
          <strong>@ペルソナ</strong> → {persona?.name.trim() || '未選択'}
        </p>
      )}
      {doubled.length > 0 && (
        <p className="casting-warning">同一キャラを複数ロールに配役中: {doubled.map((c) => c.name || '無名').join('・')}</p>
      )}
      {issues.length > 0 && <p className="casting-warning">未解決の配役があります。開始前に必要な項目を埋めてください。</p>}

      {session.story.opening.trim() && (
        <details className="casting-preview">
          <summary>導入文の実名プレビュー</summary>
          <pre>{preview.issues.length === 0 ? preview.content : '配役を埋めると実名へ解決した本文を確認できます。'}</pre>
        </details>
      )}
    </div>
  )
}
