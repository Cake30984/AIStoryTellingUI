import { useState } from 'react'
import { newSceneType, useStore } from '../../store'
import type { SceneType } from '../../types'
import SceneTypeEditor from './SceneTypeEditor'
import { Icon } from '../icons'

export default function SceneTypeLibrary() {
  const sceneTypes = useStore((s) => s.sceneTypes)
  const [editing, setEditing] = useState<SceneType | null>(null)
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const visible = sceneTypes.filter((t) => !q || (t.name || '').toLowerCase().includes(q))

  return (
    <div className="library">
      <div className="library-head">
        <h2>🎬 シーンの種類</h2>
        <button className="btn primary" onClick={() => setEditing(newSceneType())}>
          <Icon name="plus" size={14} /> 新規タイプ
        </button>
      </div>

      <div className="library-empty" style={{ marginBottom: 16, padding: 16 }}>
        セッション設定で「演出ディレクター」を有効にすると、ここで定義した種類から
        重み・クールダウンに基づいて次シーンが自動抽選されます。
      </div>

      {sceneTypes.length > 0 && (
        <input
          className="model-search"
          placeholder="名前で検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {sceneTypes.length > 0 && visible.length === 0 && (
        <div className="library-empty">
          <p>見つかりません。</p>
        </div>
      )}

      {visible.length > 0 && (
        <div className="card-grid">
          {visible.map((t) => (
            <div key={t.id} className="entity-card" onClick={() => setEditing(t)}>
              <div className="entity-avatar" style={{ background: t.color }}>
                🎬
              </div>
              <div className="entity-body">
                <div className="entity-name">{t.name || '無名'}</div>
                <div className="entity-desc">{t.guidance || '演出ガイドなし'}</div>
                <div className="tag-row">
                  <span className="tag">重み {t.weight}</span>
                  <span className="tag">間隔 {t.minGap}</span>
                  {t.builtin && <span className="tag">既定</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <SceneTypeEditor sceneType={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
