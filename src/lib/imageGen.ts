import type { ImageProvider, ImageProviderKind, ImageQuality, PromptStyle, Provider } from '../types'
import { appFetch } from './platform'
import type { ImageCost } from './cost'
import { applyArtStyle, artStyleText, combineWithDefaults } from './promptTags'
import {
  analyzeComfyWorkflow,
  hasWorkflowPlaceholders,
  injectComfyWorkflow,
  type ComfyGraph,
  type ComfyOverrides,
} from './comfyWorkflow'

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

/** 生成結果。コストを返す接続先だけ `cost` が入る（**単位はサービスごと**。円に換算しない） */
export interface ImageGenResult {
  blob: Blob
  /** 実測コスト（1枚あたり）。「前回の実績」表示に使う。返さない接続先では undefined */
  cost?: ImageCost
}

/**
 * 新規作成時の初期モデル。**「推奨モデル一覧」はここに持たない**
 * （推奨は変わるので、ハードコードすると腐る。一覧は `fetchOpenRouterImageModels` で
 * 実サービスから取り、推奨は説明書側で扱う）。これは動く初期値が1つ要るだけのもの。
 */
export const OPENROUTER_DEFAULT_IMAGE_MODEL = 'openai/gpt-5-image-mini'

/** OpenRouter で画像出力できるモデル一覧。**非永続のプロセス内キャッシュ**（増減するので都度取り直す） */
const orImageModelCache = new Map<string, { id: string; name: string }[]>()

export async function fetchOpenRouterImageModels(
  p: ImageProvider,
  force = false,
): Promise<{ id: string; name: string }[]> {
  const base = stripSlash(p.baseUrl)
  if (!force) {
    const hit = orImageModelCache.get(base)
    if (hit) return hit
  }
  const res = await appFetch(`${base}/models?output_modalities=image`)
  if (!res.ok) throw new Error(`モデル一覧を取得できませんでした (${res.status})`)
  const json = await res.json()
  const list = (Array.isArray(json?.data) ? json.data : [])
    .filter((m: unknown): m is { id: string; name?: string } => typeof (m as { id?: unknown })?.id === 'string')
    .map((m: { id: string; name?: string }) => ({ id: m.id, name: m.name || m.id }))
    .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))
  orImageModelCache.set(base, list)
  return list
}

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

/**
 * ComfyUI 用デフォルト workflow（API Format）。
 * **プレースホルダを入れない**＝そのまま自動検出（I4）に載る素の SDXL 構成。
 * ComfyUI から書き出した JSON に置き換えても同じように動く。
 * `ckpt_name` は設定のプルダウン（`/object_info` 由来）から選べるので手で書き換えなくてよい。
 */
