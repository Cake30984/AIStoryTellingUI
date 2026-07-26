import { bindRoleNames, resolveParties, useStore } from '../store'
import { roleMembers } from '../lib/casting'
import type { Session } from '../types'
import EntityAvatar from './EntityAvatar'
import { Icon } from './icons'

interface Props {
  session: Session
}

/** 状態（関係性 prose ＋ 事実の数）の読み取り専用ビュー（ドック用。編集は StatusPanel モーダルで行う） */
export default function StatusView({ session }: Props) {
  const { worlds, characters, personas, endingRecords } = useStore()
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
  const statValue = (defId: string, characterId?: string): number => {
    const v = st.stats.find((s) => s.defId === defId && s.characterId === characterId)
    if (v) return v.value
    return world?.stats.find((d) => d.id === defId)?.default ?? 0
  }
  const counterValue = (defId: string, characterId?: string): number =>
    (st.counters ?? []).find((c) => c.defId === defId && c.characterId === characterId)?.value ?? 0
  // 実績の解除記録（キャラ系はキャラの組ごとに複数。FB7-D）
  const unlockedRecordsOf = (defId: string) => (st.achievements ?? []).filter((a) => a.defId === defId)
  const nameOf = (id: string) => characters.find((c) => c.id === id)?.name || id

  if (!world) {
    return <p className="inline-empty">ワールドを設定すると、関係性・ステータスを管理できます。</p>
  }

  const globalStats = world.stats.filter((d) => d.scope === 'global')
  const charStats = world.stats.filter((d) => d.scope === 'character')
  const globalCounters = world.counters.filter((d) => d.scope === 'global')
  const charCounters = world.counters.filter((d) => d.scope === 'character')

  return (
    <>
      {(globalStats.length > 0 || globalCounters.length > 0) && (
        <div className="field">
          <label>主人公・世界の状態</label>
          <div className="dock-chip-row">
            {globalStats.map((d) => (
              <span key={d.id} className="badge">
                {d.name}: {statValue(d.id)}
              </span>
            ))}
            {globalCounters.map((d) => (
              <span key={d.id} className="badge">
                {d.name}: {counterValue(d.id)}
              </span>
            ))}
          </div>
        </div>
      )}

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
            {(charStats.length > 0 || charCounters.length > 0) && (
              <div className="dock-chip-row" style={{ marginBottom: 6 }}>
                {charStats.map((d) => (
                  <span key={d.id} className="badge">
                    {d.name}: {statValue(d.id, c.id)}
                  </span>
                ))}
                {charCounters.map((d) => (
                  <span key={d.id} className="badge">
                    {d.name}: {counterValue(d.id, c.id)}
                  </span>
                ))}
              </div>
            )}
            {rel ? (
              <>
                <p className="desc">{rel.stance}</p>
                {rel.aspects.map((a) => (
                  <div key={a.aspectId} className="sub-field" style={{ marginTop: 6 }}>
                    <span className="sub-label">{aspectName(a.aspectId)}</span>
                    <p className="desc">{a.note}</p>
                  </div>
                ))}
                {rel.flags.length > 0 && (
                  <div className="desc" style={{ marginTop: 4 }}>
                    🚩 {rel.flags.join('・')}
                  </div>
                )}
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

      {(world.achievements ?? []).length > 0 && (
        <div className="field">
          <label>
            <Icon name="trophy" size={13} className="label-icon" /> 実績
          </label>
          {world.achievements.map((a) => {
            const recs = unlockedRecordsOf(a.id)
            const unlocked = recs.length > 0
            const conceal = a.hidden && !unlocked
            // 当事者の組ごとの解除行（ロール名: 実名 で表示）
            const groups = recs.filter((r) => (r.parties?.length ?? 0) > 0)
            return (
              <div key={a.id} style={{ marginBottom: 4 }}>
                <div className="desc" style={{ opacity: unlocked ? 1 : 0.55 }}>
                  <Icon
                    name={unlocked ? 'check' : 'lock'}
                    size={12}
                    className={unlocked ? 'state-icon ok' : 'state-icon'}
                  />{' '}
                  {conceal ? '？？？' : a.name || '無名'}
                  {!conceal && a.description && <span> — {a.description}</span>}
                </div>
                {!conceal &&
                  groups.map((r, i) => {
                    const subjects = resolveParties(r.parties, world, characters)
                    const ids = r.parties!.flatMap((p) => p.characterIds)
                    return (
                      <div key={i} className="desc" style={{ marginLeft: 16, opacity: 0.8 }}>
                        ・{bindRoleNames(a.name || '無名', subjects)}
                        <span className="growth-keys">（{ids.map(nameOf).join('・')}）</span>
                      </div>
                    )
                  })}
              </div>
            )
          })}
        </div>
      )}

      {(world.endings ?? []).length > 0 &&
        (() => {
          const endings = world.endings ?? []
          // このセッションで到達したエンディング（distinct）。FB9-B で世界観単位からセッション単位へ。
          // 1セッションでも分岐で複数回収できるため n/m に意味がある。hidden の伏字もこれに従う
          // ＝別セッションで到達した結末は、新しいセッションではまた ？？？ に戻る
          const seen = new Set(
            endingRecords
              .filter((r) => r.sessionId === session.id)
              .map((r) => r.endingDefId),
          )
          return (
            <div className="field">
              <label>
                <Icon name="flag" size={13} className="label-icon" /> エンディング（このセッションで到達{' '}
                {seen.size}/{endings.length}）
              </label>
              {endings.map((e) => {
                const reached = session.ending?.defId === e.id
                const everSeen = seen.has(e.id)
                const conceal = e.hidden && !everSeen
                return (
                  <div
                    key={e.id}
                    className="desc"
                    style={{
                      opacity: everSeen ? 1 : 0.55,
                      marginBottom: 4,
                      fontWeight: reached ? 600 : undefined,
                    }}
                  >
                    <Icon
                      name={reached ? 'flag' : everSeen ? 'check' : 'lock'}
                      size={12}
                      className={reached ? 'state-icon accent' : everSeen ? 'state-icon ok' : 'state-icon'}
                    />{' '}
                    {conceal ? '？？？' : e.name || '無名'}
                    {reached && <span className="badge accent" style={{ marginLeft: 6 }}>到達</span>}
                    {!conceal && e.description && <span> — {e.description}</span>}
                  </div>
                )
              })}
            </div>
          )
        })()}
    </>
  )
}
