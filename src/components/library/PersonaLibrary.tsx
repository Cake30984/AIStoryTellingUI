import { useState } from 'react'
import { newPersona, useStore } from '../../store'
import type { Persona } from '../../types'
import PersonaEditor from './PersonaEditor'
import EntityAvatar from '../EntityAvatar'
import { parseCardPng, attachCardImage } from '../../lib/cards'
import { useCardDrop } from '../../lib/useCardDrop'
import { useMultiSelect } from '../../lib/useMultiSelect'
import { appConfirm } from '../../lib/dialogs'
import { SelectionBar, CardContextMenu } from './LibraryMultiSelect'
import { Icon } from '../icons'

export default function PersonaLibrary() {
  const { personas, importPersonaCard, deletePersona } = useStore()
  const [editing, setEditing] = useState<Persona | null>(null)
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null)

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

  const q = query.trim().toLowerCase()
  const visible = personas.filter((p) => !q || (p.name || '').toLowerCase().includes(q))

  const { selected, clear, handleClick, selectForContext } = useMultiSelect(visible.map((p) => p.id))

  const doDelete = async (ids: string[]) => {
    const names = ids
      .map((id) => personas.find((p) => p.id === id)?.name || '無名')
      .slice(0, 5)
      .join('・')
    const more = ids.length > 5 ? ` ほか${ids.length - 5}件` : ''
    if (
      !(await appConfirm({
        message: `ペルソナ${ids.length}件（${names}${more}）を削除しますか？\nこの操作は元に戻せません。`,
        danger: true,
      }))
    )
      return
    ids.forEach((id) => deletePersona(id))
    clear()
  }

  return (
    <div className={'library' + (dragOver ? ' drag-over' : '')} {...dropProps}>
      <div className="library-head">
        <h2>
          <Icon name="smile" size={18} className="head-icon" />
          ペルソナ
        </h2>
        <button className="btn primary" onClick={() => setEditing(newPersona())}>
          <Icon name="plus" size={14} /> ペルソナを作る
        </button>
      </div>

      <div className="desc">ペルソナカード（PNG）をここにドラッグ＆ドロップするとインポートできます。</div>
      {personas.length > 0 && (
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
        noun="ペルソナ"
        onDelete={() => doDelete([...selected])}
        onClear={clear}
      />

      {personas.length === 0 ? (
        <div className="library-empty">
          <p>「自分が演じる人物」を登録すると、各セッションで切り替えて使えます。</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="library-empty">
          <p>見つかりません。</p>
        </div>
      ) : (
        <div className="card-grid">
          {visible.map((p) => (
            <div
              key={p.id}
              className={'entity-card' + (selected.has(p.id) ? ' selected' : '')}
              onClick={(e) => {
                if (handleClick(e, p.id)) return
                setEditing(p)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                selectForContext(p.id)
                setCtxMenu({ id: p.id, x: e.clientX, y: e.clientY })
              }}
            >
              <EntityAvatar className="entity-avatar" avatar={p.avatar} name={p.name || 'ペルソナ'} />
              <div className="entity-body">
                <div className="entity-name">{p.name || '無名'}</div>
                <div className="entity-desc">{p.description || '設定なし'}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {ctxMenu && (
        <CardContextMenu
          pos={{ x: ctxMenu.x, y: ctxMenu.y }}
          count={selected.has(ctxMenu.id) ? selected.size : 1}
          noun="ペルソナ"
          onEdit={() => {
            const p = personas.find((x) => x.id === ctxMenu.id)
            if (p) setEditing(p)
          }}
          onDelete={() =>
            doDelete(selected.has(ctxMenu.id) && selected.size > 0 ? [...selected] : [ctxMenu.id])
          }
          onClose={() => setCtxMenu(null)}
        />
      )}

      {editing && <PersonaEditor persona={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
