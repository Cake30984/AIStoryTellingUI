import { useState } from 'react'
import { newPersona, useStore } from '../../store'
import type { Persona } from '../../types'
import PersonaEditor from './PersonaEditor'

export default function PersonaLibrary() {
  const personas = useStore((s) => s.personas)
  const [editing, setEditing] = useState<Persona | null>(null)

  return (
    <div className="library">
      <div className="library-head">
        <h2>🙂 ペルソナ</h2>
        <button className="btn primary" onClick={() => setEditing(newPersona())}>
          ＋ 新規ペルソナ
        </button>
      </div>

      {personas.length === 0 ? (
        <div className="library-empty">
          <p>「自分が演じる人物」を登録すると、各セッションで切り替えて使えます。</p>
        </div>
      ) : (
        <div className="card-grid">
          {personas.map((p) => (
            <div key={p.id} className="entity-card" onClick={() => setEditing(p)}>
              <div className="entity-avatar" style={{ background: p.avatar.color }}>
                {p.avatar.emoji || '🙂'}
              </div>
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
