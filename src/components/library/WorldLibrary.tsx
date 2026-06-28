import { useState } from 'react'
import { newWorld, useStore } from '../../store'
import type { World } from '../../types'
import WorldEditor from './WorldEditor'

export default function WorldLibrary() {
  const worlds = useStore((s) => s.worlds)
  const [editing, setEditing] = useState<World | null>(null)

  return (
    <div className="library">
      <div className="library-head">
        <h2>🌍 世界観</h2>
        <button className="btn primary" onClick={() => setEditing(newWorld())}>
          ＋ 新規世界観
        </button>
      </div>

      {worlds.length === 0 ? (
        <div className="library-empty">
          <p>世界観（ロアブック）を作ると、複数のセッションで共有できます。</p>
        </div>
      ) : (
        <div className="card-grid">
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
