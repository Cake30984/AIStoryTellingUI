import type { ImageProvider, ImageProviderKind, ImageQuality, PromptStyle, Provider } from '../types'
import { appFetch } from './platform'
import { applyArtStyle, artStyleText, combineWithDefaults } from './promptTags'

/**
 * 接続先の既定のプロンプトスタイル。**必ず上書き可**（ComfyUI で Flux を回す人がいる）。
 * openrouter-image の推奨モデルはいずれも自然文系なので `natural`。
 */
export function defaultPromptStyleOf(kind: ImageProviderKind): PromptStyle {
  return kind === 'openrouter-image' || kind === 'openai-image' ? 'natural' : 'tags'
}

/** 実際に使うプロンプトスタイル（未設定なら kind から導く） */
export function promptStyleOf(p: ImageProvider): PromptStyle {
  return p.promptStyle ?? defaultPromptStyleOf(p.kind)
}

function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export interface ImageGenRequest {
  prompt: string
  negative?: string
  /** 既定 1024 */
  width?: number
  /** 既定 1024 */
  height?: number
  /** サンプリングステップ数（modelslab: num_inference_steps。comfyui/openai は未使用） */
  steps?: number
  /** サンプラー／スケジューラ名（modelslab: scheduler。comfyui/openai は未使用） */
  sampler?: string
  /** ガイダンススケール／CFG（modelslab: guidance_scale。comfyui/openai は未使用） */
  cfg?: number
  /** 生成品質（openrouter-image のみ。コストが十数倍変わるので UI にも出す） */
  quality?: ImageQuality
}

/** 生成結果。コストを返す接続先（openrouter-image）だけ `costUsd` が入る */
export interface ImageGenResult {
  blob: Blob
  /** 実測コスト（USD/枚）。「前回の実績」表示に使う。返さない接続先では undefined */
  costUsd?: number
}

/** OpenRouter の推奨画像モデル。全 42 モデルから絞った3つ＋自由入力（docs/設計_画像生成の簡易化.md §4.1） */
export const OPENROUTER_IMAGE_MODELS: { id: string; label: string }[] = [
  { id: 'openai/gpt-5-image-mini', label: '安い・十分な品質（おすすめ）' },
  { id: 'google/gemini-2.5-flash-image', label: '高品質' },
  { id: 'black-forest-labs/flux.2-klein-4b', label: '別系統（好みで）' },
]

/** ModelsLab の scheduler（サンプラー）候補。UI のプルダウンで使う */
export const MODELSLAB_SCHEDULERS = [
  'UniPCMultistepScheduler',
  'EulerDiscreteScheduler',
  'EulerAncestralDiscreteScheduler',
  'DPMSolverMultistepScheduler',
  'DPMSolverSinglestepScheduler',
  'DDPMScheduler',
  'DDIMScheduler',
  'PNDMScheduler',
  'LMSDiscreteScheduler',
  'HeunDiscreteScheduler',
  'KDPM2DiscreteScheduler',
  'KDPM2AncestralDiscreteScheduler',
  'DEISMultistepScheduler',
  'LCMScheduler',
]

/** ComfyUI 用デフォルト workflow（API Format・プレースホルダ入り）。ckpt_name は各自の環境に合わせて書き換える */
export const DEFAULT_COMFY_WORKFLOW = `{
  "3": { "class_type": "KSampler", "inputs": { "cfg": 7, "denoise": 1, "latent_image": ["5", 0], "model": ["4", 0], "negative": ["7", 0], "positive": ["6", 0], "sampler_name": "euler", "scheduler": "normal", "seed": "%SEED%", "steps": 25 } },
  "4": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "sd_xl_base_1.0.safetensors" } },
  "5": { "class_type": "EmptyLatentImage", "inputs": { "batch_size": 1, "height": "%HEIGHT%", "width": "%WIDTH%" } },
  "6": { "class_type": "CLIPTextEncode", "inputs": { "clip": ["4", 1], "text": "%PROMPT%" } },
  "7": { "class_type": "CLIPTextEncode", "inputs": { "clip": ["4", 1], "text": "%NEGATIVE%" } },
  "8": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0], "vae": ["4", 2] } },
  "9": { "class_type": "SaveImage", "inputs": { "filename_prefix": "AIST", "images": ["8", 0] } }
}`

