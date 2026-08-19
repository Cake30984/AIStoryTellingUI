import { useState } from 'react'
import { useStore } from '../store'
import type { Scene } from '../types'
import ModalShell from './ModalShell'

interface Props {
  scene: Scene
  onClose: () => void
}

export default function SceneEditor({ scene, onClose }: Props) {
  const { updateScene } = useStore()
  const [d, setD] = useState<Scene>(scene)
  const [dirty, setDirty] = useState(false)
  const patch = (p: Partial<Scene>) => {
    setD((s) => ({ ...s, ...p }))
    setDirty(true)
  }

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
            <label>状況メモ（時・場所・その場に居る人物）</label>
            <div className="desc">
              ここに書いた顔ぶれが、このシーンに登場する人物の目安になります。
            </div>
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
