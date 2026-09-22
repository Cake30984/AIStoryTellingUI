import type { OpenRouterModel, Provider, Role } from '../types'
import { appFetch } from './platform'
import { isAnthropicEndpoint, isLocalEndpoint } from './providers'
import { weakerJsonMode, type JsonMode, type JsonSchemaSpec } from './jsonSchemas'
import { estimateTokens } from './tokens'

/** モードの強さ（比較用） */
const rank = (m: JsonMode) => (m === 'schema' ? 2 : m === 'object' ? 1 : 0)

/** content ブロック配列の1要素。`cache_control` はキャッシュのブレークポイント（PC-C） */
export type ContentPart = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }

export interface ChatMessage {
  role: Role
  /**
   * 文字列で組み立てる（`prompts.ts` は常に文字列を返す）。
   * ブロック配列になるのは送信直前の `withCacheControl` を通った後だけ。
   */
  content: string | ContentPart[]
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
  /*
   * OpenRouter 推奨の任意ヘッダ（ランキング表示などに使われる）。
   *
   * **ローカルの接続先へは送らない。** 既定の接続先（`kind:'openrouter'`）の Base URL だけを
   * Ollama / LM Studio に書き換える使い方は自然だが、そのとき種別は openrouter のまま残る。
   * `X-Title` は単純ヘッダではないためブラウザがプリフライトを打ち、Ollama の
   * `Access-Control-Allow-Headers` に無いので**本番の POST が全部 CORS で落ちる**
   * （Web 版のみ。Tauri 版は plugin-http なので CORS 対象外）。
   * ランキングに載せる相手でもないので、送る意味も無い。
   * 判定は種別ではなく接続先で行う＝実際の openrouter.ai 宛のリクエストは1バイトも変わらない。
   */
  if (provider.kind === 'openrouter' && !isLocalEndpoint(provider.baseUrl)) {
    headers['HTTP-Referer'] = location.origin
    headers['X-Title'] = 'Delusia'
  }
  /*
   * Anthropic 直叩き（プリセット「Claude」）。api.anthropic.com はブラウザからの直接アクセスを
   * このヘッダが無いと CORS で拒否する（BYOK でキーがユーザー自身のものだと明示するための opt-in）。
   * Tauri 版は CORS 対象外だが、送っても害は無いので判定は接続先だけで行う。
   */
  if (isAnthropicEndpoint(provider.baseUrl)) {
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
  }
  return headers
}

/**
 * Anthropic の最小キャッシュ長（モデルにより 1024〜2048 トークン）。
 * これを下回る接頭辞は Anthropic 側で単に**キャッシュされない**（エラーにはならない）ので、
 * 無意味なマーカーを付けないための足切りとしてだけ使う。
 */
const MIN_CACHE_TOKENS = 1024

/**
 * 末尾の「毎ターン変わる」メッセージ数（PC1+PC4 の組み立てに対応）。
 * 深さ3の1通 ＋ その後ろの履歴3件 ＋ 深さ0の1通 ＋ 呼び出し側の念押し1通（`CONTINUATION_NUDGE` 等）= 6。
 * ブレークポイント②はこの手前に置く＝**多めに数える方が安全**（早すぎればキャッシュ範囲が少し狭まるだけだが、
 * 遅すぎると毎ターン変わるメッセージを接頭辞に含めてしまいブレークポイントが無駄になる）。
 */
const VOLATILE_TAIL_MESSAGES = 6