export function newImageProvider(kind: ImageProviderKind): ImageProvider {
  if (kind === 'openrouter-image') {
    return {
      id: uid(),
      label: 'OpenRouter（画像）',
      kind,
      baseUrl: 'https://openrouter.ai/api/v1',
      // 空のまま＝文章側の OpenRouter プロバイダのキーを流用する（resolveImageApiKey）
      apiKey: '',
      model: OPENROUTER_IMAGE_MODELS[0].id,
      workflowJson: '',
      quality: 'low',
      promptStyle: 'natural',
      artStyle: 'anime',
    }
  }
  if (kind === 'comfyui') {
    return {
      id: uid(),
      label: 'ComfyUI',
      kind,
      baseUrl: 'http://127.0.0.1:8188',
      apiKey: '',
      model: '',
      workflowJson: DEFAULT_COMFY_WORKFLOW,
      defaultPositive: 'masterpiece, best quality, very aesthetic, absurdres',
      defaultNegative:
        'low quality, worst quality, bad anatomy, bad hands, extra fingers, missing fingers, extra digits, jpeg artifacts, signature, watermark, username',
    }
  }
  if (kind === 'modelslab') {
    return {
      id: uid(),
      label: 'ModelsLab',
      kind,
      baseUrl: 'https://modelslab.com/api/v6',
      apiKey: '',
      model: '',
      workflowJson: '',
      defaultPositive: 'masterpiece, best quality, very aesthetic, absurdres',
      defaultNegative:
        'low quality, worst quality, bad anatomy, bad hands, extra fingers, missing fingers, jpeg artifacts, signature, watermark',
    }
  }
  return {
    id: uid(),
    label: '画像API',
    kind,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'dall-e-3',
    workflowJson: '',
  }
}

const stripSlash = (url: string) => url.replace(/\/+$/, '')

/**
 * workflow テンプレートのプレースホルダを埋める。
 * - %PROMPT%/%NEGATIVE% は文字列の中身として埋める（JSON エスケープ必須。生埋めすると " や改行で壊れる）
 * - "%SEED%"/"%WIDTH%"/"%HEIGHT%" は引用符ごと数値リテラルに置換する
 */
export function fillWorkflow(template: string, req: ImageGenRequest): string {
  const esc = (s: string) => JSON.stringify(s).slice(1, -1)
  const seed = Math.floor(Math.random() * 0xffffffff)
  return template
    .replaceAll('"%SEED%"', String(seed))
    .replaceAll('"%WIDTH%"', String(req.width ?? 1024))
    .replaceAll('"%HEIGHT%"', String(req.height ?? 1024))
    .replaceAll('%PROMPT%', esc(req.prompt))
    .replaceAll('%NEGATIVE%', esc(req.negative ?? ''))
}

const CONN_HINT =
  'ComfyUI に接続できません。ComfyUI が起動しているか、URL（既定 http://127.0.0.1:8188）が正しいか確認してください。'
  + 'ブラウザ版から使う場合のみ CORS 許可付きの起動が必要です（例: python main.py --enable-cors-header \'*\'）。'

/**
 * ComfyUI の origin_only_middleware（`--enable-cors-header` なしの通常起動時に有効）は
 * 「Host がループバック かつ Origin のホスト名が Host と不一致」を 403 で落とす。
 * デスクトップ版は appFetch の omitOrigin で Origin を外して回避しているので、ここに来るのは想定外。
 */
