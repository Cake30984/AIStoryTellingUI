import { useState } from 'react'
import { newWorld, useStore } from '../../store'
import type { World } from '../../types'
import WorldEditor from './WorldEditor'
import { parseCardPng } from '../../lib/cards'
import { useCardDrop } from '../../lib/useCardDrop'
import { useMultiSelect } from '../../lib/useMultiSelect'
import { appConfirm } from '../../lib/dialogs'
import { SelectionBar, CardContextMenu } from './LibraryMultiSelect'
import { Icon } from '../icons'

export default function WorldLibrary() {
  const { worlds, importWorldCard, deleteWorld } = useStore()
  const [editing, setEditing] = useState<World | null>(null)
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null)

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

  const q = query.trim().toLowerCase()
  const visible = worlds.filter((w) => !q || (w.name || '').toLowerCase().includes(q))

  const { selected, clear, handleClick, selectForContext } = useMultiSelect(visible.map((w) => w.id))

  const doDelete = async (ids: string[]) => {
    const names = ids
      .map((id) => worlds.find((w) => w.id === id)?.name || '無名の世界')
      .slice(0, 5)
      .join('・')
    const more = ids.length > 5 ? ` ほか${ids.length - 5}件` : ''
    if (
      !(await appConfirm({
        message: `世界観${ids.length}件（${names}${more}）を削除しますか？\nこの操作は元に戻せません。`,
        danger: true,
      }))
    )
      return
    ids.forEach((id) => deleteWorld(id))
    clear()
  }

  if (editing) {
    return <WorldEditor world={editing} onClose={() => setEditing(null)} />
  }

  return (
    <div className={'library' + (dragOver ? ' drag-over' : '')} {...dropProps}>
      <div className="library-head">
        <h2>🌍 世界観</h2>
        <button className="btn primary" onClick={() => setEditing(newWorld())}>
          <Icon name="plus" size={14} /> 新規世界観
        </button>
      </div>

      <div className="desc">世界観カード（PNG）をここにドラッグ＆ドロップするとインポートできます。</div>
      {worlds.length > 0 && (
        <input
          className="model-search"
          placeholder="名前で検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {notice && <p className="notice">{notice}</p>}

      <SelectionBar
        count={selected.size}
        noun="世界観"
        onDelete={() => doDelete([...selected])}
        onClear={clear}
      />

      {worlds.length === 0 ? (
        <div className="library-empty">
          <p>世界観（ロアブック）を作ると、複数のセッションで共有できます。</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="library-empty">
          <p>見つかりません。</p>
        </div>
      ) : (
        <div className="card-grid">
          {visible.map((w) => (
            <div
              key={w.id}
              className={'entity-card' + (selected.has(w.id) ? ' selected' : '')}
              onClick={(e) => {
                if (handleClick(e, w.id)) return
                setEditing(w)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                selectForContext(w.id)
                setCtxMenu({ id: w.id, x: e.clientX, y: e.clientY })
              }}
            >
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

      {ctxMenu && (
        <CardContextMenu
          pos={{ x: ctxMenu.x, y: ctxMenu.y }}
          count={selected.has(ctxMenu.id) ? selected.size : 1}
          noun="世界観"
          onEdit={() => {
            const w = worlds.find((x) => x.id === ctxMenu.id)
            if (w) setEditing(w)
          }}
          onDelete={() =>
            doDelete(selected.has(ctxMenu.id) && selected.size > 0 ? [...selected] : [ctxMenu.id])
          }
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  )
}
