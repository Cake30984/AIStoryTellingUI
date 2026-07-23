import { useState } from 'react'
import { useStore } from '../store'
import type { Scene, Session } from '../types'
import EntityAvatar from './EntityAvatar'
import ModalShell from './ModalShell'

interface Props {
  session: Session
  scene: Scene
  onClose: () => void
}

export default function SceneEditor({ session, scene, onClose }: Props) {
  const { updateScene, characters } = useStore()
  const [d, setD] = useState<Scene>(scene)
  const [dirty, setDirty] = useState(false)
  const patch = (p: Partial<Scene>) => {
    setD((s) => ({ ...s, ...p }))
    setDirty(true)
  }

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
    <ModalShell
      title="シーン設定"
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
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
        </>
      }
    >
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
              <p className="inline-empty">セッション設定で登場キャラクターを追加してください。</p>
            ) : (
              <div className="pick-grid">
                {roster.map((c) => (
                  <button
                    key={c.id}
                    className={'pick-chip' + (d.activeCharacterIds.includes(c.id) ? ' on' : '')}
                    onClick={() => toggle(c.id)}
                  >
                    <EntityAvatar className="dot-avatar" avatar={c.avatar} name={c.name || '無名'} />
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
    </ModalShell>
  )
}
