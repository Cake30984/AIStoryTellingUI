import { useState } from 'react'
import { useStore } from '../../store'
import type { SceneType } from '../../types'
import { appConfirm } from '../../lib/dialogs'
import ModalShell from '../ModalShell'

const COLORS = ['#7c5cff', '#ef6f6c', '#4cc9a4', '#f0a76b', '#5b8def', '#d77ad8', '#e0b341', '#8b95a7']

interface Props {
  sceneType: SceneType
  onClose: () => void
}

export default function SceneTypeEditor({ sceneType, onClose }: Props) {
  const { upsertSceneType, deleteSceneType } = useStore()
  const [d, setD] = useState<SceneType>(sceneType)
  const [dirty, setDirty] = useState(false)
  const patch = (p: Partial<SceneType>) => {
    setD((x) => ({ ...x, ...p }))
    setDirty(true)
  }

  return (
    <ModalShell
      title="シーンの種類"
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <button
            className="btn danger"
            onClick={async () => {
              if (await appConfirm({ message: 'このシーン種類を削除しますか？', danger: true })) {
                deleteSceneType(d.id)
                onClose()
              }
            }}
          >
            削除
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            キャンセル
          </button>
          <button
            className="btn primary"
            onClick={() => {
              upsertSceneType(d)
              onClose()
            }}
          >
            保存
          </button>
        </>
      }
    >
          <div className="field">
            <label>名称</label>
            <input
              value={d.name}
              placeholder="例: バトルへの伏線"
              onChange={(e) => patch({ name: e.target.value })}
            />
          </div>
          <div className="field">
            <label>演出ガイド</label>
            <div className="desc">このタイプが選ばれた時、AIに渡す方向づけの指示。</div>
            <textarea
              rows={3}
              value={d.guidance}
              placeholder="例: 今後の戦いの予兆や違和感をさりげなく忍ばせる。"
              onChange={(e) => patch({ guidance: e.target.value })}
            />
          </div>
          <div className="row2">
            <div className="field" style={{ marginBottom: 0 }}>
              <label>出やすさ（重み）</label>
              <div className="range-row">
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={d.weight}
                  onChange={(e) => patch({ weight: Number(e.target.value) })}
                />
                <span className="val">{d.weight}</span>
              </div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>最低間隔（クールダウン）</label>
              <div className="range-row">
                <input
                  type="range"
                  min={0}
                  max={8}
                  step={1}
                  value={d.minGap}
                  onChange={(e) => patch({ minGap: Number(e.target.value) })}
                />
                <span className="val">{d.minGap}</span>
              </div>
            </div>
          </div>
          <div className="field" style={{ marginTop: 18 }}>
            <label>色</label>
            <div className="color-row">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={'color-dot' + (d.color === c ? ' on' : '')}
                  style={{ background: c }}
                  onClick={() => patch({ color: c })}
                />
              ))}
            </div>
          </div>
    </ModalShell>
  )
}
