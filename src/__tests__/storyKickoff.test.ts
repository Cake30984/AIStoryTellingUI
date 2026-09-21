// 一行から始める（P4）の store 側。LLM 呼び出しと永続化は差し替える——
// ここで見たいのは「起案結果が素材とセッションへどう落ちるか」だけ。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatParams, ChatResult } from '../lib/openrouter'

/** streamChat の差し替え本体。テストごとに入れ替える */
let streamImpl: (params: ChatParams) => Promise<ChatResult>
/** 実際に渡されたパラメータ（スキーマ・モデルの確認用） */
const seenParams: ChatParams[] = []

vi.mock('../lib/openrouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/openrouter')>()
  return {
    ...actual,
    streamChat: (params: ChatParams) => {
      seenParams.push(params)
      return streamImpl(params)
    },
  }
})

vi.mock('../lib/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/platform')>()
  const state = new Map<string, string>()
  return {
    ...actual,
    stateStorage: {
      getItem: (k: string) => state.get(k) ?? null,
      setItem: (k: string, v: string) => void state.set(k, v),
      removeItem: (k: string) => void state.delete(k),
    },
    checkpointStore: {
      put: async () => {},
      get: async () => undefined,
      delete: async () => {},
      deleteSession: async () => {},
      listNodeIds: async () => [],
    },
    sessionStore: {
      list: async () => [],
      getAll: async () => [],
      get: async () => undefined,
      put: async () => {},
      delete: async () => {},
    },
    scheduleSessionWrite: () => {},
    cancelSessionWrite: () => {},
    flushSessionWrites: async () => {},
    deleteSessionRecord: async () => {},
  }
})

const { useStore } = await import('../store')

const KICKOFF = {
  world: {
    name: '灯台守の冬',
    description: '北の岬にある小さな港町。',
    calendarFormat: '◯月◯日／朝・昼・夜',
    entries: [{ keys: ['灯台'], content: '灯台は町で最後の一基。', alwaysOn: true }],
    relationAspects: [{ name: '信頼', guidance: 'どこを信じているか。' }],
    startPreset: {
      genre: '現代・港町／静かな再生',
      premise: '灯台が来年で消える町に、一人の若者が戻ってくる。',
      opening: '　港は凪いでいた。\n「……ただいま」',
      openingTitle: '十二月、最後の灯',
      openingSceneNote: '十二月三日の夕方。港の突堤。',
      initialDirective: '再会の理由をまだ明かさない。',
      startNow: '12月3日 夕方',
    },
  },
  characters: [
    { name: '灯野 みなと', persona: '二十歳。', speechStyle: '一人称は「俺」。', appearance: '痩せ型。', exampleDialogues: ['「別に」'], greeting: '「灯野みなと」', tags: ['帰郷'] },
    { name: '磯貝ふゆ', persona: '灯台守の孫。', speechStyle: '言い切る。', appearance: '背が低い。', exampleDialogues: ['「遅い」'], greeting: '「磯貝ふゆ」', tags: ['灯台守'] },
  ],
}

const respond = (text: string, usage?: ChatResult['usage']) => async (): Promise<ChatResult> => ({
  text,
  finishReason: 'stop',
  usage,
})

beforeEach(() => {
  seenParams.length = 0
  streamImpl = respond(JSON.stringify(KICKOFF))
  useStore.setState({
    providers: [
      { id: 'p1', label: 'テスト接続先', kind: 'openrouter', baseUrl: 'https://example.test/v1', apiKey: 'k' },
    ],
    characters: [],
    worlds: [],
    sessions: [],
    activeId: null,
    usageLog: [],
    defaultModelRef: 'p1::test/model',
  })
})

