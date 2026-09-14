// 永続化のセッション分割（計画 P2c）。store を node 上で動かして、
// **入れ物（state.json / localStorage）と本体（SessionStore）の出し入れ**だけを見る。
//
// 保存先は素のメモリに差し替える（node に IndexedDB は無い）。デバウンスも挟まない——
// ここで確かめたいのは「いつ・何を書くか」であって、待ち時間ではない。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionRecord } from '../lib/platform'
import { PERSIST_KEY } from '../lib/platform'
import { APP_STATE_VERSION, SAVE_DATA_VERSION } from '../lib/schema'

/** 入れ物（state.json / localStorage 相当） */
const container = new Map<string, string>()
/** 本体（SessionStore 相当） */
const records = new Map<string, SessionRecord>()
/** 退避した原文 */
const backups: string[] = []
/** 書き込み・削除の記録（回数を見る） */
const puts: string[] = []
const deletes: string[] = []
/** 読めずに飛ばした件数（platform が数えるぶんの差し替え） */
let unreadable = 0

vi.mock('../lib/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/platform')>()
  const write = (record: SessionRecord) => {
    records.set(record.session.id, record)
    puts.push(record.session.id)
  }
  return {
    ...actual,
    stateStorage: {
      getItem: (k: string) => container.get(k) ?? null,
      setItem: (k: string, v: string) => void container.set(k, v),
      removeItem: (k: string) => void container.delete(k),
    },
    checkpointStore: {
      put: async () => {},
      get: async () => undefined,
      delete: async () => {},
      deleteSession: async () => {},
      listNodeIds: async () => [],
    },
    sessionStore: {
      list: async () => [...records.values()].map((r) => ({ id: r.session.id, v: r.v, title: '', updatedAt: 0 })),
      getAll: async () => [...records.values()],
      get: async (id: string) => records.get(id),
      put: async (record: SessionRecord) => write(record),
      delete: async (id: string) => {
        records.delete(id)
        deletes.push(id)
      },
    },
    scheduleSessionWrite: write,
    cancelSessionWrite: () => {},
    flushSessionWrites: async () => {},
    deleteSessionRecord: async (id: string) => {
      records.delete(id)
      deletes.push(id)
    },
    backupStateSnapshot: async (raw: string) => void backups.push(raw),
    unreadableSessionCount: () => unreadable,
  }
})

const { useStore } = await import('../store')

/** セッション1件ぶんの最小形（現行スキーマ。移行の対象になる欄だけ持たせる） */
function sessionAt(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    mode: 'story',
    title: `物語 ${id}`,
    createdAt: 1,
    updatedAt: 1,
    model: '',
    reviewModel: '',
    choicesModel: '',
    temperature: 0.9,
    maxTokens: 1200,
    worldId: 'w1',
    focusCharacterId: 'c1',
    characterIds: ['c1'],
    introBindings: [],
    story: { premise: '', genre: '', opening: '', openingTitle: '', introTags: [] },
    scenes: [{ id: 's1', note: '', foreground: '', ...(extra.sceneExtra ?? {}) }],
    currentSceneId: 's1',
    messages: (extra.messages as unknown[]) ?? [],
    state: { relations: [], moods: [], now: '', place: '', presentIds: [], situation: '', pending: [], recentDone: [] },
    overlay: { lore: [], characterDevelopments: [] },
    usage: [],
  }
}

/** 入れ物に保存されている軽い状態 */
function storedContainer(): any {
  const raw = container.get(PERSIST_KEY)
  return raw === null || raw === undefined ? null : JSON.parse(raw)
}

function reset(): void {
  container.clear()
  records.clear()
  backups.length = 0
  puts.length = 0
  deletes.length = 0
  unreadable = 0
  useStore.setState({ sessions: [], cassettes: [], characters: [], worlds: [], activeId: null, schemaError: null, infoNotice: null })
}

beforeEach(() => reset())

describe('一度きりの移行（入れ物 → SessionStore）', () => {
  it('旧形式の入れ物にある 20 本が本体へ移り、入れ物からは消える', async () => {
    const legacy = {
      state: {
        schemaVersions: { save: SAVE_DATA_VERSION, cassette: 5 },
        sessions: Array.from({ length: 20 }, (_, i) => sessionAt(`s${i}`)),
        characters: [],
        worlds: [],
        cassettes: [],
        ui: {},
      },
      version: 2, // セッションを外す前の入れ物の版番
    }
    container.set(PERSIST_KEY, JSON.stringify(legacy))

    await useStore.persist.rehydrate()

    expect(records.size).toBe(20)
    expect(useStore.getState().sessions).toHaveLength(20)
    // 入れ物には本体を書き戻さない
    expect('sessions' in storedContainer().state).toBe(false)
    expect(storedContainer().version).toBe(APP_STATE_VERSION)
    // 上書きの前に原文を退避してある
    expect(backups).toHaveLength(1)
    expect(JSON.parse(backups[0]).state.sessions).toHaveLength(20)
  })

  it('移行の前後で exportBundle の中身が一致する', async () => {
    const sessions = Array.from({ length: 3 }, (_, i) => sessionAt(`s${i}`))
    container.set(PERSIST_KEY, JSON.stringify({ state: { schemaVersions: { save: SAVE_DATA_VERSION, cassette: 5 }, sessions }, version: 2 }))
    await useStore.persist.rehydrate()
    const before = await useStore.getState().exportBundle()

    // 移行後の姿（入れ物は軽い状態・本体は SessionStore）から読み直す
    backups.length = 0
    await useStore.persist.rehydrate()
    const after = await useStore.getState().exportBundle()

    expect(backups).toHaveLength(0) // 2回目は移行ではない
    expect({ ...after, exportedAt: 0 }).toEqual({ ...before, exportedAt: 0 })
  })

  it('移行で刻む版番は「そのとき保存されていた版番」＝中身と食い違わせない', async () => {
    const old = sessionAt('s0', { sceneExtra: { ambientPins: [{ id: 'p1' }] } })
    container.set(PERSIST_KEY, JSON.stringify({ state: { schemaVersions: { save: 4, cassette: 4 }, sessions: [old] }, version: 2 }))

    await useStore.persist.rehydrate()

    // メモリ上は現行版（ambientPins が落ちている）
    expect('ambientPins' in (useStore.getState().sessions[0].scenes[0] as any)).toBe(false)
    // 引っ越し直後に現行版で書き直すので、保存先も現行版で揃う
    expect(records.get('s0')?.v).toBe(SAVE_DATA_VERSION)
    expect('ambientPins' in (records.get('s0')!.session as any).scenes[0]).toBe(false)
  })
})

