import { useState } from 'react'
import { useStore } from '../store'
import { streamChat } from '../lib/openrouter'
import { parseModelRef, modelRefLabel } from '../lib/providers'
import { extractJson } from '../lib/json'
import { STYLE_PRESETS, applyStylePreset, ensureTags } from '../lib/imagePresets'
import { useBlobUrl, type ImageJobTarget } from '../lib/imageJobs'
import ModelPicker from './ModelPicker'

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
      {zoom && (
        <div className="overlay" onClick={() => setZoom(false)}>
          <img src={url} alt="" style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 'var(--radius)' }} />
        </div>
      )}
    </div>
  )
}

interface Props {
  /** モーダル見出し */
  title: string
  /** プロンプト起案に使う文脈（system/user）。省略時は起案ボタン非表示 */
  draftContext?: { system: string; user: string; modelRef: string }
  /** 初期プロンプト（キャラの imagePrompt 等） */
  initialPrompt?: string
  /** 生成ジョブの保存先。採用時に store の applyImageJobResult が保存先ごとに分岐する */
  target: ImageJobTarget
  /** ジョブ一覧・通知に出すラベル（例: '挿絵: 放課後の屋上'） */
  label: string
  /** サイズ選択の初期インデックス（SIZE_PRESETS）。立ち絵=縦長・背景=横長 等の既定値切替に使う */
  defaultSizeIdx?: number
  /** 起案後も必ず維持するタグ（カンマ区切り）。LoRA トリガー・表情タグ等が起案の全文置換で消えるのを防ぐ（V5c） */
  pinTags?: string
  onClose: () => void
}