describe('kickoffStory', () => {
  it('素材をライブラリへ入れ、顔ぶれと開始テンプレートを反映したセッションを開く', async () => {
    const res = await useStore.getState().kickoffStory('灯台が消える町に若者が帰る')
    const st = useStore.getState()
    expect(res.error).toBeUndefined()
    expect(st.worlds).toHaveLength(1)
    expect(st.characters).toHaveLength(2)
    expect(st.sessions).toHaveLength(1)
    const s = st.sessions[0]
    expect(res.sessionId).toBe(s.id)
    expect(st.activeId).toBe(s.id)
    expect(s.worldId).toBe(res.worldId)
    expect(s.characterIds).toEqual(res.characterIds)
    // 先頭が中心人物（未選択だと開始できない）
    expect(s.focusCharacterId).toBe(res.characterIds[0])
    expect(s.title).toBe('灯台守の冬')
    expect(s.story.genre).toBe('現代・港町／静かな再生')
    expect(s.story.openingTitle).toBe('十二月、最後の灯')
    expect(s.story.initialDirective).toBe('再会の理由をまだ明かさない。')
    // 名前の空白は落ちる（P3 の罠）。導入文はそのまま
    expect(st.characters.find((c) => c.id === s.focusCharacterId)!.name).toBe('灯野みなと')
    expect(s.story.opening).toBe('港は凪いでいた。\n「……ただいま」')
    expect(s.state.now).toBe('12月3日 夕方')
    // 生成はまだ始めない（開いた設定画面で人が直してから始める）
    expect(s.messages).toEqual([])
  })

  it('起案した素材にタグ「起案」が付く', async () => {
    await useStore.getState().kickoffStory('一行')
    expect(useStore.getState().characters.every((c) => c.tags.includes('起案'))).toBe(true)
  })

  it('既定モデルで1回だけ呼び、JSON スキーマを渡す', async () => {
    await useStore.getState().kickoffStory('一行')
    expect(seenParams).toHaveLength(1)
    expect(seenParams[0].model).toBe('test/model')
    expect(seenParams[0].jsonSchema?.name).toBe('story_kickoff')
  })

  it('起案したセッションに使用量が乗る（kind は kickoff）', async () => {
    streamImpl = respond(JSON.stringify(KICKOFF), {
      promptTokens: 300,
      completionTokens: 900,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      cost: 0.004,
    })
    const res = await useStore.getState().kickoffStory('一行')
    const st = useStore.getState()
    expect(st.usageLog.map((u) => u.kind)).toEqual(['kickoff'])
    expect(st.usageLog[0].sessionId).toBe(res.sessionId)
    expect(st.sessions[0].usage).toEqual({ promptTokens: 300, completionTokens: 900, cost: 0.004 })
  })

  it('接続先が使えないときは空のセッションだけ作って理由を返す', async () => {
    useStore.setState({ providers: [{ id: 'p1', label: 'テスト接続先', kind: 'openrouter', baseUrl: 'https://example.test/v1', apiKey: '' }] })
    const res = await useStore.getState().kickoffStory('一行')
    const st = useStore.getState()
    expect(seenParams).toHaveLength(0)
    expect(res.error).toBeTruthy()
    expect(res.worldId).toBeNull()
    expect(st.worlds).toHaveLength(0)
    expect(st.characters).toHaveLength(0)
    // 行き止まりにしない＝空のセッションは開ける
    expect(st.sessions).toHaveLength(1)
    expect(res.sessionId).toBe(st.sessions[0].id)
  })

  it('読み取れない応答・生成の失敗でも空のセッションを開ける', async () => {
    streamImpl = respond('起案できませんでした、と言い訳だけ返ってきた場合')
    const res = await useStore.getState().kickoffStory('一行')
    expect(res.error).toBeTruthy()
    expect(useStore.getState().sessions).toHaveLength(1)
    expect(useStore.getState().worlds).toHaveLength(0)

    streamImpl = async () => {
      throw new Error('502 Bad Gateway')
    }
    const res2 = await useStore.getState().kickoffStory('一行')
    expect(res2.error).toContain('502')
    expect(useStore.getState().sessions).toHaveLength(2)
  })

  it('中止したときは何も作らない', async () => {
    streamImpl = async () => {
      const e = new Error('aborted')
      e.name = 'AbortError'
      throw e
    }
    const res = await useStore.getState().kickoffStory('一行', new AbortController().signal)
    expect(res.sessionId).toBeNull()
    expect(useStore.getState().sessions).toHaveLength(0)
    expect(useStore.getState().worlds).toHaveLength(0)
  })

  it('応答が返った後に中止されていれば素材を作らない', async () => {
    const controller = new AbortController()
    streamImpl = async () => {
      controller.abort()
      return { text: JSON.stringify(KICKOFF), finishReason: 'stop' }
    }
    const res = await useStore.getState().kickoffStory('一行', controller.signal)
    expect(res.sessionId).toBeNull()
    expect(useStore.getState().worlds).toHaveLength(0)
    expect(useStore.getState().sessions).toHaveLength(0)
  })
})
