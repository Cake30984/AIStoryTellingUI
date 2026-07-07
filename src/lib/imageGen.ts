import type { ImageProvider, ImageProviderKind } from '../types'
import { appFetch } from './platform'
import { combineWithDefaults } from './promptTags'

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
}

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

const CORS_HINT =
  'ComfyUI に接続できません。CORS 許可付きで起動しているか確認してください（例: python main.py --enable-cors-header \'*\'）。'

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
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new Error(CORS_HINT)
  }
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
    const h = await appFetch(`${base}/history/${encodeURIComponent(promptId)}`, { signal })
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
        const v = await appFetch(`${base}/view?${q}`, { signal })
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
  if (item?.b64_json) {
    // 画像バイナリの base64。atob → Latin-1 → Uint8Array（cards.ts の b64decode は UTF-8 テキスト用なので使わない）
    const bin = atob(item.b64_json)
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    return new Blob([bytes as BlobPart], { type: 'image/png' })
  }
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

/** プロバイダ種別を吸収して1枚生成する。接続先のデフォルトタグをここで結合する。失敗は throw（呼び出し側で表示） */
export async function generateImage(p: ImageProvider, req: ImageGenRequest, signal?: AbortSignal): Promise<Blob> {
  const merged: ImageGenRequest = {
    ...req,
    prompt: combineWithDefaults(p.defaultPositive, req.prompt),
    negative: combineWithDefaults(p.defaultNegative, req.negative ?? '') || undefined,
  }
  if (p.kind === 'comfyui') return generateComfy(p, merged, signal)
  return generateOpenAiImage(p, merged, signal)
}

/** 接続テスト。到達可否と簡単なメッセージを返す（throw しない） */
export async function testImageProvider(p: ImageProvider): Promise<{ ok: boolean; message: string }> {
  const base = stripSlash(p.baseUrl)
  try {
    if (p.kind === 'comfyui') {
      const res = await appFetch(`${base}/system_stats`)
      if (res.ok) return { ok: true, message: 'ComfyUI に接続できました。' }
      return { ok: false, message: `応答はありますがエラーです (${res.status})` }
    }
    const res = await appFetch(`${base}/models`, {
      headers: p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : undefined,
    })
    if (res.ok) return { ok: true, message: 'API に接続できました。' }
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'API キーが無効です。' }
    return { ok: false, message: `応答はありますがエラーです (${res.status})` }
  } catch {
    return {
      ok: false,
      message: p.kind === 'comfyui' ? CORS_HINT : '接続できませんでした。URL と CORS を確認してください。',
    }
  }
}
