import { useState } from 'react'
import { useStore } from '../store'
import {
  newImageProvider,
  testImageProvider,
  resolveImageApiKey,
  promptStyleOf,
  OPENROUTER_IMAGE_MODELS,
} from '../lib/imageGen'
import type { ImageProvider, ImageQuality, PromptStyle } from '../types'
import { Icon } from './icons'

/**
 * プロンプトの作法。`natural` を選ぶと下のネガティブ・品質タグ欄が消える
 * （docs/設計_画像生成の簡易化.md §5.1）。
 */
const STYLE_LABELS: { value: PromptStyle; label: string }[] = [
  { value: 'tags', label: 'タグ羅列（SD1.5 / SDXL / Illustrious 系）' },
  { value: 'natural', label: '自然な文章（Flux / SD3 / DALL·E / nano banana 系）' },
]

/** API の値をそのまま3択で見せる（日本語ラベルに翻訳するだけ。docs/設計_画像生成の簡易化.md §6.3） */
const QUALITY_LABELS: { value: ImageQuality; label: string }[] = [
  { value: 'low', label: '標準' },
  { value: 'medium', label: '高品質' },
  { value: 'high', label: '最高品質' },
]

const KIND_LABELS: Record<ImageProvider['kind'], string> = {
  'openrouter-image': 'OpenRouter',
  comfyui: 'ComfyUI',
  modelslab: 'ModelsLab',
  'openai-image': '画像API',
}

const inputStyle = {
  width: '100%',
  background: 'var(--bg-elev2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text)',
  padding: '9px 11px',
  outline: 'none',
  fontSize: 14,
  marginBottom: 6,
} as const

/**
 * OpenRouter（画像）の欄。文章側のキーを流用するのが既定なので、通常は入力欄が1つも出ない。
 * これが「設定が難しい」を解く本体（docs/設計_画像生成の簡易化.md §0）。
 */
function OpenRouterFields({
  p,
  sharedKey,
  own,
  setOwn,
  show,
  setShow,
  onChange,
}: {
  p: ImageProvider
  sharedKey: string
  own: boolean
  setOwn: (v: boolean) => void
  show: boolean
  setShow: (v: boolean) => void
  onChange: (p: ImageProvider) => void
}) {
  const known = OPENROUTER_IMAGE_MODELS.some((m) => m.id === p.model)
  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        <select
          style={{ flex: 1 }}
          value={known ? p.model : '__custom__'}
          onChange={(e) =>
            onChange({ ...p, model: e.target.value === '__custom__' ? '' : e.target.value })
          }
        >
          {OPENROUTER_IMAGE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}（{m.id}）
            </option>
          ))}
          <option value="__custom__">その他（モデル名を直接入力）</option>
        </select>
        <select
          style={{ width: 130 }}
          value={p.quality ?? 'low'}
          onChange={(e) => onChange({ ...p, quality: e.target.value as ImageQuality })}
        >
          {QUALITY_LABELS.map((q) => (
            <option key={q.value} value={q.value}>
              {q.label}
            </option>
          ))}
        </select>
      </div>
      {!known && (
        <input
          style={inputStyle}
          placeholder="モデル名（例: openai/gpt-image-1-mini）"
          value={p.model}
          onChange={(e) => onChange({ ...p, model: e.target.value })}
        />
      )}

      <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '2px 0 6px', fontSize: 13 }}>
        <input
          type="checkbox"
          checked={!own}
          onChange={(e) => {
            setOwn(!e.target.checked)
            if (e.target.checked) onChange({ ...p, apiKey: '' })
          }}
        />
        文章と同じ接続（OpenRouter）のキーを使う
      </label>
      {!own ? (
        <div className="desc" style={{ marginBottom: 6 }}>
          {sharedKey
            ? '文章側の OpenRouter 接続先のキーを使います。画像生成のためにキーを取り直す必要はありません。'
            : '文章側に OpenRouter の接続先がまだありません。先に「接続先（API）」で OpenRouter を設定するか、下のチェックを外して直接入力してください。'}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <input
            type={show ? 'text' : 'password'}
            style={{ ...inputStyle, flex: 1, width: 'auto', marginBottom: 0 }}
            placeholder="API キー（この接続先専用）"
            value={p.apiKey}
            onChange={(e) => onChange({ ...p, apiKey: e.target.value })}
          />
          <button className="btn" style={{ whiteSpace: 'nowrap' }} onClick={() => setShow(!show)}>
            {show ? '隠す' : '表示'}
          </button>
        </div>
      )}
    </>
  )
}

