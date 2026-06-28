import { useState } from 'react'
import { newCharacter, useStore } from '../../store'
import type { Character } from '../../types'
import CharacterEditor from './CharacterEditor'

export default function CharacterLibrary() {
  const characters = useStore((s) => s.characters)
  const [editing, setEditing] = useState<Character | null>(null)

  return (
    <div className="library">
      <div className="library-head">
        <h2>🎭 キャラクター</h2>
        <button className="btn primary" onClick={() => setEditing(newCharacter())}>
          ＋ 新規キャラ
        </button>
      </div>

      {characters.length === 0 ? (
        <div className="library-empty">
          <p>まだキャラクターがいません。「＋ 新規キャラ」から作成しましょう。</p>
        </div>
      ) : (
        <div className="card-grid">
          {characters.map((c) => (
            <div key={c.id} className="entity-card" onClick={() => setEditing(c)}>
              <div className="entity-avatar" style={{ background: c.avatar.color }}>
                {c.avatar.emoji || '✦'}
              </div>
              <div className="entity-body">
                <div className="entity-name">{c.name || '無名'}</div>
                <div className="entity-desc">{c.persona || '設定なし'}</div>
                {c.tags.length > 0 && (
                  <div className="tag-row">
                    {c.tags.map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <CharacterEditor character={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
