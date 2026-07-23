import { roleMembers, validateCasting } from '../lib/casting'
import type { Character, Persona, RoleAssignment, Session, World } from '../types'

interface Props {
  session: Pick<Session, 'characterIds' | 'personaId' | 'roleAssignments' | 'story' | 'introBindings'>
  world?: World
  characters: Character[]
  personas: Persona[]
  onChange: (assignments: RoleAssignment[]) => void
}

/**
 * セッション設定・カセット・開始時モーダルで共有する、世界観ロール（グループ）への配役欄（A-2）。
 * 1つのロールに複数人・1人が複数ロールの兼任も可能なチェックボックス形式。
 */
export default function CastingFields({ session, world, characters, personas, onChange }: Props) {
  const roles = (world?.roles ?? []).filter((role) => role.id.trim() && role.name.trim())
  const participants = session.characterIds
    .map((id) => characters.find((character) => character.id === id))
    .filter((character): character is Character => !!character)
  const assignments = session.roleAssignments ?? []
  const membersByRole = roleMembers(roles, assignments, participants, new Set(session.characterIds))
  const issues = validateCasting(session as Session, world, characters, personas)
  const issueRoleIds = new Set(issues.flatMap((issue) => (issue.roleId ? [issue.roleId] : [])))

  if (roles.length === 0) return null

  const toggleMember = (roleId: string, characterId: string, checked: boolean) => {
    const rest = assignments.filter((a) => !(a.roleId === roleId && a.characterId === characterId))
    onChange(checked ? [...rest, { roleId, characterId }] : rest)
  }

  return (
    <div className="casting-fields">
      <div className="casting-fields-head">
        <label>配役（ロールグループ）</label>
        <p className="desc">
          世界観が定めた立ち位置へ、登場キャラクターを配役します。1つのロールに複数人、1人が複数のロールを兼任することもできます。
        </p>
      </div>

      {roles.map((role) => {
        const members = membersByRole.get(role.id) ?? []
        const memberIds = new Set(members.map((c) => c.id))
        const unresolved = issueRoleIds.has(role.id)
        return (
          <div key={role.id} className={'casting-role' + (unresolved ? ' unresolved' : '')}>
            <div className="casting-role-copy">
              <strong>{role.name || '（ロール名を入力）'}</strong>
              <span className={role.required ? 'badge warn' : 'badge'}>
                {role.required ? '開始に必須' : '任意'}
              </span>
              {role.description.trim() && <p>{role.description.trim()}</p>}
            </div>
            <div className="casting-role-members">
              {participants.length === 0 && <span className="inline-empty">登場キャラクターがいません</span>}
              {participants.map((character) => (
                <label key={character.id} className="chk">
                  <input
                    type="checkbox"
                    checked={memberIds.has(character.id)}
                    onChange={(event) => toggleMember(role.id, character.id, event.target.checked)}
                  />
                  {character.name || '無名のキャラ'}
                </label>
              ))}
            </div>
          </div>
        )
      })}
      {issues.some((issue) => issue.kind === 'missing-role-assignment') && (
        <p className="casting-warning">未配役の必須ロールがあります。開始前に埋めてください。</p>
      )}
    </div>
  )
}
