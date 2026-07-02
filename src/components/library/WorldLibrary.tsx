import { useState } from 'react'
import { newWorld, useStore } from '../../store'
import type { World } from '../../types'
import WorldEditor from './WorldEditor'
import { parseCardPng } from '../../lib/cards'
import { useCardDrop } from '../../lib/useCardDrop'

export default function WorldLibrary() {
  const { worlds, importWorldCard } = useStore()
  const [editing, setEditing] = useState<World | null>(null)
  const [notice, setNotice] = useState('')

  const handleFiles = async (files: FileList) => {
    for (const file of Array.from(files)) {
      if (!file.type.includes('png') && !file.name.toLowerCase().endsWith('.png')) continue
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const parsed = parseCardPng(bytes)
        if (!parsed || parsed.kind !== 'world') throw new Error('世界観カードが見つかりません。')
        importWorldCard(parsed.world)
        setNotice(`カードから「${parsed.world.name || '無名の世界'}」を追加しました。`)
      } catch (e) {
        setNotice(`インポート失敗：${(e as Error).message}`)
      }
    }
  }

  const { dragOver, dropProps } = useCardDrop(handleFiles)

  return (
    <div className="library" {...dropProps}>
      <div className="library-head">
        <h2>🌍 世界観</h2>
        <button className="btn primary" onClick={() => setEditing(newWorld())}>
          ＋ 新規世界観
        </button>
      </div>

      <div className="desc">世界観カード（PNG）をここにドラッグ＆ドロップするとインポートできます。</div>
      {notice && <p className="notice">{notice}</p>}

      {worlds.length === 0 ? (
        <div className={'library-empty' + (dragOver ? ' drag-over' : '')}>
          <p>世界観（ロアブック）を作ると、複数のセッションで共有できます。</p>
        </div>
      ) : (
        <div className={'card-grid' + (dragOver ? ' drag-over' : '')}>
          {worlds.map((w) => (
            <div key={w.id} className="entity-card" onClick={() => setEditing(w)}>
              <div className="entity-avatar" style={{ background: '#2f3346' }}>
                🌍
              </div>
              <div className="entity-body">
                <div className="entity-name">{w.name || '無名の世界'}</div>
                <div className="entity-desc">{w.description || '概要なし'}</div>
                <div className="tag-row">
                  <span className="tag">ロア {w.entries.length} 項目</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <WorldEditor world={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
