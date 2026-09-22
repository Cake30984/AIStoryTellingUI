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

/** Gemini の OpenAI 互換エンドポイント（初回ウィザードの「無料枠」と設定のプリセットで共用） */
export const GEMINI_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'

/** Anthropic（Claude）の OpenAI 互換エンドポイント。ブラウザ直叩きには専用ヘッダが要る（`openrouter.ts` の `commonHeaders`） */
export const ANTHROPIC_OPENAI_BASE_URL = 'https://api.anthropic.com/v1'

/**
 * 主要プロバイダのプリセット（base URL 補完用）。
 * Gemini / Claude も中身は OpenAI 互換（`kind:'openai'`）で、URL だけ最初から入っている独立の選択肢。
 * ※ ブラウザから直叩き可能かどうかは各社の CORS ポリシー次第。
 *    確実動作が確認されているのは OpenRouter のみ。
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { label: 'OpenRouter', kind: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { label: 'Gemini', kind: 'openai', baseUrl: GEMINI_OPENAI_BASE_URL },
  { label: 'Claude', kind: 'openai', baseUrl: ANTHROPIC_OPENAI_BASE_URL },
  { label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1' },
  { label: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1' },
  { label: 'OpenAI互換（カスタム）', kind: 'openai', baseUrl: '' },
]

/** Anthropic 直叩き（`api.anthropic.com`）か。ブラウザ向けの追加ヘッダと `/models` の認証方式が他社と違う */
export function isAnthropicEndpoint(baseUrl: string): boolean {
  try {
    return /(^|\.)anthropic\.com$/i.test(new URL(baseUrl).hostname)
  } catch {
    return false
  }
}

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

/**
 * ローカル（同一 PC／宅内 LAN）で動いている接続先か。
 *
 * Ollama / LM Studio のようなローカルの OpenAI 互換サーバは **API キーを持たない**。
 * ここを見ずに「キーが空＝設定漏れ」と扱うと、**正しく設定できている構成が警告になり、
 * 生成そのものが止まる**（R5「PC で動かす」の導線）。
 */
export function isLocalEndpoint(baseUrl: string): boolean {
  let host: string
  try {
    host = new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return false
  }
  // URL の hostname は IPv6 を角括弧付きで返す
  const h = host.replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h === '::1' || h === '0.0.0.0') return true
  if (h.endsWith('.local')) return true // mDNS（宅内の別 PC で動かす構成）
  // 127.0.0.0/8
  if (/^127\./.test(h)) return true
  // RFC1918（宅内 LAN の別 PC に Ollama を置く構成は珍しくない）
  if (/^10\./.test(h)) return true
  if (/^192\.168\./.test(h)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true
  return false
}

/**
 * この接続先は API キーを要求するか。
 * **キーの有無を判定する側は必ずこれを通す**（`apiKey.trim()` を直接見ない）。
 */
export function requiresApiKey(provider: Provider): boolean {
  return !isLocalEndpoint(provider.baseUrl)
}

/** 接続先として使える状態か（キーが要るならキーがある、要らないなら常に true） */
export function isProviderUsable(provider: Provider | undefined): provider is Provider {
  if (!provider) return false
  return !requiresApiKey(provider) || provider.apiKey.trim() !== ''
}

/**
 * 使えない接続先の理由を日本語で返す（`isProviderUsable` が false のときだけ呼ぶ）。
 * **「接続先が無い」と「キーが無い」は別の失敗**なので文言を分ける。
 */
export function providerUnusableMessage(provider: Provider | undefined): string {
  if (!provider) return '接続先が設定されていません。設定から登録してください。'
  return `接続先「${provider.label}」の API キーが未設定です。設定から登録してください。`
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
