import type { Provider, ProviderKind } from '../types'

function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/** モデル参照内でプロバイダIDとモデルIDを区切る文字列 */
export const PROVIDER_SEP = '::'

export interface ProviderPreset {
  label: string
  kind: ProviderKind
  baseUrl: string
}

/**
 * 主要プロバイダのプリセット（base URL 補完用）。
 * ※ ブラウザから直叩き可能かどうかは各社の CORS ポリシー次第。
 *    確実動作が確認されているのは OpenRouter のみ。
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { label: 'OpenRouter', kind: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1' },
  { label: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1' },
  { label: 'OpenAI互換（カスタム）', kind: 'openai', baseUrl: '' },
]

/** デフォルトの OpenRouter プロバイダを生成（v6→v7 移行・初期状態用） */
export function defaultOpenRouterProvider(apiKey: string): Provider {
  return {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey,
  }
}

/** 空の新規プロバイダを生成 */
export function newProvider(): Provider {
  return {
    id: uid(),
    label: '',
    kind: 'openai',
    baseUrl: '',
    apiKey: '',
  }
}

/**
 * モデル参照（"providerId::modelId" または plain modelId）を分解する。
 * - "::" を含む → providerId と modelId に分割
 * - "::" を含まない → providerId: null（既定プロバイダにフォールバック）
 */
export function splitRef(ref: string): { providerId: string | null; model: string } {
  const idx = ref.indexOf(PROVIDER_SEP)
  if (idx < 0) return { providerId: null, model: ref }
  return { providerId: ref.slice(0, idx), model: ref.slice(idx + PROVIDER_SEP.length) }
}

/** プロバイダID とモデルID からモデル参照文字列を組み立てる */
export function makeModelRef(providerId: string, model: string): string {
  return `${providerId}${PROVIDER_SEP}${model}`
}

/**
 * モデル参照からプロバイダとモデルIDを解決する。
 * providerId が見つからない場合・plain 文字列の場合は providers[0]（既定プロバイダ）にフォールバック。
 * providers が空のときは provider: undefined（呼び出し側は API キー有無のガードで弾く）。
 */
export function parseModelRef(
  ref: string,
  providers: Provider[],
): { provider: Provider | undefined; model: string } {
  const fallback: Provider | undefined = providers[0]
  if (!ref || providers.length === 0) return { provider: fallback, model: ref }
  const { providerId, model } = splitRef(ref)
  if (!providerId) return { provider: fallback, model }
  const found = providers.find((p) => p.id === providerId)
  return { provider: found ?? fallback, model }
}

/**
 * UI 表示用のモデルラベル。
 * - プロバイダが1件のみ: モデルIDのみ表示（接続先プレフィックス省略）
 * - 複数プロバイダ: "[プロバイダ名] モデルID" 形式
 * - plain モデルID（"::" なし）: そのまま表示
 */
export function modelRefLabel(ref: string, providers: Provider[]): string {
  if (!ref) return ''
  const { providerId, model } = splitRef(ref)
  if (!providerId || providers.length <= 1) return model
  const p = providers.find((pr) => pr.id === providerId)
  return p ? `[${p.label}] ${model}` : model
}
