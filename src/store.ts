import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  Character,
  Development,
  ExportBundle,
  LoreEntry,
  NextSceneSuggestion,
  OpenRouterModel,
  Persona,
  Provider,
  Scene,
  SceneReview,
  SceneType,
  Session,
  SessionMode,
  World,
} from './types'
import { fetchModels, streamChat } from './lib/openrouter'
import {
  buildMessages,
  choicesSystem,
  CONTINUE_PROMPT,
  reviewSystem,
  SCENE_START_PROMPT,
  type ResolvedRefs,
} from './lib/prompts'
import {
  advanceTimeline,
  defaultTimeline,
  isNearEnd,
  timeLabelOf,
  timelinePromptInfo,
} from './lib/timeline'
import { extractJson } from './lib/json'
import { defaultOpenRouterProvider, parseModelRef } from './lib/providers'

export const DEFAULT_MODEL = 'openrouter/auto'

export type View = 'sessions' | 'characters' | 'worlds' | 'personas' | 'sceneTypes'

export function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

const COLORS = ['#7c5cff', '#ef6f6c', '#4cc9a4', '#f0a76b', '#5b8def', '#d77ad8', '#e0b341']
function pickColor(): string {
  return COLORS[Math.floor(Math.random() * COLORS.length)]
}

/** 関係値 0〜100 を段階ラベルに変換（プロンプト注入用） */
export function valueLabel(v: number): string {
  if (v >= 80) return '非常に高'
  if (v >= 60) return '高'
  if (v >= 40) return '中'
  if (v >= 20) return '低'
  return '非常に低'
}

/** 関係値を 0〜100 に丸める */
function clampValue(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)))
}

