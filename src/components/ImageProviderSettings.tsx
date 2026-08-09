import { useMemo, useState } from 'react'
import { useStore } from '../store'
import {
  newImageProvider,
  testImageProvider,
  resolveImageApiKey,
  promptStyleOf,
  fetchComfyChoices,
  civitaiParamsOf,
  CIVITAI_SCHEDULERS,
  OPENROUTER_IMAGE_MODELS,
  type ComfyChoices,
  type CivitaiParams,
} from '../lib/imageGen'
import { analyzeComfyWorkflow, hasWorkflowPlaceholders, type ComfyPlan } from '../lib/comfyWorkflow'
import { promptStyleFromBaseModel, resolveCivitaiResource } from '../lib/civitai'
import { ensureTags } from '../lib/promptTags'
import NumberInput from './NumberInput'
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
  civitai: 'Civitai',
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

/**
 * Civitai の欄（I5）。位置づけは「成人向け枠」ではなく **コミュニティモデル枠**
 * （Illustrious / Pony 系のアニメ特化モデルを、ローカル GPU なしで使う経路）。
 * したがってここに書くのは事実だけで、用途の推奨は書かない。
 *
 * 表に出すのは **API キーとモデル URL の2つだけ**。steps / CFG / scheduler / LoRA は詳細へ。
 */
