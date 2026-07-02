import { useState } from 'react'
import { newPersona, useStore } from '../../store'
import type { Persona } from '../../types'
import PersonaEditor from './PersonaEditor'
import EntityAvatar from '../EntityAvatar'
import { parseCardPng, attachCardImage } from '../../lib/cards'
import { useCardDrop } from '../../lib/useCardDrop'

export default function PersonaLibrary() {
  const { personas, importPersonaCard } = useStore()
  const [editing, setEditing] = useState<Persona | null>(null)
  const [notice, setNotice] = useState('')

  const handleFiles = async (files: FileList) => {
    for (const file of Array.from(files)) {
      if (!file.type.includes('png') && !file.name.toLowerCase().endsWith('.png')) continue
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const parsed = parseCardPng(bytes)
        if (!parsed || parsed.kind !== 'persona') throw new Error('ペルソナカードが見つかりません。')
        const withImage = await attachCardImage(parsed.persona, bytes)
        importPersonaCard(withImage)
        setNotice(`カードから「${withImage.name || '無名'}」を追加しました。`)
      } catch (e) {
        setNotice(`インポート失敗：${(e as Error).message}`)
      }
    }
  }

  const { dragOver, dropProps } = useCardDrop(handleFiles)

  return (
    <div className="library" {...dropProps}>
      <div className="library-head">
        <h2>🙂 ペルソナ</h2>
        <button className="btn primary" onClick={() => setEditing(newPersona())}>
          ＋ 新規ペルソナ
        </button>
      </div>

      <div className="desc">ペルソナカード（PNG）をここにドラッグ＆ドロップするとインポートできます。</div>
      {notice && <p className="notice">{notice}</p>}

      {personas.length === 0 ? (
        <div className={'library-empty' + (dragOver ? ' drag-over' : '')}>
          <p>「自分が演じる人物」を登録すると、各セッションで切り替えて使えます。</p>
        </div>
      ) : (
        <div className={'card-grid' + (dragOver ? ' drag-over' : '')}>
          {personas.map((p) => (
            <div key={p.id} className="entity-card" onClick={() => setEditing(p)}>
              <EntityAvatar className="entity-avatar" avatar={p.avatar} name={p.name || '🙂'} />
              <div className="entity-body">
                <div className="entity-name">{p.name || '無名'}</div>
                <div className="entity-desc">{p.description || '設定なし'}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <PersonaEditor persona={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
