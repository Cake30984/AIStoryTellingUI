import { useState } from 'react'
import { useStore } from '../store'
import type { Session, SessionState } from '../types'
import EntityAvatar from './EntityAvatar'
import ModalShell from './ModalShell'

interface Props {
  session: Session
  onClose: () => void
}

/** セッションの状態（関係性 prose）の閲覧・手動編集パネル */
export default function StatusPanel({ session, onClose }: Props) {
  const { worlds, characters, applyStatusEdit } = useStore()
  const world = worlds.find((w) => w.id === session.worldId)
  const heroName = characters.find((c) => c.id === session.focusCharacterId)?.name || '主人公'
  const cast = session.characterIds
    .filter((id) => id !== session.focusCharacterId)
    .map((id) => characters.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => !!c)
  const aspectName = (id: string) => world?.relationAspects.find((a) => a.id === id)?.name ?? ''

  const [st, setSt] = useState<SessionState>(() => ({
    ...session.state,
    relations: session.state.relations.map((r) => ({
      ...r,
      aspects: r.aspects.map((a) => ({ ...a })),
    })),
    moods: session.state.moods.map((m) => ({ ...m })),
    presentIds: [...session.state.presentIds],
    pending: session.state.pending.map((x) => ({ ...x })),
    recentDone: session.state.recentDone.map((x) => ({ ...x })),
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

  const save = () => {
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
            // 関係性の宛先＝中心人物（F3。'hero' という特別値は廃止）
            const relIdx = st.relations.findIndex(
              (r) => r.fromId === c.id && r.toId === session.focusCharacterId,
            )
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

    </ModalShell>
  )
}
