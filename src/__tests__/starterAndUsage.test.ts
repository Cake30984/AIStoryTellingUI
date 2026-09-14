// 既定コンテンツの投入とセッション累計（P3）。store を node 上で動かして確かめる。
// 永続化の口は差し替える——ここで見たいのは state の動きだけで、保存先の中身ではない。
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
const { STARTER_WORLD_ID } = await import('../starter')

beforeEach(() => {
  useStore.setState({
    characters: [],
    worlds: [],
    sessions: [],
    cassettes: [],
    activeId: null,
    usageLog: [],
    defaultModelRef: undefined,
    starterSeeded: false,
  })
})

describe('既定コンテンツの投入（seedStarterContent）', () => {
  it('世界1・登場人物3・セッション1を入れ、投入済みの印を立てる', () => {
    const id = useStore.getState().seedStarterContent()
    const st = useStore.getState()
    expect(st.worlds).toHaveLength(1)
    expect(st.characters).toHaveLength(3)
    expect(st.sessions).toHaveLength(1)
    expect(st.starterSeeded).toBe(true)
    const s = st.sessions.find((x) => x.id === id)!
    expect(s.worldId).toBe(STARTER_WORLD_ID)
    expect(s.characterIds).toContain(s.focusCharacterId)
  })

  it('2回入れても素材は増えない（固定 id へ上書き）', () => {
    useStore.getState().seedStarterContent()
    useStore.getState().seedStarterContent()
    const st = useStore.getState()
    expect(st.worlds).toHaveLength(1)
    expect(st.characters).toHaveLength(3)
    // セッションだけは毎回1本増える＝同じ物語を最初からやり直せる
    expect(st.sessions).toHaveLength(2)
    expect(new Set(st.sessions.map((s) => s.id)).size).toBe(2)
  })

  it('セッション・シーン・予定の id を投入ごとに振り直す', () => {
    const idA = useStore.getState().seedStarterContent()
    const idB = useStore.getState().seedStarterContent()
    const a = useStore.getState().sessions.find((s) => s.id === idA)!
    const b = useStore.getState().sessions.find((s) => s.id === idB)!
    expect(a.id).not.toBe(b.id)
    expect(a.scenes[0].id).not.toBe(b.scenes[0].id)
    expect(a.currentSceneId).toBe(a.scenes[0].id)
    expect(a.state.pending.map((p) => p.id)).not.toEqual(b.state.pending.map((p) => p.id))
  })

  it('既定モデルがあれば刻んで始める', () => {
    useStore.setState({ defaultModelRef: 'p1::some/model' })
    const id = useStore.getState().seedStarterContent()
    expect(useStore.getState().sessions.find((s) => s.id === id)!.model).toBe('p1::some/model')
  })
})

describe('サンプルを開く（openStarterStory）', () => {
  it('無ければ投入して開く', () => {
    const id = useStore.getState().openStarterStory()
    expect(useStore.getState().activeId).toBe(id)
    expect(useStore.getState().view).toBe('sessions')
  })

  it('未プレイのサンプルには既定モデルを刻み直す（ウィザードより先に作られているため）', () => {
    const id = useStore.getState().seedStarterContent()
    useStore.setState({ defaultModelRef: 'p2::after/wizard' })
    expect(useStore.getState().openStarterStory()).toBe(id)
    expect(useStore.getState().sessions.find((s) => s.id === id)!.model).toBe('p2::after/wizard')
  })

  it('遊び始めているサンプルのモデルは書き換えない', () => {
    const id = useStore.getState().seedStarterContent()
    useStore.getState().updateSession(id, {
      model: 'p1::chosen',
      messages: [{ id: 'm1', role: 'assistant', content: '本文', createdAt: 0 }],
    })
    useStore.setState({ defaultModelRef: 'p2::after/wizard' })
    useStore.getState().openStarterStory()
    expect(useStore.getState().sessions.find((s) => s.id === id)!.model).toBe('p1::chosen')
  })
})

describe('セッション累計（recordUsage）', () => {
  const rec = (over: Record<string, unknown> = {}) => ({
    kind: 'main' as const,
    modelRef: 'p1::m',
    promptTokens: 100,
    cachedTokens: 0,
    completionTokens: 20,
    cost: 0.001,
    ms: 10,
    ...over,
  })

  it('呼び出しごとに足し込む', () => {
    const id = useStore.getState().createSession('story')
    useStore.getState().recordUsage(rec({ sessionId: id }))
    useStore.getState().recordUsage(rec({ sessionId: id, promptTokens: 50, completionTokens: 5, cost: 0.002 }))
    expect(useStore.getState().sessions.find((s) => s.id === id)!.usage).toEqual({
      promptTokens: 150,
      completionTokens: 25,
      cost: 0.003,
    })
  })

  it('裏方の呼び出しも同じ累計に乗る（加算はここ1か所）', () => {
    const id = useStore.getState().createSession('story')
    useStore.getState().recordUsage(rec({ sessionId: id, kind: 'review' }))
    useStore.getState().recordUsage(rec({ sessionId: id, kind: 'choices' }))
    expect(useStore.getState().sessions.find((s) => s.id === id)!.usage!.promptTokens).toBe(200)
  })

  it('コストを返さない接続先では cost が増えない（トークンだけ伸びる）', () => {
    const id = useStore.getState().createSession('story')
    useStore.getState().recordUsage(rec({ sessionId: id, cost: undefined }))
    const usage = useStore.getState().sessions.find((s) => s.id === id)!.usage!
    expect(usage.cost).toBe(0)
    expect(usage.promptTokens).toBe(100)
  })

  it('sessionId の無い記録はどのセッションも触らない', () => {
    const id = useStore.getState().createSession('story')
    useStore.getState().recordUsage(rec())
    expect(useStore.getState().sessions.find((s) => s.id === id)!.usage).toBeUndefined()
    expect(useStore.getState().usageLog).toHaveLength(1)
  })
})
