import { useState } from 'react'
import { useStore } from '../store'
import type { Scene, Session } from '../types'

interface Props {
  session: Session
  scene: Scene
  onClose: () => void
}

export default function SceneEditor({ session, scene, onClose }: Props) {
  const { updateScene, characters } = useStore()
  const [d, setD] = useState<Scene>(scene)
  const patch = (p: Partial<Scene>) => setD((s) => ({ ...s, ...p }))

  // 候補はセッションの登場キャラ（ロスター）
  const roster = session.characterIds
    .map((id) => characters.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => !!c)

  const toggle = (id: string) =>
    patch({
      activeCharacterIds: d.activeCharacterIds.includes(id)
        ? d.activeCharacterIds.filter((c) => c !== id)
        : [...d.activeCharacterIds, id],
    })

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>📖 シーン設定</h3>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>シーン名</label>
            <input
              value={d.title}
              placeholder="例: 1日目・放課後の教室"
              onChange={(e) => patch({ title: e.target.value })}
            />
          </div>

          <div className="field">
            <label>このシーンの登場キャラ</label>
            <div className="desc">
              選んだキャラだけが登場・発言します。空にすると全員が対象になります。
            </div>
            {roster.length === 0 ? (
              <p className="inline-empty">セッション設定（⚙）で参加キャラを追加してください。</p>
            ) : (
              <div className="pick-grid">
                {roster.map((c) => (
                  <button
                    key={c.id}
                    className={'pick-chip' + (d.activeCharacterIds.includes(c.id) ? ' on' : '')}
                    onClick={() => toggle(c.id)}
                  >
                    <span className="dot-avatar" style={{ background: c.avatar.color }}>
                      {c.avatar.emoji}
                    </span>
                    {c.name || '無名'}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="field">
            <label>状況メモ（時・場所・状況）</label>
            <textarea
              rows={2}
              value={d.note}
              placeholder="例: 夕暮れの教室。二人きり。"
              onChange={(e) => patch({ note: e.target.value })}
            />
          </div>

          {(d.summary.trim() || d.endedAt) && (
            <div className="field">
              <label>引き継ぎ要約（編集可）</label>
              <div className="desc">このシーンのあらすじ。次シーン以降に引き継がれます。</div>
              <textarea
                rows={5}
                value={d.summary}
                onChange={(e) => patch({ summary: e.target.value })}
              />
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            キャンセル
          </button>
          <button
            className="btn primary"
            onClick={() => {
              updateScene(d.id, {
                title: d.title,
                activeCharacterIds: d.activeCharacterIds,
                note: d.note,
                summary: d.summary,
              })
              onClose()
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
