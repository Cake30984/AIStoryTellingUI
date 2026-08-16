import { useState } from 'react'
import { useStore } from '../store'
import { isLocalEndpoint, makeModelRef, newProvider, requiresApiKey } from '../lib/providers'
import { oauthPkceAvailable } from '../lib/platform'
import { startOpenRouterOAuth } from '../lib/oauthPkce'
import { testProviderConnection, type ConnectionTestResult } from '../lib/openrouter'
import type { Provider, ProviderKind } from '../types'
import ModalShell from './ModalShell'
import ModelPicker from './ModelPicker'
import { Icon } from './icons'

type PathId = 'oauth' | 'free' | 'quality' | 'uncensored' | 'local'

interface PathDef {
  id: PathId
  label: string
  desc: string
  /** プライバシー・課金・PC要件の注記（無ければ表示しない） */
  note?: string
  presetLabel: string
  presetKind: ProviderKind
  presetBaseUrl: string
  /** 接続テストに使う既定モデル。空文字ならユーザーに選ばせる（Gemini/ローカルは既知のモデル名が無い） */
  presetModel: string
}

const PATHS: PathDef[] = [
  {
    id: 'oauth',
    label: 'かんたん接続',
    desc: 'OpenRouter を使います。多くのモデルをまとめて利用できます。',
    note: 'ブラウザで承認するだけ',
    presetLabel: 'OpenRouter',
    presetKind: 'openrouter',
    presetBaseUrl: 'https://openrouter.ai/api/v1',
    presetModel: 'openrouter/auto',
  },
  {
    id: 'free',
    label: '無料枠で始める',
    desc: 'Gemini の無料枠を使います。',
    note: '入力が提供元の品質改善に使われる場合があります',
    presetLabel: 'Gemini（無料枠）',
    presetKind: 'openai',
    presetBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    presetModel: '',
  },
  {
    id: 'quality',
    label: '品質重視',
    desc: 'OpenRouter 経由で Claude / GPT など高品質なモデルを使います。',
    note: '従量課金',
    presetLabel: 'OpenRouter',
    presetKind: 'openrouter',
    presetBaseUrl: 'https://openrouter.ai/api/v1',
    presetModel: 'openrouter/auto',
  },
  {
    id: 'uncensored',
    label: '表現の制限が緩いモデル',
    desc: 'OpenRouter 経由で表現の制限が緩いモデルを使います。あとからモデルを選び直せます。',
    presetLabel: 'OpenRouter',
    presetKind: 'openrouter',
    presetBaseUrl: 'https://openrouter.ai/api/v1',
    presetModel: 'openrouter/auto',
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
export default function FirstRunWizard({ onClose }: { onClose: () => void }) {
  const { providers, upsertProvider, setDefaultModelRef } = useStore()

  const [pathId, setPathId] = useState<PathId | null>(null)
  const [providerId, setProviderId] = useState<string | null>(null)
  const [model, setModel] = useState('')
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [oauthBusy, setOauthBusy] = useState(false)
  const [testState, setTestState] = useState<'idle' | 'testing'>('idle')
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null)

  const path = PATHS.find((p) => p.id === pathId) ?? null
  const provider = providers.find((p) => p.id === providerId) ?? null
  const isOAuthPath = path?.id === 'oauth' && oauthPkceAvailable()
  const totalSteps = isOAuthPath ? 2 : 3
  // ステップ番号: 1=選択, 2=キー入力(OAuth なら承認〜テスト結果まで2に同居), 3=接続テスト結果
  const step = pathId === null ? 1 : isOAuthPath ? 2 : testResult === null ? 2 : 3

  const choosePath = (def: PathDef) => {
    let draft: Provider
    if (def.presetKind === 'openrouter') {
      // OpenRouter 系3経路は同じ接続先を共有する（初期状態の既定 id='openrouter' を再利用し、
      // 空の重複エントリを作らない）
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
      const apiKey = await startOpenRouterOAuth()
      if (provider) updateProvider({ apiKey })
      await runTest(apiKey)
    } catch (e) {
      setTestResult({ ok: false, kind: 'unknown', message: (e as Error).message })
    } finally {
      setOauthBusy(false)
    }
  }

  const runTest = async (apiKeyOverride?: string) => {
    if (!provider) return
    setTestState('testing')
    setTestResult(null)
    const target = apiKeyOverride !== undefined ? { ...provider, apiKey: apiKeyOverride } : provider
    const result = await testProviderConnection(target, model)
    setTestResult(result)
    setTestState('idle')
    if (result.ok) setDefaultModelRef(makeModelRef(target.id, model))
  }

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
            物語の生成には LLM（AI モデル）への接続が必要です。使い方に近いものを選んでください。
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
                  {p.id === 'oauth' && !oauthPkceAvailable() && (
                    <span className="badge" style={{ marginLeft: 8, fontWeight: 400 }}>
                      Web 版はキー貼り付けのみ
                    </span>
                  )}
                </div>
                <div className="desc" style={{ margin: 0 }}>{p.desc}</div>
                {p.note && (
                  <div className="desc" style={{ margin: '4px 0 0', color: 'var(--accent)' }}>
                    {p.note}
                  </div>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {/* ステップ2 (OAuth): ブラウザ承認 */}
      {path && provider && isOAuthPath && testResult?.ok !== true && (
        <>
          <p className="desc" style={{ marginTop: 0 }}>
            ブラウザで OpenRouter の承認画面が開きます。「Allow」を選ぶとこのアプリに戻り、自動的に接続テストまで行います。
          </p>
          <button className="btn primary" style={{ width: '100%' }} onClick={() => void runOAuth()} disabled={oauthBusy}>
            {oauthBusy ? '承認待ち…（ブラウザで承認してください）' : (
              <>
                <Icon name="refresh-cw" size={14} /> ブラウザで承認する
              </>
            )}
          </button>
          {testResult && !testResult.ok && <TestResultBox result={testResult} />}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn" onClick={retryFromStep1}>
              別の接続方法にする
            </button>
          </div>
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
          <label className="sub-label">モデル</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
              placeholder="モデル名（例: gemini-2.5-flash / llama3.1 など）"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <button className="btn" onClick={() => setShowModelPicker(true)}>
              一覧から選ぶ
            </button>
          </div>
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
          <TestResultBox result={testResult} />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn" onClick={goToModelSelection}>
              設定を変更してやり直す
            </button>
            <button className="btn" onClick={retryFromStep1}>
              別の接続方法にする
            </button>
            {testResult.ok && (
              <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={onClose}>
                完了
              </button>
            )}
          </div>
        </>
      )}

      {isOAuthPath && testResult?.ok === true && (
        <>
          <TestResultBox result={testResult} />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={onClose}>
              完了
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

/** エラー翻訳の結果表示（R5）。ok/kind に応じて次の一手の文言を出し分ける */
function TestResultBox({ result }: { result: ConnectionTestResult }) {
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
    </p>
  )
}
