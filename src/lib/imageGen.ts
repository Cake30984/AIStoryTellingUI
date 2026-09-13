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
  /** 生成品質（openrouter-image のみ。コストが十数倍変わるので UI にも出す） */
  quality?: ImageQuality
}

/** 生成結果。コストを返す接続先（openrouter-image）だけ `cost` が入る（課金単位のまま。円に換算しない） */
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
