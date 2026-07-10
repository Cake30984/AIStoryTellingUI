import { useStore } from '../store'
import type { Session } from '../types'
import EntityAvatar from './EntityAvatar'

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

  const st = session.state
  const statValue = (defId: string, characterId?: string): number => {
    const v = st.stats.find((s) => s.defId === defId && s.characterId === characterId)
    if (v) return v.value
    return world?.stats.find((d) => d.id === defId)?.default ?? 0
  }
  const counterValue = (defId: string, characterId?: string): number =>
    (st.counters ?? []).find((c) => c.defId === defId && c.characterId === characterId)?.value ?? 0
  const isUnlocked = (defId: string) => (st.achievements ?? []).some((a) => a.defId === defId)

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
        return (
          <div key={c.id} className="field">
            <label>
              <EntityAvatar className="dot-avatar" avatar={c.avatar} name={c.name || '無名'} />{' '}
              {c.name || '無名'} → {heroName}
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
          <label>🏆 実績</label>
          {world.achievements.map((a) => {
            const unlocked = isUnlocked(a.id)
            const conceal = a.hidden && !unlocked
            return (
              <div key={a.id} className="desc" style={{ opacity: unlocked ? 1 : 0.55, marginBottom: 4 }}>
                {unlocked ? '✅' : '🔒'} {conceal ? '？？？' : a.name || '無名'}
                {!conceal && a.description && <span> — {a.description}</span>}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
