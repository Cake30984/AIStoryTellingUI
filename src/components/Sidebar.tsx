import { useState } from 'react'
import { useStore, type View } from '../store'
import { parseCardPng } from '../lib/cards'
import { useCardDrop } from '../lib/useCardDrop'

interface Props {
  onOpenSettings: () => void
}

const NAV: { key: View; label: string; icon: string }[] = [
  { key: 'sessions', label: 'セッション', icon: '💬' },
  { key: 'characters', label: 'キャラ', icon: '🎭' },
  { key: 'worlds', label: '世界観', icon: '🌍' },
  { key: 'personas', label: 'ペルソナ', icon: '🙂' },
  { key: 'sceneTypes', label: '演出', icon: '🎬' },
]

export default function Sidebar({ onOpenSettings }: Props) {
  const { sessions, activeId, view, setView, setActive, createSession, characters, importSessionCard } = useStore()
  const [notice, setNotice] = useState('')

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

  return (
    <aside className="sidebar" {...dropProps} style={dragOver ? { outline: '2px dashed var(--accent)', outlineOffset: -4 } : undefined}>
      <div className="sidebar-head">
        <div className="brand">
          <span className="dot" />
          AI Storytelling Studio
        </div>
        <nav className="nav">
          {NAV.map((n) => (
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
        {sessions.map((s) => {
          const cast = s.characterIds
            .map((id) => characters.find((c) => c.id === id)?.name)
            .filter(Boolean)
          return (
            <div
              key={s.id}
              className={
                'session-item' + (s.id === activeId && view === 'sessions' ? ' active' : '')
              }
              onClick={() => setActive(s.id)}
            >
              <div className="title">{s.title || '無題'}</div>
              <div className="meta">
                <span className={'badge ' + s.mode}>{s.mode === 'roleplay' ? 'RP' : '物語'}</span>
                {cast.length > 0 && <span className="cast">{cast.join('・')}</span>}
                <span>· {s.messages.length}</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="sidebar-foot">
        <button onClick={onOpenSettings}>⚙ 設定・データ管理</button>
      </div>
    </aside>
  )
}
