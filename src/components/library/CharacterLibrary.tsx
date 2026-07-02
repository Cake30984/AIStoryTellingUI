import { useState } from 'react'
import { newCharacter, useStore } from '../../store'
import type { Character } from '../../types'
import CharacterEditor from './CharacterEditor'
import EntityAvatar from '../EntityAvatar'
import { parseCardPng, attachCardImage } from '../../lib/cards'

export default function CharacterLibrary() {
  const { characters, importCharacterCard } = useStore()
  const [editing, setEditing] = useState<Character | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [notice, setNotice] = useState('')

  const handleFiles = async (files: FileList) => {
    for (const file of Array.from(files)) {
      if (!file.type.includes('png') && !file.name.toLowerCase().endsWith('.png')) continue
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const parsed = parseCardPng(bytes)
        if (!parsed) throw new Error('カード情報が見つかりません。')
        const withImage = await attachCardImage(parsed.character, bytes)
        importCharacterCard(withImage)
        setNotice(`カードから「${withImage.name || '無名'}」を追加しました。`)
      } catch (e) {
        setNotice(`インポート失敗：${(e as Error).message}`)
      }
    }
  }

  return (
    <div
      className="library"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files)
      }}
    >
      <div className="library-head">
        <h2>🎭 キャラクター</h2>
        <button className="btn primary" onClick={() => setEditing(newCharacter())}>
          ＋ 新規キャラ
        </button>
      </div>

      <div className="desc">キャラカード（PNG）をここにドラッグ＆ドロップするとインポートできます。</div>
      {notice && <p className="notice">{notice}</p>}

      {characters.length === 0 ? (
        <div className={'library-empty' + (dragOver ? ' drag-over' : '')}>
          <p>まだキャラクターがいません。「＋ 新規キャラ」から作成、またはカード画像をドロップしましょう。</p>
        </div>
      ) : (
        <div className={'card-grid' + (dragOver ? ' drag-over' : '')}>
          {characters.map((c) => (
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
