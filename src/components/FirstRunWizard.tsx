import { useEffect, useRef, useState } from 'react'
import { storeActions, useStore } from '../store'
import { isLocalEndpoint, makeModelRef, newProvider, requiresApiKey } from '../lib/providers'
import { oauthPkceMode } from '../lib/platform'
import {
  openRouterOAuthAvailable,
  redirectToOpenRouterOAuth,
  startOpenRouterOAuth,
} from '../lib/oauthPkce'
import { testProviderConnection, type ConnectionTestResult } from '../lib/openrouter'
import { RECOMMENDED_MODELS } from '../lib/recommendedModels'
import type { Provider, ProviderKind } from '../types'
import ModalShell from './ModalShell'
import ModelPicker from './ModelPicker'
import RecommendedModelList from './RecommendedModelList'
import HelpDetails from './HelpDetails'
import { Icon } from './icons'

type PathId = 'openrouter' | 'free' | 'local'

interface PathDef {
  id: PathId
  label: string
  desc: string
  /** プライバシー・課金・PC要件の注記（無ければ表示しない） */
  note?: string
  presetLabel: string
  presetKind: ProviderKind
  presetBaseUrl: string
  /**
   * 接続テストに使う既定モデル。空文字ならユーザーに選ばせる（ローカルは既知のモデル名が無い）。
   * OpenRouter は推奨リストの先頭（`RECOMMENDED_MODELS`）。Gemini は無料枠で新規ユーザーに開放されている
   * Flash 系（2026-09 時点で `gemini-2.5-flash` は新規停止・`gemini-3.6-flash` を実測で確認）。
   */
  presetModel: string
}

const PATHS: PathDef[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter で接続',
    desc: '実績のある外部の有料サービスです。アカウントが必要になります。有名な多数のモデルを利用できます。',
    note: '従量課金',
    presetLabel: 'OpenRouter',
    presetKind: 'openrouter',
    presetBaseUrl: 'https://openrouter.ai/api/v1',
    presetModel: RECOMMENDED_MODELS[0].id,
  },
  {
    id: 'free',
    label: '無料枠で始める',
    desc: 'Gemini の無料枠を使います。',
    note: '入力が提供元の品質改善に使われる場合があります',
    presetLabel: 'Gemini（無料枠）',
    presetKind: 'openai',
    presetBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    presetModel: 'gemini-3.6-flash',
  },
  {
    id: 'local',
    label: 'PC で動かす',
    desc: 'Ollama / LM Studio など、この PC で動く OpenAI 互換サーバを使います。',
    note: '外部送信なし・数GBのダウンロードと相応の PC 性能が必要です',
    presetLabel: 'ローカル接続先',
    presetKind: 'openai',
    presetBaseUrl: 'http://localhost:11434/v1',
    presetModel: '',
  },
]

const inputStyle = {
  width: '100%',
  background: 'var(--bg-elev2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text)',
  padding: '9px 11px',
  outline: 'none',
  fontSize: 14,
  marginBottom: 8,
} as const

/**
 * 初回ウィザード（R5）。3ステップ固定・分岐を作らない（プロバイダ選択→キー入力→接続テスト）。
 * OpenRouter を OAuth で選んだ場合（Tauri のみ）はキー入力が要らないため2ステップに縮む。
 */