/** SettingsBody（System ページ）内の「画像生成の接続先」管理セクション */
export default function ImageProviderSettings() {
  const { imageProviders, upsertImageProvider, deleteImageProvider, providers } = useStore()
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [testResults, setTestResults] = useState<Record<string, string>>({})
  const [testingId, setTestingId] = useState<string | null>(null)
  /** openrouter-image で「この接続先に直接キーを入れる」を選んだかどうか（既定は文章側から流用） */
  const [ownKey, setOwnKey] = useState<Record<string, boolean>>({})

  const runTest = async (p: ImageProvider) => {
    setTestingId(p.id)
    try {
      // キー流用を接続テストにも効かせる（生成だけ通ってテストが落ちる、を防ぐ）
      const { ok, message } = await testImageProvider({ ...p, apiKey: resolveImageApiKey(p, providers) })
      setTestResults((r) => ({ ...r, [p.id]: (ok ? '接続OK: ' : '接続エラー: ') + message }))
    } finally {
      setTestingId(null)
    }
  }

  return (
    <div className="field">
      <label>画像生成の接続先</label>
      <div className="desc">
        アバター・挿絵の生成に使います。<b>OpenRouter</b>{' '}
        なら文章用に設定済みのキーをそのまま使えます。ComfyUI は通常起動のまま使えます（デスクトップ版）。ブラウザ版から使う場合のみ
        CORS 許可付きの起動が必要です（例: <code>python main.py --enable-cors-header '*'</code>）。API
        キーはこの端末内にのみ保存されます。
      </div>

      {imageProviders.map((p) => (
        <div key={p.id} className="lore-entry" style={{ marginBottom: 10 }}>
          <div className="lore-entry-top">
            <input
              style={{ ...inputStyle, flex: 1, width: 'auto', marginBottom: 0 }}
              placeholder="接続先の名前"
              value={p.label}
              onChange={(e) => upsertImageProvider({ ...p, label: e.target.value })}
            />
            <span className="badge" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
              {KIND_LABELS[p.kind]}
            </span>
            <button
              className="icon-btn small"
              onClick={() => deleteImageProvider(p.id)}
              title="削除"
              style={{ flexShrink: 0 }}
            >
              <Icon name="trash-2" size={14} />
            </button>
          </div>

          {p.kind !== 'openrouter-image' && (
            <input
              style={inputStyle}
              placeholder={
                p.kind === 'comfyui'
                  ? 'Base URL（例: http://127.0.0.1:8188）'
                  : p.kind === 'modelslab'
                    ? 'Base URL（例: https://modelslab.com/api/v6）'
                    : 'Base URL（例: https://api.openai.com/v1）'
              }
              value={p.baseUrl}
              onChange={(e) => upsertImageProvider({ ...p, baseUrl: e.target.value })}
            />
          )}

          {p.kind === 'openrouter-image' && (
            <OpenRouterFields
              p={p}
              sharedKey={resolveImageApiKey({ ...p, apiKey: '' }, providers)}
              own={ownKey[p.id] ?? !!p.apiKey}
              setOwn={(v) => setOwnKey((s) => ({ ...s, [p.id]: v }))}
              show={!!showKeys[p.id]}
              setShow={(v) => setShowKeys((s) => ({ ...s, [p.id]: v }))}
              onChange={upsertImageProvider}
            />
          )}

          {(p.kind === 'openai-image' || p.kind === 'modelslab') && (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <input
                  type={showKeys[p.id] ? 'text' : 'password'}
                  style={{ ...inputStyle, flex: 1, width: 'auto', marginBottom: 0 }}
                  placeholder="API キー"
                  value={p.apiKey}
                  onChange={(e) => upsertImageProvider({ ...p, apiKey: e.target.value })}
                />
                <button
                  className="btn"
                  style={{ whiteSpace: 'nowrap' }}
                  onClick={() => setShowKeys((s) => ({ ...s, [p.id]: !s[p.id] }))}
                >
                  {showKeys[p.id] ? '隠す' : '表示'}
                </button>
              </div>
              <input
                style={inputStyle}
                placeholder={
                  p.kind === 'modelslab'
                    ? 'モデルID（model_id・空欄でデフォルト）'
                    : 'モデル名（例: dall-e-3 / grok-2-image）'
                }
                value={p.model}
                onChange={(e) => upsertImageProvider({ ...p, model: e.target.value })}
              />
            </>
          )}

          {p.kind === 'comfyui' && (
            <>
              <div className="desc" style={{ marginBottom: 4 }}>
                workflow（API Format）。%PROMPT% / %NEGATIVE% / "%SEED%" / "%WIDTH%" / "%HEIGHT%"
                がプレースホルダとして置換されます。ckpt_name はご自身の環境のモデル名に書き換えてください。
              </div>
              <textarea
                rows={6}
                style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12 }}
                value={p.workflowJson}
                onChange={(e) => upsertImageProvider({ ...p, workflowJson: e.target.value })}
              />
            </>
          )}

          <div className="desc" style={{ marginBottom: 4 }}>
            プロンプトの作法: 使うモデルの世代に合わせます。画風（アニメ／実写）は生成画面で選びます。
          </div>
          <select
            style={{ width: '100%', marginBottom: 6 }}
            value={promptStyleOf(p)}
            onChange={(e) => upsertImageProvider({ ...p, promptStyle: e.target.value as PromptStyle })}
          >
            {STYLE_LABELS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          {/* 自然文モデルは品質タグもネガティブも効かないので、欄ごと出さない（結合もしない） */}
          {promptStyleOf(p) === 'tags' && (
            <>
              <div className="desc" style={{ marginBottom: 4 }}>
                デフォルトタグ: 生成のたびにプロンプトの先頭へ自動で結合されます（品質・LoRA トリガー等。
                生成モーダルのプロンプト欄には表示されません）。
              </div>
              <textarea
                rows={2}
                style={inputStyle}
                placeholder="デフォルトプロンプト（例: masterpiece, best quality, very aesthetic）"
                value={p.defaultPositive ?? ''}
                onChange={(e) => upsertImageProvider({ ...p, defaultPositive: e.target.value })}
              />
              {(p.kind === 'comfyui' || p.kind === 'modelslab') && (
                <textarea
                  rows={2}
                  style={inputStyle}
                  placeholder="デフォルトネガティブ（例: low quality, worst quality, bad anatomy）"
                  value={p.defaultNegative ?? ''}
                  onChange={(e) => upsertImageProvider({ ...p, defaultNegative: e.target.value })}
                />
              )}
            </>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              className="btn"
              style={{ fontSize: 12, padding: '5px 12px' }}
              onClick={() => runTest(p)}
              disabled={testingId === p.id}
            >
              {testingId === p.id ? 'テスト中…' : '🔌 接続テスト'}
            </button>
            {testResults[p.id] && <span style={{ fontSize: 12.5 }}>{testResults[p.id]}</span>}
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn primary"
          style={{ flex: 1 }}
          onClick={() => upsertImageProvider(newImageProvider('openrouter-image'))}
        >
          <Icon name="plus" size={14} /> OpenRouter を追加（おすすめ）
        </button>
        <button className="btn" style={{ flex: 1 }} onClick={() => upsertImageProvider(newImageProvider('comfyui'))}>
          <Icon name="plus" size={14} /> ComfyUI を追加
        </button>
      </div>
      <details style={{ marginTop: 6 }}>
        <summary className="desc" style={{ cursor: 'pointer' }}>
          その他の接続先を追加
        </summary>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button
            className="btn"
            style={{ flex: 1 }}
            onClick={() => upsertImageProvider(newImageProvider('modelslab'))}
          >
            <Icon name="plus" size={14} /> ModelsLab
          </button>
          <button
            className="btn"
            style={{ flex: 1 }}
            onClick={() => upsertImageProvider(newImageProvider('openai-image'))}
          >
            <Icon name="plus" size={14} /> OpenAI 互換の画像 API
          </button>
        </div>
      </details>
    </div>
  )
}
