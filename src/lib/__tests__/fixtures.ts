// テスト用の最小オブジェクト工房。**既定値は「空・無効」に寄せる**——各テストが必要な欄だけを
// 上書きして意図を露出できるようにするため。store の factory（newCharacter 等）は id と時刻が
// 毎回変わるので、決定的な比較（byte 一致の検証）ができるようここで固定値を組む。
import type {
  BranchNode,
  BranchTree,
  Character,
  LoreEntry,
  Message,
  Provider,
  Scene,
  Session,
  SessionState,
  World,
} from '../../types'
import type { ResolvedRefs } from '../prompts'

export function makeCharacter(over: Partial<Character> = {}): Character {
  return {
    id: 'c1',
    name: '美咲',
    persona: '',
    speechStyle: '',
    appearance: '',
    exampleDialogues: '',
    greeting: '',
    developments: [],
    avatar: { color: '#7c5cff' },
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

export function makeLore(over: Partial<LoreEntry> = {}): LoreEntry {
  return { id: 'l1', keys: [], content: '', alwaysOn: false, enabled: true, order: 0, ...over }
}

export function makeWorld(over: Partial<World> = {}): World {
  return {
    id: 'w1',
    name: '学園',
    description: '',
    entries: [],
    relationAspects: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

export function makeScene(over: Partial<Scene> = {}): Scene {
  return { id: 's1', title: '', note: '', summary: '', createdAt: 0, ...over }
}

export function makeMessage(over: Partial<Message> = {}): Message {
  return { id: 'm1', role: 'assistant', content: '', createdAt: 0, ...over }
}

export function makeSessionState(over: Partial<SessionState> = {}): SessionState {
  return {
    relations: [],
    moods: [],
    now: '',
    place: '',
    presentIds: [],
    situation: '',
    pending: [],
    recentDone: [],
    ...over,
  }
}

export function makeSession(over: Partial<Session> = {}): Session {
  return {
    id: 'sess1',
    title: 'テスト',
    mode: 'story',
    model: 'p1::m1',
    reviewModel: '',
    choicesModel: '',
    characterIds: [],
    worldId: null,
    focusCharacterId: '',
    authorNote: '',
    story: { premise: '', genre: '', opening: '', openingTitle: '' },
    scenes: [],
    currentSceneId: null,
    narrativeStyle: 'novel',
    state: makeSessionState(),
    overlay: { lore: [], characterDevelopments: [] },
    messages: [],
    temperature: 0.8,
    maxTokens: 1200,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

export function makeRefs(over: Partial<ResolvedRefs> = {}): ResolvedRefs {
  return {
    characters: [],
    priorSummaries: [],
    sceneNote: '',
    currentSceneId: null,
    timelineInfo: '',
    foreground: '',
    stateInfo: '',
    ...over,
  }
}

export function makeProvider(over: Partial<Provider> = {}): Provider {
  return {
    id: 'p1',
    label: 'OpenRouter',
    kind: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: 'k',
    ...over,
  }
}

export function makeNode(over: Partial<BranchNode> & { id: string }): BranchNode {
  return {
    parentId: null,
    kind: 'action',
    label: over.id,
    createdAt: 0,
    imageIds: [],
    bytes: 0,
    ...over,
  }
}

/** `id:parentId` 形式の簡易記法から木を組む（親は先に書く）。`currentId` は既定で最後のノード */
export function makeTree(spec: (Partial<BranchNode> & { id: string })[], currentId?: string): BranchTree {
  const nodes = spec.map(makeNode)
  return { currentId: currentId ?? nodes[nodes.length - 1]?.id ?? null, nodes }
}
