import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 交換だけは appFetch を通る（ネットワークを踏まない）。platform は Web 扱いに固定する
const appFetch = vi.fn()
vi.mock('../platform', () => ({
  appFetch: (...args: unknown[]) => appFetch(...args),
  oauthPkceMode: () => 'redirect' as const,
}))

import {
  completeOpenRouterOAuthRedirect,
  oauthRedirectUsable,
  openRouterOAuthAvailable,
  pendingOAuthRedirect,
  redirectToOpenRouterOAuth,
  startOpenRouterOAuth,
} from '../oauthPkce'

const REDIRECT_KEY = 'delusia-oauth-pkce'

/** node 環境には無いブラウザの器だけを最小限に用意する（jsdom は入れない方針） */
function installBrowserGlobals(search: string) {
  const map = new Map<string, string>()
  const g = globalThis as Record<string, unknown>
  g.sessionStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
  g.location = {
    origin: 'https://example.com',
    pathname: '/delusia/',
    hash: '',
    search,
    assign: vi.fn(),
  }
  g.history = { replaceState: vi.fn() }
  return { map, location: g.location as { assign: ReturnType<typeof vi.fn>; search: string } }
}

let env: ReturnType<typeof installBrowserGlobals>

beforeEach(() => {
  appFetch.mockReset()
  env = installBrowserGlobals('')
})

afterEach(() => {
  const g = globalThis as Record<string, unknown>
  delete g.sessionStorage
  delete g.location
  delete g.history
})

describe('リダイレクト方式の可否', () => {
  it('sessionStorage が読めれば使える', () => {
    expect(oauthRedirectUsable()).toBe(true)
    expect(openRouterOAuthAvailable()).toBe(true)
  })

  it('sessionStorage が無ければ使えない（手動貼り付けへ倒す）', () => {
    delete (globalThis as Record<string, unknown>).sessionStorage
    expect(oauthRedirectUsable()).toBe(false)
    expect(openRouterOAuthAvailable()).toBe(false)
  })

  it('リダイレクト方式の環境ではローカル受け口の関数は明示的に失敗する', async () => {
    await expect(startOpenRouterOAuth()).rejects.toThrow(/貼り付け/)
  })
})

describe('承認の開始', () => {
  it('検証子を sessionStorage へ置き、自分のページを callback_url にして移動する', async () => {
    await redirectToOpenRouterOAuth('wizard')

    const pending = JSON.parse(env.map.get(REDIRECT_KEY) as string) as {
      codeVerifier: string
      origin: string
    }
    expect(pending.origin).toBe('wizard')
    expect(pending.codeVerifier.length).toBeGreaterThan(20)

    const url = new URL(env.location.assign.mock.calls[0][0] as string)
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth')
    // クエリとハッシュを落とした「自分のページ」に戻す（?code= を二重に持たせない）
    expect(url.searchParams.get('callback_url')).toBe('https://example.com/delusia/')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    // チャレンジは検証子そのものではない（SHA-256 の base64url）
    expect(url.searchParams.get('code_challenge')).not.toBe(pending.codeVerifier)
    expect(url.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/)
  })

  it('毎回ちがう検証子を作る', async () => {
    await redirectToOpenRouterOAuth('settings')
    const first = env.map.get(REDIRECT_KEY)
    await redirectToOpenRouterOAuth('settings')
    expect(env.map.get(REDIRECT_KEY)).not.toBe(first)
  })
})

describe('戻りの判定', () => {
  it('?code= と検証子が揃ったときだけ真', () => {
    expect(pendingOAuthRedirect()).toBe(false) // どちらも無い

    env.map.set(REDIRECT_KEY, JSON.stringify({ codeVerifier: 'v', origin: 'wizard' }))
    expect(pendingOAuthRedirect()).toBe(false) // code が無い

    env = installBrowserGlobals('?code=abc')
    expect(pendingOAuthRedirect()).toBe(false) // 検証子が無い（他タブ・他人のコード）

    env.map.set(REDIRECT_KEY, JSON.stringify({ codeVerifier: 'v', origin: 'wizard' }))
    expect(pendingOAuthRedirect()).toBe(true)
  })
})

describe('戻りの消費', () => {
  beforeEach(() => {
    env = installBrowserGlobals('?code=the-code')
    env.map.set(REDIRECT_KEY, JSON.stringify({ codeVerifier: 'the-verifier', origin: 'settings' }))
  })

  it('コードを鍵へ交換し、開始した画面を返す', async () => {
    appFetch.mockResolvedValue({ ok: true, json: async () => ({ key: 'sk-or-v1-xxx' }) })

    const result = await completeOpenRouterOAuthRedirect()
    expect(result).toEqual({ apiKey: 'sk-or-v1-xxx', origin: 'settings' })

    const [url, init] = appFetch.mock.calls[0] as [string, { body: string }]
    expect(url).toBe('https://openrouter.ai/api/v1/auth/keys')
    expect(JSON.parse(init.body)).toEqual({
      code: 'the-code',
      code_verifier: 'the-verifier',
      code_challenge_method: 'S256',
    })
  })

  it('成功しても失敗しても検証子と URL の code を使い捨てる（リロードで再送しない）', async () => {
    appFetch.mockResolvedValue({ ok: false, status: 400, text: async () => 'bad code' })

    await expect(completeOpenRouterOAuthRedirect()).rejects.toThrow(/HTTP 400/)
    expect(env.map.get(REDIRECT_KEY)).toBeUndefined()
    expect(history.replaceState).toHaveBeenCalledWith(null, '', 'https://example.com/delusia/')
  })

  it('検証子が無ければ交換しに行かない', async () => {
    env.map.delete(REDIRECT_KEY)
    await expect(completeOpenRouterOAuthRedirect()).rejects.toThrow(/途中経過/)
    expect(appFetch).not.toHaveBeenCalled()
  })

  it('応答に key が無ければ失敗として扱う', async () => {
    appFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    await expect(completeOpenRouterOAuthRedirect()).rejects.toThrow(/想定と異なります/)
  })
})
