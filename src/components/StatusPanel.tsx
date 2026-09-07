import { useState } from 'react'
import { useStore } from '../store'
import type { Session, SessionState } from '../types'
import EntityAvatar from './EntityAvatar'
import ModalShell from './ModalShell'
import { Icon } from './icons'

interface Props {
  session: Session
  onClose: () => void
}

/** セッションの状態（関係性 prose）の閲覧・手動編集パネル */
export default function StatusPanel({ session, onClose }: Props) {
  const { worlds, characters, personas, applyStatusEdit } = useStore()
  const world = worlds.find((w) => w.id === session.worldId)
  const heroName = personas.find((p) => p.id === session.personaId)?.name || '主人公'
  const cast = session.characterIds
    .map((id) => characters.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => !!c)
  const aspectName = (id: string) => world?.relationAspects.find((a) => a.id === id)?.name ?? ''

  const [st, setSt] = useState<SessionState>(() => ({
    relations: session.state.relations.map((r) => ({
      ...r,
      aspects: r.aspects.map((a) => ({ ...a })),
    })),
    moods: session.state.moods.map((m) => ({ ...m })),
    achievements: (session.state.achievements ?? []).map((a) => ({ ...a })),
  }))
  const [dirty, setDirty] = useState(false)
  const mutate = (updater: (prev: SessionState) => SessionState) => {
    setSt(updater)
    setDirty(true)
  }

  const setStance = (i: number, stance: string) =>
    mutate((prev) => {
      const relations = prev.relations.slice()
      relations[i] = { ...relations[i], stance }
      return { ...prev, relations }
    })
  const setAspectNote = (i: number, aspectId: string, note: string) =>
    mutate((prev) => {
      const relations = prev.relations.slice()
      relations[i] = {
        ...relations[i],
        aspects: relations[i].aspects.map((a) => (a.aspectId === aspectId ? { ...a, note } : a)),
      }
      return { ...prev, relations }
    })

  const isUnlocked = (defId: string) => st.achievements.some((a) => a.defId === defId)
  const toggleAchievement = (defId: string) =>
    mutate((prev) => {
      const has = prev.achievements.some((a) => a.defId === defId)
      const achievements = has
        ? prev.achievements.filter((a) => a.defId !== defId)
        : [...prev.achievements, { defId, unlockedAt: Date.now() }]
      return { ...prev, achievements }
    })


  const save = () => {
    // clamp・実績の再評価はストア側（applyStatusEdit）で行う
    applyStatusEdit(st)
    onClose()
  }

  return (
    <ModalShell
      title="📊 状態"
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
          {!world && (
            <p className="inline-empty">
              ワールドを設定すると、関係性を管理できます。
            </p>
          )}

          {/* キャラ別の関係性 */}
          {cast.map((c) => {
            const relIdx = st.relations.findIndex((r) => r.fromId === c.id && r.toId === 'hero')
            const rel = relIdx >= 0 ? st.relations[relIdx] : null
            const mood = st.moods.find((m) => m.characterId === c.id)?.mood
            return (
              <div key={c.id} className="field">
                <label>
                  <EntityAvatar className="dot-avatar" avatar={c.avatar} name={c.name || '無名'} />{' '}
                  {c.name || '無名'} → {heroName}
                </label>
                {rel ? (
                  <>
                    <textarea
                      rows={2}
                      value={rel.stance}
                      placeholder="関係の現在地（stance）"
                      onChange={(e) => setStance(relIdx, e.target.value)}
                    />
                    {rel.aspects.map((a) => (
                      <div key={a.aspectId} className="sub-field" style={{ marginTop: 6 }}>
                        <span className="sub-label">{aspectName(a.aspectId)}</span>
                        <textarea
                          rows={2}
                          value={a.note}
                          onChange={(e) => setAspectNote(relIdx, a.aspectId, e.target.value)}
                        />
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="desc">まだ関係性の記録はありません（シーンを終えると生成されます）。</div>
                )}
                {mood && <div className="desc" style={{ marginTop: 4 }}>気分: {mood}</div>}
              </div>
            )
          })}

          {/* 実績 */}
          {(world?.achievements ?? []).length > 0 && (
            <div className="field">
              <label>
                <Icon name="trophy" size={13} className="label-icon" /> 実績
              </label>
              {world!.achievements.map((a) => {
                const unlocked = isUnlocked(a.id)
                const conceal = a.hidden && !unlocked
                return (
                  <label
                    key={a.id}
                    className="chk"
                    style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}
                  >
                    <input
                      type="checkbox"
                      checked={unlocked}
                      onChange={() => toggleAchievement(a.id)}
                    />
                    <span>{conceal ? '？？？' : a.name || '無名'}</span>
                    {!conceal && a.description && (
                      <span className="desc" style={{ marginLeft: 4 }}>
                        {a.description}
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          )}

          {/* エンディング（v1 は表示のみ。外したい場合は分岐復元で代替） */}
          {(world?.endings ?? []).length > 0 && (
            <div className="field">
              <label>
                <Icon name="flag" size={13} className="label-icon" /> エンディング
              </label>
              {world!.endings!.map((e) => {
                const reached = session.ending?.defId === e.id
                const conceal = e.hidden && !reached
                return (
                  <div
                    key={e.id}
                    className="desc"
                    style={{ opacity: reached ? 1 : 0.7, marginBottom: 4, fontWeight: reached ? 600 : undefined }}
                  >
                    <Icon
                      name={reached ? 'flag' : 'lock'}
                      size={12}
                      className={reached ? 'state-icon accent' : 'state-icon'}
                    />{' '}
                    {conceal ? '？？？' : e.name || '無名'}
                    {!conceal && e.description && <span> — {e.description}</span>}
                  </div>
                )
              })}
            </div>
          )}
    </ModalShell>
  )
}
