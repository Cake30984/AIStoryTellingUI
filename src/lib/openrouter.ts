import type { OpenRouterModel, Provider, Role } from '../types'
import { appFetch } from './platform'
import { weakerJsonMode, type JsonMode, type JsonSchemaSpec } from './jsonSchemas'

/** モードの強さ（比較用） */
const rank = (m: JsonMode) => (m === 'schema' ? 2 : m === 'object' ? 1 : 0)

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
  /** 出力を固定するのに使うスキーマ（`jsonMode==='schema'` のときだけ使う。`jsonSchemas.ts`） */
  jsonSchema?: JsonSchemaSpec
  /**
   * JSON 強制の初期モード（呼び出し側の対応判定。既定 `none`）。
   * ここは**弾かれたら1段ずつ弱いモードへ落として投げ直す**保険を持つので、多少強気で構わない。
   */
  jsonMode?: JsonMode
}

/**
 * モデルごとに「実際に通った上限」を覚える（プロセス内のみ）。
 * 一度弾かれたら以降そのモデルには最初からその段で送る＝毎回無駄打ちするのを避ける。
 * 永続化しない（モデル側の対応は増えるので、再起動で楽観に戻すのが妥当）。
 */
const jsonModeCap = new Map<string, JsonMode>()

/**
 * 弱いモードで投げ直す価値がある失敗か。
 * 認証・レート超過は明らかに別問題なので対象外。それ以外の 4xx/5xx は**文言を問わず**降格を試す
 * ——ローカル/自前の OpenAI 互換サーバは `response_format` に触れない曖昧なエラーを返すことがあり、
 * 文言での判定に頼ると「対応していないのにエラーだけ出る」状態になるため。
 */
function mayBeJsonModeRejection(status: number): boolean {
  return status !== 401 && status !== 403 && status !== 429
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

export interface ChatUsage {
  promptTokens: number
  completionTokens: number
  /** プレフィックスキャッシュから読めた入力トークン数 */
  cachedTokens: number
  /** キャッシュ書き込みトークン数（Anthropic 系のみ非0になる） */
  cacheWriteTokens: number
  /** プロバイダ申告の実コスト（USD）。OpenRouter 以外は undefined */
  cost?: number
  /** 実際に処理した上流プロバイダ名。キャッシュはこの単位で効くので必ず記録する */
  upstream?: string
}

export interface ChatResult {
  text: string
  /** 停止理由（stop=完了 / length=上限到達 / null=不明・切断 など） */
  finishReason: string | null
  usage?: ChatUsage
}

/**
 * チャット補完をストリーミングで取得する。
 * onDelta で逐次トークンが渡される。完了後に全文と停止理由を返す。
 */
export async function streamChat(
  params: ChatParams,
  onDelta: (chunk: string) => void,
): Promise<ChatResult> {
  const modelKey = `${params.provider.id}::${params.model}`
  // 過去に弾かれた実績があればそこから始める（無駄打ちを繰り返さない）
  const requested = params.jsonSchema ? (params.jsonMode ?? 'none') : 'none'
  const capped = jsonModeCap.get(modelKey)
  let mode: JsonMode =
    capped && rank(capped) < rank(requested) ? capped : requested

  const send = (m: JsonMode) =>
    appFetch(`${params.provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: commonHeaders(params.provider),
      signal: params.signal,
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        stream: true,
        // OpenRouter は無くても usage を返すため送らない。汎用 OpenAI 互換サーバのみ明示的に要求する
        // （現行の OpenRouter リクエストを1バイトも変えないため。未知フィールドで 400 を返す互換サーバ対策）。
        ...(params.provider.kind === 'openai' ? { stream_options: { include_usage: true } } : {}),
        ...(m === 'schema' && params.jsonSchema
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: {
                  name: params.jsonSchema.name,
                  strict: true,
                  schema: params.jsonSchema.schema,
                },
              },
              // スキーマを無視する上流へ回されないようにする（OpenRouter は同一モデルでも
              // 上流を分散するため。指定が無いと「対応していない上流に当たった回だけ崩れる」になる）
              ...(params.provider.kind === 'openrouter'
                ? { provider: { require_parameters: true } }
                : {}),
            }
          : {}),
        ...(m === 'object' ? { response_format: { type: 'json_object' } } : {}),
      }),
    })

  let res = await send(mode)

  // 弾かれたら1段ずつ弱いモードへ落として投げ直す（schema → json_object → 素）
  while ((!res.ok || !res.body) && mode !== 'none' && mayBeJsonModeRejection(res.status)) {
    const text = await res.text().catch(() => '')
    const next = weakerJsonMode(mode)
    console.warn(
      `[llm] ${params.model} は ${mode === 'schema' ? 'JSON スキーマ' : 'JSON モード'}を受け付けませんでした（${res.status}）。${
        next === 'none' ? '指定なし' : 'JSON モード'
      }で投げ直します:`,
      text.slice(0, 200),
    )
    mode = next
    res = await send(mode)
    // 落とした先で通ったなら、そのモデルの上限として記憶する
    if (res.ok && res.body) jsonModeCap.set(modelKey, mode)
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`API エラー (${res.status}): ${text || res.statusText}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let finishReason: string | null = null
  let lastUsage: Omit<ChatUsage, 'upstream'> | undefined
  let upstream: string | undefined

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
      // [DONE] の後に usage チャンクが来る経路もあり得るため、順序を仮定せず return せずに読み続ける
      // （ストリームは reader.read() が done:true を返した時点で自然に終わる）
      if (data === '[DONE]') continue
      try {
        const json = JSON.parse(data)
        const choice = json.choices?.[0]
        const delta: string | undefined = choice?.delta?.content
        if (delta) {
          full += delta
          onDelta(delta)
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason
        if (json.usage) {
          lastUsage = {
            promptTokens: json.usage.prompt_tokens ?? 0,
            completionTokens: json.usage.completion_tokens ?? 0,
            cachedTokens: json.usage.prompt_tokens_details?.cached_tokens ?? 0,
            cacheWriteTokens: json.usage.prompt_tokens_details?.cache_write_tokens ?? 0,
            cost: json.usage.cost,
          }
        }
        if (json.provider) upstream = String(json.provider)
      } catch {
        // 分割された JSON 断片は次チャンクで補完されるため無視
      }
    }
  }
  return {
    text: full,
    finishReason,
    usage: lastUsage ? { ...lastUsage, upstream } : undefined,
  }
}

/** 利用可能なモデル一覧を取得 */
export async function fetchModels(provider: Provider): Promise<OpenRouterModel[]> {
  const res = await appFetch(`${provider.baseUrl}/models`, {
    // ブラウザの HTTP キャッシュは Authorization ヘッダの違いをキャッシュキーに含めないため、
    // no-store にしないと「別接続先が同じ baseUrl へキー付きで取得済み」の場合に
    // キー無しリクエストでもキャッシュされた成功レスポンスが返ってしまう。
    cache: 'no-store',
    headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : undefined,
  })
  if (!res.ok) {
    throw new Error(`モデル一覧の取得に失敗しました (${res.status})`)
  }
  const json = await res.json()
  const data: OpenRouterModel[] = json.data ?? []
  return data.filter(m => m.id).sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id))
}
