import { useEffect, useState } from 'react'
import { bindRoleNames, useStore } from './store'
import Rail from './components/Rail'
import Sidebar from './components/Sidebar'
import ChatPanel from './components/ChatPanel'
import { SettingsBody } from './components/SettingsModal'
import CharacterLibrary from './components/library/CharacterLibrary'
import WorldLibrary from './components/library/WorldLibrary'
import PersonaLibrary from './components/library/PersonaLibrary'
import CassetteLibrary from './components/library/CassetteLibrary'
import LibraryBar from './components/LibraryBar'
import SceneReviewModal from './components/SceneReviewModal'
import SessionEditor from './components/SessionEditor'
import CastingModal from './components/CastingModal'
import DialogHost from './components/DialogHost'
import CommandPalette from './components/CommandPalette'
import { useGlobalShortcuts } from './lib/shortcuts'
import { ensureAudio, setMasterVolume } from './lib/ambientAudio'
import { stateLocationLabel } from './lib/platform'
import { isProviderUsable } from './lib/providers'
import { schemaErrorMessage } from './lib/schema'
import { Icon, type IconName } from './components/icons'

// 積層トーストの1件。autoCloseMs があれば一定時間後に自動で onClose を呼ぶ（UI-0）
function ToastItem({
  className,
  text,
  icon,
  onClose,
  autoCloseMs,
}: {
  className: string
  text: string
  icon?: IconName
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
      <span>
        {icon && <Icon name={icon} size={14} className="toast-icon" />}
        {text}
      </span>
      <button onClick={onClose}>閉じる</button>
    </div>
  )
}