export const DEFAULT_COMFY_WORKFLOW = `{
  "3": { "class_type": "KSampler", "inputs": { "cfg": 7, "denoise": 1, "latent_image": ["5", 0], "model": ["4", 0], "negative": ["7", 0], "positive": ["6", 0], "sampler_name": "euler", "scheduler": "normal", "seed": 0, "steps": 25 } },
  "4": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "sd_xl_base_1.0.safetensors" } },
  "5": { "class_type": "EmptyLatentImage", "inputs": { "batch_size": 1, "height": 1024, "width": 1024 } },
  "6": { "class_type": "CLIPTextEncode", "inputs": { "clip": ["4", 1], "text": "" } },
  "7": { "class_type": "CLIPTextEncode", "inputs": { "clip": ["4", 1], "text": "" } },
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
      model: OPENROUTER_DEFAULT_IMAGE_MODEL,
      workflowJson: '',
      quality: 'low',
      promptStyle: 'natural',
      artStyle: 'anime',
    }
  }
  if (kind === 'civitai') {
    return {
      id: uid(),
      label: 'Civitai',
      kind,
      baseUrl: CIVITAI_ORCHESTRATION,
      apiKey: '',
      model: '',
      workflowJson: '',
      // コミュニティモデルは SDXL 系が主流なのでタグ作法を既定に（URL を貼れば自動判定で上書きされる）
      promptStyle: 'tags',
      artStyle: 'anime',
      defaultPositive: 'masterpiece, best quality, very aesthetic, absurdres',
      defaultNegative:
        'low quality, worst quality, bad anatomy, bad hands, extra fingers, missing fingers, jpeg artifacts, signature, watermark',
      params: { steps: 25, cfgScale: 6, scheduler: 'EulerA', clipSkip: 2 },
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

/**
 * ComfyUI の workflow に値を入れる。**明示指定（プレースホルダ）が常に勝つ**。
 * プレースホルダが1つも無いときだけ、リンクを辿って注入先を自動検出する（I4）。
 * 両方効かせると二重注入で壊れるので、必ず排他にすること。
 */
function buildComfyWorkflow(p: ImageProvider, req: ImageGenRequest): unknown {
  if (hasWorkflowPlaceholders(p.workflowJson)) {
    try {
      return JSON.parse(fillWorkflow(p.workflowJson, req))
    } catch (e) {
      throw new Error(`workflow JSON が不正です: ${(e as Error).message}`)
    }
  }
  let parsed: ComfyGraph
  try {
    parsed = JSON.parse(p.workflowJson)
  } catch (e) {
    throw new Error(`workflow JSON が不正です: ${(e as Error).message}`)
  }
  const plan = analyzeComfyWorkflow(parsed)
  if (!plan.ok) {
    throw new Error(
      `ワークフローの自動検出に失敗しました: ${plan.problems.join(' / ')}` +
        ' 差し込み位置に %PROMPT% / %NEGATIVE% / "%SEED%" / "%WIDTH%" / "%HEIGHT%" を手で書くと確実に動きます。',
    )
  }
  return injectComfyWorkflow(parsed, plan, req, comfyOverridesOf(p))
}

/** 接続先に保存されたユーザーの明示選択（未選択なら workflow 自身の値を使う） */
export function comfyOverridesOf(p: ImageProvider): ComfyOverrides {
  const raw = (p.params ?? {}) as Record<string, unknown>
  const str = (k: string) => (typeof raw[k] === 'string' && raw[k] ? (raw[k] as string) : undefined)
  const num = (k: string) => (typeof raw[k] === 'number' ? (raw[k] as number) : undefined)
  return {
    ckptName: str('ckptName'),
    samplerName: str('samplerName'),
    scheduler: str('scheduler'),
    steps: num('steps'),
    cfg: num('cfg'),
    loraName: str('loraName'),
    loraStrength: num('loraStrength'),
  }
}

async function generateComfy(p: ImageProvider, req: ImageGenRequest, signal?: AbortSignal): Promise<Blob> {
  const base = stripSlash(p.baseUrl)
  const workflow = buildComfyWorkflow(p, req)

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
  const usd = typeof json.usage?.cost === 'number' ? json.usage.cost : undefined
  const cost: ImageCost | undefined = usd == null ? undefined : { unit: 'usd', amount: usd }
  if (item?.b64_json) return { blob: b64ToBlob(item.b64_json, item.media_type), cost }
  if (item?.url) {
    const r = await appFetch(item.url, { signal })
    if (r.ok) return { blob: await r.blob(), cost }
    throw new Error('画像 URL からの取得に失敗しました。')
  }
  throw new Error('画像データが返されませんでした。')
}

/**
 * Civitai の生成は**サイト API（civitai.com/api/v1）ではなく Orchestration API**。ホストが別。
 * `api.civitai.com` は Web サイトを返すので注意（docs/設計_画像生成の簡易化.md §1.2）。
 */
export const CIVITAI_ORCHESTRATION = 'https://orchestration.civitai.com'

/** Civitai の生成パラメータ（`params` に保存する詳細設定） */
export interface CivitaiParams {
  air?: string
  modelName?: string
  baseModel?: string
  steps?: number
  cfgScale?: number
  scheduler?: string
  clipSkip?: number
  loras?: { air: string; name: string; strength: number }[]
}

/** Civitai の scheduler 候補。UI のプルダウンで使う */
export const CIVITAI_SCHEDULERS = ['EulerA', 'Euler', 'DPM2M', 'DPM2MKarras', 'DPMSDE', 'DDIM', 'LCM', 'UniPC']

export function civitaiParamsOf(p: ImageProvider): CivitaiParams {
  return (p.params ?? {}) as CivitaiParams
}

/**
 * リクエストボディを組み立てる。**未知のプロパティは Civitai に黙って無視される**ので
 * （`{"__bogus__":123}` でも 200 が返った）、名前を実測形から動かさないこと。
 * `seed` は 0〜4294967295 で、`-1` は 400 になる＝ランダムは「送らない」で表現する。
 */
function civitaiBody(p: ImageProvider, req: ImageGenRequest): Record<string, unknown> {
  const cp = civitaiParamsOf(p)
  const body: Record<string, unknown> = {
    model: cp.air,
    prompt: req.prompt,
    negativePrompt: req.negative ?? '',
    width: req.width ?? 1024,
    height: req.height ?? 1024,
    steps: cp.steps ?? 25,
    cfgScale: cp.cfgScale ?? 6,
    scheduler: cp.scheduler || 'EulerA',
    clipSkip: cp.clipSkip ?? 2,
    quantity: 1,
  }
  const loras = (cp.loras ?? []).filter((l) => l.air)
  if (loras.length > 0) {
    body.additionalNetworks = Object.fromEntries(
      loras.map((l) => [l.air, { type: 'Lora', strength: l.strength ?? 1 }]),
    )
  }
  return body
}

function civitaiUrl(whatIf: boolean): string {
  const qs = new URLSearchParams({ allowMatureContent: 'true' })
  if (whatIf) qs.set('whatif', 'true')
  return `${CIVITAI_ORCHESTRATION}/v2/consumer/recipes/textToImage?${qs}`
}

/** レスポンスヘッダの `x-civitai-cost-total` は Buzz。数値化して返す */
function buzzOf(res: Response): number | undefined {
  const n = Number(res.headers.get('x-civitai-cost-total'))
  return Number.isFinite(n) ? n : undefined
}

async function civitaiError(res: Response): Promise<Error> {
  const text = await res.text().catch(() => '')
  if (res.status === 401 || res.status === 403) return new Error('Civitai の API キーが無効です。')
  if (res.status === 402 || /buzz/i.test(text)) {
    // 残高不足が最も多い。種別の話（成人向けは Yellow Buzz）は補足に留める
    return new Error(
      'Buzz が足りません。Civitai で残高を確認してください。' +
        '（成人向けモデル・成人向け出力には Yellow Buzz が必要で、無料の Blue Buzz とカードで買える Green Buzz は全年齢向けのみです）',
    )
  }
  return new Error(`Civitai エラー (${res.status}): ${text.slice(0, 300) || res.statusText}`)
}

/**
 * 生成前の見積り。**`whatif=true` は Buzz を消費せずに正確な料金だけ返す**ので、
 * 「いくらかかるか」を押す前に見せられる（§6.2）。失敗しても致命的でないので呼び出し側で握る。
 */
export async function estimateCivitaiBuzz(
  p: ImageProvider,
  req: ImageGenRequest,
  signal?: AbortSignal,
): Promise<number | undefined> {
  if (!civitaiParamsOf(p).air) return undefined
  const res = await appFetch(civitaiUrl(true), {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(civitaiBody(p, req)),
    signal,
  })
  if (!res.ok) return undefined
  return buzzOf(res)
}

/**
 * Civitai（Orchestration textToImage）。submit はほぼ同期で返るが `available:false` の
 * ことがあるので、署名付き URL が 200 を返すまでポーリングする。
 * **レスポンスの CORS ヘッダが空**なのでブラウザ版からは叩けない（デスクトップ版専用）。
 */
async function generateCivitai(
  p: ImageProvider,
  req: ImageGenRequest,
  signal?: AbortSignal,
): Promise<ImageGenResult> {
  const cp = civitaiParamsOf(p)
  if (!cp.air) {
    throw new Error('モデルが未設定です。設定で Civitai のモデルページの URL を貼ってください。')
  }
  const res = await appFetch(civitaiUrl(false), {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(civitaiBody(p, req)),
    signal,
  })
  if (!res.ok) throw await civitaiError(res)
  const costBuzz = buzzOf(res)
  const json = await res.json()
  const img = json?.images?.[0]
  if (!img?.url) throw new Error('Civitai から画像が返されませんでした。')

  const deadline = Date.now() + 5 * 60_000
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException('中断されました', 'AbortError')
    const g = await appFetch(img.url, { signal })
    if (g.ok) return { blob: await g.blob(), cost: costBuzz == null ? undefined : { unit: 'buzz', amount: costBuzz } }
    await sleep(2000)
  }
  throw new Error('生成がタイムアウトしました（5分）。')
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
  if (p.kind === 'civitai') return generateCivitai(p, merged, signal)
  if (p.kind === 'openrouter-image') return generateOpenRouterImage(p, merged, signal)
  return { blob: await generateOpenAiImage(p, merged, signal) }
}

/** ComfyUI から取れた選択肢。**その PC に実在するものだけ**が並ぶ＝同梱プリセットより正確 */
export interface ComfyChoices {
  ckpt: string[]
  sampler: string[]
  scheduler: string[]
  lora: string[]
}

/**
 * `/object_info/{クラス名}` はノードの入力仕様を返し、列挙型の候補は
 * `input.required.<名前>[0]` に配列で入っている。そこからプルダウンの選択肢を作る。
 *
 * **永続化しない**（モデルフォルダは増減するので、開くたびに取り直すのが正しい）。
 * 同一 baseUrl のぶんだけプロセス内にキャッシュする。
 */
const objectInfoCache = new Map<string, ComfyChoices>()

function enumOf(info: unknown, cls: string, key: string): string[] {
  const req = (info as Record<string, { input?: { required?: Record<string, unknown> } }>)?.[cls]?.input?.required
  const spec = req?.[key]
  const list = Array.isArray(spec) ? spec[0] : undefined
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
}

export async function fetchComfyChoices(p: ImageProvider, force = false): Promise<ComfyChoices> {
  const base = stripSlash(p.baseUrl)
  if (!force) {
    const hit = objectInfoCache.get(base)
    if (hit) return hit
  }
  // 使うクラスだけ個別に取る（/object_info 全体は数MBある）
  const get = async (cls: string): Promise<unknown> => {
    const res = await appFetch(`${base}/object_info/${encodeURIComponent(cls)}`, { omitOrigin: true })
    if (res.status === 403) throw new Error(FORBIDDEN_HINT)
    if (!res.ok) return undefined
    return res.json()
  }
  const [ck, ks, lo] = await Promise.all([
    get('CheckpointLoaderSimple').catch(() => undefined),
    get('KSampler').catch(() => undefined),
    get('LoraLoader').catch(() => undefined),
  ])
  const choices: ComfyChoices = {
    ckpt: enumOf(ck, 'CheckpointLoaderSimple', 'ckpt_name'),
    sampler: enumOf(ks, 'KSampler', 'sampler_name'),
    scheduler: enumOf(ks, 'KSampler', 'scheduler'),
    lora: enumOf(lo, 'LoraLoader', 'lora_name'),
  }
  objectInfoCache.set(base, choices)
  return choices
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
    if (p.kind === 'civitai') {
      if (!p.apiKey.trim()) return { ok: false, message: 'API キーを入力してください。' }
      if (!civitaiParamsOf(p).air) return { ok: false, message: 'モデルの URL を貼ってください。' }
      // whatif は Buzz を消費しないので、そのまま疎通＋料金確認になる
      const buzz = await estimateCivitaiBuzz(p, { prompt: 'test', width: 1024, height: 1024 })
      if (buzz == null) return { ok: false, message: 'Civitai に接続できませんでした（キー・モデルを確認してください）。' }
      return { ok: true, message: `接続できました。この設定で 1 枚あたり ${buzz} Buzz です。` }
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