const FORBIDDEN_HINT =
  'ComfyUI が 403 を返しました。ComfyUI の Origin チェックにブロックされています。'
  + 'ブラウザ版では CORS 許可付きの起動（python main.py --enable-cors-header \'*\'）が必要です。'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function generateComfy(p: ImageProvider, req: ImageGenRequest, signal?: AbortSignal): Promise<Blob> {
  const base = stripSlash(p.baseUrl)

  let workflow: unknown
  try {
    workflow = JSON.parse(fillWorkflow(p.workflowJson, req))
  } catch (e) {
    throw new Error(`workflow JSON が不正です: ${(e as Error).message}`)
  }

  const clientId = uid()
  let res: Response
  try {
    res = await appFetch(`${base}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      signal,
      omitOrigin: true,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new Error(CONN_HINT + detailOf(e))
  }
  if (res.status === 403) throw new Error(FORBIDDEN_HINT)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`ComfyUI エラー (${res.status}): ${text || res.statusText}`)
  }
  const { prompt_id: promptId } = await res.json()
  if (!promptId) throw new Error('ComfyUI から prompt_id が返されませんでした。')

  // /history をポーリング（1.5秒間隔・最大5分）。outputs に images を持つノードが出たら完了
  const deadline = Date.now() + 5 * 60_000
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException('中断されました', 'AbortError')
    await sleep(1500)
    const h = await appFetch(`${base}/history/${encodeURIComponent(promptId)}`, { signal, omitOrigin: true })
    if (!h.ok) continue
    const json = await h.json()
    const entry = json?.[promptId]
    if (!entry) continue
    if (entry.status?.status_str === 'error') {
      throw new Error('ComfyUI 側で生成エラーが発生しました。workflow とモデル名を確認してください。')
    }
    const outputs = entry.outputs ?? {}
    for (const nodeId of Object.keys(outputs)) {
      const images = outputs[nodeId]?.images
      if (Array.isArray(images) && images.length > 0) {
        const img = images[0]
        const q = [
          `filename=${encodeURIComponent(img.filename)}`,
          `subfolder=${encodeURIComponent(img.subfolder ?? '')}`,
          `type=${encodeURIComponent(img.type ?? 'output')}`,
        ].join('&')
        const v = await appFetch(`${base}/view?${q}`, { signal, omitOrigin: true })
        if (!v.ok) throw new Error(`生成画像の取得に失敗しました (${v.status})`)
        return v.blob()
      }
    }
  }
  throw new Error('生成がタイムアウトしました（5分）。')
}

async function generateOpenAiImage(p: ImageProvider, req: ImageGenRequest, signal?: AbortSignal): Promise<Blob> {
  const base = stripSlash(p.baseUrl)
  const size = `${req.width ?? 1024}x${req.height ?? 1024}`
  const res = await appFetch(`${base}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${p.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: p.model,
      prompt: req.prompt,
      n: 1,
      size,
      response_format: 'b64_json',
    }),
    signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`画像 API エラー (${res.status}): ${text || res.statusText}`)
  }
  const json = await res.json()
  const item = json.data?.[0]
  if (item?.b64_json) return b64ToBlob(item.b64_json, item.media_type)
  if (item?.url) {
    try {
      const r = await appFetch(item.url, { signal })
      if (r.ok) return r.blob()
    } catch {
      // CORS 失敗は下の明示エラーへ
    }
    throw new Error('このプロバイダは URL 返却のみで、ブラウザから画像を取得できませんでした（CORS 制限）。')
  }
  throw new Error('画像データが返されませんでした。')
}

/**
 * 画像バイナリの base64 → Blob。`atob` の戻りは Latin-1 文字列なので charCodeAt で戻す。
 * cards.ts の `b64decode` は UTF-8 テキスト用なので流用しないこと。
 */
function b64ToBlob(b64: string, mime?: string): Blob {
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new Blob([bytes as BlobPart], { type: mime || 'image/png' })
}

/**
 * OpenRouter の画像生成。**`/chat/completions` + `modalities` ではなく専用の `/images` を使う**
 * （前者は reasoning トークンが乗って割高なうえ size/quality を指定できない。実測は
 * docs/設計_画像生成の簡易化.md §1.1）。レスポンスは OpenAI images 互換で `data[0].b64_json`。
 * `usage.cost`（USD）が返るので「前回の実績」表示に使う。
 */