describe('読み出し（SessionStore → メモリ）', () => {
  it('旧版のレコードは1件ずつ現行版まで上がる', async () => {
    records.set('s0', { v: 4, session: sessionAt('s0', { sceneExtra: { ambientPins: [{ id: 'p1' }] } }) as any })
    container.set(PERSIST_KEY, JSON.stringify({ state: { schemaVersions: { save: SAVE_DATA_VERSION, cassette: 5 } }, version: APP_STATE_VERSION }))

    await useStore.persist.rehydrate()

    expect(useStore.getState().sessions).toHaveLength(1)
    expect('ambientPins' in (useStore.getState().sessions[0].scenes[0] as any)).toBe(false)
    // 読んだだけでは書き戻さない
    expect(puts).toHaveLength(0)
  })

  it('中断された pending メッセージは読み込み時に truncated へ倒れる（正規化を変えていない）', async () => {
    const messages = [
      { id: 'm1', role: 'assistant', content: '途中まで', createdAt: 1, pending: true },
      { id: 'm2', role: 'assistant', content: '', createdAt: 2, pending: true },
    ]
    records.set('s0', { v: SAVE_DATA_VERSION, session: sessionAt('s0', { messages }) as any })
    container.set(PERSIST_KEY, JSON.stringify({ state: { schemaVersions: { save: SAVE_DATA_VERSION, cassette: 5 } }, version: APP_STATE_VERSION }))

    await useStore.persist.rehydrate()

    const msgs = useStore.getState().sessions[0].messages
    expect(msgs).toHaveLength(1) // 空の pending は消える
    expect(msgs[0].pending).toBe(false)
    expect(msgs[0].truncated).toBe(true)
  })

  it('読めなかった件数は封印せず案内に出す', async () => {
    unreadable = 2
    records.set('s0', { v: SAVE_DATA_VERSION, session: sessionAt('s0') as any })
    container.set(PERSIST_KEY, JSON.stringify({ state: { schemaVersions: { save: SAVE_DATA_VERSION, cassette: 5 } }, version: APP_STATE_VERSION }))

    await useStore.persist.rehydrate()

    expect(useStore.getState().schemaError).toBeNull()
    expect(useStore.getState().sessions).toHaveLength(1)
    expect(useStore.getState().infoNotice).toContain('2 件')
  })
})

describe('書き出し（メモリ → SessionStore）', () => {
  beforeEach(async () => {
    records.set('s0', { v: SAVE_DATA_VERSION, session: sessionAt('s0') as any })
    container.set(PERSIST_KEY, JSON.stringify({ state: { schemaVersions: { save: SAVE_DATA_VERSION, cassette: 5 } }, version: APP_STATE_VERSION }))
    await useStore.persist.rehydrate()
    puts.length = 0
    deletes.length = 0
  })

  it('変わったセッションだけを書く', async () => {
    useStore.getState().createSession('story')
    const created = useStore.getState().sessions[0].id
    expect(puts).toEqual([created]) // 触っていない s0 は書き直さない
  })

  it('生成中（pending あり）は書かず、完了時に1回だけ書く', () => {
    const pending = { id: 'm1', role: 'assistant' as const, content: '', createdAt: 1, pending: true }
    useStore.getState().updateSession('s0', { messages: [pending] as any })
    useStore.getState().updateSession('s0', { messages: [{ ...pending, content: 'あ' }] as any })
    useStore.getState().updateSession('s0', { messages: [{ ...pending, content: 'あい' }] as any })
    expect(puts).toEqual([])

    useStore.getState().updateSession('s0', { messages: [{ ...pending, content: 'あい', pending: false }] as any })
    expect(puts).toEqual(['s0'])
  })

  it('消したセッションは保存先からも消える', () => {
    useStore.getState().deleteSession('s0')
    expect(deletes).toEqual(['s0'])
    expect(records.has('s0')).toBe(false)
  })

  it('書き出すレコードには現行のセーブ版番を刻む', () => {
    useStore.getState().updateSession('s0', { title: '書き換え' })
    expect(records.get('s0')?.v).toBe(SAVE_DATA_VERSION)
    expect((records.get('s0')!.session as any).title).toBe('書き換え')
  })
})

describe('読めなかったとき', () => {
  it('未来の版番のレコードが1件でもあれば封印して案内へ回す', async () => {
    records.set('s0', { v: 99, session: sessionAt('s0') as any })
    container.set(PERSIST_KEY, JSON.stringify({ state: { schemaVersions: { save: SAVE_DATA_VERSION, cassette: 5 } }, version: APP_STATE_VERSION }))

    await useStore.persist.rehydrate()

    expect(useStore.getState().schemaError).toEqual({ scope: 'save', found: 99, supported: SAVE_DATA_VERSION })
    expect(useStore.getState().sessions).toHaveLength(0)
  })
})
