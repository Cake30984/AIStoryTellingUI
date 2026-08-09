import type { PromptStyle } from '../types'
import { appFetch } from './platform'

/**
 * Civitai のモデル解決（I5）。
 *
 * **ユーザーに打たせるのはモデルページの URL だけ**にする（docs/設計_画像生成の簡易化.md §4.2）。
 * AIR（`urn:air:sdxl:checkpoint:civitai:827184@2883731`）を手で組み立てさせない。
 * ecosystem 部分はベースモデル名と一致しない（Illustrious でも `sdxl`）ので、
 * **必ず API が返す `air` をそのまま使う**こと。
 *
 * サイト API は civitai.com にあり、civitai.red からも同じものが見える
 * （2ドメイン分割後も "Existing integrations don't need to change"）。
 */

const SITE_API = 'https://civitai.com/api/v1'

export interface CivitaiResource {
  /** そのまま生成リクエストの model / additionalNetworks キーに使う */
  air: string
  /** 表示用のモデル名 */
  name: string
  /** 表示用のバージョン名 */
  versionName: string
  /** 'SDXL 1.0' / 'Illustrious' / 'Flux.1 D' 等。プロンプト作法の自動判定に使う */
  baseModel: string
  /** 'Checkpoint' / 'LORA' 等 */
  type: string
  /** LoRA のトリガーワード。**自動では入れず、ユーザーに提示して選ばせる** */
  trainedWords: string[]
}

/**
 * モデルページの URL から modelVersionId を取り出す。
 * - `.../models/827184?modelVersionId=2883731` → 2883731
 * - `.../models/827184` → バージョン未指定（最新を引く必要がある）
 * civitai.com / civitai.red のどちらでも同じ形。
 */
export function parseCivitaiUrl(input: string): { versionId?: number; modelId?: number } {
  const s = input.trim()
  if (!s) return {}
  // 数字だけを貼られた場合はバージョン ID とみなす（モデルページの右側に出る値）
  if (/^\d+$/.test(s)) return { versionId: Number(s) }
  let url: URL
  try {
    url = new URL(s)
  } catch {
    return {}
  }
  const v = url.searchParams.get('modelVersionId')
  const m = /\/models\/(\d+)/.exec(url.pathname)
  return {
    versionId: v && /^\d+$/.test(v) ? Number(v) : undefined,
    modelId: m ? Number(m[1]) : undefined,
  }
}

/** ベースモデル名からプロンプトの作法を推定する。**必ず上書き可**（推定は当たらないことがある） */
export function promptStyleFromBaseModel(baseModel: string): PromptStyle {
  return /flux|sd\s*3|qwen|hidream/i.test(baseModel) ? 'natural' : 'tags'
}

async function getJson(url: string, apiKey: string): Promise<unknown> {
  const res = await appFetch(url, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  })
  if (res.status === 401 || res.status === 403) throw new Error('Civitai の API キーが無効です。')
  if (res.status === 404) throw new Error('そのモデルが見つかりませんでした。URL を確認してください。')
  if (!res.ok) throw new Error(`Civitai エラー (${res.status})`)
  return res.json()
}

/** URL（またはバージョン ID）から生成に必要な情報を引く。失敗は throw（呼び出し側で表示） */
export async function resolveCivitaiResource(input: string, apiKey: string): Promise<CivitaiResource> {
  const { versionId, modelId } = parseCivitaiUrl(input)
  let vid = versionId
  if (!vid) {
    if (!modelId) throw new Error('Civitai のモデルページの URL を貼ってください。')
    // バージョン未指定なら最新版を採用する
    const m = (await getJson(`${SITE_API}/models/${modelId}`, apiKey)) as {
      modelVersions?: { id?: number }[]
    }
    vid = m.modelVersions?.[0]?.id
    if (!vid) throw new Error('このモデルには利用できるバージョンがありません。')
  }
  const v = (await getJson(`${SITE_API}/model-versions/${vid}`, apiKey)) as {
    air?: string
    name?: string
    baseModel?: string
    trainedWords?: unknown
    model?: { name?: string; type?: string }
  }
  if (!v.air) {
    throw new Error('このバージョンは API 生成に対応していません（AIR が発行されていません）。')
  }
  return {
    air: v.air,
    name: v.model?.name ?? '(名称不明)',
    versionName: v.name ?? '',
    baseModel: v.baseModel ?? '',
    type: v.model?.type ?? '',
    trainedWords: Array.isArray(v.trainedWords)
      ? v.trainedWords.filter((x): x is string => typeof x === 'string')
      : [],
  }
}
