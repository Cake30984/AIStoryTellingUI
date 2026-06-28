import { useStore, type View } from '../store'

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
  const { sessions, activeId, view, setView, setActive, createSession, characters } = useStore()

  return (
    <aside className="sidebar">
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
