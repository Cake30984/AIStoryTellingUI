import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { generateImage } from '../lib/imageGen'
import { streamChat } from '../lib/openrouter'
import { parseModelRef, modelRefLabel } from '../lib/providers'
import { extractJson } from '../lib/json'
import ModelPicker from './ModelPicker'

/** サイズプリセット（openai系は API 側の許容値に依存。エラーはそのまま表示する） */
const SIZE_PRESETS = [
  { label: '1024 × 1024（正方形）', width: 1024, height: 1024 },
  { label: '1216 × 832（横長）', width: 1216, height: 832 },
  { label: '832 × 1216（縦長）', width: 832, height: 1216 },
]

interface Props {
  /** モーダル見出し */
  title: string
  /** プロンプト起案に使う文脈（system/user）。省略時は起案ボタン非表示 */
  draftContext?: { system: string; user: string; modelRef: string }
  /** 初期プロンプト（キャラの imagePrompt 等） */
  initialPrompt?: string
  /** 生成確定。呼び出し元が保存先を決める（アバター: normalize→avatar / 挿絵: 原寸のまま） */
  onAccept: (blob: Blob, prompt: string) => Promise<void>
  onClose: () => void
}

export default function ImageGenModal({ title, draftContext, initialPrompt, onAccept, onClose }: Props) {
  const { imageProviders, providers } = useStore()
  const [providerId, setProviderId] = useState(imageProviders[0]?.id ?? '')
  const [sizeIdx, setSizeIdx] = useState(0)
  const [prompt, setPrompt] = useState(initialPrompt ?? '')
  const [negative, setNegative] = useState('')
  const [draftModel, setDraftModel] = useState(draftContext?.modelRef ?? '')
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState('')
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  const [resultUrl, setResultUrl] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const provider = imageProviders.find((p) => p.id === providerId)

  // プレビュー objectURL の後始末
  useEffect(() => {
    return () => {
      if (resultUrl) URL.revokeObjectURL(resultUrl)
      abortRef.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setResult = (blob: Blob | null) => {
    if (resultUrl) URL.revokeObjectURL(resultUrl)
    setResultBlob(blob)
    setResultUrl(blob ? URL.createObjectURL(blob) : '')
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
          maxTokens: 600,
        },
        () => {},
      )
      const json = extractJson<{ prompt?: string; negative?: string }>(res.text)
      if (json?.prompt) {
        setPrompt(json.prompt)
        if (typeof json.negative === 'string') setNegative(json.negative)
      } else {
        // JSON でなければ全文をプロンプト扱い（フォールバック）
        setPrompt(res.text.trim())
      }
    } catch (e) {
      setError(`起案に失敗しました: ${(e as Error).message}`)
    } finally {
      setDrafting(false)
    }
  }

  const generate = async () => {
    if (!provider) {
      setError('画像生成の接続先を設定してください（⚙ 設定・データ管理）。')
      return
    }
    if (!prompt.trim()) {
      setError('プロンプトを入力してください。')
      return
    }
    const size = SIZE_PRESETS[sizeIdx]
    abortRef.current = new AbortController()
    setGenerating(true)
    setError('')
    try {
      const blob = await generateImage(
        provider,
        { prompt: prompt.trim(), negative: negative.trim() || undefined, width: size.width, height: size.height },
        abortRef.current.signal,
      )
      setResult(blob)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      setGenerating(false)
      abortRef.current = null
    }
  }

  const accept = async () => {
    if (!resultBlob) return
    setAccepting(true)
    try {
      await onAccept(resultBlob, prompt.trim())
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
                <label>接続先・サイズ</label>
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
                  {generating ? (
                    <button className="btn" onClick={() => abortRef.current?.abort()}>
                      ✕ キャンセル
                    </button>
                  ) : (
                    <button className="btn primary" onClick={generate} disabled={!provider}>
                      🎨 {resultBlob ? 'もう一度生成' : '生成'}
                    </button>
                  )}
                  {generating && <span className="desc" style={{ alignSelf: 'center' }}>生成中…（ComfyUI は数十秒かかることがあります）</span>}
                </div>
              </div>

              {resultUrl && (
                <div className="field">
                  <label>プレビュー</label>
                  <img src={resultUrl} alt="生成結果" style={{ maxWidth: '100%', borderRadius: 'var(--radius)' }} />
                </div>
              )}
            </>
          )}

          {error && <p className="notice">{error}</p>}
        </div>
        <div className="modal-foot">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            閉じる
          </button>
          <button className="btn primary" onClick={accept} disabled={!resultBlob || accepting}>
            {accepting ? '保存中…' : '✔ この画像を使う'}
          </button>
        </div>
      </div>
      {showModelPicker && (
        <ModelPicker current={draftModel} onPick={(ref) => setDraftModel(ref)} onClose={() => setShowModelPicker(false)} />
      )}
    </div>
  )
}
