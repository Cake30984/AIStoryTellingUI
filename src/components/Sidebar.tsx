import { useState } from 'react'
import { areaOf, useStore, type View } from '../store'
import { parseCardPng } from '../lib/cards'
import { useCardDrop } from '../lib/useCardDrop'
import { useMultiSelect } from '../lib/useMultiSelect'
import { appConfirm } from '../lib/dialogs'
import { Icon, type IconName } from './icons'
import MenuPopover from './MenuPopover'
import SessionEditor from './SessionEditor'
import SessionCardModal from './SessionCardModal'

const LIBRARY_NAV: { key: View; label: string; icon: IconName }[] = [
  { key: 'characters', label: 'キャラ', icon: 'users' },
  { key: 'worlds', label: '世界観', icon: 'globe' },
  { key: 'personas', label: 'ペルソナ', icon: 'smile' },
  { key: 'sceneTypes', label: '演出', icon: 'clapperboard' },
  { key: 'cassettes', label: 'カセット', icon: 'library-big' },
]

export default function Sidebar() {
  const {
    sessions,
    activeId,
    view,
    setView,
    setActive,
    createSession,
    updateSession,
    deleteSession,
    characters,
    importSessionCard,
    importCassette,
  } = useStore()
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [cardId, setCardId] = useState<string | null>(null)
  const area = areaOf(view)

  // セッションカード（PNG）のドロップ受付
  const handleFiles = async (files: FileList) => {
    for (const file of Array.from(files)) {
      if (!file.type.includes('png') && !file.name.toLowerCase().endsWith('.png')) continue
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const parsed = parseCardPng(bytes)
        if (parsed?.kind === 'cassette') {
          await importCassette(parsed.bundle, new Blob([bytes as BlobPart], { type: 'image/png' }))
          setNotice(`🎮 ゲームカセット「${parsed.bundle.session.title || '無題'}」を棚に登録しました（「作る > カセット」から遊べます）。`)
        } else if (parsed?.kind === 'session') {
          await importSessionCard(parsed.bundle)
          setNotice(`セッション「${parsed.bundle.session.title || '無題'}」を復元しました。`)
        } else {
          throw new Error('セッションカード／ゲームカセットではありません。')
        }
      } catch (e) {
        setNotice(`読み込み失敗：${(e as Error).message}`)
      }
    }
  }
  const { dragOver, dropProps } = useCardDrop(handleFiles)

  // 作成直後に設定モーダルを開く（顔ぶれ・世界観をすぐ設定できるように。F3/R15）
  const newSession = (mode: 'roleplay' | 'story') => {
    const id = createSession(mode)
    setEditingId(id)
  }

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

  const { selected, clear, handleClick, selectForContext } = useMultiSelect(visible.map((s) => s.id))

  const bulkDelete = async (ids: string[]) => {
    if (
      !(await appConfirm({
        message: `選択した${ids.length}件のセッションを削除しますか？\nこの操作は元に戻せません。`,
        danger: true,
      }))
    )
      return
    ids.forEach((id) => deleteSession(id))
    clear()
  }
  const bulkArchive = (ids: string[], archived: boolean) => {
    ids.forEach((id) => updateSession(id, { archived }))
    clear()
  }

  const ctxSession = ctxMenu ? sessions.find((s) => s.id === ctxMenu.id) : undefined
  const ctxMulti = ctxMenu ? selected.has(ctxMenu.id) && selected.size > 1 : false
  const editingSession = editingId ? sessions.find((s) => s.id === editingId) : undefined
  const cardSession = cardId ? sessions.find((s) => s.id === cardId) : undefined

  return (
    <aside className="sidebar" {...dropProps} style={dragOver ? { outline: '2px dashed var(--accent)', outlineOffset: -4 } : undefined}>
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
            <button onClick={() => newSession('roleplay')}>
              <Icon name="plus" size={14} /> ロールプレイ
            </button>
            <button onClick={() => newSession('story')}>
              <Icon name="plus" size={14} /> 物語
            </button>
          </div>
          <div className="new-buttons" style={{ marginTop: 0 }}>
            <button onClick={() => setView('cassettes')} title="ゲームカセットの棚から選んで遊ぶ">
              <Icon name="library-big" size={14} /> カセットから遊ぶ
            </button>
          </div>

          {selected.size >= 2 && (
            <div className="sidebar-sel-bar">
              <span>{selected.size} 件選択</span>
              <div style={{ flex: 1 }} />
              <button className="btn danger" onClick={() => bulkDelete([...selected])}>
                <Icon name="trash-2" size={12} /> 削除
              </button>
              <button className="icon-btn small" title="選択を解除" onClick={clear}>
                <Icon name="x" size={13} />
              </button>
            </div>
          )}

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
                    (s.archived ? ' archived' : '') +
                    (selected.has(s.id) ? ' selected' : '')
                  }
                  onClick={(e) => {
                    if (handleClick(e, s.id)) return
                    setActive(s.id)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    selectForContext(s.id)
                    setCtxMenu({ id: s.id, x: e.clientX, y: e.clientY })
                  }}
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
              <Icon name={n.icon} size={16} />
              {n.label}
            </button>
          ))}
        </nav>
      )}

      {/* 複数選択時の一括メニュー（FB2-D） */}
      {ctxMenu && ctxSession && ctxMulti && (
        <MenuPopover position={{ x: ctxMenu.x, y: ctxMenu.y }} onClose={() => setCtxMenu(null)}>
          <button
            className="menu-item"
            onClick={() => {
              bulkArchive([...selected], true)
              setCtxMenu(null)
            }}
          >
            <Icon name="archive" size={15} /> 選択した {selected.size} 件をアーカイブ
          </button>
          <button
            className="menu-item danger"
            onClick={() => {
              const ids = [...selected]
              setCtxMenu(null)
              void bulkDelete(ids)
            }}
          >
            <Icon name="trash-2" size={15} /> 選択した {selected.size} 件を削除
          </button>
        </MenuPopover>
      )}

      {/* セッションの右クリックメニュー（F3/R14）。⋯メニュー（ChatPanel）と両導線 */}
      {ctxMenu && ctxSession && !ctxMulti && (
        <MenuPopover position={{ x: ctxMenu.x, y: ctxMenu.y }} onClose={() => setCtxMenu(null)}>
          <button
            className="menu-item"
            onClick={() => {
              setActive(ctxMenu.id)
              setCtxMenu(null)
            }}
          >
            <Icon name="book-open" size={15} /> 開く
          </button>
          <button
            className="menu-item"
            onClick={() => {
              setEditingId(ctxMenu.id)
              setCtxMenu(null)
            }}
          >
            <Icon name="settings" size={15} /> セッション設定
          </button>
          <button
            className="menu-item"
            onClick={() => {
              setCardId(ctxMenu.id)
              setCtxMenu(null)
            }}
          >
            <Icon name="credit-card" size={15} /> セッションをカード化
          </button>
          <button
            className="menu-item"
            onClick={() => {
              updateSession(ctxMenu.id, { archived: !ctxSession.archived })
              setCtxMenu(null)
            }}
          >
            <Icon name="archive" size={15} /> {ctxSession.archived ? 'アーカイブから戻す' : 'アーカイブする'}
          </button>
          <button
            className="menu-item danger"
            onClick={async () => {
              const id = ctxMenu.id
              setCtxMenu(null)
              if (await appConfirm({ message: 'このセッションを削除しますか？', danger: true }))
                deleteSession(id)
            }}
          >
            <Icon name="trash-2" size={15} /> 削除
          </button>
        </MenuPopover>
      )}

      {editingSession && (
        <SessionEditor session={editingSession} onClose={() => setEditingId(null)} />
      )}
      {cardSession && <SessionCardModal session={cardSession} onClose={() => setCardId(null)} />}
    </aside>
  )
}
