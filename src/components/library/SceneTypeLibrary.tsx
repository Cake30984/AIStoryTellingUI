import { useState } from 'react'
import { newSceneType, useStore } from '../../store'
import type { SceneType } from '../../types'
import SceneTypeEditor from './SceneTypeEditor'
import { useMultiSelect } from '../../lib/useMultiSelect'
import { appConfirm } from '../../lib/dialogs'
import { SelectionBar, CardContextMenu } from './LibraryMultiSelect'
import { Icon } from '../icons'

export default function SceneTypeLibrary() {
  const sceneTypes = useStore((s) => s.sceneTypes)
  const deleteSceneType = useStore((s) => s.deleteSceneType)
  const [editing, setEditing] = useState<SceneType | null>(null)
  const [query, setQuery] = useState('')
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null)

  const q = query.trim().toLowerCase()
  const visible = sceneTypes.filter((t) => !q || (t.name || '').toLowerCase().includes(q))

  const { selected, clear, handleClick, selectForContext } = useMultiSelect(visible.map((t) => t.id))

  const doDelete = async (ids: string[]) => {
    const names = ids
      .map((id) => sceneTypes.find((t) => t.id === id)?.name || '無名')
      .slice(0, 5)
      .join('・')
    const more = ids.length > 5 ? ` ほか${ids.length - 5}件` : ''
    if (
      !(await appConfirm({
        message: `シーンの種類${ids.length}件（${names}${more}）を削除しますか？\nこの操作は元に戻せません。`,
        danger: true,
      }))
    )
      return
    ids.forEach((id) => deleteSceneType(id))
    clear()
  }

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

      <SelectionBar
        count={selected.size}
        noun="種類"
        onDelete={() => doDelete([...selected])}
        onClear={clear}
      />

      {visible.length > 0 && (
        <div className="card-grid">
          {visible.map((t) => (
            <div
              key={t.id}
              className={'entity-card' + (selected.has(t.id) ? ' selected' : '')}
              onClick={(e) => {
                if (handleClick(e, t.id)) return
                setEditing(t)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                selectForContext(t.id)
                setCtxMenu({ id: t.id, x: e.clientX, y: e.clientY })
              }}
            >
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

      {ctxMenu && (
        <CardContextMenu
          pos={{ x: ctxMenu.x, y: ctxMenu.y }}
          count={selected.has(ctxMenu.id) ? selected.size : 1}
          noun="種類"
          onEdit={() => {
            const t = sceneTypes.find((x) => x.id === ctxMenu.id)
            if (t) setEditing(t)
          }}
          onDelete={() =>
            doDelete(selected.has(ctxMenu.id) && selected.size > 0 ? [...selected] : [ctxMenu.id])
          }
          onClose={() => setCtxMenu(null)}
        />
      )}

      {editing && <SceneTypeEditor sceneType={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