/** cache_control を付ける相手か。Anthropic 系以外は素通し＝リクエストの形を1バイトも変えない */
function isAnthropic(provider: Provider, model: string): boolean {
  // OpenRouter 経由（`anthropic/claude-…`）
  if (/^anthropic\//i.test(model)) return true
  // Anthropic 直叩き（OpenAI 互換エンドポイント）
  return isAnthropicEndpoint(provider.baseUrl)
}

/**
 * Anthropic 系にだけプロンプトキャッシュのブレークポイントを付ける（PC-C）。
 *
 * `buildMessages` は今までどおり `content: string` を返し、変換はこの送信直前の1箇所に閉じ込める
 * （プロンプト組み立て側がプロバイダの都合を知らなくて済む）。
 * ブレークポイントは上限4つのうち**2つ**だけ使う:
 *   ① system メッセージの末尾 — 毎ターン byte 一致する最大の塊（PC1+PC4 でそう作ってある）
 *   ② 深さ3の注入点の手前 — そこから後ろは毎ターン変わるので、境界をその前に置く
 *
 * 非対応モデルへ content ブロック配列を送っても実測ではエラーにならない（F8）が、
 * **意図しない差分を作らない**ため対象を Anthropic 系に限定する。
 * `docs/詳細設計_プロンプト構造とキャッシュ.md` §7.1
 */
export function withCacheControl(
  messages: ChatMessage[],
  provider: Provider,
  model: string,
): ChatMessage[] {
  if (!isAnthropic(provider, model)) return messages
  // 呼び出し側が既にブロック配列を組んでいる場合は触らない（二重付与の事故を避ける）
  if (messages.some((m) => typeof m.content !== 'string')) return messages

  // 接頭辞の累計トークン（概算）。最小キャッシュ長に満たない位置にはマーカーを置かない
  let acc = 0
  const prefixTokens = messages.map((m) => {
    acc += estimateTokens(m.content as string)
    return acc
  })

  const marks = new Set<number>()
  const mark = (i: number) => {
    if (i >= 0 && i < messages.length && prefixTokens[i] >= MIN_CACHE_TOKENS) marks.add(i)
  }
  // ① system の末尾
  if (messages[0]?.role === 'system') mark(0)
  // ② 毎ターン変わる末尾を除いた最後の位置（system 自身は①が担当するので 1 以上に限る）
  const stable = messages.length - 1 - VOLATILE_TAIL_MESSAGES
  if (stable >= 1) mark(stable)

  if (marks.size === 0) return messages
  return messages.map((m, i) =>
    marks.has(i)
      ? {
          role: m.role,
          content: [
            { type: 'text' as const, text: m.content as string, cache_control: { type: 'ephemeral' as const } },
          ],
        }
      : m,
  )
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

  // プロンプトキャッシュのブレークポイント付与（Anthropic 系のみ。それ以外は同一参照で素通し）
  const outgoing = withCacheControl(params.messages, params.provider, params.model)

  const send = (m: JsonMode) =>
    appFetch(`${params.provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: commonHeaders(params.provider),
      signal: params.signal,
      body: JSON.stringify({
        model: params.model,
        messages: outgoing,
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

/** `/models` 用の認証ヘッダ。Anthropic 直叩きだけは OpenAI 互換の `/models` が無く、ネイティブ API の形で叩く */
function modelsHeaders(provider: Provider): Record<string, string> | undefined {
  if (isAnthropicEndpoint(provider.baseUrl)) {
    return {
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    }
  }
  return provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : undefined
}

/** 利用可能なモデル一覧を取得 */
export async function fetchModels(provider: Provider): Promise<OpenRouterModel[]> {
  // Anthropic のネイティブ `/models` はページング（既定 20 件）なので上限を明示する
  const url = `${provider.baseUrl}/models` + (isAnthropicEndpoint(provider.baseUrl) ? '?limit=1000' : '')
  const res = await appFetch(url, {
    // ブラウザの HTTP キャッシュは Authorization ヘッダの違いをキャッシュキーに含めないため、
    // no-store にしないと「別接続先が同じ baseUrl へキー付きで取得済み」の場合に
    // キー無しリクエストでもキャッシュされた成功レスポンスが返ってしまう。
    cache: 'no-store',
    headers: modelsHeaders(provider),
  })
  if (!res.ok) {
    throw new Error(`モデル一覧の取得に失敗しました (${res.status})`)
  }
  const json = await res.json()
  const data: (OpenRouterModel & { display_name?: string })[] = json.data ?? []
  return data
    .filter(m => m.id)
    // `name` を持つのは OpenRouter だけ。Gemini の OpenAI 互換 `/models` は id のみ・Anthropic は `display_name`。
    // 空のまま返すと検索の `name.toLowerCase()` で落ちてモデル選択画面ごと消えるので、ここで必ず埋める
    .map(m => ({ ...m, name: m.name ?? m.display_name ?? m.id }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** 接続テストの結果種別。R5 のエラー翻訳表と対応させる（ウィザードが `kind` で導線を出し分ける） */
export type ConnectionTestKind = 'invalid_key' | 'quota' | 'invalid_model' | 'content_filter' | 'unreachable' | 'unknown'

export type ConnectionTestResult =
  | { ok: true; message: string }
  | { ok: false; kind: ConnectionTestKind; message: string }

/** レスポンスのエラー文言にコンテンツフィルタ系のキーワードが含まれるか（プロバイダ間で文言がまちまちなため緩めに拾う） */
function looksLikeContentFilter(text: string): boolean {
  return /moderation|flagged|content[ _-]?filter|content policy|safety system|blocked by/i.test(text)
}

function looksLikeModelError(text: string): boolean {
  return /model/i.test(text) && /not found|does not exist|invalid model|unknown model|no such model/i.test(text)
}

/**
 * 極小のリクエストで接続を確認する（R5）。**投げっぱなしにしない**：生の API エラーはここで
 * 日本語の導線付きメッセージへ翻訳し、呼び出し側（ウィザード）は `kind` で次の一手を出し分ける。
 */
export async function testProviderConnection(provider: Provider, model: string): Promise<ConnectionTestResult> {
  if (!provider.baseUrl.trim()) {
    return { ok: false, kind: 'unreachable', message: 'Base URL が未入力です。' }
  }
  if (!isLocalEndpoint(provider.baseUrl) && !provider.apiKey.trim()) {
    return { ok: false, kind: 'invalid_key', message: 'API キーが未入力です。貼り付けてください。' }
  }
  if (!model.trim()) {
    return { ok: false, kind: 'invalid_model', message: 'モデルを選択してください。' }
  }

  let res: Response
  try {
    res = await appFetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: commonHeaders(provider),
      omitOrigin: isLocalEndpoint(provider.baseUrl),
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1,
        stream: false,
      }),
    })
  } catch (e) {
    return {
      ok: false,
      kind: 'unreachable',
      message: `接続先に到達できませんでした。Base URL や起動状態を確認してください（${(e as Error).message}）。`,
    }
  }

  if (res.ok) {
    const json = await res.json().catch(() => null)
    if (json?.choices?.[0]?.finish_reason === 'content_filter') {
      return {
        ok: false,
        kind: 'content_filter',
        message: 'コンテンツフィルタにより応答がブロックされました。モデルを変更してください。',
      }
    }
    return { ok: true, message: '接続できました。' }
  }

  const text = await res.text().catch(() => '')
  let detail = text
  try {
    detail = JSON.parse(text)?.error?.message ?? text
  } catch {
    // JSON でないボディはそのまま使う
  }
  const snippet = detail.slice(0, 200)

  if (res.status === 401 || res.status === 403) {
    if (looksLikeContentFilter(detail)) {
      return {
        ok: false,
        kind: 'content_filter',
        message: `コンテンツフィルタにより拒否されました。表現の制限が緩いモデルへの変更を検討してください。（${snippet}）`,
      }
    }
    return {
      ok: false,
      kind: 'invalid_key',
      message: `API キーが正しくないか、権限がありません。キーを貼り直してください。（${snippet}）`,
    }
  }
  if (res.status === 429) {
    return {
      ok: false,
      kind: 'quota',
      message: `利用上限（残高不足またはレート制限）に達しています。課金状況を確認するか、時間をおいて再試行してください。（${snippet}）`,
    }
  }
  if (res.status === 404 || looksLikeModelError(detail)) {
    return {
      ok: false,
      kind: 'invalid_model',
      message: `モデル名が正しくありません。モデルを選び直してください。（${snippet}）`,
    }
  }
  if (looksLikeContentFilter(detail)) {
    return {
      ok: false,
      kind: 'content_filter',
      message: `コンテンツフィルタにより拒否されました。モデル選択画面から別のモデルを試してください。（${snippet}）`,
    }
  }
  return { ok: false, kind: 'unknown', message: `接続に失敗しました（HTTP ${res.status}）。${snippet}` }
}