function CivitaiFields({ p, onChange }: { p: ImageProvider; onChange: (p: ImageProvider) => void }) {
  const cp = civitaiParamsOf(p)
  const [modelUrl, setModelUrl] = useState('')
  const [loraUrl, setLoraUrl] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [triggers, setTriggers] = useState<string[]>([])

  const setParams = (patch: Partial<CivitaiParams>) =>
    onChange({ ...p, params: { ...cp, ...patch } as Record<string, unknown> })

  const loadModel = async () => {
    setBusy('model')
    setError('')
    try {
      const r = await resolveCivitaiResource(modelUrl, p.apiKey)
      // ベースモデルから作法を推定して同時に設定する（上書きは可能）
      onChange({
        ...p,
        promptStyle: promptStyleFromBaseModel(r.baseModel),
        params: { ...cp, air: r.air, modelName: `${r.name}（${r.versionName}）`, baseModel: r.baseModel },
      })
      setModelUrl('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const addLora = async () => {
    setBusy('lora')
    setError('')
    try {
      const r = await resolveCivitaiResource(loraUrl, p.apiKey)
      const loras = [...(cp.loras ?? []), { air: r.air, name: `${r.name}（${r.versionName}）`, strength: 0.8 }]
      setParams({ loras })
      setTriggers(r.trainedWords)
      setLoraUrl('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  /** トリガーワードは**自動で入れない**。ユーザーが見て決める（勝手にプロンプトを変えない） */
  const applyTriggers = () => {
    onChange({ ...p, defaultPositive: ensureTags(p.defaultPositive ?? '', triggers.join(', ')) })
    setTriggers([])
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <input
          style={{ ...inputStyle, flex: 1, width: 'auto', marginBottom: 0 }}
          placeholder="Civitai のモデルページの URL を貼る"
          value={modelUrl}
          onChange={(e) => setModelUrl(e.target.value)}
        />
        <button
          className="btn"
          style={{ whiteSpace: 'nowrap' }}
          onClick={loadModel}
          disabled={!modelUrl.trim() || busy === 'model'}
        >
          {busy === 'model' ? '読込中…' : '読み込む'}
        </button>
      </div>
      <div className="desc" style={{ marginBottom: 6 }}>
        {cp.air ? (
          <>
            使用モデル: <b>{cp.modelName}</b>
            {cp.baseModel ? `／ベース: ${cp.baseModel}` : ''}
          </>
        ) : (
          'モデル未設定。AIR や ID を打つ必要はありません（URL から自動で解決します）。'
        )}
      </div>
      {error && <p className="notice">{error}</p>}

      <details style={{ marginBottom: 6 }}>
        <summary className="desc" style={{ cursor: 'pointer' }}>
          生成パラメータ・LoRA（詳細）
        </summary>
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
            <span className="desc" style={{ margin: 0 }}>ステップ数</span>
            <NumberInput
              value={cp.steps ?? 25}
              min={1}
              max={50}
              step={1}
              integer
              onChange={(v) => setParams({ steps: v })}
              style={{ width: 76 }}
            />
            <span className="desc" style={{ margin: 0 }}>CFG</span>
            <NumberInput
              value={cp.cfgScale ?? 6}
              min={1}
              max={20}
              step={0.5}
              onChange={(v) => setParams({ cfgScale: v })}
              style={{ width: 76 }}
            />
            <span className="desc" style={{ margin: 0 }}>Clip Skip</span>
            <NumberInput
              value={cp.clipSkip ?? 2}
              min={1}
              max={4}
              step={1}
              integer
              onChange={(v) => setParams({ clipSkip: v })}
              style={{ width: 60 }}
            />
            <select
              value={cp.scheduler || 'EulerA'}
              onChange={(e) => setParams({ scheduler: e.target.value })}
              style={{ flex: 1, minWidth: 120 }}
            >
              {CIVITAI_SCHEDULERS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <input
              style={{ ...inputStyle, flex: 1, width: 'auto', marginBottom: 0 }}
              placeholder="LoRA のページ URL を貼る（任意）"
              value={loraUrl}
              onChange={(e) => setLoraUrl(e.target.value)}
            />
            <button
              className="btn"
              style={{ whiteSpace: 'nowrap' }}
              onClick={addLora}
              disabled={!loraUrl.trim() || busy === 'lora'}
            >
              {busy === 'lora' ? '読込中…' : 'LoRA を追加'}
            </button>
          </div>
          {triggers.length > 0 && (
            <div className="desc" style={{ marginBottom: 6 }}>
              この LoRA のトリガーワード: <code>{triggers.join(', ')}</code>{' '}
              <button className="btn" style={{ fontSize: 12, padding: '3px 10px' }} onClick={applyTriggers}>
                デフォルトタグに追加
              </button>
            </div>
          )}
          {(cp.loras ?? []).map((l, i) => (
            <div key={l.air} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <span className="desc" style={{ margin: 0, flex: 1 }}>{l.name}</span>
              <NumberInput
                value={l.strength}
                min={0}
                max={2}
                step={0.05}
                onChange={(v) => {
                  const loras = [...(cp.loras ?? [])]
                  loras[i] = { ...loras[i], strength: v }
                  setParams({ loras })
                }}
                style={{ width: 76 }}
              />
              <button
                className="icon-btn small"
                title="削除"
                onClick={() => setParams({ loras: (cp.loras ?? []).filter((_, j) => j !== i) })}
              >
                <Icon name="trash-2" size={14} />
              </button>
            </div>
          ))}
        </div>
      </details>
    </>
  )
}

/**
 * ComfyUI の欄（I4）。**テンプレを配るのではなく、持ち込みを楽にする**方向に投資している:
 * エクスポートした API Format をそのまま貼れば注入先を自動検出し、モデル・サンプラーの
 * 選択肢は ComfyUI 本体から取る（こちらが同梱するどんなプリセットより正確）。
 */
function ComfyFields({ p, onChange }: { p: ImageProvider; onChange: (p: ImageProvider) => void }) {
  const [choices, setChoices] = useState<ComfyChoices | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')

  const manual = hasWorkflowPlaceholders(p.workflowJson)
  const plan = useMemo(() => {
    if (manual) return null
    try {
      return analyzeComfyWorkflow(JSON.parse(p.workflowJson))
    } catch {
      return { ok: false, problems: ['ワークフローが JSON として読めません。'], summary: [] } as ComfyPlan
    }
  }, [p.workflowJson, manual])

  const params = (p.params ?? {}) as Record<string, unknown>
  const setParam = (key: string, value: unknown) =>
    onChange({ ...p, params: { ...params, [key]: value === '' ? undefined : value } })

  const load = async () => {
    setLoading(true)
    setLoadError('')
    try {
      setChoices(await fetchComfyChoices(p, true))
    } catch (e) {
      setLoadError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  /** 選択肢が取れていればプルダウン、まだなら手入力。既定は「ワークフローの値を使う」 */
  const pick = (label: string, key: string, list: string[] | undefined) => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
      <span className="desc" style={{ margin: 0, width: 96, flexShrink: 0 }}>{label}</span>
      {list && list.length > 0 ? (
        <select
          style={{ flex: 1 }}
          value={typeof params[key] === 'string' ? (params[key] as string) : ''}
          onChange={(e) => setParam(key, e.target.value)}
        >
          <option value="">ワークフローの値を使う</option>
          {list.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      ) : (
        <input
          style={{ ...inputStyle, flex: 1, width: 'auto', marginBottom: 0 }}
          placeholder="ワークフローの値を使う（上のボタンで選択肢を取得）"
          value={typeof params[key] === 'string' ? (params[key] as string) : ''}
          onChange={(e) => setParam(key, e.target.value)}
        />
      )}
    </div>
  )

  return (
    <>
      {manual ? (
        <div className="desc" style={{ marginBottom: 6 }}>
          ワークフローに <code>%PROMPT%</code>{' '}
          等のプレースホルダがあるので、そこへ差し込みます（明示指定が優先されます）。
        </div>
      ) : plan?.ok ? (
        <div className="desc" style={{ marginBottom: 6 }}>
          自動検出できました。ComfyUI から書き出した JSON をそのまま貼るだけで動きます。
          <br />
          {plan.summary.join(' ／ ')}
        </div>
      ) : (
        <p className="notice" style={{ marginBottom: 6 }}>
          自動検出できません: {plan?.problems.join(' / ')}
          <br />
          差し込みたい位置に <code>%PROMPT%</code> / <code>%NEGATIVE%</code> / <code>"%SEED%"</code> /{' '}
          <code>"%WIDTH%"</code> / <code>"%HEIGHT%"</code> を手で書くと確実に動きます。
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <button className="btn" style={{ fontSize: 12, padding: '5px 12px' }} onClick={load} disabled={loading}>
          {loading ? '取得中…' : 'ComfyUI から選択肢を取得'}
        </button>
        {loadError && <span style={{ fontSize: 12.5 }}>{loadError}</span>}
        {choices && !loadError && (
          <span className="desc" style={{ margin: 0 }}>
            モデル {choices.ckpt.length} 件 / LoRA {choices.lora.length} 件
          </span>
        )}
      </div>

      {pick('モデル', 'ckptName', choices?.ckpt)}
      {pick('サンプラー', 'samplerName', choices?.sampler)}
      {pick('スケジューラ', 'scheduler', choices?.scheduler)}
      {plan?.loraId && pick('LoRA', 'loraName', choices?.lora)}
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

          {/* OpenRouter / Civitai は接続先が固定なので URL 欄を出さない（触らせる意味がない） */}
          {p.kind !== 'openrouter-image' && p.kind !== 'civitai' && (
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

          {(p.kind === 'openai-image' || p.kind === 'modelslab' || p.kind === 'civitai') && (
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
          )}

          {(p.kind === 'openai-image' || p.kind === 'modelslab') && (
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
          )}

          {p.kind === 'civitai' && <CivitaiFields p={p} onChange={upsertImageProvider} />}

          {p.kind === 'comfyui' && (
            <>
              <ComfyFields p={p} onChange={upsertImageProvider} />
              {/* workflow 本文は通常触らない前提なので畳んでおく（§7.3） */}
              <details style={{ marginBottom: 6 }}>
                <summary className="desc" style={{ cursor: 'pointer' }}>
                  ワークフロー（詳細）
                </summary>
                <div className="desc" style={{ margin: '6px 0 4px' }}>
                  ComfyUI の「Save (API Format)」で書き出した JSON をそのまま貼ってください。
                  差し込み位置を自分で決めたい場合は %PROMPT% / %NEGATIVE% / "%SEED%" / "%WIDTH%" /
                  "%HEIGHT%" を書くと、自動検出より優先されます。
                </div>
                <textarea
                  rows={6}
                  style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12 }}
                  value={p.workflowJson}
                  onChange={(e) => upsertImageProvider({ ...p, workflowJson: e.target.value })}
                />
              </details>
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
        <button className="btn" style={{ flex: 1 }} onClick={() => upsertImageProvider(newImageProvider('civitai'))}>
          <Icon name="plus" size={14} /> Civitai を追加
        </button>
      </div>
      {/*
        事実だけを書く。用途の推奨・勧誘はしない（docs/設計_画像生成の簡易化.md §2）。
        規約は各社のものなので、確認の責任がどこにあるかを明示する。
      */}
      <div className="desc" style={{ marginTop: 6 }}>
        Civitai はコミュニティ製モデル（アニメ特化など）をローカル GPU なしで使う経路です。生成には Buzz
        が必要で、種別によって使える範囲が違います（カードで買える Green Buzz と無料の Blue Buzz は全年齢向けのみ、
        Yellow Buzz は暗号資産での購入）。各サービスの利用規約・課金条件は各社のもので変更されることがあります。
        <b>ご自身でご確認ください。</b>ComfyUI はご自身の PC で動くため、外部サービスの規約は関係しません。
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
