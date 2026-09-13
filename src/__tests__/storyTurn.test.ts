// 物語を進める操作の競合まわり（P2a）。store 本体を node 上で動かして確かめる。
// LLM 呼び出しと永続化は差し替える——ここで見たいのは「何回・どの順で走るか」だけなので、
// ネットワークと IndexedDB/localStorage を本物にする理由がない。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatParams, ChatResult } from '../lib/openrouter'

/** streamChat の差し替え本体。テストごとに入れ替える */
let streamImpl: (params: ChatParams, onDelta: (chunk: string) => void) => Promise<ChatResult>
/** 実際に渡された signal（ローカル controller から取れているかの確認用） */
const seenSignals: (AbortSignal | undefined)[] = []

vi.mock('../lib/openrouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/openrouter')>()
  return {
    ...actual,
    streamChat: (params: ChatParams, onDelta: (chunk: string) => void) => {
      seenSignals.push(params.signal)
      return streamImpl(params, onDelta)
    },
  }
})

vi.mock('../lib/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/platform')>()
  const state = new Map<string, string>()
  const blobs = new Map<string, Uint8Array>()
  return {
    ...actual,
    stateStorage: {
      getItem: (k: string) => state.get(k) ?? null,
      setItem: (k: string, v: string) => void state.set(k, v),
      removeItem: (k: string) => void state.delete(k),
    },
    checkpointStore: {
      put: async (s: string, n: string, d: Uint8Array) => void blobs.set(`${s}/${n}`, d),
      get: async (s: string, n: string) => blobs.get(`${s}/${n}`),
      delete: async (s: string, n: string) => void blobs.delete(`${s}/${n}`),
      deleteSession: async () => {},
      listNodeIds: async () => [],
    },
  }
})

const { useStore } = await import('../store')

const reply = (text: string, finishReason: string | null = 'stop') =>
  async (_params: ChatParams, onDelta: (chunk: string) => void): Promise<ChatResult> => {
    onDelta(text)
    return { text, finishReason }
  }

function newSessionWithProvider(): string {
  useStore.setState({
    providers: [
      { id: 'p1', label: 'テスト接続先', kind: 'openrouter', baseUrl: 'https://example.test/v1', apiKey: 'k' },
    ],
    sessions: [],
    branchTrees: {},
    activeId: null,
    isStreaming: false,
    error: null,
  })
  return useStore.getState().createSession('story')
}

const messagesOf = (id: string) => useStore.getState().sessions.find((s) => s.id === id)!.messages

beforeEach(() => {
  seenSignals.length = 0
  streamImpl = reply('本文')
})

afterEach(() => {
  useStore.getState().stop()
})

describe('二重送信ガード', () => {
  it('send を続けて2回呼んでも user メッセージは1つしか積まれない', async () => {
    const id = newSessionWithProvider()
    const first = useStore.getState().send('1回目')
    const second = useStore.getState().send('2回目')
    await Promise.all([first, second])
    const users = messagesOf(id).filter((m) => m.role === 'user')
    expect(users.map((m) => m.content)).toEqual(['1回目'])
  })

  it('続けて2回呼んでも生成は1回しか走らない', async () => {
    newSessionWithProvider()
    await Promise.all([useStore.getState().continueStory(), useStore.getState().continueStory()])
    expect(seenSignals).toHaveLength(1)
  })

  it('生成中の send は何も積まない', async () => {
    const id = newSessionWithProvider()
    let release: () => void = () => {}
    streamImpl = async (_p, onDelta) => {
      await new Promise<void>((r) => (release = r))
      onDelta('本文')
      return { text: '本文', finishReason: 'stop' }
    }
    const running = useStore.getState().send('1回目')
    await vi.waitFor(() => expect(useStore.getState().isStreaming).toBe(true))
    await useStore.getState().send('2回目')
    expect(messagesOf(id).filter((m) => m.role === 'user')).toHaveLength(1)
    release()
    await running
  })

  it('1回目が終われば2回目は通る', async () => {
    const id = newSessionWithProvider()
    await useStore.getState().send('1回目')
    await useStore.getState().send('2回目')
    expect(messagesOf(id).filter((m) => m.role === 'user').map((m) => m.content)).toEqual([
      '1回目',
      '2回目',
    ])
  })
})

describe('生成の中断（AbortController）', () => {
  it('毎回の呼び出しに生きた signal が渡る', async () => {
    newSessionWithProvider()
    await useStore.getState().send('本文')
    expect(seenSignals).toHaveLength(1)
    expect(seenSignals[0]).toBeInstanceOf(AbortSignal)
    expect(seenSignals[0]!.aborted).toBe(false)
  })

  it('リトライの最中に共有参照が片付いても落ちない（旧実装は null.signal で落ちた）', async () => {
    newSessionWithProvider()
    let calls = 0
    streamImpl = async (_p, onDelta) => {
      calls++
      if (calls === 1) {
        // 「いま止められる相手」の参照が外から消える状況（停止ボタン・並行生成の終了）を再現する。
        // 旧実装はリトライで共有変数から signal を読み直していたため、ここで TypeError になった
        useStore.getState().stop()
        throw new Error('一時エラー')
      }
      onDelta('2回目の本文')
      return { text: '2回目の本文', finishReason: 'stop' }
    }
    await useStore.getState().send('本文')
    expect(calls).toBe(2)
    expect(seenSignals).toHaveLength(2)
    // 2回目も signal は渡る（停止済みなので本物の streamChat なら即 AbortError で畳まれる）
    expect(seenSignals[1]).toBeInstanceOf(AbortSignal)
    expect(useStore.getState().isStreaming).toBe(false)
  }, 10000)

  it('stop() で signal が abort され isStreaming が降りる', async () => {
    newSessionWithProvider()
    streamImpl = (params) =>
      new Promise((_resolve, reject) => {
        params.signal?.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    const running = useStore.getState().send('本文')
    await vi.waitFor(() => expect(useStore.getState().isStreaming).toBe(true))
    useStore.getState().stop()
    await running
    expect(seenSignals[0]!.aborted).toBe(true)
    expect(useStore.getState().isStreaming).toBe(false)
  })
})
