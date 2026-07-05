import type { OpenRouterModel, Provider, Role } from '../types'
import { appFetch } from './platform'

export interface ChatMessage {
  role: Role
  content: string
}

export interface ChatParams {
  provider: Provider
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

/** プロバイダ種別に応じたリクエストヘッダを組み立てる */
function commonHeaders(provider: Provider): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${provider.apiKey}`,
    'Content-Type': 'application/json',
  }
  // OpenRouter 推奨の任意ヘッダ（ランキング表示などに使われる）
  if (provider.kind === 'openrouter') {
    headers['HTTP-Referer'] = location.origin
    headers['X-Title'] = 'AI Storytelling Studio'
  }
  return headers
}

export interface ChatResult {
  text: string
  /** 停止理由（stop=完了 / length=上限到達 / null=不明・切断 など） */
  finishReason: string | null
}

/**
 * チャット補完をストリーミングで取得する。
 * onDelta で逐次トークンが渡される。完了後に全文と停止理由を返す。
 */
export async function streamChat(
  params: ChatParams,
  onDelta: (chunk: string) => void,
): Promise<ChatResult> {
  const res = await appFetch(`${params.provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: commonHeaders(params.provider),
    signal: params.signal,
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stream: true,
    }),
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`API エラー (${res.status}): ${text || res.statusText}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let finishReason: string | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE は \n\n でイベント区切り
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith(':')) continue
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return { text: full, finishReason }
      try {
        const json = JSON.parse(data)
        const choice = json.choices?.[0]
        const delta: string | undefined = choice?.delta?.content
        if (delta) {
          full += delta
          onDelta(delta)
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason
      } catch {
        // 分割された JSON 断片は次チャンクで補完されるため無視
      }
    }
  }
  return { text: full, finishReason }
}

/** 利用可能なモデル一覧を取得 */
export async function fetchModels(provider: Provider): Promise<OpenRouterModel[]> {
  const res = await appFetch(`${provider.baseUrl}/models`, {
    headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : undefined,
  })
  if (!res.ok) {
    throw new Error(`モデル一覧の取得に失敗しました (${res.status})`)
  }
  const json = await res.json()
  const data: OpenRouterModel[] = json.data ?? []
  return data.filter(m => m.id).sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id))
}
