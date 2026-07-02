import { useState } from 'react'
import { useStore } from '../../store'
import type { Persona } from '../../types'
import AvatarField from './AvatarField'

interface Props {
  persona: Persona
  onClose: () => void
}

export default function PersonaEditor({ persona, onClose }: Props) {
  const { upsertPersona, deletePersona } = useStore()
  const [d, setD] = useState<Persona>(persona)
  const patch = (p: Partial<Persona>) => setD((x) => ({ ...x, ...p }))

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>ペルソナ（あなたが演じる人物）</h3>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>アバター</label>
            <AvatarField avatar={d.avatar} name={d.name} onChange={(avatar) => patch({ avatar })} />
          </div>
          <div className="field">
            <label>名前</label>
            <input value={d.name} placeholder="例: 主人公" onChange={(e) => patch({ name: e.target.value })} />
          </div>
          <div className="field">
            <label>説明・設定</label>
            <textarea
              rows={4}
              value={d.description}
              placeholder="例: 転校してきたばかりの高校生。好奇心旺盛で..."
              onChange={(e) => patch({ description: e.target.value })}
            />
          </div>
        </div>
        <div className="modal-foot">
          <button
            className="btn danger"
            onClick={() => {
              if (confirm('このペルソナを削除しますか？')) {
                deletePersona(d.id)
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
              upsertPersona(d)
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
