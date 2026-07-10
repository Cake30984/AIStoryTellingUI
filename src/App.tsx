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
import DialogHost from './components/DialogHost'
import { modalStackSize } from './lib/modalStack'

const FONT_SIZE_MAP = { s: '14px', m: '15.5px', l: '17px', xl: '18.5px' } as const
const LINE_HEIGHT_MAP = { compact: '1.7', normal: '1.9', wide: '2.1' } as const
const CONTENT_WIDTH_MAP = { narrow: '660px', normal: '760px', wide: '900px' } as const

// 積層トーストの1件。autoCloseMs があれば一定時間後に自動で onClose を呼ぶ（UI-0）
function ToastItem({
  className,
  text,
  onClose,
  autoCloseMs,
}: {
  className: string
  text: string
  onClose: () => void
  autoCloseMs?: number
}) {
  useEffect(() => {
    if (!autoCloseMs) return
    const t = setTimeout(onClose, autoCloseMs)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCloseMs])

  return (
    <div className={className}>
      <span>{text}</span>
      <button onClick={onClose}>閉じる</button>
    </div>
  )
}

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
    ui,
    setUiPrefs,
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

  // リーダー設定を CSS 変数へ反映（UI-4）
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--font-size-prose', FONT_SIZE_MAP[ui.fontScale])
    root.setProperty('--line-height-prose', LINE_HEIGHT_MAP[ui.lineHeight])
    root.setProperty('--content-width', CONTENT_WIDTH_MAP[ui.contentWidth])
    root.setProperty('--dialogue', ui.dialogueTint ? '#cfe3ff' : 'var(--text)')
    root.setProperty('--stage-bg-opacity', String(ui.stageBgOpacity))
    root.setProperty('--stage-sprite-opacity', String(ui.stageSpriteOpacity))
  }, [
    ui.fontScale,
    ui.lineHeight,
    ui.contentWidth,
    ui.dialogueTint,
    ui.stageBgOpacity,
    ui.stageSpriteOpacity,
  ])

  // 没入モードのショートカット（UI-4）: Ctrl+. でトグル、Escape はモーダルが何も開いていない時のみ解除
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '.') {
        e.preventDefault()
        setUiPrefs({ immersive: !useStore.getState().ui.immersive })
      } else if (e.key === 'Escape' && modalStackSize() === 0 && useStore.getState().ui.immersive) {
        setUiPrefs({ immersive: false })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    <div className={'app' + (ui.immersive ? ' immersive' : '')}>
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

      <DialogHost />

      <div className="toast-stack">
        {error && <ToastItem className="toast" text={error} onClose={clearError} />}

        {newlyUnlockedAchievements.length > 0 && (
          <ToastItem
            className="toast achievement"
            text={`🏆 実績解除: ${newlyUnlockedAchievements.map((a) => a.name || '無名').join(' / ')}`}
            onClose={dismissNewAchievements}
            autoCloseMs={6000}
          />
        )}

        {imageJobToasts.length > 0 && (
          <ToastItem
            className="toast image"
            text={`🖼 生成完了: ${imageJobToasts.map((t) => t.label).join(' / ')}`}
            onClose={dismissImageJobToasts}
            autoCloseMs={6000}
          />
        )}
      </div>
    </div>
  )
}
