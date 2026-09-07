import {
  useStore,
} from '../store'
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

  if (!world) {
    return <p className="inline-empty">ワールドを設定すると、関係性を管理できます。</p>
  }

  return (
    <>
      {cast.map((c) => {
        const rel = st.relations.find((r) => r.fromId === c.id && r.toId === 'hero')
        const mood = st.moods.find((m) => m.characterId === c.id)?.mood
        return (
          <div key={c.id} className="field">
            <label>
              <EntityAvatar className="dot-avatar" avatar={c.avatar} name={c.name || '無名'} />{' '}
              {c.name || '無名'} → {heroName}
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


    </>
  )
}
