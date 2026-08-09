import { useState } from 'react'
import { useStore } from '../store'
import { streamChat } from '../lib/openrouter'
import { parseModelRef, modelRefLabel } from '../lib/providers'
import { extractJson } from '../lib/json'
import { imageDraftSchema, jsonModeFor } from '../lib/jsonSchemas'
import { illustrationPromptSystem } from '../lib/prompts'
import { artStyleText, ensureTags } from '../lib/promptTags'
import { useBlobUrl, type ImageJobTarget } from '../lib/imageJobs'
import ModelPicker from './ModelPicker'
import ModalShell from './ModalShell'
import ZoomOverlay from './ZoomOverlay'
import NumberInput from './NumberInput'
import { MODELSLAB_SCHEDULERS, promptStyleOf } from '../lib/imageGen'
import { costLineOf } from '../lib/cost'
import type { ArtStyle, ImageQuality } from '../types'
import { Icon } from './icons'

/** API の値をそのまま3択で見せる（docs/設計_画像生成の簡易化.md §6.3） */
const QUALITY_LABELS: { value: ImageQuality; label: string }[] = [
  { value: 'low', label: '標準' },
  { value: 'medium', label: '高品質' },
  { value: 'high', label: '最高品質' },
]

/** 画風3択。ラベルは日本語、実際に足される英語は接続先のスタイルで決まる（§5.3） */
const ART_LABELS: { value: ArtStyle; label: string }[] = [
  { value: 'anime', label: 'アニメ' },
  { value: 'realistic', label: '実写' },
  { value: 'custom', label: '自由入力' },
]

/** サイズプリセット（openai系は API 側の許容値に依存。エラーはそのまま表示する） */
const SIZE_PRESETS = [
  { label: '1024 × 1024（正方形）', width: 1024, height: 1024 },
  { label: '1216 × 832（横長）', width: 1216, height: 832 },
  { label: '832 × 1216（縦長）', width: 832, height: 1216 },
]

/** 生成候補1枚（クリックで拡大→採用） */
function ResultThumb({ blob, busy, onUse }: { blob: Blob; busy: boolean; onUse: () => void }) {
  const url = useBlobUrl(blob)
  const [zoom, setZoom] = useState(false)
  if (!url) return null
  return (
    <div className="job-thumb">
      <img src={url} alt="生成候補" onClick={() => setZoom(true)} />
      <button className="btn primary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={onUse} disabled={busy}>
        ✔ この画像を使う
      </button>
      {zoom && <ZoomOverlay url={url} onClose={() => setZoom(false)} />}
    </div>
  )
}

interface Props {
  /** モーダル見出し */
  title: string
  /**
   * プロンプト起案に使う文脈。省略時は起案ボタン非表示。
   * **system は渡さない**——作法（タグ/自然文）は「モーダル内で選ばれた接続先」で決まるため、
   * `illustrationPromptSystem` の呼び出しはここで行う。
   */
  draftContext?: { user: string; modelRef: string }
  /** 初期プロンプト（キャラの imagePrompt 等。再生成時は元の記録のプロンプト） */
  initialPrompt?: string
  /** 初期ネガティブプロンプト（再生成時は元の記録のネガティブ） */
  initialNegative?: string
  /** 生成ジョブの保存先。採用時に store の applyImageJobResult が保存先ごとに分岐する */
  target: ImageJobTarget
  /** ジョブ一覧・通知に出すラベル（例: '挿絵: 放課後の屋上'） */
  label: string
  /** 起案後も必ず維持するタグ（カンマ区切り）。LoRA トリガー・表情タグ等が起案の全文置換で消えるのを防ぐ（V5c） */
  pinTags?: string
  onClose: () => void
}