export default function ImageGenModal({ title, draftContext, initialPrompt, target, label, defaultSizeIdx, pinTags, onClose }: Props) {
  const {
    imageProviders,
    providers,
    lastImageStyle,
    setLastImageStyle,
    lastImageProviderId,
    setLastImageProviderId,
    lastDraftModel,
    setLastDraftModel,
    imageJobs,
    startImageJob,
    cancelImageJob,
    dismissImageJob,
    applyImageJobResult,
  } = useStore()
  const [providerId, setProviderId] = useState(
    imageProviders.some((p) => p.id === lastImageProviderId) ? lastImageProviderId! : imageProviders[0]?.id ?? '',
  )
  const [sizeIdx, setSizeIdx] = useState(defaultSizeIdx ?? 0)
  const [count, setCount] = useState(1)
  const [styleId, setStyleId] = useState<'anime' | 'realistic' | ''>(lastImageStyle ?? '')
  const [prompt, setPrompt] = useState(() => {
    const init = initialPrompt ?? ''
    return (lastImageStyle ?? '') ? applyStylePreset({ prompt: init, negative: '' }, lastImageStyle ?? '').prompt : init
  })
  const [negative, setNegative] = useState(() =>
    (lastImageStyle ?? '') ? applyStylePreset({ prompt: '', negative: '' }, lastImageStyle ?? '').negative : '',
  )
  const [draftModel, setDraftModel] = useState(lastDraftModel || draftContext?.modelRef || '')
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState('')

  const provider = imageProviders.find((p) => p.id === providerId)
  const job = imageJobs.find((j) => j.id === jobId)

  const changeStyle = (v: 'anime' | 'realistic' | '') => {
    setStyleId(v)
    setLastImageStyle(v)
    const applied = applyStylePreset({ prompt, negative }, v)
    setPrompt(applied.prompt)
    setNegative(applied.negative)
  }

  const draft = async () => {
    if (!draftContext) return
    const { provider: llm, model } = parseModelRef(draftModel, providers)
    if (!llm?.apiKey || !model) {
      setError('起案に使うモデルを選択してください（API キー設定済みの接続先）。')
      return
    }
    setDrafting(true)
    setError('')
    try {
      const res = await streamChat(
        {
          provider: llm,
          model,
          messages: [
            { role: 'system', content: draftContext.system },
            { role: 'user', content: draftContext.user },
          ],
          temperature: 0.7,
          maxTokens: 4000,
        },
        () => {},
      )
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
      // 起案結果にスタイルタグが混ざっていても、除去した上で選択中スタイルを先頭に付け直す
      const applied = applyStylePreset({ prompt: draftedPrompt, negative: draftedNegative }, styleId)
      // 起案は全文置換のため、LoRA トリガー・表情タグ等の固定タグが欠けていれば末尾に補う（V5c）
      setPrompt(pinTags ? ensureTags(applied.prompt, pinTags) : applied.prompt)
      setNegative(applied.negative)
    } catch (e) {
      setError(`起案に失敗しました: ${(e as Error).message}`)
    } finally {
      setDrafting(false)
    }
  }

  const generate = () => {
    if (!provider) {
      setError('画像生成の接続先を設定してください（⚙ 設定・データ管理）。')
      return
    }
    if (!prompt.trim()) {
      setError('プロンプトを入力してください。')
      return
    }
    if (jobId) dismissImageJob(jobId)
    const size = SIZE_PRESETS[sizeIdx]
    setError('')
    setLastImageProviderId(provider.id)
    const id = startImageJob({
      label,
      target,
      providerId: provider.id,
      prompt: prompt.trim(),
      negative: negative.trim() || undefined,
      width: size.width,
      height: size.height,
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
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {imageProviders.length === 0 ? (
            <p className="desc">
              画像生成の接続先が未設定です。「⚙ 設定・データ管理」から ComfyUI または画像 API を追加してください。
            </p>
          ) : (
            <>
              <div className="field">
                <label>接続先・サイズ・枚数</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={providerId} onChange={(e) => setProviderId(e.target.value)} style={{ flex: 1 }}>
                    {imageProviders.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label || (p.kind === 'comfyui' ? 'ComfyUI' : '画像API')}
                      </option>
                    ))}
                  </select>
                  <select value={sizeIdx} onChange={(e) => setSizeIdx(Number(e.target.value))} style={{ flex: 1 }}>
                    {SIZE_PRESETS.map((s, i) => (
                      <option key={i} value={i}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <select value={styleId} onChange={(e) => changeStyle(e.target.value as 'anime' | 'realistic' | '')} style={{ flex: 1 }}>
                    <option value="">スタイルなし</option>
                    {STYLE_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <select value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ width: 90 }}>
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n}枚
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="field">
                <label>プロンプト（英語）</label>
                {draftContext && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <button className="btn" style={{ fontSize: 12, padding: '5px 12px' }} onClick={draft} disabled={drafting}>
                      {drafting ? '起案中…' : '✨ プロンプトを起案'}
                    </button>
                    <button className="model-chip" style={{ flex: 1 }} onClick={() => setShowModelPicker(true)}>
                      {draftModel ? modelRefLabel(draftModel, providers) : '起案モデルを選択…'}
                    </button>
                  </div>
                )}
                <textarea rows={4} value={prompt} placeholder="例: 1girl, long black hair, school uniform, ..." onChange={(e) => setPrompt(e.target.value)} />
              </div>

              {provider?.kind === 'comfyui' && (
                <div className="field">
                  <label>ネガティブプロンプト（任意）</label>
                  <textarea rows={2} value={negative} placeholder="例: lowres, bad anatomy" onChange={(e) => setNegative(e.target.value)} />
                </div>
              )}

              <div className="field">
                <div style={{ display: 'flex', gap: 8 }}>
                  {job?.status === 'running' ? (
                    <button className="btn" onClick={() => cancelImageJob(job.id)}>
                      ✕ キャンセル
                    </button>
                  ) : (
                    <button className="btn primary" onClick={generate} disabled={!provider}>
                      🎨 {job ? 'もう一度生成' : '生成'}
                    </button>
                  )}
                  {job?.status === 'running' && (
                    <span className="desc" style={{ alignSelf: 'center' }}>
                      生成中…（{job.results.length}/{job.count} 枚完了。ComfyUI は数十秒かかることがあります）
                    </span>
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
        </div>
        <div className="modal-foot">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            {job?.status === 'running' ? '閉じる（生成は継続します）' : '閉じる'}
          </button>
        </div>
      </div>
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
    </div>
  )
}