export default function App() {
  const {
    sessions,
    activeId,
    view,
    setView,
    providers,
    error,
    clearError,
    createSession,
    sceneReview,
    reviewProgress,
    castingSessionId,
    newlyUnlockedAchievements,
    dismissNewAchievements,
    endingToast,
    dismissEndingToast,
    imageJobToasts,
    dismissImageJobToasts,
    infoNotice,
    setInfoNotice,
    schemaError,
    ui,
  } = useStore()
  // storage は async 化済み（Web は同期 localStorage・Tauri は T3 のファイル backend）。
  // ハイドレーション完了までスプラッシュを表示する。
  const [hydrated, setHydrated] = useState(() => useStore.persist.hasHydrated())
  const [paletteOpen, setPaletteOpen] = useState(false)
  // 空状態から新規作成した直後に開くセッション設定（F3/R15）
  const [newEditorId, setNewEditorId] = useState<string | null>(null)
  const startNew = (mode: 'roleplay' | 'story') => setNewEditorId(createSession(mode))
  const newEditorSession = newEditorId ? sessions.find((s) => s.id === newEditorId) : undefined

  // 使える接続先が1つでもあるか。**キーの有無ではなく「使えるか」で見る**
  // ——ローカル接続先（Ollama / LM Studio）はキーを持たないので、キーで数えると
  // 正しく設定できている人に「キーを登録してください」と出てしまう（R5）
  const hasUsableProvider = providers.some(isProviderUsable)

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
    if (!hasUsableProvider) setView('system')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated])

  // 起動時に木へ対応しない孤児チェックポイント（書込み中断等の残骸）を掃除する（C3）。
  // 画像記録のバックフィル（FB6-A・初回1回）も同じタイミングで裏実行する。
  // スキーマを読めなかった時は走らせない（既定値の state を基準に実データを消しかねないため。R1）
  useEffect(() => {
    if (!hydrated || schemaError) return
    void useStore.getState().cleanupOrphanCheckpoints()
    void useStore.getState().backfillImageLogs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated])

  // リーダー設定を CSS 変数へ反映（UI-4・F2で数値化）
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--font-size-prose', `${ui.fontSize}px`)
    root.setProperty('--line-height-prose', String(ui.lineHeight))
    root.setProperty('--content-width', `${ui.contentWidth}px`)
    root.setProperty('--speaker-icon-size', `${ui.speakerIconSize}px`)
    // 色分けONは tokens.css の既定（--dialogue）に戻す。OFF のときだけ本文色で上書き（A7）
    if (ui.dialogueTint) root.removeProperty('--dialogue')
    else root.setProperty('--dialogue', 'var(--text)')
  }, [ui.fontSize, ui.lineHeight, ui.contentWidth, ui.speakerIconSize, ui.dialogueTint])

  // 環境音のマスター音量（AM1）。ピンの音量制御とは独立に、出口のゲインだけを動かす
  useEffect(() => {
    setMasterVolume(ui.ambientVolume)
  }, [ui.ambientVolume])

  // 自動再生ポリシー（AM1）: 最初のユーザー操作まで AudioContext は鳴らせない。
  // どこでもよいので1回だけ操作を拾って解錠する（以後このリスナは外れる）
  useEffect(() => {
    const unlock = () => ensureAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  // グローバルショートカット（UI-7）: Ctrl+K/1/2/3/G/.。没入モードの Ctrl+. トグルもここに集約（旧 UI-4 実装を移管）
  useGlobalShortcuts(() => setPaletteOpen((v) => !v))

  if (!hydrated) {
    return (
      <div className="app solo">
        <div className="main">
          <div className="empty">
            <p>読み込み中…</p>
          </div>
        </div>
      </div>
    )
  }

  // 保存データを読めなかった場合（R1）。本編を描かず、上書きしていないことと退避手順だけを伝える。
  // 「無視して続ける」は置かない（続けた先の保存が全部封印されているため、できることが無い）
  if (schemaError) {
    return (
      <div className="app solo">
        <div className="main">
          <div className="empty">
            <div className="schema-block">
              <h2>このデータはこのバージョンでは読めません</h2>
              <p>{schemaErrorMessage(schemaError)}</p>
              <p>
                保存されているデータは<strong>書き換えていません</strong>。このまま本体を新しいバージョンへ
                更新すると、そのまま読み込めます。
              </p>
              <p>
                更新の前に、次の場所をコピーしてバックアップを取ってください。
                <br />
                <code>{stateLocationLabel()}</code>
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={
        'app' +
        // 没入は Play（セッション）ビューでのみ有効。Library/System で効くとレールごと消えて戻れなくなる（F0/A6）
        (ui.immersive && view === 'sessions' ? ' immersive' : '') +
        (view === 'system' ? ' no-side' : '')
      }
    >
      <Rail />
      {view !== 'system' && <Sidebar />}

      {view === 'characters' ? (
        <div className="main">
          <LibraryBar />
          <CharacterLibrary />
        </div>
      ) : view === 'worlds' ? (
        <div className="main">
          <LibraryBar />
          <WorldLibrary />
        </div>
      ) : view === 'personas' ? (
        <div className="main">
          <LibraryBar />
          <PersonaLibrary />
        </div>
      ) : view === 'cassettes' ? (
        <div className="main">
          <LibraryBar />
          <CassetteLibrary />
        </div>
      ) : view === 'system' ? (
        <div className="library">
          <div className="page-narrow">
            <div className="library-head">
              <h2>
                <Icon name="settings" size={18} className="head-icon" /> 設定・データ管理
              </h2>
            </div>
            <SettingsBody />
          </div>
        </div>
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
                <button onClick={() => startNew('roleplay')}>ロールプレイを始める</button>
                <button className="ghost" onClick={() => startNew('story')}>
                  物語を始める
                </button>
              </div>
              {!hasUsableProvider && (
                <p style={{ marginTop: 20, fontSize: 13, color: 'var(--text-faint)' }}>
                  左のレール最下段の「設定」から接続先を登録してください（OpenRouter 等の API キー、
                  または Ollama / LM Studio のようなローカルの OpenAI 互換サーバ）。
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* レビューモーダルは、該当セッションを Play で開いている時だけ出す（FB8-B #14）。
          他画面・他セッション表示中は sceneReview を保持したまま待たせ、戻ってきたら表示する。
          生成中（reviewProgress）でも開く＝「シーン終了」直後にあらすじが流れ始める（PC-A A-1） */}
      {(sceneReview?.sessionId === activeId || reviewProgress?.sessionId === activeId) &&
        view === 'sessions' && <SceneReviewModal />}

      {castingSessionId && <CastingModal sessionId={castingSessionId} />}

      {newEditorSession && (
        <SessionEditor session={newEditorSession} onClose={() => setNewEditorId(null)} />
      )}

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}

      <DialogHost />

      <div className="toast-stack">
        {error && <ToastItem className="toast" text={error} onClose={clearError} />}

        {infoNotice && (
          <ToastItem
            className="toast info"
            text={infoNotice}
            onClose={() => setInfoNotice(null)}
            autoCloseMs={4000}
          />
        )}

        {newlyUnlockedAchievements.length > 0 && (
          <ToastItem
            className="toast achievement"
            icon="trophy"
            text={`実績解除: ${newlyUnlockedAchievements
              .map((a) => bindRoleNames(a.def.name, a.subjects) || '無名')
              .join(' / ')}`}
            onClose={dismissNewAchievements}
            autoCloseMs={6000}
          />
        )}

        {endingToast && (
          <ToastItem
            className="toast achievement"
            icon="flag"
            text={`エンディング「${endingToast.name}」へ`}
            onClose={dismissEndingToast}
            autoCloseMs={6000}
          />
        )}

        {imageJobToasts.length > 0 && (
          <ToastItem
            className="toast image"
            icon="image"
            text={`生成完了: ${imageJobToasts.map((t) => t.label).join(' / ')}`}
            onClose={dismissImageJobToasts}
            autoCloseMs={6000}
          />
        )}
      </div>
    </div>
  )
}
