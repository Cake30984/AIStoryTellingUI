import { useEffect, useState } from 'react'
import { useStore } from './store'
import Sidebar from './components/Sidebar'
import ChatPanel from './components/ChatPanel'
import SettingsModal from './components/SettingsModal'
import CharacterLibrary from './components/library/CharacterLibrary'
import WorldLibrary from './components/library/WorldLibrary'
import PersonaLibrary from './components/library/PersonaLibrary'
import SceneTypeLibrary from './components/library/SceneTypeLibrary'
import SceneReviewModal from './components/SceneReviewModal'

export default function App() {
  const {
    sessions,
    activeId,
    view,
    providers,
    error,
    clearError,
    createSession,
    sceneReview,
    newlyUnlockedAchievements,
    dismissNewAchievements,
    imageJobToasts,
    dismissImageJobToasts,
  } = useStore()
  const [showSettings, setShowSettings] = useState(false)
  // storage は async 化済み（Web は同期 localStorage・Tauri は T3 のファイル backend）。
  // ハイドレーション完了までスプラッシュを表示する。
  const [hydrated, setHydrated] = useState(() => useStore.persist.hasHydrated())

  // いずれかのプロバイダに API キーが設定されているか
  const hasApiKey = providers.some((p) => p.apiKey.trim() !== '')

  const active = sessions.find((s) => s.id === activeId)

  useEffect(() => {
    if (useStore.persist.hasHydrated()) {
      setHydrated(true)
      return
    }
    return useStore.persist.onFinishHydration(() => setHydrated(true))
  }, [])

  useEffect(() => {
    if (!hydrated) return
    if (!hasApiKey) setShowSettings(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated])

  // 起動時に木へ対応しない孤児チェックポイント（書込み中断等の残骸）を掃除する（C3）
  useEffect(() => {
    if (!hydrated) return
    void useStore.getState().cleanupOrphanCheckpoints()
  }, [hydrated])

  if (!hydrated) {
    return (
      <div className="app">
        <div className="main">
          <div className="empty">
            <p>読み込み中…</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <Sidebar onOpenSettings={() => setShowSettings(true)} />

      {view === 'characters' ? (
        <CharacterLibrary />
      ) : view === 'worlds' ? (
        <WorldLibrary />
      ) : view === 'personas' ? (
        <PersonaLibrary />
      ) : view === 'sceneTypes' ? (
        <SceneTypeLibrary />
      ) : active ? (
        <ChatPanel key={active.id} session={active} />
      ) : (
        <div className="main">
          <div className="empty">
            <div>
              <h2>AI とロールプレイ・物語づくりを</h2>
              <p>
                OpenRouter のお好きなモデルで、キャラとの会話や
                <br />
                自動で進む物語を楽しめます。
              </p>
              <div className="cta">
                <button onClick={() => createSession('roleplay')}>ロールプレイを始める</button>
                <button className="ghost" onClick={() => createSession('story')}>
                  物語を始める
                </button>
              </div>
              {!hasApiKey && (
                <p style={{ marginTop: 20, fontSize: 13, color: 'var(--text-faint)' }}>
                  まず左下の設定から OpenRouter の API キーを登録してください。
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {sceneReview && <SceneReviewModal />}

      {error && (
        <div className="toast">
          <span>{error}</span>
          <button onClick={clearError}>閉じる</button>
        </div>
      )}

      {newlyUnlockedAchievements.length > 0 && (
        <div className="toast achievement">
          <span>
            🏆 実績解除: {newlyUnlockedAchievements.map((a) => a.name || '無名').join(' / ')}
          </span>
          <button onClick={dismissNewAchievements}>閉じる</button>
        </div>
      )}

      {imageJobToasts.length > 0 && (
        <div className="toast image">
          <span>🖼 生成完了: {imageJobToasts.map((t) => t.label).join(' / ')}</span>
          <button onClick={dismissImageJobToasts}>閉じる</button>
        </div>
      )}
    </div>
  )
}
