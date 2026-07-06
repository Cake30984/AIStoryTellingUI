import { useState } from 'react'
import { useStore } from '../../store'
import type { Persona } from '../../types'
import AvatarField from './AvatarField'
import { exportPersonaCard } from '../../lib/cards'

interface Props {
  persona: Persona
  onClose: () => void
}

export default function PersonaEditor({ persona, onClose }: Props) {
  const { upsertPersona, deletePersona } = useStore()
  const [d, setD] = useState<Persona>(persona)
  const [exporting, setExporting] = useState(false)
  const patch = (p: Partial<Persona>) => setD((x) => ({ ...x, ...p }))

  const exportCard = async () => {
    setExporting(true)
    try {
      await exportPersonaCard(d)
    } finally {
      setExporting(false)
    }
  }

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
          <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 0, marginBottom: 10 }}>
            素材の編集・保存はすべてのセッション・すべての分岐に共有されます（分岐を戻しても巻き戻りません）。
          </p>
          <div className="field">
            <label>アバター</label>
            <AvatarField
              avatar={d.avatar}
              name={d.name}
              genContext={{ name: d.name, appearance: d.description, imagePrompt: d.imagePrompt }}
              target={{ type: 'persona-avatar', personaId: d.id }}
              onChange={(avatar) => patch({ avatar })}
            />
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
          <div className="field">
            <label>画像生成タグ（英語・任意）</label>
            <div className="desc">髪色や画風などの固定タグ。挿絵・アバター生成時に自動で使われます。</div>
            <input
              value={d.imagePrompt ?? ''}
              placeholder="例: 1boy, short brown hair, casual clothes"
              onChange={(e) => patch({ imagePrompt: e.target.value || undefined })}
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
          <button className="btn" onClick={exportCard} disabled={exporting}>
            {exporting ? '書き出し中…' : '🖼 カードとして保存'}
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