async function generateOpenRouterImage(
  p: ImageProvider,
  req: ImageGenRequest,
  signal?: AbortSignal,
): Promise<ImageGenResult> {
  const base = stripSlash(p.baseUrl)
  const size = `${req.width ?? 1024}x${req.height ?? 1024}`

  const send = async (withQuality: boolean): Promise<Response> => {
    const body: Record<string, unknown> = { model: p.model, prompt: req.prompt, n: 1, size }
    if (withQuality && req.quality) body.quality = req.quality
    return appFetch(`${base}/images`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  }

  let res = await send(true)
  if (res.status === 400 && req.quality) {
    // quality 非対応モデルへの追従。openrouter.ts の JSON モード降格と同じ idiom で1段だけ落として投げ直す
    const text = await res.text().catch(() => '')
    if (/quality/i.test(text)) res = await send(false)
    else throw new Error(`OpenRouter エラー (400): ${text || res.statusText}`)
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      p.apiKey
        ? 'OpenRouter の API キーが無効です。'
        : 'OpenRouter の API キーが見つかりません。文章側の OpenRouter 接続先にキーを設定するか、この接続先に直接入力してください。',
    )
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenRouter エラー (${res.status}): ${text || res.statusText}`)
  }

  const json = await res.json()
  const item = json.data?.[0]
  const costUsd = typeof json.usage?.cost === 'number' ? json.usage.cost : undefined
  if (item?.b64_json) return { blob: b64ToBlob(item.b64_json, item.media_type), costUsd }
  if (item?.url) {
    const r = await appFetch(item.url, { signal })
    if (r.ok) return { blob: await r.blob(), costUsd }
    throw new Error('画像 URL からの取得に失敗しました。')
  }
  throw new Error('画像データが返されませんでした。')
}

/**
 * ModelsLab（v6 text2img）。OpenAI 互換ではないので専用パス。
 * - 認証はヘッダではなく body の `key`。モデルは `model_id`（空ならプロバイダ既定）
 * - status:'processing' なら `fetch_result`（または /images/fetch/{id}）を success までポーリング
 * - 出力は URL 配列。先頭を取得して Blob 化（Web は CORS 制限で失敗しうる＝デスクトップ版は appFetch で回避）
 */
async function generateModelslab(p: ImageProvider, req: ImageGenRequest, signal?: AbortSignal): Promise<Blob> {
  const base = stripSlash(p.baseUrl)
  const body: Record<string, unknown> = {
    key: p.apiKey,
    prompt: req.prompt,
    negative_prompt: req.negative ?? '',
    width: req.width ?? 1024,
    height: req.height ?? 1024,
    samples: 1,
    num_inference_steps: req.steps ?? 30,
    guidance_scale: req.cfg ?? 7.5,
    scheduler: req.sampler || 'UniPCMultistepScheduler',
    safety_checker: false,
    enhance_prompt: false,
    seed: null,
  }
  if (p.model.trim()) body.model_id = p.model.trim()

  const res = await appFetch(`${base}/images/text2img`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`ModelsLab エラー (${res.status}): ${text || res.statusText}`)
  }
  let json = await res.json()

  // processing の間は fetch_result をポーリング（最大5分）
  const deadline = Date.now() + 5 * 60_000
  while (json?.status === 'processing' && Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException('中断されました', 'AbortError')
    const eta = Math.min(Math.max(Number(json.eta) || 3, 1), 15)
    await sleep(eta * 1000)
    const fetchUrl = json.fetch_result || `${base}/images/fetch/${encodeURIComponent(json.id)}`
    const fr = await appFetch(fetchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: p.apiKey }),
      signal,
    })
    if (!fr.ok) continue
    json = await fr.json()
  }

  if (json?.status !== 'success') {
    // ModelsLab は message を "messege" と綴ることがある
    throw new Error(`ModelsLab: ${json?.message || json?.messege || `生成に失敗しました（status: ${json?.status}）`}`)
  }
  const url = Array.isArray(json?.output) ? json.output[0] : undefined
  if (!url) throw new Error('ModelsLab から画像 URL が返されませんでした。')
  const img = await appFetch(url, { signal })
  if (!img.ok) throw new Error(`生成画像の取得に失敗しました (${img.status})`)
  return img.blob()
}

/**
 * 接続先が API キーを持たない場合の解決。`openrouter-image` は**文章側の OpenRouter キーを流用する**
 * ＝画像生成のためにキーを取り直させない（docs/設計_画像生成の簡易化.md §4.1）。
 * store に依存させないため、呼び出し側が `providers` を渡す。
 */
export function resolveImageApiKey(p: ImageProvider, providers: Provider[]): string {
  if (p.apiKey.trim()) return p.apiKey.trim()
  if (p.kind !== 'openrouter-image') return ''
  return sharedOpenRouterKey(providers)
}

/** 文章側に設定済みの OpenRouter キー（無ければ空文字）。流用の可否判定はここに一本化する */
export function sharedOpenRouterKey(providers: Provider[]): string {
  return providers.find((x) => x.kind === 'openrouter' && x.apiKey.trim())?.apiKey.trim() ?? ''
}

/**
 * プロバイダ種別を吸収して1枚生成する。**定型タグ・画風の結合はここ1箇所のみ**
 * （UI 側で足さない。AGENTS.md の不変条件）。失敗は throw（呼び出し側で表示）。
 *
 * `natural` スタイルでは品質タグもネガティブも効かないので、UI で欄を隠すだけでなく
 * **結合自体をしない**（スタイルを切り替えた後に古いタグが見えないまま混ざるのを防ぐ）。
 */
export async function generateImage(
  p: ImageProvider,
  req: ImageGenRequest,
  signal?: AbortSignal,
): Promise<ImageGenResult> {
  const style = promptStyleOf(p)
  const art = artStyleText(style, p.artStyle, p.artStyleCustom)
  const withDefaults = style === 'tags' ? combineWithDefaults(p.defaultPositive, req.prompt) : req.prompt.trim()
  const merged: ImageGenRequest = {
    ...req,
    prompt: applyArtStyle(style, withDefaults, art),
    negative:
      style === 'tags' ? combineWithDefaults(p.defaultNegative, req.negative ?? '') || undefined : undefined,
  }
  if (p.kind === 'comfyui') return { blob: await generateComfy(p, merged, signal) }
  if (p.kind === 'modelslab') return { blob: await generateModelslab(p, merged, signal) }
  if (p.kind === 'openrouter-image') return generateOpenRouterImage(p, merged, signal)
  return { blob: await generateOpenAiImage(p, merged, signal) }
}

/** 接続テスト。到達可否と簡単なメッセージを返す（throw しない） */
export async function testImageProvider(p: ImageProvider): Promise<{ ok: boolean; message: string }> {
  const base = stripSlash(p.baseUrl)
  try {
    if (p.kind === 'comfyui') {
      const res = await appFetch(`${base}/system_stats`, { omitOrigin: true })
      if (res.ok) return { ok: true, message: 'ComfyUI に接続できました。' }
      if (res.status === 403) return { ok: false, message: FORBIDDEN_HINT }
      return { ok: false, message: `応答はありますがエラーです (${res.status})` }
    }
    if (p.kind === 'modelslab') {
      // ModelsLab は無料の疎通確認エンドポイントが無い（生成はクレジット消費）。キー有無だけ確認する
      if (!p.apiKey.trim()) return { ok: false, message: 'API キーを入力してください。' }
      return { ok: true, message: 'API キーが設定されています。実際の生成でキー・モデルの有効性を確認します。' }
    }
    if (p.kind === 'openrouter-image') {
      // /key はキー自身の情報を返す＝モデル一覧（公開）と違い「キーが有効か」を実際に判定できる
      if (!p.apiKey) {
        return {
          ok: false,
          message:
            'API キーが見つかりません。文章側の OpenRouter 接続先にキーを設定するか、この接続先に直接入力してください。',
        }
      }
      const res = await appFetch(`${base}/key`, { headers: { Authorization: `Bearer ${p.apiKey}` } })
      if (res.ok) return { ok: true, message: 'OpenRouter に接続できました。' }
      if (res.status === 401 || res.status === 403) return { ok: false, message: 'API キーが無効です。' }
      return { ok: false, message: `応答はありますがエラーです (${res.status})` }
    }
    const res = await appFetch(`${base}/models`, {
      headers: p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : undefined,
    })
    if (res.ok) return { ok: true, message: 'API に接続できました。' }
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'API キーが無効です。' }
    return { ok: false, message: `応答はありますがエラーです (${res.status})` }
  } catch (e) {
    // 例外の中身（scope 拒否・接続失敗・ヘッダ不正など原因が全く違う）を握り潰さない
    return {
      ok: false,
      message:
        (p.kind === 'comfyui' ? CONN_HINT : '接続できませんでした。URL と CORS を確認してください。') +
        detailOf(e),
    }
  }
}

/**
 * 例外の生メッセージを表示用に短く添える。原因が全く違う（capabilities のスコープ拒否・接続失敗・
 * ヘッダ不正など）ものが同じ文言に潰れると切り分け不能になるため、握り潰さないこと。
 */
function detailOf(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? '')
  return msg ? `［詳細: ${msg}］` : ''
}
