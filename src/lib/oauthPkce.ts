// R4: OpenRouter OAuth（PKCE）。docs/設計_公開前実装.md R4 参照。
//
// エンドポイント（2026-08-16 に OpenRouter 公式ドキュメントで確認）:
//   認可ページ: https://openrouter.ai/auth?callback_url=...&code_challenge=...&code_challenge_method=S256
//   交換:      POST https://openrouter.ai/api/v1/auth/keys { code, code_verifier, code_challenge_method }
// client_id の事前登録は不要。localhost の callback は任意のポートが許容される。
//
// **`state` パラメータは無い**（OpenRouter 側が対応していない）。CSRF 対策は代わりに、
// ローカル受け口をリクエスト1件だけ・ランダムな nonce をパスに含む URL でしか受け付けない
// ことで代替する（oauth.rs 側）。手動キー貼り付けは削らない（この関数は追加の入口）。
//
// P5: Web 版はローカル受け口を立てられないので**リダイレクト方式**を足した。`callback_url` を
// 自分のページ URL にし、`?code=` 付きで戻ってきたところで交換する。検証子（`code_verifier`）は
// そのタブの `sessionStorage` にだけ置く＝**注入された他人のコードは PKCE の突き合わせで弾かれる**
// （`state` が無い分の CSRF 対策はこの結び付きが担う）。

import { appFetch, oauthPkceMode } from './platform'

export class OAuthPkceError extends Error {}

/** OAuth を始めた画面。Web はページごと離れるので、戻ってきた時にどこへ返すかを覚えておく */
export type OAuthOrigin = 'wizard' | 'settings'

/** リダイレクト方式の途中経過を置く sessionStorage のキー（タブ内だけ・タブを閉じれば消える） */
const REDIRECT_KEY = 'delist-oauth-pkce'

interface PendingRedirect {
  codeVerifier: string
  origin: OAuthOrigin
}

function randomBytes(n: number): Uint8Array {
  const arr = new Uint8Array(n)
  crypto.getRandomValues(arr)
  return arr
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomHex(n: number): string {
  return Array.from(randomBytes(n))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function sha256(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return new Uint8Array(digest)
}

interface OAuthListenResult {
  code: string | null
  error: string | null
}

/**
 * OpenRouter の OAuth (PKCE) を1回実行し、発行された API キーを返す。
 * 失敗（拒否・タイムアウト・交換失敗）は `OAuthPkceError` を投げる。呼び出し側で catch して表示する。
 */
export async function startOpenRouterOAuth(): Promise<string> {
  if (oauthPkceMode() !== 'listener') {
    throw new OAuthPkceError('この環境ではブラウザ承認の受け口を立てられません。API キーを直接貼り付けてください。')
  }

  const codeVerifier = base64UrlEncode(randomBytes(32))
  const codeChallenge = base64UrlEncode(await sha256(codeVerifier))
  const nonce = randomHex(16)

  const { listen } = await import('@tauri-apps/api/event')
  const { invoke } = await import('@tauri-apps/api/core')
  const { openUrl } = await import('@tauri-apps/plugin-opener')

  let resolvePort: (port: number) => void = () => {}
  const portPromise = new Promise<number>((resolve) => {
    resolvePort = resolve
  })
  // invoke より先に登録する（先に emit されて取りこぼす競合を避ける）
  const unlisten = await listen<{ port: number }>('oauth-pkce-port', (e) => resolvePort(e.payload.port))

  try {
    const listenPromise = invoke<OAuthListenResult>('oauth_pkce_listen', { nonce, timeoutSecs: 180 })

    const port = await portPromise
    const callbackUrl = `http://127.0.0.1:${port}/callback/${nonce}`
    const authorizeUrl =
      `https://openrouter.ai/auth?callback_url=${encodeURIComponent(callbackUrl)}` +
      `&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=S256`
    await openUrl(authorizeUrl)

    const result = await listenPromise
    if (result.error) {
      throw new OAuthPkceError(
        result.error === 'timeout'
          ? '承認がタイムアウトしました（3分以内にブラウザで承認してください）。もう一度お試しください。'
          : `OpenRouter 側で承認が完了しませんでした（${result.error}）。`,
      )
    }
    if (!result.code) {
      throw new OAuthPkceError('認証コードを受け取れませんでした。もう一度お試しください。')
    }

    return await exchangeCodeForKey(result.code, codeVerifier)
  } finally {
    void unlisten()
  }
}

/** 認可コードを API キーへ交換する（両方式の共通部）。PKCE の検証子はここでしか使わない */
async function exchangeCodeForKey(code: string, codeVerifier: string): Promise<string> {
  const res = await appFetch('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: codeVerifier, code_challenge_method: 'S256' }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new OAuthPkceError(`API キーの発行に失敗しました（HTTP ${res.status}）。${text.slice(0, 200)}`)
  }
  const body = (await res.json()) as { key?: string }
  if (!body.key) {
    throw new OAuthPkceError('API キーの発行に失敗しました（応答が想定と異なります）。')
  }
  return body.key
}

// --- リダイレクト方式（Web。P5）---
//
// ページごと離れて戻ってくるので、1回の OAuth が「開始」と「完了」の2つの関数に割れる。
// 開始側は戻らない（`location.assign`）ため `Promise<never>` 相当の扱いで呼ぶ。

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    // プライベートモード等で読めないことがある（その場合はリダイレクト方式を使わせない）
    return null
  }
}

