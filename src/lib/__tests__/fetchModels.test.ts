import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchModels } from '../openrouter'
import { makeProvider } from './fixtures'

// `appFetch` を差し替え、送ったリクエストの中身を検査する
const calls: { url: string; headers: Record<string, string> | undefined }[] = []
vi.mock('../platform', () => ({
  appFetch: async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, headers: init?.headers })
    return new Response(JSON.stringify(mockBody), { status: 200 })
  },
}))
let mockBody: unknown = { data: [] }

afterEach(() => {
  calls.length = 0
})

describe('fetchModels', () => {
  it('Gemini の OpenAI 互換 /models（name 無し）でも name を id で埋める（検索で落ちない）', async () => {
    mockBody = { data: [{ id: 'models/gemini-3.5-flash-lite' }, { id: 'models/gemini-3.6-flash' }] }
    const list = await fetchModels(
      makeProvider({ baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: 'k' }),
    )
    expect(list.map((m) => m.name)).toEqual(['models/gemini-3.5-flash-lite', 'models/gemini-3.6-flash'])
    expect(calls[0].headers).toEqual({ Authorization: 'Bearer k' })
  })

  it('Anthropic 直叩きはネイティブ /models の形（x-api-key・display_name・ページ上限）で取る', async () => {
    mockBody = { data: [{ id: 'claude-opus-5', display_name: 'Claude Opus 5' }] }
    const list = await fetchModels(makeProvider({ baseUrl: 'https://api.anthropic.com/v1', apiKey: 'k' }))
    expect(list[0].name).toBe('Claude Opus 5')
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/models?limit=1000')
    expect(calls[0].headers).toMatchObject({
      'x-api-key': 'k',
      'anthropic-dangerous-direct-browser-access': 'true',
    })
  })

  it('OpenRouter の name はそのまま使う', async () => {
    mockBody = { data: [{ id: 'b', name: 'Beta' }, { id: 'a', name: 'Alpha' }] }
    const list = await fetchModels(makeProvider({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k' }))
    expect(list.map((m) => m.name)).toEqual(['Alpha', 'Beta'])
  })
})
