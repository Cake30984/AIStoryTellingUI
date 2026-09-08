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
  const { worlds, characters } = useStore()
  const world = worlds.find((w) => w.id === session.worldId)
  const heroName = characters.find((c) => c.id === session.focusCharacterId)?.name || '主人公'
  // 中心人物は自分自身への関係を持たない（F3）
  const cast = session.characterIds
    .filter((id) => id !== session.focusCharacterId)
    .map((id) => characters.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => !!c)
  const aspectName = (id: string) => world?.relationAspects.find((a) => a.id === id)?.name ?? ''

  // 取り込んだ古いカセット等で欠けていても落とさない（移行の取りこぼしへの保険）
  const st = {
    relations: session.state?.relations ?? [],
    moods: session.state?.moods ?? [],
    now: session.state?.now ?? '',
    place: session.state?.place ?? '',
    presentIds: session.state?.presentIds ?? [],
    situation: session.state?.situation ?? '',
    pending: session.state?.pending ?? [],
    recentDone: session.state?.recentDone ?? [],
  }
  const nameOf = (id: string) => characters.find((c) => c.id === id)?.name || '？'

  // 時間と予定（§2.3）。世界観が未設定でも出す＝これはセッションの状態であって世界の定義ではない
  const tracker = (
    <>
      {(st.now.trim() || st.place.trim() || st.situation.trim() || st.presentIds.length > 0) && (
        <div className="field">
          <label>いま</label>
          {st.now.trim() && <p className="desc">{st.now}</p>}
          {st.place.trim() && <p className="desc">{st.place}</p>}
          {st.presentIds.length > 0 && (
            <p className="desc">この場に: {st.presentIds.map(nameOf).join('・')}</p>
          )}
          {st.situation.trim() && <p className="desc">{st.situation}</p>}
        </div>
      )}

      {st.pending.length > 0 && (
        <div className="field">
          <label>これから起きること</label>
          {st.pending.map((x) => (
            <div key={x.id} className="desc" style={{ marginBottom: 4 }}>
              {x.when.trim() ? `${x.when}: ` : ''}
              {x.what}
            </div>
          ))}
        </div>
      )}

      {st.recentDone.length > 0 && (
        <div className="field">
          <label>消化した予定</label>
          {st.recentDone.map((x, i) => (
            <div key={i} className="desc" style={{ marginBottom: 4, opacity: 0.7 }}>
              {x.what}
            </div>
          ))}
        </div>
      )}
    </>
  )

  if (!world) {
    return (
      <>
        {tracker}
        <p className="inline-empty">ワールドを設定すると、関係性を管理できます。</p>
      </>
    )
  }

  return (
    <>
      {tracker}
      {cast.map((c) => {
        const rel = st.relations.find((r) => r.fromId === c.id && r.toId === session.focusCharacterId)
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