export function newCharacter(): Character {
  const now = Date.now()
  return {
    id: uid(),
    name: '',
    persona: '',
    speechStyle: '',
    appearance: '',
    exampleDialogues: '',
    greeting: '',
    developments: [],
    avatar: { emoji: '✦', color: pickColor() },
    tags: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function newPersona(): Persona {
  const now = Date.now()
  return {
    id: uid(),
    name: '',
    description: '',
    avatar: { emoji: '🙂', color: '#5b8def' },
    createdAt: now,
    updatedAt: now,
  }
}

export function newLoreEntry(order: number): LoreEntry {
  return { id: uid(), keys: [], content: '', alwaysOn: false, enabled: true, order }
}

export function newDevelopment(text: string): Development {
  return { id: uid(), text, enabled: true }
}

/**
 * 本編生成に使うモデル参照。
 * chat 群像で話者が確定している場合、そのキャラ専用モデルを優先する。
 */
export function mainModelOf(s: Session, character?: Character): string {
  return character?.model?.trim() || s.model || DEFAULT_MODEL
}

/** レビュー（シーン終了解析）用モデル参照。未指定なら本編モデルを使う */
export function reviewModelOf(s: Session): string {
  return s.reviewModel?.trim() || s.model || DEFAULT_MODEL
}

/** 選択肢生成用モデル参照。未指定なら本編モデルを使う */
export function choicesModelOf(s: Session): string {
  return s.choicesModel?.trim() || s.model || DEFAULT_MODEL
}

export function newWorld(): World {
  const now = Date.now()
  return {
    id: uid(),
    name: '',
    description: '',
    entries: [],
    scheduledEvents: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function newSceneType(): SceneType {
  return { id: uid(), name: '', guidance: '', weight: 1, minGap: 0, color: pickColor() }
}

/** 既定のシーンタイプ（初回シード用） */
export function defaultSceneTypes(): SceneType[] {
  const base: Omit<SceneType, 'id'>[] = [
    { name: '日常の幸福', guidance: '登場人物たちの和やかで幸福な日常の一場面。関係性の温かさを描く。', weight: 3, minGap: 0, color: '#4cc9a4', builtin: true },
    { name: '穏やかな時間', guidance: '静かで落ち着いた内省的な時間。情景と心情を丁寧に描く。', weight: 2, minGap: 0, color: '#5b8def', builtin: true },
    { name: 'バトルへの伏線', guidance: '今後の戦い・対立の予兆や違和感をさりげなく忍ばせる。', weight: 1, minGap: 2, color: '#f0a76b', builtin: true },
    { name: 'バトル', guidance: '緊迫した戦闘・対決の場面。手に汗握る攻防と決着を描く。', weight: 1, minGap: 3, color: '#ef6f6c', builtin: true },
    { name: '過去回想', guidance: '登場人物の過去を掘り下げる回想。背景や動機を明かす。', weight: 1, minGap: 3, color: '#d77ad8', builtin: true },
    { name: '特別イベント', guidance: '季節行事や特別な催し。非日常の高揚を描く。', weight: 1, minGap: 4, color: '#e0b341', builtin: true },
  ]
  return base.map((b) => ({ ...b, id: uid() }))
}

export function newScene(
  title: string,
  activeCharacterIds: string[] = [],
  timeLabel?: string,
): Scene {
  return {
    id: uid(),
    title,
    activeCharacterIds: [...activeCharacterIds],
    note: '',
    summary: '',
    timeLabel,
    createdAt: Date.now(),
  }
}

function newSession(mode: SessionMode): Session {
  const now = Date.now()
  const scene = newScene('シーン 1')
  return {
    id: uid(),
    title: mode === 'roleplay' ? '新しいロールプレイ' : '新しい物語',
    mode,
    model: DEFAULT_MODEL,
    reviewModel: '',
    choicesModel: '',
    characterIds: [],
    worldId: null,
    personaId: null,
    authorNote: '',
    story: { premise: '', genre: '', protagonist: '' },
    scenes: [scene],
    currentSceneId: scene.id,
    timeline: defaultTimeline(),
    choiceMode: 'off',
    narrativeStyle: mode === 'story' ? 'novel' : 'chat',
    director: { enabled: false, typeIds: [] },
    usedEventIds: [],
    state: { relationships: [], moods: [] },
    messages: [],
    temperature: 0.9,
    maxTokens: 1024,
    createdAt: now,
    updatedAt: now,
  }
}

/** セッションの現在シーンを返す（無ければ最後のシーン） */
export function currentScene(s: Session): Scene | undefined {
  return s.scenes.find((sc) => sc.id === s.currentSceneId) ?? s.scenes[s.scenes.length - 1]
}

interface AppState {
  // 永続化
  providers: Provider[]
  favoriteModels: string[]
  characters: Character[]
  worlds: World[]
  personas: Persona[]
  sceneTypes: SceneType[]
  sessions: Session[]
  activeId: string | null

  // ランタイム
  view: View
  modelsByProvider: Record<string, OpenRouterModel[]>
  modelsLoadingFor: string | null
  isStreaming: boolean
  isGeneratingChoices: boolean
  isReviewing: boolean
  sceneReview: SceneReview | null
  error: string | null

  // 共通
  setView: (v: View) => void
  clearError: () => void

  // 接続先（プロバイダ）
  upsertProvider: (p: Provider) => void
  deleteProvider: (id: string) => void
  loadModels: (providerId: string) => Promise<void>
  toggleFavorite: (modelId: string) => void

  // ライブラリ CRUD
  upsertCharacter: (c: Character) => void
  deleteCharacter: (id: string) => void
  bulkSetCharacterModel: (characterIds: string[], modelRef: string) => void
  upsertWorld: (w: World) => void
  deleteWorld: (id: string) => void
  upsertSceneType: (t: SceneType) => void
  deleteSceneType: (id: string) => void
  upsertPersona: (p: Persona) => void
  deletePersona: (id: string) => void

  // セッション
  createSession: (mode: SessionMode) => void
  deleteSession: (id: string) => void
  setActive: (id: string) => void
  updateSession: (id: string, patch: Partial<Session>) => void
  resolveRefs: (session: Session) => ResolvedRefs

  // シーン
  updateScene: (sceneId: string, patch: Partial<Scene>) => void
  prepareSceneReview: (sceneId?: string) => Promise<void>
  confirmSceneReview: (opts: {
    summary: string
    suggestion?: NextSceneSuggestion
    characterGrowthIdx: number[]
    worldGrowthIdx: number[]
    relationshipDeltaIdx: number[]
  }) => void
  setReviewNextType: (typeId: string | null) => void
  rerollReviewType: () => void
  cancelReview: () => void

  // 生成
  startSession: () => void
  send: (text: string, speakerId?: string) => Promise<void>
  continueStory: (speakerId?: string) => Promise<void>
  regenerate: (speakerId?: string) => Promise<void>
  startStory: () => Promise<void>
  beginScene: () => Promise<void>
  continueLast: () => Promise<void>
  editMessage: (messageId: string, content: string) => void
  deleteMessage: (messageId: string) => void
  regenerateFrom: (messageId: string) => Promise<void>
  stop: () => void

  // データ入出力
  exportBundle: () => ExportBundle
  importBundle: (bundle: ExportBundle) => { added: number }
}

let controller: AbortController | null = null

/** キャラ→主人公の関係値・気分をプロンプト用テキストに整形（空なら ''） */
function buildRelationshipInfo(session: Session, characters: Character[]): string {
  const rels = session.state?.relationships ?? []
  const moods = session.state?.moods ?? []
  if (rels.length === 0 && moods.length === 0) return ''
  const nameOf = (id: string) => characters.find((c) => c.id === id)?.name ?? 'キャラ'
  const axesByChar = new Map<string, string[]>()
  for (const r of rels) {
    const arr = axesByChar.get(r.characterId) ?? []
    arr.push(`${r.axis} ${r.value}(${valueLabel(r.value)})`)
    axesByChar.set(r.characterId, arr)
  }
  const moodOf = (id: string) => moods.find((m) => m.characterId === id)?.mood
  const lines: string[] = []
  // 関係値を持つキャラ（気分も併記）
  for (const [cid, axisList] of axesByChar) {
    const mood = moodOf(cid)
    lines.push(`- ${nameOf(cid)} → 主人公: ${axisList.join(' / ')}${mood ? ` ｜ 気分: ${mood}` : ''}`)
  }
  // 気分のみのキャラ
  for (const m of moods) {
    if (!axesByChar.has(m.characterId)) lines.push(`- ${nameOf(m.characterId)}: 気分 ${m.mood}`)
  }
  return lines.join('\n')
}

/**
 * ディレクター：次シーンの方向を決める。
 * ①日付指定の特別イベントを最優先 → ②重み＋クールダウンで抽選。
 */
function directNextScene(
  session: Session,
  world: World | undefined,
  sceneTypes: SceneType[],
  nextDay: number | null,
): { typeId?: string; eventId?: string; eventName?: string } {
  // ① 特別イベント（消化済みでなく、到来済み）
  if (world && nextDay != null) {
    const ev = (world.scheduledEvents ?? [])
      .filter((e) => !session.usedEventIds.includes(e.id) && e.day <= nextDay)
      .sort((a, b) => a.day - b.day)[0]
    if (ev) return { eventId: ev.id, eventName: ev.name }
  }

  // ② ディレクター無効なら抽選しない
  if (!session.director.enabled) return {}
  const pool = session.director.typeIds
    .map((id) => sceneTypes.find((t) => t.id === id))
    .filter((t): t is SceneType => !!t)
  if (pool.length === 0) return {}

  // クールダウン：直近シーンで使われた種類を除外
  const recent = [...session.scenes].reverse()
  const eligible = pool.filter((t) => {
    if (!t.minGap) return true
    let gap = Infinity
    for (let i = 0; i < recent.length; i++) {
      if (recent[i].sceneTypeId === t.id) {
        gap = i
        break
      }
    }
    return gap >= t.minGap
  })
  const cands = eligible.length ? eligible : pool
  const total = cands.reduce((s, t) => s + Math.max(1, t.weight), 0)
  let r = Math.random() * total
  for (const t of cands) {
    r -= Math.max(1, t.weight)
    if (r <= 0) return { typeId: t.id }
  }
  return { typeId: cands[cands.length - 1].id }
}

/** v0（設定がセッション直書き）→ v1（素材ライブラリ参照） */
function migrateV0toV1(persisted: any): any {
  const characters: Character[] = []
  const personas: Persona[] = []
  const sessions: any[] = []

  for (const old of persisted.sessions ?? []) {
    const now = Date.now()
    const newS: any = {
      id: old.id ?? uid(),
      title: old.title ?? '無題',
      mode: old.mode === 'story' ? 'story' : 'roleplay',
      model: old.model ?? DEFAULT_MODEL,
      characterIds: [],
      worldId: null,
      personaId: null,
      authorNote: '',
      story: {
        premise: old.story?.premise ?? '',
        genre: old.story?.genre ?? '',
        protagonist: old.story?.protagonist ?? '',
      },
      messages: (old.messages ?? []).map((m: any) => ({
        id: m.id ?? uid(),
        role: m.role,
        content: m.content ?? '',
        createdAt: m.createdAt ?? now,
      })),
      temperature: old.temperature ?? 0.9,
      maxTokens: old.maxTokens ?? 1024,
      createdAt: old.createdAt ?? now,
      updatedAt: old.updatedAt ?? now,
    }

    const oc = old.character
    if (oc && (oc.name || oc.persona || oc.greeting)) {
      const c = newCharacter()
      c.name = oc.name ?? ''
      c.persona = oc.persona ?? ''
      c.greeting = oc.greeting ?? ''
      characters.push(c)
      newS.characterIds = [c.id]
      if (oc.scenario?.trim()) newS.authorNote = `舞台・状況: ${oc.scenario.trim()}`
    }

    if (old.userPersona?.trim()) {
      const p = newPersona()
      p.name = 'わたし'
      p.description = old.userPersona.trim()
      personas.push(p)
      newS.personaId = p.id
    }

    sessions.push(newS)
  }

  return {
    apiKey: persisted.apiKey ?? '',
    favoriteModels: persisted.favoriteModels ?? [],
    characters,
    worlds: [],
    personas,
    sessions,
    activeId: persisted.activeId ?? null,
  }
}

/** v1 → v2（シーン概念を追加。既存会話を初期シーンに収める） */
function migrateV1toV2(persisted: any): any {
  const sessions = (persisted.sessions ?? []).map((s: any) => {
    if (Array.isArray(s.scenes) && s.scenes.length > 0) return s
    const scene = newScene('シーン 1', s.characterIds ?? [])
    return {
      ...s,
      scenes: [scene],
      currentSceneId: scene.id,
      messages: (s.messages ?? []).map((m: any) => ({ ...m, sceneId: scene.id })),
    }
  })
  return { ...persisted, sessions }
}

/** v2 → v3（タイムライン・選択肢・キャラ成長フィールドを追加） */
function migrateV2toV3(persisted: any): any {
  const characters = (persisted.characters ?? []).map((c: any) => ({
    ...c,
    developments: Array.isArray(c.developments) ? c.developments : [],
  }))
  const sessions = (persisted.sessions ?? []).map((s: any) => ({
    ...s,
    timeline: s.timeline ?? defaultTimeline(),
    choiceMode: s.choiceMode ?? 'off',
  }))
  return { ...persisted, characters, sessions }
}

/** v3 → v4（文体スタイルを追加） */
function migrateV3toV4(persisted: any): any {
  const sessions = (persisted.sessions ?? []).map((s: any) => ({
    ...s,
    narrativeStyle: s.narrativeStyle ?? (s.mode === 'story' ? 'novel' : 'chat'),
  }))
  return { ...persisted, sessions }
}

/** v4 → v5（developments を ON/OFF 付きオブジェクト化・裏方モデル追加） */
function migrateV4toV5(persisted: any): any {
  const characters = (persisted.characters ?? []).map((c: any) => ({
    ...c,
    developments: Array.isArray(c.developments)
      ? c.developments.map((d: any) =>
          typeof d === 'string'
            ? { id: uid(), text: d, enabled: true }
            : { id: d.id ?? uid(), text: d.text ?? '', enabled: d.enabled ?? true },
        )
      : [],
  }))
  const sessions = (persisted.sessions ?? []).map((s: any) => ({
    ...s,
    utilityModel: s.utilityModel ?? '',
  }))
  return { ...persisted, characters, sessions }
}

/** v5 → v6（シーン演出エンジン：シーンタイプ・特別イベント・ディレクター） */
function migrateV5toV6(persisted: any): any {
  const worlds = (persisted.worlds ?? []).map((w: any) => ({
    ...w,
    scheduledEvents: Array.isArray(w.scheduledEvents) ? w.scheduledEvents : [],
  }))
  const sessions = (persisted.sessions ?? []).map((s: any) => ({
    ...s,
    director: s.director ?? { enabled: false, typeIds: [] },
    usedEventIds: Array.isArray(s.usedEventIds) ? s.usedEventIds : [],
  }))
  const sceneTypes =
    Array.isArray(persisted.sceneTypes) && persisted.sceneTypes.length > 0
      ? persisted.sceneTypes
      : defaultSceneTypes()
  return { ...persisted, worlds, sessions, sceneTypes }
}

/** v6 → v7（プロバイダ概念導入・裏方モデルを役割別に分割） */
/** v7→v8: Character に model フィールド追加（任意）。既存データはそのまま通過。 */
function migrateV7toV8(persisted: any): any {
  return persisted
}

/** v8→v9: セッションに感情・関係値の状態（state）を追加 */
function migrateV8toV9(persisted: any): any {
  const sessions = (persisted.sessions ?? []).map((s: any) => ({
    ...s,
    state:
      s.state && Array.isArray(s.state.relationships)
        ? {
            relationships: s.state.relationships,
            moods: Array.isArray(s.state.moods) ? s.state.moods : [],
          }
        : { relationships: [], moods: [] },
  }))
  return { ...persisted, sessions }
}

function migrateV6toV7(persisted: any): any {
  // セッションの utilityModel → reviewModel / choicesModel
  const sessions = (persisted.sessions ?? []).map((s: any) => {
    const { utilityModel, ...rest } = s
    return {
      ...rest,
      reviewModel: utilityModel ?? '',
      choicesModel: utilityModel ?? '',
    }
  })
  // providers: 既存データがあればそのまま、なければ旧 apiKey から生成
  const providers =
    Array.isArray(persisted.providers) && persisted.providers.length > 0
      ? persisted.providers
      : [defaultOpenRouterProvider(persisted.apiKey ?? '')]
  return { ...persisted, sessions, providers }
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => {
      const active = () => {
        const { sessions, activeId } = get()
        return sessions.find((s) => s.id === activeId)
      }

      const patchActive = (patch: Partial<Session>) => {
        const s = active()
        if (s) get().updateSession(s.id, patch)
      }

      function resolveRefs(session: Session): ResolvedRefs {
        const { characters, worlds, personas } = get()
        const scene = currentScene(session)
        // 登場キャラはシーンの active cast に限定（未設定ならセッションの全キャラ）
        const castIds =
          scene && scene.activeCharacterIds.length > 0
            ? scene.activeCharacterIds
            : session.characterIds
        return {
          characters: castIds
            .map((id) => characters.find((c) => c.id === id))
            .filter((c): c is Character => !!c),
          world: worlds.find((w) => w.id === session.worldId) ?? undefined,
          persona: personas.find((p) => p.id === session.personaId) ?? undefined,
          priorSummaries: session.scenes
            .filter((sc) => sc.id !== scene?.id && sc.summary.trim().length > 0)
            .map((sc) => ({ title: sc.title, summary: sc.summary.trim() })),
          sceneNote: scene?.note ?? '',
          currentSceneId: scene?.id ?? null,
          timelineInfo: timelinePromptInfo(session.timeline),
          nearEnd: isNearEnd(session.timeline),
          sceneTypeGuidance: scene?.sceneTypeId
            ? (get().sceneTypes.find((t) => t.id === scene.sceneTypeId)?.guidance ?? '')
            : '',
          relationshipInfo: buildRelationshipInfo(session, characters),
        }
      }

      async function runCompletion(speakerId?: string, appendToId?: string): Promise<void> {
        const s = active()
        if (!s) return

        // 話者を先に確定（キャラ別モデル解決のため）
        const novel = s.narrativeStyle === 'novel'
        const refs = resolveRefs(s)
        const speaker = novel ? undefined : refs.characters.find((c) => c.id === speakerId)

        // モデル参照を解決してプロバイダとモデルIDを確定（キャラ別 → セッション本編の優先順）
        const { provider, model: mainModel } = parseModelRef(mainModelOf(s, speaker), get().providers)
        if (!provider?.apiKey.trim()) {
          set({ error: `接続先「${provider?.label ?? ''}」の API キーが未設定です。設定から登録してください。` })
          return
        }

        controller = new AbortController()
        set({ isStreaming: true, error: null })

        // 既存メッセージへ追記する場合はそれを対象に、そうでなければ空メッセージを新規追加
        const assistantId = appendToId ?? uid()
        if (appendToId) {
          patchActive({
            messages: s.messages.map((m) =>
              m.id === appendToId ? { ...m, pending: true, truncated: false } : m,
            ),
          })
        } else {
          patchActive({
            messages: [
              ...s.messages,
              {
                id: assistantId,
                role: 'assistant',
                characterId: speaker?.id,
                sceneId: s.currentSceneId ?? undefined,
                content: '',
                createdAt: Date.now(),
                pending: true,
              },
            ],
          })
        }

        const writeDelta = (chunk: string) => {
          const cur = active()
          if (!cur) return
          patchActive({
            messages: cur.messages.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + chunk } : m,
            ),
          })
        }

        let finishReason: string | null = null
        let gotContent = false
        const MAX_TRIES = 3
        for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
          try {
            const res = await streamChat(
              {
                provider,
                model: mainModel,
                messages: buildMessages(active()!, refs, speaker),
                temperature: s.temperature,
                maxTokens: s.maxTokens,
                signal: controller.signal,
              },
              (chunk) => {
                gotContent = true
                writeDelta(chunk)
              },
            )
            finishReason = res.finishReason
            break
          } catch (e) {
            const err = e as Error
            if (err.name === 'AbortError') break
            // まだ何も生成されていない一時的エラーのみ自動リトライ
            if (!gotContent && attempt < MAX_TRIES) {
              await new Promise((r) => setTimeout(r, 500 * attempt))
              continue
            }
            set({ error: `${err.message}（${attempt}回試行）` })
            break
          }
        }

        const cur = active()
        if (cur) {
          const msgs = cur.messages
            .map((m) => {
              if (m.id !== assistantId) return m
              let content = m.content
              let characterId = m.characterId
              // おまかせ(会話劇・複数キャラ・話者未指定)時は先頭の「名前:」から話者を判定
              if (!novel && !characterId && refs.characters.length > 1) {
                const match = content.match(/^\s*([^:：\n]{1,20})[:：]\s*/)
                if (match) {
                  const nm = match[1].trim()
                  const hit = refs.characters.find((c) => c.name === nm)
                  if (hit) {
                    characterId = hit.id
                    content = content.slice(match[0].length)
                  }
                }
              }
              return { ...m, content, characterId, pending: false, truncated: finishReason === 'length' }
            })
            .filter((m) => !(m.id === assistantId && m.content.trim() === ''))
          patchActive({ messages: msgs })
        }
        controller = null
        set({ isStreaming: false })

        // 選択肢の生成（off 以外、かつ応答が生成された場合）
        const after = active()
        const finalMsg = after?.messages.find((m) => m.id === assistantId)
        if (after && finalMsg && finalMsg.content.trim() && after.choiceMode !== 'off') {
          await genChoices(after, assistantId)
        }
      }

      /** 直近のアシスタント応答に対する選択肢を生成して付与 */
      async function genChoices(session: Session, messageId: string): Promise<void> {
        const { provider, model } = parseModelRef(choicesModelOf(session), get().providers)
        if (!provider?.apiKey.trim()) return
        const mode = session.choiceMode === 'auto' ? 'auto' : 'always'
        set({ isGeneratingChoices: true })
        try {
          const refs = resolveRefs(session)
          const base = buildMessages(session, refs)
          const msgs = [{ role: 'system' as const, content: choicesSystem(mode) }, ...base.slice(1)]
          const raw = await streamChat(
            { provider, model, messages: msgs, temperature: 0.8, maxTokens: 250 },
            () => {},
          )
          const arr = extractJson<unknown>(raw.text)
          const choices = Array.isArray(arr)
            ? arr.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 4)
            : []
          if (choices.length > 0) {
            const cur = active()
            if (cur && cur.id === session.id) {
              get().updateSession(cur.id, {
                messages: cur.messages.map((m) =>
                  m.id === messageId ? { ...m, choices } : m,
                ),
              })
            }
          }
        } catch {
          /* 選択肢は失敗しても無視（本編には影響させない） */
        } finally {
          set({ isGeneratingChoices: false })
        }
      }

      return {
        providers: [defaultOpenRouterProvider('')],
        favoriteModels: [],
        characters: [],
        worlds: [],
        personas: [],
        sceneTypes: defaultSceneTypes(),
        sessions: [],
        activeId: null,

        view: 'sessions',
        modelsByProvider: {},
        modelsLoadingFor: null,
        isStreaming: false,
        isGeneratingChoices: false,
        isReviewing: false,
        sceneReview: null,
        error: null,

        setView: (view) => set({ view }),
        clearError: () => set({ error: null }),

        upsertProvider: (p) =>
          set((st) => ({
            providers: st.providers.some((x) => x.id === p.id)
              ? st.providers.map((x) => (x.id === p.id ? p : x))
              : [...st.providers, p],
          })),

        deleteProvider: (id) =>
          set((st) => ({
            providers: st.providers.length > 1 ? st.providers.filter((p) => p.id !== id) : st.providers,
          })),

        loadModels: async (providerId) => {
          const provider = get().providers.find((p) => p.id === providerId)
          if (!provider) return
          set({ modelsLoadingFor: providerId })
          try {
            const list = await fetchModels(provider)
            set((st) => ({
              modelsByProvider: { ...st.modelsByProvider, [providerId]: list },
            }))
          } catch (e) {
            set({ error: (e as Error).message })
          } finally {
            set({ modelsLoadingFor: null })
          }
        },

        toggleFavorite: (modelId) => {
          const fav = get().favoriteModels
          set({
            favoriteModels: fav.includes(modelId) ? fav.filter((f) => f !== modelId) : [...fav, modelId],
          })
        },

        upsertCharacter: (c) =>
          set((st) => {
            const exists = st.characters.some((x) => x.id === c.id)
            const updated = { ...c, updatedAt: Date.now() }
            return {
              characters: exists
                ? st.characters.map((x) => (x.id === c.id ? updated : x))
                : [updated, ...st.characters],
            }
          }),

        deleteCharacter: (id) =>
          set((st) => ({
            characters: st.characters.filter((c) => c.id !== id),
            sessions: st.sessions.map((s) => ({
              ...s,
              characterIds: s.characterIds.filter((cid) => cid !== id),
            })),
          })),

        bulkSetCharacterModel: (characterIds, modelRef) =>
          set((st) => ({
            characters: st.characters.map((c) =>
              characterIds.includes(c.id)
                ? { ...c, model: modelRef || undefined, updatedAt: Date.now() }
                : c,
            ),
          })),

        upsertWorld: (w) =>
          set((st) => {
            const exists = st.worlds.some((x) => x.id === w.id)
            const updated = { ...w, updatedAt: Date.now() }
            return {
              worlds: exists
                ? st.worlds.map((x) => (x.id === w.id ? updated : x))
                : [updated, ...st.worlds],
            }
          }),

        deleteWorld: (id) =>
          set((st) => ({
            worlds: st.worlds.filter((w) => w.id !== id),
            sessions: st.sessions.map((s) =>
              s.worldId === id ? { ...s, worldId: null } : s,
            ),
          })),

        upsertSceneType: (t) =>
          set((st) => {
            const exists = st.sceneTypes.some((x) => x.id === t.id)
            return {
              sceneTypes: exists
                ? st.sceneTypes.map((x) => (x.id === t.id ? t : x))
                : [...st.sceneTypes, t],
            }
          }),

        deleteSceneType: (id) =>
          set((st) => ({
            sceneTypes: st.sceneTypes.filter((t) => t.id !== id),
            sessions: st.sessions.map((s) => ({
              ...s,
              director: { ...s.director, typeIds: s.director.typeIds.filter((x) => x !== id) },
            })),
          })),

        upsertPersona: (p) =>
          set((st) => {
            const exists = st.personas.some((x) => x.id === p.id)
            const updated = { ...p, updatedAt: Date.now() }
            return {
              personas: exists
                ? st.personas.map((x) => (x.id === p.id ? updated : x))
                : [updated, ...st.personas],
            }
          }),

        deletePersona: (id) =>
          set((st) => ({
            personas: st.personas.filter((p) => p.id !== id),
            sessions: st.sessions.map((s) =>
              s.personaId === id ? { ...s, personaId: null } : s,
            ),
          })),

        createSession: (mode) => {
          const s = newSession(mode)
          set((st) => ({ sessions: [s, ...st.sessions], activeId: s.id, view: 'sessions' }))
        },

        deleteSession: (id) =>
          set((st) => {
            const sessions = st.sessions.filter((s) => s.id !== id)
            const activeId = st.activeId === id ? (sessions[0]?.id ?? null) : st.activeId
            return { sessions, activeId }
          }),

        setActive: (id) => set({ activeId: id, view: 'sessions' }),

        updateSession: (id, patch) =>
          set((st) => ({
            sessions: st.sessions.map((s) =>
              s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s,
            ),
          })),

        resolveRefs,

        updateScene: (sceneId, patch) => {
          const s = active()
          if (!s) return
          get().updateSession(s.id, {
            scenes: s.scenes.map((sc) => (sc.id === sceneId ? { ...sc, ...patch } : sc)),
          })
        },

        prepareSceneReview: async (targetSceneId?: string) => {
          const s = active()
          if (!s || get().isStreaming || get().isReviewing) return
          const scene = targetSceneId
            ? s.scenes.find((sc) => sc.id === targetSceneId)
            : currentScene(s)
          if (!scene) return
          const sceneMsgs = s.messages.filter(
            (m) => m.sceneId === scene.id && m.content.trim().length > 0,
          )
          if (sceneMsgs.length === 0) {
            set({ error: 'このシーンにはまだ会話がありません。' })
            return
          }

          // レビュー用モデルを解決
          const { provider, model } = parseModelRef(reviewModelOf(s), get().providers)
          if (!provider?.apiKey.trim()) {
            set({ error: `接続先「${provider?.label ?? ''}」の API キーが未設定です。` })
            return
          }

          set({ isReviewing: true, error: null })
          try {
            const refs = resolveRefs(s)
            const nameOf = (id?: string) =>
              get().characters.find((c) => c.id === id)?.name ?? 'キャラ'
            const transcript = sceneMsgs
              .map((m) =>
                m.role === 'user'
                  ? `${refs.persona?.name || 'ユーザー'}: ${m.content}`
                  : `${nameOf(m.characterId)}: ${m.content}`,
              )
              .join('\n')

            // 文脈：登場キャラの現行設定・世界概要・時間
            const castDefs = refs.characters
              .map((c) => {
                const added = c.developments.filter((d) => d.enabled).map((d) => d.text)
                return `- ${c.name}: ${c.persona}${
                  added.length ? `（既知の追加設定: ${added.join(' / ')}）` : ''
                }`
              })
              .join('\n')
            const ctxParts: string[] = []
            if (castDefs) ctxParts.push(`【登場人物の現行設定】\n${castDefs}`)
            if (refs.world) ctxParts.push(`【世界観】${refs.world.name}: ${refs.world.description}`)
            if (refs.timelineInfo) ctxParts.push(`【時間】${refs.timelineInfo}`)

            // ディレクター：次シーンの方向を決定（イベント優先→抽選）
            const nextDay = s.timeline.enabled ? advanceTimeline(s.timeline).currentDay : null
            const pick = directNextScene(s, refs.world, get().sceneTypes, nextDay)
            const pickedType = pick.typeId
              ? get().sceneTypes.find((t) => t.id === pick.typeId)
              : undefined
            const event = pick.eventId
              ? refs.world?.scheduledEvents.find((e) => e.id === pick.eventId)
              : undefined
            if (event) {
              ctxParts.push(
                `【次のシーンの方向性】特別イベント「${event.name}」が発生します。${event.note}\nsuggestions はこのイベントに沿った内容にしてください。`,
              )
            } else if (pickedType) {
              ctxParts.push(
                `【次のシーンの方向性】次シーンの種類は「${pickedType.name}」です。${pickedType.guidance}\nsuggestions はこの方向性に沿った内容にしてください。`,
              )
            }
            const context = ctxParts.join('\n')

            // 既存の関係軸（自由軸の auto-discovery：初出はモデルが定義、以降は拘束）
            const existingAxes = Array.from(
              new Set((s.state?.relationships ?? []).map((r) => r.axis)),
            )

            const raw = await streamChat(
              {
                provider,
                model,
                messages: [
                  { role: 'system', content: reviewSystem(existingAxes) },
                  {
                    role: 'user',
                    content: `${context}\n\n【シーン「${scene.title}」の会話】\n${transcript}`,
                  },
                ],
                temperature: 0.4,
                maxTokens: 2000,
              },
              () => {},
            )

            const parsed = extractJson<any>(raw.text)
            const sessionChars = get().characters
            const findId = (name: string) =>
              s.characterIds
                .map((id) => sessionChars.find((c) => c.id === id))
                .find((c) => c && c.name === name)?.id

            const review: SceneReview = {
              sceneId: scene.id,
              summary: (() => {
                if (typeof parsed?.summary === 'string' && parsed.summary.trim())
                  return parsed.summary.trim()
                if (Array.isArray(parsed?.summary) && parsed.summary.length > 0)
                  return (parsed.summary as unknown[]).map(String).join('\n')
                return raw.text.trim()
              })(),
              suggestions: Array.isArray(parsed?.suggestions)
                ? parsed.suggestions
                    .filter((x: any) => x && (x.title || x.note))
                    .map((x: any) => ({ title: String(x.title ?? ''), note: String(x.note ?? '') }))
                    .slice(0, 4)
                : [],
              characterGrowth: Array.isArray(parsed?.characterGrowth)
                ? parsed.characterGrowth
                    .map((x: any) => ({
                      characterId: findId(String(x?.name ?? '')) ?? '',
                      name: String(x?.name ?? ''),
                      addition: String(x?.addition ?? ''),
                    }))
                    .filter((g: any) => g.characterId && g.addition.trim())
                : [],
              worldGrowth: Array.isArray(parsed?.worldGrowth)
                ? parsed.worldGrowth
                    .map((x: any) => ({
                      keys: Array.isArray(x?.keys) ? x.keys.map((k: any) => String(k)) : [],
                      content: String(x?.content ?? ''),
                    }))
                    .filter((g: any) => g.content.trim())
                : [],
              relationshipDeltas: Array.isArray(parsed?.relationshipDeltas)
                ? parsed.relationshipDeltas
                    .map((x: any) => ({
                      characterId: findId(String(x?.character ?? x?.name ?? '')) ?? '',
                      name: String(x?.character ?? x?.name ?? ''),
                      axis: String(x?.axis ?? '').trim(),
                      delta: Math.max(-50, Math.min(50, Math.round(Number(x?.delta) || 0))),
                      reason: String(x?.reason ?? ''),
                    }))
                    .filter((d: any) => d.characterId && d.axis && d.delta !== 0)
                : [],
              moodChanges: Array.isArray(parsed?.moods)
                ? parsed.moods
                    .map((x: any) => ({
                      characterId: findId(String(x?.character ?? x?.name ?? '')) ?? '',
                      name: String(x?.character ?? x?.name ?? ''),
                      mood: String(x?.mood ?? '').trim(),
                    }))
                    .filter((m: any) => m.characterId && m.mood)
                : [],
              nextTypeId: pickedType?.id,
              nextTypeName: pickedType?.name,
              scheduledEventId: event?.id,
              scheduledEventName: event?.name,
            }
            set({ sceneReview: review })
          } catch (e) {
            if ((e as Error).name !== 'AbortError') set({ error: (e as Error).message })
          } finally {
            set({ isReviewing: false })
          }
        },

        confirmSceneReview: (opts) => {
          const review = get().sceneReview
          const s = active()
          if (!review || !s) return
          const sceneIdx = s.scenes.findIndex((sc) => sc.id === review.sceneId)
          const scene = s.scenes[sceneIdx]
          if (!scene) return

          const selectedGrowth = opts.characterGrowthIdx
            .map((i) => review.characterGrowth[i])
            .filter(Boolean)
          const selectedWorld = opts.worldGrowthIdx
            .map((i) => review.worldGrowth[i])
            .filter(Boolean)
          const selectedDeltas = opts.relationshipDeltaIdx
            .map((i) => review.relationshipDeltas[i])
            .filter(Boolean)

          // 関係値の差分を加算し、気分を上書きした新しい state を返す
          const applyState = (prev: Session['state']): Session['state'] => {
            const base = prev ?? { relationships: [], moods: [] }
            const relationships = base.relationships.map((r) => ({ ...r }))
            for (const d of selectedDeltas) {
              const idx = relationships.findIndex(
                (r) => r.characterId === d.characterId && r.axis === d.axis,
              )
              if (idx >= 0) {
                relationships[idx].value = clampValue(relationships[idx].value + d.delta)
              } else {
                // 初出の軸は中立 50 を起点に加算
                relationships.push({
                  characterId: d.characterId,
                  axis: d.axis,
                  value: clampValue(50 + d.delta),
                })
              }
            }
            const moods = base.moods.map((m) => ({ ...m }))
            for (const m of review.moodChanges) {
              const idx = moods.findIndex((x) => x.characterId === m.characterId)
              if (idx >= 0) moods[idx].mood = m.mood
              else moods.push({ characterId: m.characterId, mood: m.mood })
            }
            return { relationships, moods }
          }

          const applyGrowth = (st: AppState) => ({
            characters: st.characters.map((c) => {
              const adds: Development[] = selectedGrowth
                .filter((g) => g.characterId === c.id)
                .map((g) => newDevelopment(g.addition))
              return adds.length
                ? { ...c, developments: [...c.developments, ...adds], updatedAt: Date.now() }
                : c
            }),
            worlds: st.worlds.map((w) => {
              if (w.id !== s.worldId || selectedWorld.length === 0) return w
              const base = w.entries.length
              const entries: LoreEntry[] = selectedWorld.map((g, i) => ({
                ...newLoreEntry(base + i),
                keys: g.keys,
                content: g.content,
                addedInStory: true,
              }))
              return { ...w, entries: [...w.entries, ...entries], updatedAt: Date.now() }
            }),
          })

          const isPastScene = scene.id !== s.currentSceneId

          if (isPastScene) {
            // 過去シーンの再レビュー：要約を更新し、次シーンの方向のみ差し替える
            const sug = opts.suggestion
            const nextScene = s.scenes[sceneIdx + 1]
            const event = review.scheduledEventId
              ? get().worlds
                  .find((w) => w.id === s.worldId)
                  ?.scheduledEvents.find((e) => e.id === review.scheduledEventId)
              : undefined
            set((st) => ({
              ...applyGrowth(st),
              sessions: st.sessions.map((sess) =>
                sess.id === s.id
                  ? {
                      ...sess,
                      scenes: sess.scenes.map((sc) => {
                        if (sc.id === scene.id)
                          return { ...sc, summary: opts.summary.trim() }
                        if (nextScene && sc.id === nextScene.id && (sug || event)) {
                          const base = event?.name || sug?.title || review.nextTypeName || sc.title
                          return {
                            ...sc,
                            title: base || sc.title,
                            note: sug?.note || event?.note || sc.note,
                            sceneTypeId: review.nextTypeId ?? sc.sceneTypeId,
                          }
                        }
                        return sc
                      }),
                      updatedAt: Date.now(),
                    }
                  : sess,
              ),
              sceneReview: null,
            }))
            return
          }

          // 現在シーンの通常フロー
          const tl = s.timeline.enabled ? advanceTimeline(s.timeline) : s.timeline
          const nextLabel = s.timeline.enabled ? timeLabelOf(tl) : undefined

          const sug = opts.suggestion
          const event = review.scheduledEventId
            ? get().worlds
                .find((w) => w.id === s.worldId)
                ?.scheduledEvents.find((e) => e.id === review.scheduledEventId)
            : undefined
          const base = event?.name || sug?.title || review.nextTypeName || ''
          const title =
            [nextLabel, base].filter(Boolean).join('：') ||
            `シーン ${s.scenes.length + 1}`
          const next = newScene(title, scene.activeCharacterIds, nextLabel)
          next.note = sug?.note || event?.note || ''
          next.sceneTypeId = review.nextTypeId
          const usedEventIds = event
            ? [...s.usedEventIds, event.id]
            : s.usedEventIds

          set((st) => ({
            ...applyGrowth(st),
            sessions: st.sessions.map((sess) =>
              sess.id === s.id
                ? {
                    ...sess,
                    scenes: sess.scenes
                      .map((sc) =>
                        sc.id === scene.id
                          ? { ...sc, summary: opts.summary.trim(), endedAt: Date.now() }
                          : sc,
                      )
                      .concat(next),
                    currentSceneId: next.id,
                    timeline: tl,
                    usedEventIds,
                    state: applyState(sess.state),
                    updatedAt: Date.now(),
                  }
                : sess,
            ),
            sceneReview: null,
          }))

          // 新シーンの導入を自動生成（→ 続けて選択肢が提示される）
          void get().beginScene()
        },

        setReviewNextType: (typeId) => {
          const review = get().sceneReview
          if (!review) return
          const t = typeId ? get().sceneTypes.find((x) => x.id === typeId) : undefined
          set({
            sceneReview: {
              ...review,
              nextTypeId: t?.id,
              nextTypeName: t?.name,
              // 手動指定時は特別イベントを解除
              scheduledEventId: undefined,
              scheduledEventName: undefined,
            },
          })
        },

        rerollReviewType: () => {
          const review = get().sceneReview
          const s = active()
          if (!review || !s) return
          const pick = directNextScene(
            { ...s, usedEventIds: [...s.usedEventIds, review.scheduledEventId ?? ''] },
            get().worlds.find((w) => w.id === s.worldId),
            get().sceneTypes,
            null, // イベントを除外して種類のみ抽選
          )
          const t = pick.typeId ? get().sceneTypes.find((x) => x.id === pick.typeId) : undefined
          set({
            sceneReview: {
              ...review,
              nextTypeId: t?.id,
              nextTypeName: t?.name,
              scheduledEventId: undefined,
              scheduledEventName: undefined,
            },
          })
        },

        cancelReview: () => set({ sceneReview: null }),

        startSession: () => {
          const s = active()
          if (!s || s.messages.length > 0) return
          const refs = resolveRefs(s)
          // ロールプレイで単一キャラ＋挨拶があれば最初の発話に
          if (s.mode === 'roleplay' && refs.characters.length === 1) {
            const c = refs.characters[0]
            if (c.greeting.trim()) {
              patchActive({
                messages: [
                  {
                    id: uid(),
                    role: 'assistant',
                    characterId: c.id,
                    sceneId: s.currentSceneId ?? undefined,
                    content: c.greeting.trim(),
                    createdAt: Date.now(),
                  },
                ],
              })
            }
          }
        },

        send: async (text, speakerId) => {
          const s = active()
          if (!s || get().isStreaming) return
          const trimmed = text.trim()
          if (!trimmed) return
          patchActive({
            messages: [
              ...s.messages,
              {
                id: uid(),
                role: 'user',
                sceneId: s.currentSceneId ?? undefined,
                content: trimmed,
                createdAt: Date.now(),
              },
            ],
          })
          await runCompletion(speakerId)
        },

        continueStory: async (speakerId) => {
          const s = active()
          if (!s || get().isStreaming) return
          patchActive({
            messages: [
              ...s.messages,
              {
                id: uid(),
                role: 'user',
                sceneId: s.currentSceneId ?? undefined,
                content: CONTINUE_PROMPT,
                createdAt: Date.now(),
              },
            ],
          })
          await runCompletion(speakerId)
        },

        regenerate: async (speakerId) => {
          const s = active()
          if (!s || get().isStreaming) return
          const curId = s.currentSceneId
          const msgs = [...s.messages]
          // 現在シーン内の末尾アシスタント応答のみ取り消す
          while (
            msgs.length &&
            msgs[msgs.length - 1].role === 'assistant' &&
            (!curId || !msgs[msgs.length - 1].sceneId || msgs[msgs.length - 1].sceneId === curId)
          ) {
            msgs.pop()
          }
          patchActive({ messages: msgs })
          await runCompletion(speakerId)
        },

        startStory: async () => {
          const s = active()
          if (!s || get().isStreaming) return
          const scene = currentScene(s)
          if (!scene) return

          // 開始時のシーン選出：世界イベント確認＋タイプ抽選＋時間帯決定
          const refs = resolveRefs(s)
          const day = s.timeline.enabled ? s.timeline.currentDay : null
          const pick = directNextScene(s, refs.world, get().sceneTypes, day)
          const event = pick.eventId
            ? refs.world?.scheduledEvents.find((e) => e.id === pick.eventId)
            : undefined
          const label = s.timeline.enabled ? timeLabelOf(s.timeline) : undefined
          const baseName = event?.name || (pick.typeId ? get().sceneTypes.find((t) => t.id === pick.typeId)?.name : '')
          const title = [label, baseName].filter(Boolean).join('：') || scene.title

          get().updateSession(s.id, {
            scenes: s.scenes.map((sc) =>
              sc.id === scene.id
                ? {
                    ...sc,
                    title,
                    timeLabel: label ?? sc.timeLabel,
                    sceneTypeId: pick.typeId,
                    note: sc.note || event?.note || '',
                  }
                : sc,
            ),
            usedEventIds: event ? [...s.usedEventIds, event.id] : s.usedEventIds,
          })

          await get().beginScene()
        },

        beginScene: async () => {
          const s = active()
          if (!s || get().isStreaming) return
          patchActive({
            messages: [
              ...s.messages,
              {
                id: uid(),
                role: 'user',
                sceneId: s.currentSceneId ?? undefined,
                content: SCENE_START_PROMPT,
                createdAt: Date.now(),
              },
            ],
          })
          await runCompletion()
        },

        continueLast: async () => {
          const s = active()
          if (!s || get().isStreaming) return
          const last = [...s.messages].reverse().find((m) => m.role === 'assistant')
          if (!last) return
          await runCompletion(last.characterId, last.id)
        },

        editMessage: (messageId, content) => {
          const s = active()
          if (!s) return
          get().updateSession(s.id, {
            messages: s.messages.map((m) => (m.id === messageId ? { ...m, content } : m)),
          })
        },

        deleteMessage: (messageId) => {
          const s = active()
          if (!s || get().isStreaming) return
          get().updateSession(s.id, {
            messages: s.messages.filter((m) => m.id !== messageId),
          })
        },

        regenerateFrom: async (messageId) => {
          const s = active()
          if (!s || get().isStreaming) return
          const idx = s.messages.findIndex((m) => m.id === messageId)
          if (idx < 0) return
          const target = s.messages[idx]
          // アシスタント発言: それ自身と以降を破棄して再生成
          // ユーザー発言: その発言は残し、以降を破棄して応答を作り直す
          const keepUpto = target.role === 'assistant' ? idx : idx + 1
          const speaker = target.role === 'assistant' ? target.characterId : undefined
          patchActive({ messages: s.messages.slice(0, keepUpto) })
          await runCompletion(speaker)
        },

        stop: () => {
          controller?.abort()
          controller = null
          set({ isStreaming: false })
        },

        exportBundle: () => {
          const { providers, characters, worlds, personas, sceneTypes, sessions } = get()
          return {
            type: 'ai-storytelling-studio',
            version: 9,
            exportedAt: Date.now(),
            providers,
            characters,
            worlds,
            personas,
            sceneTypes,
            sessions,
          }
        },

        importBundle: (bundle) => {
          let added = 0
          // 古いバンドルも取り込めるよう補正（シーン・タイムライン・成長欄・演出・プロバイダ）
          const normalized = migrateV8toV9(
            migrateV7toV8(
              migrateV6toV7(
                migrateV5toV6(
                  migrateV4toV5(
                    migrateV3toV4(
                      migrateV2toV3(
                        migrateV1toV2({
                          characters: bundle.characters,
                          worlds: bundle.worlds,
                          sessions: bundle.sessions,
                          sceneTypes: bundle.sceneTypes,
                          providers: bundle.providers,
                        }),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          )
          const incomingSessions = normalized.sessions
          const incomingCharacters = normalized.characters
          const incomingWorlds = normalized.worlds
          set((st) => {
            const mergeById = <T extends { id: string }>(cur: T[], inc: T[]): T[] => {
              const ids = new Set(cur.map((x) => x.id))
              const fresh = inc.filter((x) => x && x.id && !ids.has(x.id))
              added += fresh.length
              return [...fresh, ...cur]
            }
            return {
              characters: mergeById(st.characters, incomingCharacters),
              worlds: mergeById(st.worlds, incomingWorlds),
              personas: mergeById(st.personas, bundle.personas),
              sceneTypes: mergeById(st.sceneTypes, bundle.sceneTypes ?? []),
              sessions: mergeById(st.sessions, incomingSessions),
              // providers はユーザー固有の設定のためインポート対象外
            }
          })
          return { added }
        },
      }
    },
    {
      name: 'ai-storytelling-store',
      version: 9,
      partialize: (st) => ({
        providers: st.providers,
        favoriteModels: st.favoriteModels,
        characters: st.characters,
        worlds: st.worlds,
        personas: st.personas,
        sceneTypes: st.sceneTypes,
        sessions: st.sessions,
        activeId: st.activeId,
      }),
      migrate: (persisted: any, version: number) => {
        if (!persisted) return persisted
        let state = persisted
        if (version < 1) state = migrateV0toV1(state)
        if (version < 2) state = migrateV1toV2(state)
        if (version < 3) state = migrateV2toV3(state)
        if (version < 4) state = migrateV3toV4(state)
        if (version < 5) state = migrateV4toV5(state)
        if (version < 6) state = migrateV5toV6(state)
        if (version < 7) state = migrateV6toV7(state)
        if (version < 8) state = migrateV7toV8(state)
        if (version < 9) state = migrateV8toV9(state)
        return state
      },
    },
  ),
)
