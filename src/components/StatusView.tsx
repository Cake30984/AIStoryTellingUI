import {
  bindRoleNames,
  firedEventLog,
  useStore,
} from '../store'
import { roleMembers } from '../lib/casting'
import type { Session } from '../types'
import EntityAvatar from './EntityAvatar'
import { Icon } from './icons'

interface Props {
  session: Session
}

/** 状態（関係性 prose ＋ 事実の数）の読み取り専用ビュー（ドック用。編集は StatusPanel モーダルで行う） */
export default function StatusView({ session }: Props) {
  const { worlds, characters, personas } = useStore()
  const world = worlds.find((w) => w.id === session.worldId)
  const heroName = personas.find((p) => p.id === session.personaId)?.name || '主人公'
  const cast = session.characterIds
    .map((id) => characters.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => !!c)
  const aspectName = (id: string) => world?.relationAspects.find((a) => a.id === id)?.name ?? ''
  const membersByRole = roleMembers(world?.roles, session.roleAssignments, characters)
  const rolesOf = (characterId: string) =>
    (world?.roles ?? [])
      .filter((role) => (membersByRole.get(role.id) ?? []).some((c) => c.id === characterId))
      .map((role) => role.name)
      .filter(Boolean)

  const st = session.state

  if (!world) {
    return <p className="inline-empty">ワールドを設定すると、関係性を管理できます。</p>
  }

  return (
    <>
      {cast.map((c) => {
        const rel = st.relations.find((r) => r.fromId === c.id && r.toId === 'hero')
        const mood = st.moods.find((m) => m.characterId === c.id)?.mood
        const roleNames = rolesOf(c.id)
        return (
          <div key={c.id} className="field">
            <label>
              <EntityAvatar className="dot-avatar" avatar={c.avatar} name={c.name || '無名'} />{' '}
              {c.name || '無名'}{roleNames.length > 0 ? `（${roleNames.join('・')}）` : ''} → {heroName}
            </label>
            {rel ? (
              <>
                <p className="desc">{rel.stance}</p>
                {rel.aspects.map((a) => (
                  <div key={a.aspectId} className="sub-field" style={{ marginTop: 6 }}>
                    <span className="sub-label">{aspectName(a.aspectId)}</span>
                    <p className="desc">{a.note}</p>
                  </div>
                ))}
              </>
            ) : (
              <div className="desc">まだ関係性の記録はありません（シーンを終えると生成されます）。</div>
            )}
            {mood && (
              <div className="desc" style={{ marginTop: 4 }}>
                気分: {mood}
              </div>
            )}
          </div>
        )
      })}

      {/* 起きた出来事（G2）。消化済みの特別イベントのみを発火順に出す。未発火は件数も出さない
          ＝プレイヤーが見る画面なので先の展開を割らない（docs/詳細設計_ゲーム性向上.md §2.2） */}
      {(() => {
        const fired = firedEventLog(session.usedEventIds, world, characters)
        if (fired.length === 0) return null
        return (
          <div className="field">
            <label>
              <Icon name="sparkles" size={13} className="label-icon" /> 起きた出来事
            </label>
            {fired.map(({ key, event, subjects }, i) => {
              const names = subjects.flatMap((p) => p.members.map((m) => m.name))
              return (
                <div key={`${key}-${i}`} className="desc" style={{ marginBottom: 4 }}>
                  <Icon name="check" size={12} className="state-icon ok" />{' '}
                  {bindRoleNames(event.name || '無名', subjects)}
                  {names.length > 0 && <span className="growth-keys">（{names.join('・')}）</span>}
                </div>
              )
            })}
          </div>
        )
      })()}

    </>
  )
}
