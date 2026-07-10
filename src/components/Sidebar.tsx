import { useState } from 'react'
import { areaOf, useStore, type View } from '../store'
import { parseCardPng } from '../lib/cards'
import { useCardDrop } from '../lib/useCardDrop'

const LIBRARY_NAV: { key: View; label: string; icon: string }[] = [
  { key: 'characters', label: 'キャラ', icon: '🎭' },
  { key: 'worlds', label: '世界観', icon: '🌍' },
  { key: 'personas', label: 'ペルソナ', icon: '🙂' },
  { key: 'sceneTypes', label: '演出', icon: '🎬' },
]

export default function Sidebar() {
  const { sessions, activeId, view, setView, setActive, createSession, characters, importSessionCard } = useStore()
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const area = areaOf(view)

  // セッションカード（PNG）のドロップ受付
  const handleFiles = async (files: FileList) => {
    for (const file of Array.from(files)) {
      if (!file.type.includes('png') && !file.name.toLowerCase().endsWith('.png')) continue
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const parsed = parseCardPng(bytes)
        if (!parsed || parsed.kind !== 'session') throw new Error('セッションカードではありません。')
        await importSessionCard(parsed.bundle)
        setNotice(`セッション「${parsed.bundle.session.title || '無題'}」を復元しました。`)
      } catch (e) {
        setNotice(`読み込み失敗：${(e as Error).message}`)
      }
    }
  }
  const { dragOver, dropProps } = useCardDrop(handleFiles)

  const q = query.trim().toLowerCase()
  const matchesQuery = (s: (typeof sessions)[number]) => {
    if (!q) return true
    if ((s.title || '').toLowerCase().includes(q)) return true
    return s.characterIds.some((id) =>
      (characters.find((c) => c.id === id)?.name ?? '').toLowerCase().includes(q),
    )
  }
  const archivedCount = sessions.filter((s) => s.archived).length
  const visible = sessions.filter((s) => (showArchived || !s.archived) && matchesQuery(s))

  return (
    <aside className="sidebar" {...dropProps} style={dragOver ? { outline: '2px dashed var(--accent)', outlineOffset: -4 } : undefined}>
      <div className="sidebar-head">
        <div className="brand">
          <span className="dot" />
          AI Storytelling Studio
        </div>
      </div>

      {area === 'play' ? (
        <>
          <div className="sidebar-search">
            <input
              className="model-search"
              placeholder="セッション名・キャラ名で検索"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="new-buttons">
            <button onClick={() => createSession('roleplay')}>＋ ロールプレイ</button>
            <button onClick={() => createSession('story')}>＋ 物語</button>
          </div>

          <div className="session-list">
            {notice && (
              <p style={{ color: 'var(--accent)', fontSize: 12, padding: '4px 12px' }}>{notice}</p>
            )}
            {sessions.length === 0 && (
              <p style={{ color: 'var(--text-faint)', fontSize: 13, padding: '8px 12px' }}>
                まだセッションがありません。
              </p>
            )}
            {sessions.length > 0 && visible.length === 0 && (
              <p style={{ color: 'var(--text-faint)', fontSize: 13, padding: '8px 12px' }}>
                見つかりません。
              </p>
            )}
            {visible.map((s) => {
              const cast = s.characterIds
                .map((id) => characters.find((c) => c.id === id)?.name)
                .filter(Boolean)
              return (
                <div
                  key={s.id}
                  className={
                    'session-item' +
                    (s.id === activeId && view === 'sessions' ? ' active' : '') +
                    (s.archived ? ' archived' : '')
                  }
                  onClick={() => setActive(s.id)}
                >
                  <div className="title">{s.title || '無題'}</div>
                  <div className="meta">
                    <span className={'badge ' + s.mode}>{s.mode === 'roleplay' ? 'RP' : '物語'}</span>
                    {s.archived && <span className="badge">アーカイブ</span>}
                    {cast.length > 0 && <span className="cast">{cast.join('・')}</span>}
                    <span>· {s.messages.length}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {archivedCount > 0 && (
            <div className="sidebar-archive-toggle">
              <button className="btn" onClick={() => setShowArchived((v) => !v)}>
                {showArchived ? 'アーカイブ済みを隠す' : `アーカイブ済み (${archivedCount}) を表示`}
              </button>
            </div>
          )}
        </>
      ) : (
        <nav className="nav-vertical">
          {LIBRARY_NAV.map((n) => (
            <button
              key={n.key}
              className={'nav-btn' + (view === n.key ? ' on' : '')}
              onClick={() => setView(n.key)}
            >
              <span>{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>
      )}
    </aside>
  )
}
