import { useState } from 'react'
import { newCharacter, useStore } from '../../store'
import type { Character } from '../../types'
import CharacterEditor from './CharacterEditor'
import EntityAvatar from '../EntityAvatar'
import { parseCardPng, attachCardImage } from '../../lib/cards'
import { useCardDrop } from '../../lib/useCardDrop'
import { useMultiSelect } from '../../lib/useMultiSelect'
import { appConfirm } from '../../lib/dialogs'
import { SelectionBar, CardContextMenu } from './LibraryMultiSelect'
import { Icon } from '../icons'

export default function CharacterLibrary() {
  const { characters, importCharacterCard, deleteCharacter } = useStore()
  const [editing, setEditing] = useState<Character | null>(null)
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null)

  const handleFiles = async (files: FileList) => {
    for (const file of Array.from(files)) {
      if (!file.type.includes('png') && !file.name.toLowerCase().endsWith('.png')) continue
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const parsed = parseCardPng(bytes)
        if (!parsed || parsed.kind !== 'character') throw new Error('キャラカードが見つかりません。')
        const withImage = await attachCardImage(parsed.character, bytes)
        importCharacterCard(withImage)
        setNotice(`カードから「${withImage.name || '無名'}」を追加しました。`)
      } catch (e) {
        setNotice(`インポート失敗：${(e as Error).message}`)
      }
    }
  }

  const { dragOver, dropProps } = useCardDrop(handleFiles)

  const q = query.trim().toLowerCase()
  const visible = characters.filter((c) => {
    if (!q) return true
    if ((c.name || '').toLowerCase().includes(q)) return true
    return c.tags.some((t) => t.toLowerCase().includes(q))
  })

  const { selected, clear, handleClick, selectForContext } = useMultiSelect(visible.map((c) => c.id))

  const doDelete = async (ids: string[]) => {
    const names = ids
      .map((id) => characters.find((c) => c.id === id)?.name || '無名')
      .slice(0, 5)
      .join('・')
    const more = ids.length > 5 ? ` ほか${ids.length - 5}件` : ''
    if (
      !(await appConfirm({
        message: `キャラクター${ids.length}件（${names}${more}）を削除しますか？\nこの操作は元に戻せません。`,
        danger: true,
      }))
    )
      return
    ids.forEach((id) => deleteCharacter(id))
    clear()
  }

  return (
    <div className={'library' + (dragOver ? ' drag-over' : '')} {...dropProps}>
      <div className="library-head">
        <h2>🎭 キャラクター</h2>
        <button className="btn primary" onClick={() => setEditing(newCharacter())}>
          <Icon name="plus" size={14} /> キャラクターを作る
        </button>
      </div>

      <div className="desc">キャラカード（PNG）をここにドラッグ＆ドロップするとインポートできます。</div>
      {characters.length > 0 && (
        <input
          className="model-search"
          placeholder="名前・タグで検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {notice && <p className="notice">{notice}</p>}

      <SelectionBar
        count={selected.size}
        noun="キャラ"
        onDelete={() => doDelete([...selected])}
        onClear={clear}
      />

      {characters.length === 0 ? (
        <div className="library-empty">
          <p>まだキャラクターがいません。「キャラクターを作る」から作成、またはカード画像をドロップしましょう。</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="library-empty">
          <p>見つかりません。</p>
        </div>
      ) : (
        <div className="card-grid">
          {visible.map((c) => (
            <div
              key={c.id}
              className={'entity-card' + (selected.has(c.id) ? ' selected' : '')}
              onClick={(e) => {
                if (handleClick(e, c.id)) return
                setEditing(c)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                selectForContext(c.id)
                setCtxMenu({ id: c.id, x: e.clientX, y: e.clientY })
              }}
            >
              <EntityAvatar className="entity-avatar" avatar={c.avatar} name={c.name || '✦'} />
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

      {ctxMenu && (
        <CardContextMenu
          pos={{ x: ctxMenu.x, y: ctxMenu.y }}
          count={selected.has(ctxMenu.id) ? selected.size : 1}
          noun="キャラ"
          onEdit={() => {
            const c = characters.find((x) => x.id === ctxMenu.id)
            if (c) setEditing(c)
          }}
          onDelete={() =>
            doDelete(selected.has(ctxMenu.id) && selected.size > 0 ? [...selected] : [ctxMenu.id])
          }
          onClose={() => setCtxMenu(null)}
        />
      )}

      {editing && <CharacterEditor character={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
