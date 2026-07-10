import { useState } from 'react'
import { newCharacter, useStore } from '../../store'
import type { Character } from '../../types'
import CharacterEditor from './CharacterEditor'
import EntityAvatar from '../EntityAvatar'
import { parseCardPng, attachCardImage } from '../../lib/cards'
import { useCardDrop } from '../../lib/useCardDrop'
import { Icon } from '../icons'

export default function CharacterLibrary() {
  const { characters, importCharacterCard } = useStore()
  const [editing, setEditing] = useState<Character | null>(null)
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')

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

  return (
    <div className="library" {...dropProps}>
      <div className="library-head">
        <h2>🎭 キャラクター</h2>
        <button className="btn primary" onClick={() => setEditing(newCharacter())}>
          <Icon name="plus" size={14} /> 新規キャラ
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

      {characters.length === 0 ? (
        <div className={'library-empty' + (dragOver ? ' drag-over' : '')}>
          <p>まだキャラクターがいません。「＋ 新規キャラ」から作成、またはカード画像をドロップしましょう。</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="library-empty">
          <p>見つかりません。</p>
        </div>
      ) : (
        <div className={'card-grid' + (dragOver ? ' drag-over' : '')}>
          {visible.map((c) => (
            <div key={c.id} className="entity-card" onClick={() => setEditing(c)}>
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

      {editing && <CharacterEditor character={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
