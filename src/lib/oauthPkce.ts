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

import { appFetch, oauthPkceAvailable } from './platform'

export class OAuthPkceError extends Error {}

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
  if (!oauthPkceAvailable()) {
    throw new OAuthPkceError('OAuth 接続は制作版アプリでのみ利用できます。API キーを直接貼り付けてください。')
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

    const res = await appFetch('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: result.code,
        code_verifier: codeVerifier,
        code_challenge_method: 'S256',
      }),
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
  } finally {
    void unlisten()
  }
}