export default function ImageGenModal({
  title,
  draftContext,
  initialPrompt,
  initialNegative,
  target,
  label,
  pinTags,
  onClose,
}: Props) {
  const {
    imageProviders,
    providers,
    lastImageProviderId,
    setLastImageProviderId,
    lastDraftModel,
    setLastDraftModel,
    imageJobs,
    startImageJob,
    cancelImageJob,
    dismissImageJob,
    applyImageJobResult,
    setView,
    recordUsage,
    modelsByProvider,
    upsertImageProvider,
  } = useStore()
  const [providerId, setProviderId] = useState(
    imageProviders.some((p) => p.id === lastImageProviderId) ? lastImageProviderId! : imageProviders[0]?.id ?? '',
  )
  const initialProvider = imageProviders.find((p) => p.id === lastImageProviderId) ?? imageProviders[0]
  const [quality, setQuality] = useState<ImageQuality>(initialProvider?.quality ?? 'low')
  const [artStyle, setArtStyle] = useState<ArtStyle>(initialProvider?.artStyle ?? 'anime')
  const [artCustom, setArtCustom] = useState(initialProvider?.artStyleCustom ?? '')
  const [sizeIdx, setSizeIdx] = useState(0) // -1 = カスタム
  const [customW, setCustomW] = useState(SIZE_PRESETS[0]?.width ?? 1024)
  const [customH, setCustomH] = useState(SIZE_PRESETS[0]?.height ?? 1024)
  const [count, setCount] = useState(1)
  const [prompt, setPrompt] = useState(initialPrompt ?? '')
  const [negative, setNegative] = useState(initialNegative ?? '')
  // ModelsLab 用パラメータ（他種別では未使用・欄も出さない）
  const [steps, setSteps] = useState(30)
  const [cfg, setCfg] = useState(7)
  const [sampler, setSampler] = useState(MODELSLAB_SCHEDULERS[0])
  const [draftModel, setDraftModel] = useState(lastDraftModel || draftContext?.modelRef || '')
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState('')

  const provider = imageProviders.find((p) => p.id === providerId)
  const job = imageJobs.find((j) => j.id === jobId)
  const isModelsLab = provider?.kind === 'modelslab'
  const isOpenRouter = provider?.kind === 'openrouter-image'
  const style = provider ? promptStyleOf(provider) : 'tags'
  // 自然文スタイルではネガティブが効かないので欄ごと消す（結合も generateImage 側でしない）
  const showNegative = style === 'tags' && (provider?.kind === 'comfyui' || isModelsLab)
  // 生成時に自動付加されるもの（画風＋定型タグ）を隠さず見せる
  const autoPositive = [artStyleText(style, artStyle, artCustom), style === 'tags' ? provider?.defaultPositive : '']
    .filter((s) => s && s.trim())
    .join(style === 'tags' ? ', ' : ' ')
  const size = sizeIdx >= 0 ? SIZE_PRESETS[sizeIdx] : { width: customW, height: customH }
  // コストを返す接続先だけ表示する（返さない接続先で推測値を出さない）
  const costLine =
    provider && isOpenRouter ? costLineOf(provider, provider.model, quality, size.width, size.height) : null

  const draft = async () => {
    if (!draftContext || !provider) return
    const { provider: llm, model } = parseModelRef(draftModel, providers)
    if (!llm?.apiKey || !model) {
      setError('起案に使うモデルを選択してください（API キー設定済みの接続先）。')
      return
    }
    setDrafting(true)
    setError('')
    try {
      const t0 = performance.now()
      const res = await streamChat(
        {
          provider: llm,
          model,
          messages: [
            // 作法は選択中の接続先で決まる（タグ羅列 / 自然文）
            { role: 'system', content: illustrationPromptSystem(style) },
            { role: 'user', content: draftContext.user },
          ],
          temperature: 0.7,
          maxTokens: 4000,
          // 対応モデルなら JSON を強制する（起案の取りこぼしを防ぐ）
          jsonSchema: imageDraftSchema(style),
          jsonMode: jsonModeFor(model, modelsByProvider[llm.id]),
        },
        () => {},
      )
      recordUsage({
        kind: 'imageDraft',
        modelRef: draftModel,
        upstream: res.usage?.upstream,
        promptTokens: res.usage?.promptTokens ?? 0,
        cachedTokens: res.usage?.cachedTokens ?? 0,
        completionTokens: res.usage?.completionTokens ?? 0,
        cost: res.usage?.cost,
        ms: performance.now() - t0,
      })
      if (!res.text.trim()) {
        // thinking系モデル等で reasoning が max_tokens を食い潰し本文0文字で終了するケース
        setError(
          res.finishReason === 'length'
            ? '起案が出力上限で本文0文字のまま終了しました。reasoning系モデルの場合は別モデルをお試しください。'
            : '起案結果が空でした。もう一度お試しください。',
        )
        return
      }
      const json = extractJson<{ prompt?: string; negative?: string }>(res.text)
      let draftedPrompt = ''
      let draftedNegative = ''
      if (json?.prompt) {
        draftedPrompt = json.prompt
        draftedNegative = typeof json.negative === 'string' ? json.negative : negative
      } else {
        // JSON でなければ全文をプロンプト扱い（フォールバック）
        draftedPrompt = res.text.trim()
        draftedNegative = negative
      }
      // 起案は全文置換のため、LoRA トリガー・表情タグ等の固定タグが欠けていれば末尾に補う（V5c）
      setPrompt(pinTags ? ensureTags(draftedPrompt, pinTags) : draftedPrompt)
      setNegative(draftedNegative)
    } catch (e) {
      setError(`起案に失敗しました: ${(e as Error).message}`)
    } finally {
      setDrafting(false)
    }
  }

  const generate = () => {
    if (!provider) {
      setError('画像生成の接続先を設定してください（設定・データ管理）。')
      return
    }
    if (!prompt.trim()) {
      setError('プロンプトを入力してください。')
      return
    }
    if (jobId) dismissImageJob(jobId)
    setError('')
    setLastImageProviderId(provider.id)
    // 選んだ品質・画風は接続先に書き戻す＝次回の既定になる（設定画面に往復させない）
    const next = {
      ...provider,
      ...(isOpenRouter ? { quality } : {}),
      artStyle,
      artStyleCustom: artStyle === 'custom' ? artCustom : provider.artStyleCustom,
    }
    if (JSON.stringify(next) !== JSON.stringify(provider)) upsertImageProvider(next)
    const id = startImageJob({
      label,
      target,
      providerId: provider.id,
      prompt: prompt.trim(),
      negative: showNegative ? negative.trim() || undefined : undefined,
      width: size.width,
      height: size.height,
      steps: isModelsLab ? steps : undefined,
      sampler: isModelsLab ? sampler : undefined,
      cfg: isModelsLab ? cfg : undefined,
      quality: isOpenRouter ? quality : undefined,
      count,
    })
    setJobId(id)
  }

  const accept = async (idx: number) => {
    if (!job) return
    setAccepting(true)
    try {
      await applyImageJobResult(job.id, idx)
      onClose()
    } catch (e) {
      setError(`保存に失敗しました: ${(e as Error).message}`)
      setAccepting(false)
    }
  }

  return (
    <>
    <ModalShell
      title={title}
      onClose={onClose}
      footer={
        <>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            {job?.status === 'running' ? '閉じる（生成は継続します）' : '閉じる'}
          </button>
        </>
      }
    >
          {imageProviders.length === 0 ? (
            <>
              <p className="desc">
                画像生成の接続先が未設定です。<b>OpenRouter</b>{' '}
                を追加すると、文章用に設定済みの API キーをそのまま使って生成できます（キーの取り直しは不要です）。
              </p>
              {/* FB8-E4: 文章で案内するだけでなく、その場から設定へ直行できるようにする */}
              <button
                className="btn primary"
                onClick={() => {
                  onClose()
                  setView('system')
                }}
              >
                <Icon name="settings" size={14} /> 設定・データ管理を開く
              </button>
            </>
          ) : (
            <>
              <div className="field">
                <label>接続先・画風・サイズ・枚数</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <select
                    value={providerId}
                    onChange={(e) => {
                      setProviderId(e.target.value)
                      // 接続先ごとに既定の品質・画風が違うので追従させる
                      const np = imageProviders.find((p) => p.id === e.target.value)
                      setQuality(np?.quality ?? 'low')
                      setArtStyle(np?.artStyle ?? 'anime')
                      setArtCustom(np?.artStyleCustom ?? '')
                    }}
                    style={{ flex: 1, minWidth: 140 }}
                  >
                    {imageProviders.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label || p.kind}
                      </option>
                    ))}
                  </select>
                  <select
                    value={artStyle}
                    onChange={(e) => setArtStyle(e.target.value as ArtStyle)}
                    style={{ width: 120 }}
                  >
                    {ART_LABELS.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                  <select value={sizeIdx} onChange={(e) => setSizeIdx(Number(e.target.value))} style={{ flex: 1, minWidth: 140 }}>
                    {SIZE_PRESETS.map((s, i) => (
                      <option key={i} value={i}>
                        {s.label}
                      </option>
                    ))}
                    <option value={-1}>カスタム（数値指定）</option>
                  </select>
                  {isOpenRouter && (
                    <select
                      value={quality}
                      onChange={(e) => setQuality(e.target.value as ImageQuality)}
                      style={{ width: 110 }}
                    >
                      {QUALITY_LABELS.map((q) => (
                        <option key={q.value} value={q.value}>
                          {q.label}
                        </option>
                      ))}
                    </select>
                  )}
                  <select value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ width: 90 }}>
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n}枚
                      </option>
                    ))}
                  </select>
                </div>
                {artStyle === 'custom' && (
                  <input
                    style={{ width: '100%', marginTop: 6 }}
                    placeholder="画風を英語で入力（例: watercolor painting / oil painting）"
                    value={artCustom}
                    onChange={(e) => setArtCustom(e.target.value)}
                  />
                )}
                {sizeIdx < 0 && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                    <span className="desc" style={{ margin: 0 }}>幅</span>
                    <NumberInput value={customW} min={64} max={2048} step={64} integer onChange={setCustomW} style={{ width: 90 }} />
                    <span className="desc" style={{ margin: 0 }}>× 高さ</span>
                    <NumberInput value={customH} min={64} max={2048} step={64} integer onChange={setCustomH} style={{ width: 90 }} />
                    <span className="desc" style={{ margin: 0 }}>px</span>
                  </div>
                )}
              </div>

              <div className="field">
                <label>プロンプト（英語）</label>
                {draftContext && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <button className="btn" style={{ fontSize: 12, padding: '5px 12px' }} onClick={draft} disabled={drafting}>
                      {drafting ? (
                        '起案中…'
                      ) : (
                        <>
                          <Icon name="sparkles" size={13} /> プロンプトを起案
                        </>
                      )}
                    </button>
                    <button className="model-chip" style={{ flex: 1 }} onClick={() => setShowModelPicker(true)}>
                      {draftModel ? modelRefLabel(draftModel, providers) : '起案モデルを選択…'}
                    </button>
                  </div>
                )}
                <textarea
                  rows={4}
                  value={prompt}
                  placeholder={
                    style === 'natural'
                      ? '例: A silver-haired girl stands in a rainy neon-lit alley at night, looking back.'
                      : '例: 1girl, long black hair, school uniform, ...'
                  }
                  onChange={(e) => setPrompt(e.target.value)}
                />
                {autoPositive && <div className="desc">生成時に自動付加: {autoPositive}</div>}
              </div>

              {showNegative && (
                <div className="field">
                  <label>ネガティブプロンプト（任意）</label>
                  <textarea rows={2} value={negative} placeholder="例: lowres, bad anatomy" onChange={(e) => setNegative(e.target.value)} />
                  {provider?.defaultNegative?.trim() && (
                    <div className="desc">生成時に自動付加: {provider.defaultNegative}</div>
                  )}
                </div>
              )}

              {isModelsLab && (
                <div className="field">
                  <label>生成パラメータ（ModelsLab）</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="desc" style={{ margin: 0 }}>サンプラー</span>
                    <select value={sampler} onChange={(e) => setSampler(e.target.value)} style={{ flex: 1 }}>
                      {MODELSLAB_SCHEDULERS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                    <span className="desc" style={{ margin: 0 }}>ステップ数</span>
                    <NumberInput value={steps} min={1} max={100} step={1} integer onChange={setSteps} style={{ width: 80 }} />
                    <span className="desc" style={{ margin: 0 }}>CFG（ガイダンス）</span>
                    <NumberInput value={cfg} min={1} max={20} step={0.5} onChange={setCfg} style={{ width: 80 }} />
                  </div>
                </div>
              )}

              <div className="field">
                <div style={{ display: 'flex', gap: 8 }}>
                  {job?.status === 'running' ? (
                    <button className="btn" onClick={() => cancelImageJob(job.id)}>
                      <Icon name="x" size={13} /> キャンセル
                    </button>
                  ) : (
                    <button className="btn primary" onClick={generate} disabled={!provider}>
                      <Icon name="palette" size={13} /> {job ? 'もう一度生成' : '生成'}
                    </button>
                  )}
                  {job?.status === 'running' ? (
                    <span className="desc" style={{ alignSelf: 'center' }}>
                      生成中…（{job.results.length}/{job.count} 枚完了。ComfyUI は数十秒かかることがあります）
                    </span>
                  ) : (
                    costLine && (
                      <span className="desc" style={{ alignSelf: 'center', margin: 0 }}>
                        {costLine}
                      </span>
                    )
                  )}
                </div>
              </div>

              {job?.status === 'error' && <p className="notice">生成に失敗しました: {job.error}</p>}

              {job?.status === 'selecting' && (
                <div className="field">
                  <label>候補（クリックで拡大・選んで採用）</label>
                  <div className="job-thumbs">
                    {job.results.map((blob, i) => (
                      <ResultThumb key={i} blob={blob} busy={accepting} onUse={() => accept(i)} />
                    ))}
                  </div>
                  {job.error && <div className="desc">一部の生成に失敗しました: {job.error}</div>}
                </div>
              )}
            </>
          )}

          {error && <p className="notice">{error}</p>}
    </ModalShell>
      {showModelPicker && (
        <ModelPicker
          current={draftModel}
          onPick={(ref) => {
            setDraftModel(ref)
            setLastDraftModel(ref)
          }}
          onClose={() => setShowModelPicker(false)}
        />
      )}
    </>
  )
}