export default function FirstRunWizard({
  onClose,
  oauthReturnKey,
  oauthReturnModel,
}: {
  onClose: () => void
  /** P5: Web のリダイレクト承認から戻ってきたときの API キー。開いた直後に接続テストへ進む */
  oauthReturnKey?: string
  /** 承認へ出る前に選んでいたモデル（ページを離れるので `sessionStorage` 経由で戻ってくる）。無ければ推奨の先頭 */
  oauthReturnModel?: string
}) {
  const providers = useStore((st) => st.providers)
  const { upsertProvider, setDefaultModelRef, openStarterStory } = storeActions()

  // 接続できたら、そのままサンプルの物語へ送り出す（P3。「完了」と同義で、行き先が1つ増えるだけ）
  const finishWithStarter = () => {
    openStarterStory()
    onClose()
  }

  const [pathId, setPathId] = useState<PathId | null>(null)
  const [providerId, setProviderId] = useState<string | null>(null)
  const [model, setModel] = useState('')
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [oauthBusy, setOauthBusy] = useState(false)
  const [testState, setTestState] = useState<'idle' | 'testing'>('idle')
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null)

  const path = PATHS.find((p) => p.id === pathId) ?? null
  const provider = providers.find((p) => p.id === providerId) ?? null
  const isOpenRouterPath = path?.id === 'openrouter'
  const isOAuthPath = isOpenRouterPath && openRouterOAuthAvailable()
  // Web は承認のためにページごと離れる。押した後この画面は消えるので文言を変える（P5）
  const oauthLeavesPage = oauthPkceMode() === 'redirect'
  const totalSteps = isOAuthPath ? 2 : 3
  // ステップ番号: 1=選択, 2=キー入力(OAuth なら承認〜テスト結果まで2に同居), 3=接続テスト結果
  const step = pathId === null ? 1 : isOAuthPath ? 2 : testResult === null ? 2 : 3

  const choosePath = (def: PathDef) => {
    let draft: Provider
    if (def.presetKind === 'openrouter') {
      // OpenRouter は初期状態の既定 id='openrouter' を再利用する（空の重複エントリを作らない。
      // 設定画面の OAuth も同じ id に鍵を入れる）
      const existing = providers.find((p) => p.kind === 'openrouter')
      draft = existing ?? { ...newProvider(), id: 'openrouter', kind: 'openrouter', label: def.presetLabel, baseUrl: def.presetBaseUrl }
    } else {
      draft = { ...newProvider(), label: def.presetLabel, kind: def.presetKind, baseUrl: def.presetBaseUrl }
    }
    upsertProvider(draft)
    setPathId(def.id)
    setProviderId(draft.id)
    setModel(def.presetModel)
    setTestResult(null)
  }

  const updateProvider = (patch: Partial<Provider>) => {
    if (!provider) return
    upsertProvider({ ...provider, ...patch })
  }

  const runOAuth = async () => {
    setOauthBusy(true)
    setTestResult(null)
    try {
      if (oauthLeavesPage) {
        // ここで戻らない（ページごと OpenRouter へ移動する）。続きは App が戻りを拾って再開する。
        // 選んでいたモデルも一緒に預ける（戻った時に選び直しにならないように）。
        // busy を降ろさないのは、移動が始まるまでボタンを「移動中…」のまま押せなくしておくため
        await redirectToOpenRouterOAuth('wizard', model)
        return
      }
      const apiKey = await startOpenRouterOAuth()
      if (provider) updateProvider({ apiKey })
      setOauthBusy(false)
      await runTest(apiKey)
    } catch (e) {
      setTestResult({ ok: false, kind: 'unknown', message: (e as Error).message })
      setOauthBusy(false)
    }
  }

  const runTest = async (apiKeyOverride?: string) => {
    if (!provider) return
    await runTestOn(apiKeyOverride !== undefined ? { ...provider, apiKey: apiKeyOverride } : provider, model)
  }

  /** 接続テスト本体。**state ではなく引数の接続先・モデルを見る**（承認直後は state がまだ古い） */
  const runTestOn = async (target: Provider, modelId: string) => {
    setTestState('testing')
    setTestResult(null)
    const result = await testProviderConnection(target, modelId)
    setTestResult(result)
    setTestState('idle')
    if (result.ok) setDefaultModelRef(makeModelRef(target.id, modelId))
  }

  // P5: Web のリダイレクト承認から戻ってきた場合。App が鍵を接続先へ入れた状態で開くので、
  // OAuth 経路を選んだ状態にして接続テストまで一気に進める（デスクトップ版と同じ画面に着地させる）
  const oauthReturnHandled = useRef(false)
  useEffect(() => {
    if (!oauthReturnKey || oauthReturnHandled.current) return
    oauthReturnHandled.current = true
    const def = PATHS[0]
    const target = providers.find((p) => p.kind === 'openrouter')
    if (!target) return
    const returnModel = oauthReturnModel?.trim() || def.presetModel
    setPathId(def.id)
    setProviderId(target.id)
    setModel(returnModel)
    void runTestOn({ ...target, apiKey: oauthReturnKey }, returnModel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthReturnKey])

  const retryFromStep1 = () => {
    setPathId(null)
    setProviderId(null)
    setModel('')
    setTestResult(null)
  }

  const goToModelSelection = () => setTestResult(null) // ステップ2へ戻る（変更後に再テストする流れ）

  return (
    <ModalShell title={`はじめに接続先を選ぶ（${step}/${totalSteps}）`} onClose={onClose} wide>
      {/* ステップ1: プロバイダ選択 */}
      {pathId === null && (
        <>
          <p className="desc" style={{ marginTop: 0 }}>
            物語の生成には LLM（AI モデル）への接続が必要です。いずれかの方法を選択してください。
            あとから設定でいつでも変更できます。
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {PATHS.map((p) => (
              <button
                key={p.id}
                className="lore-entry"
                style={{ textAlign: 'left', cursor: 'pointer', width: '100%', color: 'var(--text)' }}
                onClick={() => choosePath(p)}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {p.label}
                  {p.id === 'openrouter' && !openRouterOAuthAvailable() && (
                    <span className="badge" style={{ marginLeft: 8, fontWeight: 400 }}>
                      この環境ではキー貼り付けのみ
                    </span>
                  )}
                </div>
                <div className="desc" style={{ margin: 0 }}>{p.desc}</div>
                {p.note && (
                  <div className="desc" style={{ margin: '4px 0 0', color: 'var(--accent)' }}>
                    {/* OpenRouter の「承認するだけ」は OAuth が使える環境でだけ本当（使えない環境はバッジで補う） */}
                    {p.id === 'openrouter' && openRouterOAuthAvailable() ? `ブラウザで承認するだけ。${p.note}` : p.note}
                  </div>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {/* ステップ2 (OAuth): モデルを選んでブラウザ承認。承認済み（鍵がある）なら再テストだけできる */}
      {path && provider && isOAuthPath && testResult?.ok !== true && (
        <>
          <label className="sub-label">モデル</label>
          <RecommendedModelList provider={provider} value={model} onChange={setModel} onOpenPicker={() => setShowModelPicker(true)} />
          {testResult && !testResult.ok && <TestResultBox result={testResult} retryHint={isOpenRouterPath} />}
          {provider.apiKey.trim() ? (
            <>
              <button
                className="btn primary"
                style={{ width: '100%' }}
                onClick={() => void runTest()}
                disabled={testState === 'testing' || oauthBusy || !model.trim()}
              >
                {testState === 'testing' ? '接続テスト中…' : '接続テストを実行'}
              </button>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn" onClick={() => void runOAuth()} disabled={oauthBusy || testState === 'testing'}>
                  {oauthBusy ? '承認待ち…' : 'ブラウザで承認し直す'}
                </button>
                <button className="btn" onClick={retryFromStep1}>
                  別の接続方法にする
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="desc">
                {oauthLeavesPage
                  ? 'OpenRouter の承認画面へ移動します。「Allow」を選ぶとこのページに戻り、選んだモデルで接続テストまで行います。'
                  : 'ブラウザで OpenRouter の承認画面が開きます。「Allow」を選ぶとこのアプリに戻り、選んだモデルで接続テストまで行います。'}
              </p>
              <button
                className="btn primary"
                style={{ width: '100%' }}
                onClick={() => void runOAuth()}
                disabled={oauthBusy || !model.trim()}
              >
                {oauthBusy ? (
                  oauthLeavesPage ? '承認画面へ移動中…' : '承認待ち…（ブラウザで承認してください）'
                ) : (
                  <>
                    <Icon name="refresh-cw" size={14} /> ブラウザで承認する
                  </>
                )}
              </button>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn" onClick={retryFromStep1}>
                  別の接続方法にする
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* ステップ2 (通常): Base URL・キー・モデル入力 */}
      {path && provider && !isOAuthPath && testResult === null && (
        <>
          <p className="desc" style={{ marginTop: 0 }}>{path.desc}</p>
          <label className="sub-label">Base URL</label>
          <input
            style={inputStyle}
            value={provider.baseUrl}
            onChange={(e) => updateProvider({ baseUrl: e.target.value })}
          />
          {requiresApiKey(provider) && (
            <>
              <label className="sub-label">API キー</label>
              <input
                type="password"
                style={inputStyle}
                placeholder="API キーを貼り付け"
                value={provider.apiKey}
                onChange={(e) => updateProvider({ apiKey: e.target.value })}
              />
            </>
          )}
          {isLocalEndpoint(provider.baseUrl) && (
            <p className="desc">この接続先はローカル扱いのため API キーは不要です。</p>
          )}
          {/* P5: ブラウザ版はページとローカルサーバの間に CORS があるので、サーバ側の設定が要る。
              ここは接続テストが失敗する直前の画面なので、リンク先ではなくその場で手順を出す */}
          {oauthLeavesPage && isLocalEndpoint(provider.baseUrl) && <LocalCorsHelp />}
          <label className="sub-label">モデル</label>
          {isOpenRouterPath ? (
            <RecommendedModelList provider={provider} value={model} onChange={setModel} onOpenPicker={() => setShowModelPicker(true)} />
          ) : (
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
                placeholder="モデル名（例: gemini-3.6-flash / llama3.1 など）"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
              <button className="btn" onClick={() => setShowModelPicker(true)}>
                一覧から選ぶ
              </button>
            </div>
          )}
          <button
            className="btn primary"
            style={{ width: '100%' }}
            onClick={() => void runTest()}
            disabled={testState === 'testing' || !model.trim() || (requiresApiKey(provider) && !provider.apiKey.trim())}
          >
            {testState === 'testing' ? '接続テスト中…' : '接続テストを実行'}
          </button>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn" onClick={retryFromStep1}>
              別の接続方法にする
            </button>
          </div>
        </>
      )}

      {/* ステップ3: 接続テスト結果（通常経路の再テストもここに戻ってくる） */}
      {path && provider && !isOAuthPath && testResult !== null && (
        <>
          <TestResultBox result={testResult} retryHint={isOpenRouterPath && !testResult.ok} />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn" onClick={goToModelSelection}>
              {isOpenRouterPath && !testResult.ok ? 'モデルを選び直す' : '設定を変更してやり直す'}
            </button>
            <button className="btn" onClick={retryFromStep1}>
              別の接続方法にする
            </button>
            {testResult.ok && (
              <>
                <button className="btn" style={{ marginLeft: 'auto' }} onClick={onClose}>
                  完了
                </button>
                <button className="btn primary" onClick={finishWithStarter}>
                  サンプルの物語を開く
                </button>
              </>
            )}
          </div>
        </>
      )}

      {isOAuthPath && testResult?.ok === true && (
        <>
          <TestResultBox result={testResult} />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn" style={{ marginLeft: 'auto' }} onClick={onClose}>
              完了
            </button>
            <button className="btn primary" onClick={finishWithStarter}>
              サンプルの物語を開く
            </button>
          </div>
        </>
      )}

      {showModelPicker && provider && (
        <ModelPicker
          current={makeModelRef(provider.id, model)}
          onPick={(ref) => {
            const idx = ref.indexOf('::')
            setModel(idx < 0 ? ref : ref.slice(idx + 2))
            setShowModelPicker(false)
          }}
          onClose={() => setShowModelPicker(false)}
        />
      )}
    </ModalShell>
  )
}

/**
 * ブラウザ版からローカルサーバへつなぐときの CORS 案内（P5）。
 * 詳しい手順は `docs/ガイド_ローカルLLMで動かす.md` §11 と同じ内容。
 */
function LocalCorsHelp() {
  return (
    <>
      <p className="desc" style={{ color: 'var(--accent)' }}>
        ブラウザから自分の PC のサーバにつなぐには、<strong>サーバ側でこのページからの接続を許可する設定</strong>が必要です。
      </p>
      <HelpDetails summary="許可のしかた（Ollama / LM Studio）">
        <p>
          許可する「接続元」は、いまこのページを開いているアドレスのドメイン部分
          （<code>{typeof location === 'undefined' ? '' : location.origin}</code>）です。
        </p>
        <p>
          <strong>Ollama</strong>: 環境変数 <code>OLLAMA_ORIGINS</code> にこの接続元を入れて Ollama を起動し直します。
          Windows は「システム環境変数の編集」から追加し、タスクトレイの Ollama を終了して起動し直してください。
        </p>
        <p>
          <strong>LM Studio</strong>: Developer / Local Server タブの <code>Enable CORS</code> を ON にして
          Start Server を押し直します（接続元の指定は要りません）。
        </p>
        <p>
          設定してもつながらないときは、ブラウザの開発者ツール（F12）のコンソールに
          <code>Access-Control-Allow-Origin</code> が出ていないか見てください。
          この設定が不要なデスクトップ版に切り替えるのも手です。
        </p>
      </HelpDetails>
    </>
  )
}

/**
 * エラー翻訳の結果表示（R5）。ok/kind に応じて次の一手の文言を出し分ける。
 * `retryHint`（OpenRouter 経路）: 失敗時に「別の推奨モデルを選ぶ」ことを促す。**自動で別のモデルには切り替えない**
 * （P7 A-1。勝手に変わると拒否や文体の変化の理由を利用者が追えない）
 */
function TestResultBox({ result, retryHint = false }: { result: ConnectionTestResult; retryHint?: boolean }) {
  if (result.ok) {
    return (
      <p className="notice" style={{ color: 'var(--ok)' }}>
        <Icon name="refresh-cw" size={14} /> {result.message} この接続先が新しい物語の既定になりました。
      </p>
    )
  }
  return (
    <p className="notice" style={{ color: 'var(--danger)' }}>
      {result.message}
      {retryHint && (result.kind === 'invalid_model' || result.kind === 'content_filter' || result.kind === 'unknown') && (
        <>
          <br />
          別の推奨モデルを選んで、もう一度接続テストを実行してください。
        </>
      )}
    </p>
  )
}