/** 戻り先＝いま開いているページ（クエリとハッシュは落とす。`?code=` を二重に持たせない） */
function callbackUrlOfThisPage(): string {
  return `${location.origin}${location.pathname}`
}

/** リダイレクト方式が使えるか（`sessionStorage` が読めることが条件） */
export function oauthRedirectUsable(): boolean {
  return oauthPkceMode() === 'redirect' && sessionStore() !== null
}

/**
 * 「ブラウザで承認する」を出してよいか（UI の唯一の判定窓口）。
 * Tauri は常に可、Web は `sessionStorage` が読めるときだけ（プライベートモード等では手動貼り付けへ倒す）。
 */
export function openRouterOAuthAvailable(): boolean {
  return oauthPkceMode() === 'listener' || oauthRedirectUsable()
}

/**
 * OpenRouter の認可ページへ**ページごと移動する**（Web）。戻り先はこのページで、
 * `?code=` 付きで再読み込みされる。呼び出し後この関数は返らない。
 */
export async function redirectToOpenRouterOAuth(origin: OAuthOrigin): Promise<void> {
  const store = sessionStore()
  if (!store) {
    throw new OAuthPkceError(
      'このブラウザではブラウザ承認を開始できません（sessionStorage が使えません）。API キーを直接貼り付けてください。',
    )
  }
  const codeVerifier = base64UrlEncode(randomBytes(32))
  const codeChallenge = base64UrlEncode(await sha256(codeVerifier))
  const pending: PendingRedirect = { codeVerifier, origin }
  store.setItem(REDIRECT_KEY, JSON.stringify(pending))

  const authorizeUrl =
    `https://openrouter.ai/auth?callback_url=${encodeURIComponent(callbackUrlOfThisPage())}` +
    `&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=S256`
  location.assign(authorizeUrl)
}

/**
 * このページ読み込みが OAuth の戻りか（`?code=` があり、かつこのタブが検証子を持っている）。
 * 起動時に1回だけ見る。**副作用は無い**（実際の消費は `completeOpenRouterOAuthRedirect`）。
 */
export function pendingOAuthRedirect(): boolean {
  if (typeof location === 'undefined') return false
  if (!new URLSearchParams(location.search).has('code')) return false
  return sessionStore()?.getItem(REDIRECT_KEY) != null
}

/** URL から `?code=` を消す（履歴を増やさない）。交換の成否によらず必ず呼ぶ */
function clearCodeFromUrl(): void {
  if (typeof history === 'undefined' || !history.replaceState) return
  history.replaceState(null, '', callbackUrlOfThisPage() + location.hash)
}

/**
 * 戻ってきた `?code=` を API キーへ交換する（Web）。検証子と URL のコードは**成否によらず使い捨て**
 * ＝リロードで同じコードを再送しない。失敗は `OAuthPkceError`。
 */
export async function completeOpenRouterOAuthRedirect(): Promise<{ apiKey: string; origin: OAuthOrigin }> {
  const store = sessionStore()
  const raw = store?.getItem(REDIRECT_KEY) ?? null
  const code = new URLSearchParams(location.search).get('code')
  store?.removeItem(REDIRECT_KEY)
  clearCodeFromUrl()

  if (!raw) throw new OAuthPkceError('承認の途中経過が見つかりませんでした。もう一度お試しください。')
  let pending: PendingRedirect
  try {
    pending = JSON.parse(raw) as PendingRedirect
  } catch {
    throw new OAuthPkceError('承認の途中経過を読めませんでした。もう一度お試しください。')
  }
  if (!code) throw new OAuthPkceError('認証コードを受け取れませんでした。もう一度お試しください。')

  const apiKey = await exchangeCodeForKey(code, pending.codeVerifier)
  return { apiKey, origin: pending.origin === 'settings' ? 'settings' : 'wizard' }
}
