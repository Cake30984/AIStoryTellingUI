import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type {
  AchievementDef,
  Avatar,
  BranchNode,
  BranchTree,
  Character,
  Choice,
  ChoiceEffect,
  Clause,
  Condition,
  CounterDef,
  Development,
  EmotionId,
  ExportBundle,
  ImageProvider,
  LoreEntry,
  NextSceneSuggestion,
  Op,
  OpenRouterModel,
  Persona,
  Provider,
  RelationAspectDef,
  Scene,
  SceneIllustration,
  SceneReview,
  SceneType,
  Session,
  SessionMode,
  SessionState,
  StatDef,
  UiPrefs,
  World,
} from './types'
import { DEFAULT_UI, EMOTIONS } from './types'
import { fetchModels, streamChat } from './lib/openrouter'
import { base64ToBlob, blobToBase64, gcImages, getImage, putImage, putImageAs } from './lib/imageStore'
import { checkpointStore, PERSIST_KEY, stateStorage } from './lib/platform'
import { gunzipText, gzipText } from './lib/checkpoint'
import { normalizeImage } from './lib/avatarGen'
import { emotionUpdatesOf, matchCharacterByName, parseStructured, plainTextOf } from './lib/structured'
import { generateImage } from './lib/imageGen'
import {
  abortJobController,
  clearJobAbort,
  registerJobAbort,
  type ImageJob,
  type ImageJobTarget,
} from './lib/imageJobs'
import { sessionCardImageBlob, type SessionCardBundle } from './lib/cards'
import {
  buildMessages,
  choicesSystem,
  choicesUserNudge,
  CONTINUATION_NUDGE,
  CONTINUE_PROMPT,
  emotionSystem,
  nextSceneSystem,
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
  // セキュアコンテキスト（HTTPS/localhost）では衝突耐性の高い crypto.randomUUID を使う。
  // 非対応環境（HTTP配信等）向けにフォールバックを残す。
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

const COLORS = ['#7c5cff', '#ef6f6c', '#4cc9a4', '#f0a76b', '#5b8def', '#d77ad8', '#e0b341']
function pickColor(): string {
  return COLORS[Math.floor(Math.random() * COLORS.length)]
}

/** スタット値を def の min..max に丸める（未指定は無制限） */
function clampStat(v: number, def?: { min?: number; max?: number }): number {
  let x = Math.round(v)
  if (def?.min != null) x = Math.max(def.min, x)
  if (def?.max != null) x = Math.min(def.max, x)
  return x
}

function compareOp(a: number, op: Op, b: number): boolean {
  switch (op) {
    case '>=':
      return a >= b
    case '>':
      return a > b
    case '<=':
      return a <= b
    case '<':
      return a < b
    case '==':
      return a === b
    case '!=':
      return a !== b
    default:
      return false
  }
}

/**
 * 条件節（Clause）を評価する。prose は読まない＝数・フラグ・実績のみ判定（再現性のため）。
 * World はセッション横断の再利用素材のため characterId/fromId 省略時は
 * 「セッション参加キャラのいずれかが満たせば真」で判定する。
 */
function evalClause(
  clause: Clause,
  state: SessionState,
  world: World | undefined,
  characterIds: string[],
): boolean {
  switch (clause.kind) {
    case 'stat': {
      const def = world?.stats.find((d) => d.id === clause.defId)
      if (!def) return false
      const valueOf = (cid?: string) =>
        state.stats.find((s) => s.defId === clause.defId && s.characterId === cid)?.value ??
        def.default
      if (def.scope === 'global') return compareOp(valueOf(undefined), clause.op, clause.value)
      if (clause.characterId) return compareOp(valueOf(clause.characterId), clause.op, clause.value)
      return characterIds.some((cid) => compareOp(valueOf(cid), clause.op, clause.value))
    }
    case 'counter': {
      const def = world?.counters.find((d) => d.id === clause.defId)
      if (!def) return false
      const valueOf = (cid?: string) =>
        state.counters.find((c) => c.defId === clause.defId && c.characterId === cid)?.value ?? 0
      if (def.scope === 'global') return compareOp(valueOf(undefined), clause.op, clause.value)
      if (clause.characterId) return compareOp(valueOf(clause.characterId), clause.op, clause.value)
      return characterIds.some((cid) => compareOp(valueOf(cid), clause.op, clause.value))
    }
    case 'relationFlag': {
      const toId = clause.toId ?? 'hero'
      const hasFlag = (fromId: string) =>
        !!state.relations
          .find((r) => r.fromId === fromId && r.toId === toId)
          ?.flags.includes(clause.flag)
      const has = clause.fromId ? hasFlag(clause.fromId) : characterIds.some(hasFlag)
      return has === clause.have
    }
    case 'achievement': {
      const has = state.achievements.some((a) => a.defId === clause.defId)
      return has === clause.have
    }
    default:
      return false
  }
}

/** 条件式を評価する（all=すべて満たす／any=いずれか満たす）。節が空なら不成立扱い。 */
export function evalCondition(
  cond: Condition | undefined,
  state: SessionState,
  world: World | undefined,
  characterIds: string[],
): boolean {
  if (!cond) return false
  if ('all' in cond)
    return cond.all.length > 0 && cond.all.every((c) => evalClause(c, state, world, characterIds))
  return cond.any.length > 0 && cond.any.some((c) => evalClause(c, state, world, characterIds))
}

/**
 * World 定義の実績を state へ反復評価し、新規解除分を記録して返す（連鎖依存も1パスで解決）。
 * シーン確定時・選択肢の加点時など、state が変わり得るあらゆる場所から共通で呼ぶ。
 */
function unlockAchievements(
  state: SessionState,
  world: World | undefined,
  characterIds: string[],
): { state: SessionState; unlocked: AchievementDef[] } {
  const achievements = state.achievements.map((a) => ({ ...a }))
  const candidate: SessionState = { ...state, achievements }
  const unlocked: AchievementDef[] = []
  let progressed = true
  while (progressed) {
    progressed = false
    for (const def of world?.achievements ?? []) {
      if (achievements.some((a) => a.defId === def.id)) continue
      if (evalCondition(def.condition, candidate, world, characterIds)) {
        achievements.push({ defId: def.id, unlockedAt: Date.now() })
        unlocked.push(def)
        progressed = true
      }
    }
  }
  return { state: candidate, unlocked }
}

/**
 * 表情判定（V4）のモデル出力を検証・解決する純粋関数。
 * キャラ名は完全一致 → 前方一致の順で解決し、解決できない名前・6値以外の emotion は捨てる。
 */
export function resolveEmotionUpdates(
  raw: { character?: string; emotion?: string }[],
  characters: { id: string; name: string }[],
): { characterId: string; emotion: EmotionId }[] {
  const validEmotions = new Set(EMOTIONS.map((e) => e.id as string))
  const out: { characterId: string; emotion: EmotionId }[] = []
  for (const item of raw) {
    const name = item.character?.trim()
    const emotion = item.emotion
    if (!name || !emotion || !validEmotions.has(emotion)) continue
    const characterId = matchCharacterByName(name, characters)
    if (!characterId) continue
    out.push({ characterId, emotion: emotion as EmotionId })
  }
  return out
}

/**
 * モデルが返した JSON から選択肢を取り出す。
 * 素直な ["a","b"] のほか、`{"choices":[...]}` のラップや
 * `[{"text":"a","effects":[...]}]` のオブジェクト配列にも対応する（モデル差吸収）。
 * effects（P5・小刻み加点）はワールド定義のスタット名で解決し、未定義は無視する。
 */
function coerceChoices(parsed: unknown, world: World | undefined, characters: Character[]): Choice[] {
  const arr: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? ((Object.values(parsed as Record<string, unknown>).find((v) => Array.isArray(v)) as
          | unknown[]
          | undefined) ?? [])
      : []
  return arr
    .map((x): Choice | null => {
      if (typeof x === 'string') {
        const text = x.trim()
        return text ? { text } : null
      }
      if (!x || typeof x !== 'object') return null
      const obj = x as Record<string, unknown>
      const textRaw =
        typeof obj.text === 'string'
          ? obj.text
          : (Object.values(obj).find((v) => typeof v === 'string') as string | undefined)
      const text = textRaw?.trim()
      if (!text) return null
      const rawEffects = Array.isArray(obj.effects) ? obj.effects : []
      const effects: ChoiceEffect[] = rawEffects
        .map((e: any) => {
          const def = (world?.stats ?? []).find(
            (d) => d.name === String(e?.stat ?? e?.name ?? '').trim(),
          )
          if (!def) return null
          const charName = e?.character ? String(e.character) : undefined
          const characterId =
            def.scope === 'character' && charName
              ? characters.find((c) => c.name === charName)?.id
              : undefined
          if (def.scope === 'character' && !characterId) return null
          const delta = Math.round(Number(e?.delta) || 0)
          if (!delta) return null
          return {
            defId: def.id,
            name: def.name,
            characterId,
            charName: def.scope === 'character' ? charName : undefined,
            delta,
          }
        })
        .filter((e: any): e is NonNullable<typeof e> => !!e)
      return { text, effects: effects.length ? effects : undefined }
    })
    .filter((c): c is Choice => !!c)
    .slice(0, 4)
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
    avatar: { color: pickColor() },
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
    avatar: { color: '#5b8def' },
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
    relationAspects: [],
    stats: [],
    counters: [],
    achievements: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function newRelationAspect(name = ''): RelationAspectDef {
  return { id: uid(), name, guidance: '' }
}

export function newStatDef(name = ''): StatDef {
  return { id: uid(), name, scope: 'character', default: 0, min: 0, max: 100, inject: false }
}

export function newCounterDef(name = ''): CounterDef {
  return { id: uid(), name, scope: 'character', inject: false }
}

export function newAchievementDef(name = ''): AchievementDef {
  return { id: uid(), name, description: '', condition: { all: [] }, hidden: false }
}

/** 条件節の既定値（kind 選択時の初期形） */
export function newClause(kind: Clause['kind'], world: World): Clause {
  switch (kind) {
    case 'stat':
      return { kind: 'stat', defId: world.stats[0]?.id ?? '', op: '>=', value: 0 }
    case 'counter':
      return { kind: 'counter', defId: world.counters[0]?.id ?? '', op: '>=', value: 1 }
    case 'relationFlag':
      return { kind: 'relationFlag', flag: '', have: true }
    case 'achievement':
      return { kind: 'achievement', defId: '', have: true }
  }
}

/** ワールドの状態定義プリセット（次元＋スタット＋カウンターをまとめて投入） */
export const WORLD_PRESETS: {
  id: string
  label: string
  aspects: string[]
  stats: Omit<StatDef, 'id'>[]
  counters: Omit<CounterDef, 'id'>[]
}[] = [
  {
    id: 'romance',
    label: '恋愛',
    aspects: ['信頼', '恋愛'],
    stats: [{ name: '好感度', scope: 'character', default: 0, min: 0, max: 100, inject: false }],
    counters: [{ name: 'デート回数', scope: 'character', inject: true }],
  },
  {
    id: 'rpg',
    label: 'RPG',
    aspects: ['信頼', '警戒'],
    stats: [
      { name: 'レベル', scope: 'character', default: 1, min: 1, max: 99, inject: true },
      { name: '所持金', scope: 'global', default: 0, min: 0, inject: true },
    ],
    counters: [{ name: '戦闘回数', scope: 'global', inject: false }],
  },
  {
    id: 'business',
    label: '経営',
    aspects: ['信用'],
    stats: [
      { name: '資産', scope: 'global', default: 0, min: 0, inject: true },
      { name: '名声', scope: 'global', default: 0, min: 0, max: 100, inject: true },
    ],
    counters: [{ name: '来店回数', scope: 'global', inject: true }],
  },
]

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
    state: { relations: [], moods: [], stats: [], counters: [], achievements: [] },
    overlay: { lore: [], characterDevelopments: [] },
    structuredOutput: true,
    messages: [],
    temperature: 0.9,
    // max_tokens は打ち切り上限（書き終われば自然に止まる）。途中切れ防止を優先して余裕を持たせる
    maxTokens: 4096,
    createdAt: now,
    updatedAt: now,
  }
}

/** セッションの現在シーンを返す（無ければ最後のシーン） */
export function currentScene(s: Session): Scene | undefined {
  return s.scenes.find((sc) => sc.id === s.currentSceneId) ?? s.scenes[s.scenes.length - 1]
}

/**
 * セッション1件が参照する画像 id を抽出する（C1）。ライブ収集（collectUsedImageIds）と
 * チェックポイント保存時の imageIds 抽出の両方がこの1関数を使う。「画像 id を増やしたら
 * ここに追加」の規約はこの関数1箇所に集約する。
 */
export function sessionImageIds(session: Session): string[] {
  const ids: string[] = []
  for (const sc of session.scenes) {
    for (const ill of sc.illustrations ?? []) ids.push(ill.imageId)
    if (sc.backgroundImageId) ids.push(sc.backgroundImageId)
  }
  return ids
}

/**
 * しおり（C3）のサムネイルをチェックポイントのスナップショットから自動選択する。
 * 新しいシーンから遡り、背景 → 挿絵（末尾＝最新）の優先度で最初に見つかった画像を使う。
 */
function pickThumbFromSnapshot(session: Session): string | undefined {
  for (let i = session.scenes.length - 1; i >= 0; i--) {
    const sc = session.scenes[i]
    if (sc.backgroundImageId) return sc.backgroundImageId
    const ills = sc.illustrations ?? []
    if (ills.length > 0) return ills[ills.length - 1].imageId
  }
  return undefined
}

/**
 * 使用中の画像 id を収集する（GC・エクスポートの両方から呼ぶ。片方だけ更新される事故を防ぐため
 * 「画像 id を増やしたら GC に追加」の規約はこの関数 1 箇所への追加に集約する＝T0）
 */
export function collectUsedImageIds(characters: Character[], personas: Persona[], sessions: Session[]): Set<string> {
  const used = new Set<string>()
  for (const c of characters) {
    if (c.avatar.imageId) used.add(c.avatar.imageId)
    for (const sp of c.sprites ?? []) used.add(sp.imageId)
  }
  for (const p of personas) if (p.avatar.imageId) used.add(p.avatar.imageId)
  for (const s of sessions) for (const id of sessionImageIds(s)) used.add(id)
  return used
}

interface AppState {
  // 永続化
  providers: Provider[]
  /** 画像生成の接続先（LLM とは別系統）。localStorage のみ・エクスポート除外 */
  imageProviders: ImageProvider[]
  /** 最後に画像生成で使った接続先（ImageGenModal・一括生成の初期値。V5c） */
  lastImageProviderId?: string
  /** 最後に起案（プロンプト起草）に使ったモデル（"providerId::modelId"。V5c） */
  lastDraftModel?: string
  favoriteModels: string[]
  characters: Character[]
  worlds: World[]
  personas: Persona[]
  sceneTypes: SceneType[]
  sessions: Session[]
  activeId: string | null
  /** セッションごとの分岐ツリー（軽量メタデータのみ。実体は checkpointStore。C1） */
  branchTrees: Record<string, BranchTree>
  /** 右コンテキストドック等の永続 UI 状態（UI-3） */
  ui: UiPrefs

  // ランタイム
  view: View
  modelsByProvider: Record<string, OpenRouterModel[]>
  modelsLoadingFor: string | null
  isStreaming: boolean
  isGeneratingChoices: boolean
  isReviewing: boolean
  /** 表情判定（方式A・classifyEmotions）が進行中か（非永続。ActivityIndicator 用） */
  isClassifyingEmotions: boolean
  /** 次シーン候補（suggestions）だけを再生成中 */
  isRegenSuggestions: boolean
  sceneReview: SceneReview | null
  error: string | null
  /** 直近のシーン確定で新規解除された実績（通知用・非永続） */
  newlyUnlockedAchievements: AchievementDef[]
  /** バックグラウンド画像生成ジョブ（Blob を含むため非永続。partialize から除外） */
  imageJobs: ImageJob[]
  /** 選択待ちに変わったジョブの通知（非永続） */
  imageJobToasts: { jobId: string; label: string }[]

  // 共通
  setView: (v: View) => void
  clearError: () => void
  dismissNewAchievements: () => void
  /** 右コンテキストドック等の UI 設定を部分更新する（UI-3） */
  setUiPrefs: (patch: Partial<UiPrefs>) => void

  // 接続先（プロバイダ）
  upsertProvider: (p: Provider) => void
  deleteProvider: (id: string) => void
  loadModels: (providerId: string) => Promise<void>
  toggleFavorite: (modelId: string) => void

  // 画像生成の接続先
  upsertImageProvider: (p: ImageProvider) => void
  deleteImageProvider: (id: string) => void
  /** 最後に画像生成で使った接続先を記憶する（V5c） */
  setLastImageProviderId: (id: string) => void
  /** 最後に起案に使ったモデルを記憶する（V5c） */
  setLastDraftModel: (ref: string) => void

  // ライブラリ CRUD
  upsertCharacter: (c: Character) => void
  /** カードからのインポート専用。id が既存と衝突する場合は振り直して常に新規追加する */
  importCharacterCard: (c: Character) => void
  deleteCharacter: (id: string) => void
  bulkSetCharacterModel: (characterIds: string[], modelRef: string) => void
  /** 立ち絵を手動で設定/解除する（アップロード・削除用。生成採用は applyImageJobResult 側） */
  setCharacterSprite: (characterId: string, emotion: EmotionId, imageId: string | undefined) => Promise<void>
  upsertWorld: (w: World) => void
  /** カードからのインポート専用。id が既存と衝突する場合は振り直して常に新規追加する */
  importWorldCard: (w: World) => void
  deleteWorld: (id: string) => void
  upsertSceneType: (t: SceneType) => void
  deleteSceneType: (id: string) => void
  upsertPersona: (p: Persona) => void
  /** カードからのインポート専用。id が既存と衝突する場合は振り直して常に新規追加する */
  importPersonaCard: (p: Persona) => void
  deletePersona: (id: string) => void

  // セッション
  createSession: (mode: SessionMode) => void
  deleteSession: (id: string) => void
  setActive: (id: string) => void
  updateSession: (id: string, patch: Partial<Session>) => void
  resolveRefs: (session: Session) => ResolvedRefs
  /**
   * チェックポイントへ復元する（C1）。プレイ用ノブ（title/model/reviewModel/choicesModel/
   * temperature/maxTokens/spritesEnabled）だけ現在値を維持し、それ以外はスナップショットから復元する。
   * 復元は何も削除しない（次の物語操作でこのノードの子が積まれ、既存の子がいれば兄弟分岐になる）。
   */
  restoreCheckpoint: (sessionId: string, nodeId: string) => Promise<void>
  /**
   * 指定ノード以下のサブツリーを削除する（チェックポイント実体も削除。C2）。
   * 現在パス（root→currentId）上のノードは削除不可（例外を投げる。UI 側で confirm 済みの前提）。
   */
  deleteBranchSubtree: (sessionId: string, nodeId: string) => Promise<void>
  /** 現在パス以外のノードを一括削除する「この分岐だけ残す」（C2） */
  pruneToCurrentPath: (sessionId: string) => Promise<void>
  /** しおりを設定する（C3）。サムネイルはノードのスナップショットから自動選択（背景優先） */
  setBranchStar: (sessionId: string, nodeId: string, name: string) => Promise<void>
  /** しおりを外す（C3） */
  removeBranchStar: (sessionId: string, nodeId: string) => void
  /** 起動時の孤児チェックポイント掃除（C3）。木のノードに対応しない実体ファイルを削除する */
  cleanupOrphanCheckpoints: () => Promise<void>
  /**
   * 発見ロアをセッションのオーバーレイから元ワールドへ昇格（move）。元素材は明示操作でのみ更新される。
   * entry は呼び出し側（DiscoveryPanel）でローカル編集済みの内容をそのまま渡す
   * （store 側の overlay を経由しないため、他の未保存編集に触れない）。
   */
  promoteOverlayLore: (sessionId: string, entry: LoreEntry) => void
  /** 発見キャラ成長をセッションのオーバーレイから元キャラへ昇格（move）。dev はローカル編集済みの内容をそのまま渡す */
  promoteOverlayDev: (sessionId: string, characterId: string, dev: Development) => void

  // シーン
  updateScene: (sceneId: string, patch: Partial<Scene>) => void
  prepareSceneReview: (sceneId?: string) => Promise<void>
  confirmSceneReview: (opts: {
    summary: string
    suggestion?: NextSceneSuggestion
    characterGrowthIdx: number[]
    worldGrowthIdx: number[]
    relationUpdateIdx: number[]
    statChangeIdx: number[]
    counterEventIdx: number[]
    moodChangeIdx: number[]
  }) => void
  setReviewNextType: (typeId: string | null) => void
  rerollReviewType: () => Promise<void>
  /** 現在の方向性で次シーン候補だけを再生成する */
  regenerateSuggestions: () => Promise<void>
  cancelReview: () => void
  /** 直近のアシスタント応答に対して選択肢を手動で生成し直す */
  regenChoices: () => Promise<void>
  /** 選択肢に付いた小刻み加点（P5）を適用する（clamp加算＋実績再評価・通知） */
  applyChoiceEffects: (effects: ChoiceEffect[]) => void
  /** 状態パネルの手動編集を保存する（スタットを clamp・実績を再評価して通知） */
  applyStatusEdit: (state: SessionState) => void

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
  /** 本編生成の停止（選択肢・レビュー生成には影響しない） */
  stop: () => void
  /** 選択肢生成の停止（本編には影響しない） */
  stopChoices: () => void
  /** レビュー生成（シーン整理・次シーン候補の再生成）の停止 */
  stopReview: () => void

  // 挿絵
  addIllustration: (sessionId: string, sceneId: string, ill: SceneIllustration) => void
  removeIllustration: (sessionId: string, sceneId: string, illId: string) => void
  /** シーン背景を外す（参照除去のみ。実体回収は GC 一本化により gcUnusedImages に任せる） */
  removeSceneBackground: (sessionId: string, sceneId: string) => void

  // 画像生成ジョブ（V2・バックグラウンド生成）
  /** ジョブを起動し fire-and-forget で直列生成を回す。jobId を返す */
  startImageJob: (args: {
    label: string
    target: ImageJobTarget
    providerId: string
    prompt: string
    negative?: string
    width: number
    height: number
    count: number
  }) => string
  cancelImageJob: (jobId: string) => void
  dismissImageJob: (jobId: string) => void
  dismissImageJobToasts: () => void
  /** 候補から採用。保存先は target で分岐（挿絵/キャラアバター/ペルソナアバター/立ち絵/背景）し、完了後ジョブを自動 dismiss */
  applyImageJobResult: (jobId: string, index: number) => Promise<void>
  /** 立ち絵セットの一括生成（V4）。6感情ぶんのジョブを前を待って順番に起動する（ComfyUI が並列に弱いため） */
  startSpriteBatch: (args: {
    characterId: string
    characterName: string
    providerId: string
    prompts: { emotion: EmotionId; prompt: string }[]
    negative?: string
    width: number
    height: number
  }) => void
  /** 表情判定（V4・方式A）。runCompletion の正常完了後に fire-and-forget で呼ぶ */
  classifyEmotions: (sessionId: string) => Promise<void>

  // データ入出力
  /** includeImages=true で使用中の画像（アバター・立ち絵・挿絵・背景）を base64 同梱する（T0） */
  exportBundle: (includeImages?: boolean) => Promise<ExportBundle>
  importBundle: (bundle: ExportBundle) => Promise<{ added: number }>
  /** セッションカード（aist_session）の取り込み。同梱画像を putImage し直して参照を remap する */
  importSessionCard: (bundle: SessionCardBundle) => Promise<void>
  /** 未使用のアバター・挿絵画像（IndexedDB）を削除し、削除件数を返す */
  gcUnusedImages: () => Promise<number>
}

// 生成の中断は用途別に独立させる。単一の共有 controller だと、選択肢生成の中止が
// 並行中の本編生成を巻き込む（またはその逆で中断が空振りする）ため分離する。
let mainController: AbortController | null = null
let choicesController: AbortController | null = null
let reviewController: AbortController | null = null

// チェックポイント書き込みの直列化（セッションごと。fire-and-forget での順序逆転を防ぐ。C1）
const checkpointWriteChains = new Map<string, Promise<void>>()
function serializeCheckpointWrite(sessionId: string, fn: () => Promise<void>): Promise<void> {
  const prev = checkpointWriteChains.get(sessionId) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  checkpointWriteChains.set(sessionId, next)
  return next
}

/** チェックポイント比較用の安定した JSON（updatedAt はチェックポイント無関係の書換で変わるため除外） */
function stableSessionJson(s: Session): string {
  return JSON.stringify({ ...s, updatedAt: 0 })
}

/** 現在パス（ルート→currentId）のノード id 集合（C2。削除保護・「この分岐だけ残す」に使う） */
function currentPathIds(tree: BranchTree): Set<string> {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]))
  const ids = new Set<string>()
  let id: string | null = tree.currentId
  while (id) {
    ids.add(id)
    id = byId.get(id)?.parentId ?? null
  }
  return ids
}

/** 指定ノード自身とその子孫すべての id（C2。サブツリー削除に使う） */
function subtreeNodeIds(tree: BranchTree, rootId: string): string[] {
  const childrenOf = new Map<string, string[]>()
  for (const n of tree.nodes) {
    if (n.parentId) {
      const arr = childrenOf.get(n.parentId) ?? []
      arr.push(n.id)
      childrenOf.set(n.parentId, arr)
    }
  }
  const out: string[] = []
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop()!
    out.push(id)
    for (const c of childrenOf.get(id) ?? []) stack.push(c)
  }
  return out
}

function headOf(text: string, max = 24): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** 小ポイント（action）のラベルを、現在のセッション末尾の発言から決める */
function actionCheckpointLabel(session: Session): string {
  const lastUser = [...session.messages].reverse().find((m) => m.role === 'user')
  if (lastUser) {
    if (lastUser.content === SCENE_START_PROMPT) return '🎬 シーン導入'
    if (lastUser.content === CONTINUE_PROMPT) return '⏩ 続き'
    if (lastUser.content.trim()) return headOf(plainTextOf(lastUser.content))
  }
  const lastAssistant = [...session.messages].reverse().find((m) => m.role === 'assistant')
  if (lastAssistant?.content.trim()) return headOf(plainTextOf(lastAssistant.content))
  return '（無題）'
}

/**
 * 状態（関係性 prose ＋ 気分 ＋ 注入対象スタット）をプロンプト用テキストに整形（空なら ''）。
 * 関係性は prose（LLM が読む）、スタットは inject:true のものだけ数値を併記。
 */
function buildStateInfo(session: Session, characters: Character[], world?: World): string {
  const relations = session.state?.relations ?? []
  const moods = session.state?.moods ?? []
  const stats = session.state?.stats ?? []
  const counters = session.state?.counters ?? []
  const nameOf = (id: string) => characters.find((c) => c.id === id)?.name ?? 'キャラ'
  const aspectName = (id: string) => world?.relationAspects.find((a) => a.id === id)?.name ?? ''
  const moodOf = (id: string) => moods.find((m) => m.characterId === id)?.mood

  const lines: string[] = []
  // 関係性 prose（キャラ→主人公）
  for (const r of relations) {
    if (!r.stance.trim() && r.aspects.every((a) => !a.note.trim())) continue
    lines.push(`- ${nameOf(r.fromId)} → 主人公: ${r.stance.trim()}`)
    for (const a of r.aspects) {
      const an = aspectName(a.aspectId)
      if (an && a.note.trim()) lines.push(`    ${an}: ${a.note.trim()}`)
    }
    const mood = moodOf(r.fromId)
    if (mood) lines.push(`  気分: ${mood}`)
  }
  // 関係性を持たないキャラの気分のみ
  for (const m of moods) {
    if (!relations.some((r) => r.fromId === m.characterId)) {
      lines.push(`- ${nameOf(m.characterId)}: 気分 ${m.mood}`)
    }
  }
  // 注入対象スタット
  const injected = stats.filter((s) => world?.stats.find((d) => d.id === s.defId)?.inject)
  if (injected.length > 0) {
    const parts = injected.map((s) => {
      const def = world!.stats.find((d) => d.id === s.defId)!
      const who = s.characterId ? `${nameOf(s.characterId)} ` : ''
      return `${who}${def.name} ${s.value}`
    })
    lines.push(`【ステータス】 ${parts.join(' / ')}`)
  }
  // 注入対象カウンター
  const injCounters = counters.filter((c) => world?.counters.find((d) => d.id === c.defId)?.inject)
  if (injCounters.length > 0) {
    const parts = injCounters.map((c) => {
      const def = world!.counters.find((d) => d.id === c.defId)!
      const who = c.characterId ? `${nameOf(c.characterId)} ` : ''
      return `${who}${def.name} ${c.value}`
    })
    lines.push(`【カウンター】 ${parts.join(' / ')}`)
  }
  return lines.join('\n')
}

/**
 * ディレクター：次シーンの方向を決める。
 * ①特別イベント（未消化かつ day 到来かつ条件成立）を最優先 → ②重み＋クールダウンで抽選。
 * イベントは人の承認なしでコードが自動判定して発火する（ADR-1）。
 */
function directNextScene(
  session: Session,
  world: World | undefined,
  sceneTypes: SceneType[],
  nextDay: number | null,
  skipEvents = false,
): { typeId?: string; eventId?: string; eventName?: string } {
  // ① 特別イベント（day 未指定は日付条件なし。条件式は数・フラグ・実績のみで判定）
  //    skipEvents=true は「種類のみ抽選」（引き直し用。イベント判定を行わない）
  if (world && !skipEvents) {
    const ev = (world.scheduledEvents ?? [])
      .filter((e) => {
        if (session.usedEventIds.includes(e.id)) return false
        if (e.day != null && (nextDay == null || e.day > nextDay)) return false
        if (e.condition && !evalCondition(e.condition, session.state, world, session.characterIds))
          return false
        return true
      })
      .sort((a, b) => (a.day ?? Infinity) - (b.day ?? Infinity))[0]
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

      async function writeCheckpointNode(sessionId: string, nodeId: string, session: Session): Promise<number> {
        const gz = await gzipText(JSON.stringify({ v: 1, session }))
        await checkpointStore.put(sessionId, nodeId, gz)
        return gz.byteLength
      }

      /**
       * チェックポイントを記録する（C1）。呼び出しは物語操作の完了直後（3契機に限定・store.ts 内に集約）。
       * beforeSession は「この操作を始める前」のセッション参照（各操作の冒頭で active()/session lookup
       * したものをそのまま渡す。immutable 更新のため参照は書き換わらない）。
       * - 木が空なら beforeSession をルート（label「開始時点」）として先に積む（ルートの遅延生成）。
       * - beforeSession と実質無変化（updatedAt 以外が完全一致）なら積まない（dedupe）。
       * - 書き込みは sessionId ごとに直列化し、順序逆転を防ぐ。
       */
      async function recordCheckpoint(
        sessionId: string,
        kind: 'action' | 'scene',
        label: string,
        beforeSession: Session | undefined,
        timeLabel?: string,
      ): Promise<void> {
        await serializeCheckpointWrite(sessionId, async () => {
          const session = get().sessions.find((s) => s.id === sessionId)
          if (!session) return
          let tree = get().branchTrees[sessionId]
          if (!tree || tree.nodes.length === 0) {
            const rootSession = beforeSession ?? session
            const rootId = uid()
            const bytes = await writeCheckpointNode(sessionId, rootId, rootSession)
            const rootNode: BranchNode = {
              id: rootId,
              parentId: null,
              kind: 'scene',
              label: '開始時点',
              createdAt: Date.now(),
              imageIds: sessionImageIds(rootSession),
              bytes,
            }
            tree = { currentId: rootId, nodes: [rootNode] }
            set((st) => ({ branchTrees: { ...st.branchTrees, [sessionId]: tree! } }))
          }
          if (beforeSession && stableSessionJson(beforeSession) === stableSessionJson(session)) return
          const nodeId = uid()
          const bytes = await writeCheckpointNode(sessionId, nodeId, session)
          const node: BranchNode = {
            id: nodeId,
            parentId: tree.currentId,
            kind,
            label,
            timeLabel,
            createdAt: Date.now(),
            imageIds: sessionImageIds(session),
            bytes,
          }
          set((st) => {
            const cur = st.branchTrees[sessionId] ?? tree!
            return { branchTrees: { ...st.branchTrees, [sessionId]: { currentId: nodeId, nodes: [...cur.nodes, node] } } }
          })
        })
      }

      /** 素材（World/Character）にセッションのオーバーレイ（発見ロア・キャラ成長）を合成した実効ビューを返す */
      function effectiveWorld(world: World | undefined, overlay: Session['overlay']): World | undefined {
        if (!world) return undefined
        const extra = overlay?.lore ?? []
        return extra.length ? { ...world, entries: [...world.entries, ...extra] } : world
      }
      function effectiveCharacter(c: Character, overlay: Session['overlay']): Character {
        const ov = overlay?.characterDevelopments.find((x) => x.characterId === c.id)
        return ov && ov.developments.length
          ? { ...c, developments: [...c.developments, ...ov.developments] }
          : c
      }

      function resolveRefs(session: Session): ResolvedRefs {
        const { characters, worlds, personas } = get()
        const scene = currentScene(session)
        // 登場キャラはシーンの active cast に限定（未設定ならセッションの全キャラ）
        const castIds =
          scene && scene.activeCharacterIds.length > 0
            ? scene.activeCharacterIds
            : session.characterIds
        const effWorld = effectiveWorld(
          worlds.find((w) => w.id === session.worldId),
          session.overlay,
        )
        return {
          characters: castIds
            .map((id) => characters.find((c) => c.id === id))
            .filter((c): c is Character => !!c)
            .map((c) => effectiveCharacter(c, session.overlay)),
          world: effWorld,
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
          stateInfo: buildStateInfo(session, characters, effWorld),
        }
      }

      async function runCompletion(
        speakerId?: string,
        appendToId?: string,
        extraUserNudge?: string,
      ): Promise<void> {
        const s = active()
        if (!s) return
        // 生成中にユーザーが別セッションへ切り替えても書き込み先がぶれないよう、対象セッションを固定する
        const sessionId = s.id
        const target = () => get().sessions.find((x) => x.id === sessionId)
        const patchTarget = (patch: Partial<Session>) => get().updateSession(sessionId, patch)

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

        mainController = new AbortController()
        set({ isStreaming: true, error: null })

        // 既存メッセージへ追記する場合はそれを対象に、そうでなければ空メッセージを新規追加
        const assistantId = appendToId ?? uid()
        if (appendToId) {
          patchTarget({
            messages: s.messages.map((m) =>
              m.id === appendToId ? { ...m, pending: true, truncated: false } : m,
            ),
          })
        } else {
          patchTarget({
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

        // 構造化出力のストリーミング表情切替（ST2）: 確定行（改行済み）が増えるたびに立ち絵の感情を反映する
        const structuredOn = !!s.structuredOutput
        const watchEmotions =
          structuredOn && !!s.spritesEnabled && refs.characters.some((c) => (c.sprites?.length ?? 0) > 0)
        let acc = appendToId ? (target()?.messages.find((m) => m.id === appendToId)?.content ?? '') : ''
        let processedLineCount = acc.split('\n').length - 1
        let emotionApplied = false

        const applyLineEmotions = (completedLines: string[]) => {
          const updates = emotionUpdatesOf(completedLines, refs.characters)
          if (updates.length === 0) return
          emotionApplied = true
          const cur = target()
          if (!cur) return
          const next = [...(cur.spriteEmotions ?? [])]
          for (const u of updates) {
            const idx = next.findIndex((e) => e.characterId === u.characterId)
            if (idx >= 0) next[idx] = u
            else next.push(u)
          }
          patchTarget({ spriteEmotions: next })
        }

        const writeDelta = (chunk: string) => {
          const cur = target()
          if (!cur) return
          patchTarget({
            messages: cur.messages.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + chunk } : m,
            ),
          })
          acc += chunk
          if (watchEmotions && chunk.includes('\n')) {
            const lines = acc.split('\n')
            const completed = lines.slice(0, -1)
            if (completed.length > processedLineCount) {
              applyLineEmotions(completed.slice(processedLineCount))
              processedLineCount = completed.length
            }
          }
        }

        // 「続きを生成」の念押しは履歴には積まず、API 送信時だけ末尾に付加する
        const buildRequestMessages = () => {
          const base = buildMessages(target()!, refs, speaker)
          return extraUserNudge ? [...base, { role: 'user' as const, content: extraUserNudge }] : base
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
                messages: buildRequestMessages(),
                temperature: s.temperature,
                maxTokens: s.maxTokens,
                signal: mainController.signal,
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

        if (watchEmotions) {
          const lines = acc.split('\n')
          applyLineEmotions(lines.slice(processedLineCount))
        }

        const cur = target()
        if (cur) {
          const msgs = cur.messages
            .map((m) => {
              if (m.id !== assistantId) return m
              let content = m.content
              let characterId = m.characterId
              if (structuredOn) {
                // 構造化出力ON: 最初の @ 行の話者を代表 characterId に採用する（名前: 剥がしはしない＝ @ 行を壊さない）
                if (!novel && !characterId && refs.characters.length > 1) {
                  const first = parseStructured(content, refs.characters).find((l) => l.kind === 'dialogue')
                  if (first?.characterId) characterId = first.characterId
                }
              } else if (!novel && !characterId && refs.characters.length > 1) {
                // おまかせ(会話劇・複数キャラ・話者未指定)時は先頭の「名前:」から話者を判定
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
          patchTarget({ messages: msgs })
        }
        mainController = null
        set({ isStreaming: false })

        // 選択肢の生成（off 以外、かつ応答が生成された場合）
        const after = target()
        const finalMsg = after?.messages.find((m) => m.id === assistantId)
        if (after && finalMsg && finalMsg.content.trim() && after.choiceMode !== 'off') {
          await genChoices(after, assistantId)
        }
        // チェックポイント記録（C1）。中断（Abort）・エラー終了時は finishReason が null のままなので積まない
        if (finishReason !== null) {
          const finalSession = target()
          if (finalSession) void recordCheckpoint(sessionId, 'action', actionCheckpointLabel(finalSession), s)
        }
        // 表情判定（V4・方式A）。構造化出力で1件でも感情が取れた応答ではスキップ（ST2のフォールバック）
        if (finalMsg && finalMsg.content.trim() && !emotionApplied) {
          get().classifyEmotions(sessionId)
        }
      }

      /** 直近のアシスタント応答に対する選択肢を生成して付与 */
      async function genChoices(session: Session, messageId: string): Promise<void> {
        const { provider, model } = parseModelRef(choicesModelOf(session), get().providers)
        if (!provider?.apiKey.trim()) {
          console.warn(
            `[choices] 選択肢用モデルの接続先「${provider?.label ?? '?'}」にAPIキーが無いため生成をスキップしました。設定で選択肢用モデル/キーを確認してください。`,
          )
          return
        }
        const mode = session.choiceMode === 'auto' ? 'auto' : 'always'
        set({ isGeneratingChoices: true })
        try {
          const refs = resolveRefs(session)
          const world = refs.world
          // 本編に注入しないスタットも含め、ワールド定義の名前で effects を拘束する
          const statNames = (world?.stats ?? []).map((d) => d.name).filter(Boolean)
          const base = buildMessages(session, refs)
          // 末尾に user の念押しを積み、本編の続き（地の文）ではなく JSON を出させる
          const msgs = [
            { role: 'system' as const, content: choicesSystem(mode, statNames) },
            ...base.slice(1),
            { role: 'user' as const, content: choicesUserNudge(mode) },
          ]
          // always はモデルが本編を続けてしまうことがあるため最大2回試行（auto の空配列は正当なので1回）
          // truncated（途中切れ）の場合も抽出漏れの原因になるため再試行対象に含める。
          // ただし再試行で結果が悪化しても、それまでの最良の結果（最も多く抽出できたもの）を採用する。
          const maxAttempts = mode === 'always' ? 2 : 1
          let choices: Choice[] = []
          let bestChoices: Choice[] = []
          choicesController = new AbortController()
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const raw = await streamChat(
              { provider, model, messages: msgs, temperature: 0.5, maxTokens: 600, signal: choicesController.signal },
              () => {},
            )
            const parsedChoices = coerceChoices(extractJson<unknown>(raw.text), world, refs.characters)
            if (parsedChoices.length > bestChoices.length) bestChoices = parsedChoices
            const truncated = raw.finishReason === 'length'
            if (parsedChoices.length > 0 && !truncated) {
              choices = parsedChoices
              break
            }
            if (mode === 'always' || truncated) {
              console.warn(
                `[choices] ${truncated ? '出力が途中で切れました' : '選択肢を抽出できませんでした'}（試行${attempt}/${maxAttempts}）。モデル出力:`,
                raw.text || '<empty>',
              )
            }
          }
          if (choices.length === 0) choices = bestChoices
          if (choices.length > 0) {
            // 生成中に別セッションへ切り替えていても、対象セッションのメッセージへ付与する
            const cur = get().sessions.find((x) => x.id === session.id)
            if (cur) {
              get().updateSession(cur.id, {
                messages: cur.messages.map((m) =>
                  m.id === messageId ? { ...m, choices } : m,
                ),
              })
            }
          }
        } catch (e) {
          // 選択肢は失敗しても本編には影響させない（診断用にのみ記録。中止は正常系なので黙る）
          if ((e as Error)?.name !== 'AbortError') {
            console.warn('[choices] 生成に失敗:', (e as Error)?.message)
          }
        } finally {
          choicesController = null
          set({ isGeneratingChoices: false })
        }
      }

      /**
       * 画像生成ジョブ1件分の直列生成ループ（startImageJob と startSpriteBatch の共通処理）。
       * ジョブは呼び出し側が事前に imageJobs へ追加済みであること。完了まで待つ Promise を返す
       * （バッチ生成は前のジョブがこれを await し終えてから次を起動する）。
       */
      async function runImageJobLoop(
        id: string,
        args: { providerId: string; prompt: string; negative?: string; width: number; height: number; count: number },
      ): Promise<void> {
        const ctrl = new AbortController()
        registerJobAbort(id, ctrl)
        let lastError: string | undefined
        for (let i = 0; i < args.count; i++) {
          const cur = get().imageJobs.find((j) => j.id === id)
          if (!cur || cur.status === 'canceled') break
          const provider = get().imageProviders.find((p) => p.id === args.providerId)
          if (!provider) {
            lastError = '画像生成の接続先が見つかりません（削除された可能性があります）。'
            break
          }
          try {
            const blob = await generateImage(
              provider,
              { prompt: args.prompt, negative: args.negative, width: args.width, height: args.height },
              ctrl.signal,
            )
            set((st) => ({
              imageJobs: st.imageJobs.map((j) => (j.id === id ? { ...j, results: [...j.results, blob] } : j)),
            }))
          } catch (e) {
            if ((e as Error).name === 'AbortError') {
              clearJobAbort(id)
              set((st) => ({
                imageJobs: st.imageJobs.map((j) => (j.id === id ? { ...j, status: 'canceled' as const } : j)),
              }))
              return
            }
            lastError = (e as Error).message
            break
          }
        }
        clearJobAbort(id)
        const finished = get().imageJobs.find((j) => j.id === id)
        if (!finished || finished.status === 'canceled') return
        const status = finished.results.length > 0 ? ('selecting' as const) : ('error' as const)
        set((st) => ({
          imageJobs: st.imageJobs.map((j) => (j.id === id ? { ...j, status, error: lastError } : j)),
        }))
        if (status === 'selecting') {
          set((st) => ({ imageJobToasts: [...st.imageJobToasts, { jobId: id, label: finished.label }] }))
        }
      }

      return {
        providers: [defaultOpenRouterProvider('')],
        imageProviders: [],
        lastImageProviderId: undefined,
        lastDraftModel: undefined,
        favoriteModels: [],
        characters: [],
        worlds: [],
        personas: [],
        sceneTypes: defaultSceneTypes(),
        sessions: [],
        activeId: null,
        branchTrees: {},
        ui: DEFAULT_UI,

        view: 'sessions',
        modelsByProvider: {},
        modelsLoadingFor: null,
        isStreaming: false,
        isGeneratingChoices: false,
        isReviewing: false,
        isClassifyingEmotions: false,
        isRegenSuggestions: false,
        sceneReview: null,
        error: null,
        newlyUnlockedAchievements: [],
        imageJobs: [],
        imageJobToasts: [],

        setView: (view) => set({ view }),
        clearError: () => set({ error: null }),
        dismissNewAchievements: () => set({ newlyUnlockedAchievements: [] }),
        setUiPrefs: (patch) => set((s) => ({ ui: { ...s.ui, ...patch } })),

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

        upsertImageProvider: (p) =>
          set((st) => ({
            imageProviders: st.imageProviders.some((x) => x.id === p.id)
              ? st.imageProviders.map((x) => (x.id === p.id ? p : x))
              : [...st.imageProviders, p],
          })),

        deleteImageProvider: (id) =>
          set((st) => ({ imageProviders: st.imageProviders.filter((p) => p.id !== id) })),

        setLastImageProviderId: (id) => set({ lastImageProviderId: id }),
        setLastDraftModel: (ref) => set({ lastDraftModel: ref }),

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
            const prev = st.characters.find((x) => x.id === c.id)
            // sprites は store 直接管理（書き手は setCharacterSprite / applyImageJobResult のみ）。
            // エディタ draft のスナップショットで上書きすると、編集中に生成・解除した立ち絵が
            // 巻き戻る（消える / deleteImage 済みの imageId が復活する）ため、既存キャラでは常に
            // store 側の sprites を保持する。
            const updated = { ...c, ...(prev ? { sprites: prev.sprites } : {}), updatedAt: Date.now() }
            return {
              characters: prev
                ? st.characters.map((x) => (x.id === c.id ? updated : x))
                : [updated, ...st.characters],
            }
          }),

        importCharacterCard: (c) =>
          set((st) => {
            const idTaken = st.characters.some((x) => x.id === c.id)
            const now = Date.now()
            const fresh = idTaken ? { ...c, id: uid(), createdAt: now, updatedAt: now } : c
            return { characters: [fresh, ...st.characters] }
          }),

        deleteCharacter: (id) =>
          set((st) => ({
            characters: st.characters.filter((c) => c.id !== id),
            // 参照の残骸を全セッションから掃除する（残すと buildStateInfo が
            // 削除済みキャラの関係を「キャラ」名義で本編プロンプトに注入し続ける）
            sessions: st.sessions.map((s) => ({
              ...s,
              characterIds: s.characterIds.filter((cid) => cid !== id),
              scenes: s.scenes.map((sc) => ({
                ...sc,
                activeCharacterIds: sc.activeCharacterIds.filter((cid) => cid !== id),
              })),
              state: {
                ...s.state,
                relations: s.state.relations.filter((r) => r.fromId !== id && r.toId !== id),
                moods: s.state.moods.filter((m) => m.characterId !== id),
                stats: s.state.stats.filter((v) => v.characterId !== id),
                counters: s.state.counters.filter((v) => v.characterId !== id),
              },
              overlay: {
                ...s.overlay,
                characterDevelopments: s.overlay.characterDevelopments.filter(
                  (x) => x.characterId !== id,
                ),
              },
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

        setCharacterSprite: async (characterId, emotion, imageId) => {
          const character = get().characters.find((c) => c.id === characterId)
          if (!character) return
          // 旧 imageId の実体削除はしない（GC 一本化。分岐チェックポイントが参照している可能性があるため
          // 参照を外すだけにとどめ、回収は gcUnusedImages に任せる）
          set((st) => ({
            characters: st.characters.map((c) =>
              c.id !== characterId
                ? c
                : {
                    ...c,
                    sprites: imageId
                      ? [...(c.sprites ?? []).filter((s) => s.emotion !== emotion), { emotion, imageId }]
                      : (c.sprites ?? []).filter((s) => s.emotion !== emotion),
                    updatedAt: Date.now(),
                  },
            ),
          }))
        },

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

        importWorldCard: (w) =>
          set((st) => {
            const idTaken = st.worlds.some((x) => x.id === w.id)
            const now = Date.now()
            const fresh = idTaken ? { ...w, id: uid(), createdAt: now, updatedAt: now } : w
            return { worlds: [fresh, ...st.worlds] }
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

        importPersonaCard: (p) =>
          set((st) => {
            const idTaken = st.personas.some((x) => x.id === p.id)
            const now = Date.now()
            const fresh = idTaken ? { ...p, id: uid(), createdAt: now, updatedAt: now } : p
            return { personas: [fresh, ...st.personas] }
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

        deleteSession: (id) => {
          set((st) => {
            const sessions = st.sessions.filter((s) => s.id !== id)
            const activeId = st.activeId === id ? (sessions[0]?.id ?? null) : st.activeId
            const branchTrees = { ...st.branchTrees }
            delete branchTrees[id]
            return { sessions, activeId, branchTrees }
          })
          void checkpointStore.deleteSession(id)
        },

        setActive: (id) => set({ activeId: id, view: 'sessions' }),

        updateSession: (id, patch) =>
          set((st) => ({
            sessions: st.sessions.map((s) =>
              s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s,
            ),
          })),

        resolveRefs,

        restoreCheckpoint: async (sessionId, nodeId) => {
          if (get().isStreaming || get().isGeneratingChoices || get().isReviewing) {
            throw new Error('生成中は復元できません。生成の完了・停止後にもう一度お試しください。')
          }
          const cur = get().sessions.find((s) => s.id === sessionId)
          if (!cur) return
          const raw = await checkpointStore.get(sessionId, nodeId)
          if (!raw) throw new Error('チェックポイントが見つかりません。')
          const parsed = JSON.parse(await gunzipText(raw)) as { v: number; session: Session }
          // プレイ用ノブだけ現在値を維持（passthrough）。それ以外はスナップショットから復元する
          const restored: Session = {
            ...parsed.session,
            title: cur.title,
            model: cur.model,
            reviewModel: cur.reviewModel,
            choicesModel: cur.choicesModel,
            temperature: cur.temperature,
            maxTokens: cur.maxTokens,
            spritesEnabled: cur.spritesEnabled,
            updatedAt: Date.now(),
          }
          set((st) => ({
            sessions: st.sessions.map((s) => (s.id === sessionId ? restored : s)),
            sceneReview: null,
            branchTrees: {
              ...st.branchTrees,
              [sessionId]: {
                currentId: nodeId,
                nodes: st.branchTrees[sessionId]?.nodes ?? [],
              },
            },
          }))
        },

        deleteBranchSubtree: async (sessionId, nodeId) => {
          const tree = get().branchTrees[sessionId]
          if (!tree) return
          if (currentPathIds(tree).has(nodeId)) {
            throw new Error('現在の分岐上のノードは削除できません。')
          }
          const toDelete = subtreeNodeIds(tree, nodeId)
          const toDeleteSet = new Set(toDelete)
          set((st) => {
            const t = st.branchTrees[sessionId]
            if (!t) return {}
            return {
              branchTrees: {
                ...st.branchTrees,
                [sessionId]: { ...t, nodes: t.nodes.filter((n) => !toDeleteSet.has(n.id)) },
              },
            }
          })
          await Promise.all(toDelete.map((id) => checkpointStore.delete(sessionId, id)))
        },

        pruneToCurrentPath: async (sessionId) => {
          const tree = get().branchTrees[sessionId]
          if (!tree) return
          const keep = currentPathIds(tree)
          const toDelete = tree.nodes.filter((n) => !keep.has(n.id)).map((n) => n.id)
          if (toDelete.length === 0) return
          set((st) => {
            const t = st.branchTrees[sessionId]
            if (!t) return {}
            return {
              branchTrees: {
                ...st.branchTrees,
                [sessionId]: { ...t, nodes: t.nodes.filter((n) => keep.has(n.id)) },
              },
            }
          })
          await Promise.all(toDelete.map((id) => checkpointStore.delete(sessionId, id)))
        },

        setBranchStar: async (sessionId, nodeId, name) => {
          const tree = get().branchTrees[sessionId]
          const node = tree?.nodes.find((n) => n.id === nodeId)
          if (!tree || !node) return
          let thumbImageId: string | undefined
          try {
            const raw = await checkpointStore.get(sessionId, nodeId)
            if (raw) {
              const parsed = JSON.parse(await gunzipText(raw)) as { v: number; session: Session }
              thumbImageId = pickThumbFromSnapshot(parsed.session)
            }
          } catch {
            // サムネイル取得に失敗しても名前だけは保存する
          }
          set((st) => {
            const t = st.branchTrees[sessionId]
            if (!t) return {}
            return {
              branchTrees: {
                ...st.branchTrees,
                [sessionId]: {
                  ...t,
                  nodes: t.nodes.map((n) => (n.id === nodeId ? { ...n, star: { name, thumbImageId } } : n)),
                },
              },
            }
          })
        },

        removeBranchStar: (sessionId, nodeId) =>
          set((st) => {
            const t = st.branchTrees[sessionId]
            if (!t) return {}
            return {
              branchTrees: {
                ...st.branchTrees,
                [sessionId]: {
                  ...t,
                  nodes: t.nodes.map((n) => (n.id === nodeId ? { ...n, star: undefined } : n)),
                },
              },
            }
          }),

        cleanupOrphanCheckpoints: async () => {
          for (const [sessionId, tree] of Object.entries(get().branchTrees)) {
            const known = new Set(tree.nodes.map((n) => n.id))
            let actual: string[]
            try {
              actual = await checkpointStore.listNodeIds(sessionId)
            } catch {
              continue
            }
            const orphans = actual.filter((id) => !known.has(id))
            if (orphans.length > 0) {
              await Promise.all(orphans.map((id) => checkpointStore.delete(sessionId, id)))
            }
          }
        },

        promoteOverlayLore: (sessionId, entry) =>
          set((st) => {
            const sess = st.sessions.find((s) => s.id === sessionId)
            // overlay に該当項目が実在する場合のみ昇格（渡された entry はローカル編集済みの内容を優先して使う）
            if (!sess || !sess.worldId || !sess.overlay.lore.some((e) => e.id === entry.id)) return {}
            return {
              worlds: st.worlds.map((w) =>
                w.id === sess.worldId
                  ? { ...w, entries: [...w.entries, { ...entry, order: w.entries.length }], updatedAt: Date.now() }
                  : w,
              ),
              sessions: st.sessions.map((s) =>
                s.id === sessionId
                  ? { ...s, overlay: { ...s.overlay, lore: s.overlay.lore.filter((e) => e.id !== entry.id) } }
                  : s,
              ),
            }
          }),

        promoteOverlayDev: (sessionId, characterId, dev) =>
          set((st) => {
            const sess = st.sessions.find((s) => s.id === sessionId)
            const group = sess?.overlay.characterDevelopments.find((x) => x.characterId === characterId)
            if (!sess || !group?.developments.some((d) => d.id === dev.id)) return {}
            return {
              characters: st.characters.map((c) =>
                c.id === characterId
                  ? { ...c, developments: [...c.developments, dev], updatedAt: Date.now() }
                  : c,
              ),
              sessions: st.sessions.map((s) =>
                s.id === sessionId
                  ? {
                      ...s,
                      overlay: {
                        ...s.overlay,
                        characterDevelopments: s.overlay.characterDevelopments.map((x) =>
                          x.characterId === characterId
                            ? { ...x, developments: x.developments.filter((d) => d.id !== dev.id) }
                            : x,
                        ),
                      },
                    }
                  : s,
              ),
            }
          }),

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

          // 過去シーンの再レビューかどうか（登場キャラ・時刻の文脈組み立てを分岐させる）
          const isPastScene = scene.id !== s.currentSceneId
          set({ isReviewing: true, error: null })
          try {
            // resolveRefs はセッションの currentSceneId を見て登場キャラ・状況メモを決めるため、
            // 過去シーンの再レビューでは対象シーンを一時的に current 扱いにして正しい文脈を得る
            // （そうしないと「今アクティブなシーン」の登場キャラ・状況メモが誤って使われる）。
            const refs = isPastScene ? resolveRefs({ ...s, currentSceneId: scene.id }) : resolveRefs(s)
            const nameOf = (id?: string) =>
              get().characters.find((c) => c.id === id)?.name ?? 'キャラ'
            const transcript = sceneMsgs
              .map((m) =>
                m.role === 'user'
                  ? `${refs.persona?.name || 'ユーザー'}: ${m.content}`
                  : `${nameOf(m.characterId)}: ${plainTextOf(m.content)}`,
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

            // 次シーンの時刻を明示。過去シーンの再レビューでは、ライブの現在タイムラインを
            // 進めるのではなく、既に存在する次シーンの時刻ラベルをそのまま使う
            // （ライブの現在日はそのシーンの時点よりずっと先に進んでいる可能性があるため）。
            const sceneIdxForCtx = s.scenes.findIndex((sc) => sc.id === scene.id)
            const existingNextScene = isPastScene ? s.scenes[sceneIdxForCtx + 1] : undefined
            const nextTimeline = !isPastScene && s.timeline.enabled ? advanceTimeline(s.timeline) : null
            const nextTimeLabel = isPastScene
              ? existingNextScene?.timeLabel
              : nextTimeline
                ? timeLabelOf(nextTimeline)
                : undefined
            if (nextTimeLabel) {
              ctxParts.push(
                `【次シーンの時間】このシーンが終わると時間帯が一区切り進み、次シーンは「${nextTimeLabel}」になります。suggestions は時間が経過した後の場面として、その時刻にふさわしい状況で書いてください（直前の場面の続きをそのまま続けない）。`,
              )
            }

            // ディレクター：次シーンの方向を決定（イベント優先→抽選）。
            // 過去シーンの再レビューでは実際の履歴上の日付・状態が分からないため、
            // ライブの現在日での日付/条件付きイベント判定は行わず種類のみ抽選する。
            const nextDay = !isPastScene && nextTimeline ? nextTimeline.currentDay : null
            const pick = directNextScene(s, refs.world, get().sceneTypes, nextDay, isPastScene)
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

            // ワールド固定の関係次元・ステータス名（レビューを拘束）
            const world = refs.world
            const aspectNames = (world?.relationAspects ?? []).map((a) => a.name).filter(Boolean)
            const statNames = (world?.stats ?? []).map((d) => d.name).filter(Boolean)
            const counterNames = (world?.counters ?? []).map((d) => d.name).filter(Boolean)

            // 現在の関係性 prose（レビューが書き直すための起点）
            const relNow = (s.state?.relations ?? [])
              .map((r) => {
                const who = get().characters.find((c) => c.id === r.fromId)?.name ?? 'キャラ'
                const asp = r.aspects
                  .map((a) => {
                    const an = world?.relationAspects.find((x) => x.id === a.aspectId)?.name
                    return an && a.note.trim() ? `${an}: ${a.note.trim()}` : ''
                  })
                  .filter(Boolean)
                  .join(' / ')
                return `- ${who}→主人公: ${r.stance}${asp ? `（${asp}）` : ''}`
              })
              .join('\n')
            const relBlock = relNow ? `\n\n【現在の関係性】\n${relNow}` : ''

            const reviewMessages = [
              { role: 'system' as const, content: reviewSystem(aspectNames, statNames, counterNames) },
              {
                role: 'user' as const,
                content: `${context}${relBlock}\n\n【シーン「${scene.title}」の会話】\n${transcript}`,
              },
            ]
            // max_tokens は打ち切り上限であり、モデルは書き終われば自然に停止するため
            // 十分大きく取っても無駄な出力やコスト増にはならない（長大な JSON でも途中で切れないように余裕を持たせる）。
            const REVIEW_MAX_TOKENS = 8000
            const maxAttempts = 2
            let raw: Awaited<ReturnType<typeof streamChat>> | null = null
            let parsed: any = null
            const hasSummary = (p: any) =>
              (typeof p?.summary === 'string' && p.summary.trim().length > 0) ||
              (Array.isArray(p?.summary) && p.summary.length > 0)
            reviewController = new AbortController()
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
              raw = await streamChat(
                {
                  provider,
                  model,
                  messages: reviewMessages,
                  temperature: 0.4,
                  maxTokens: REVIEW_MAX_TOKENS,
                  signal: reviewController.signal,
                },
                () => {},
              )
              parsed = extractJson<any>(raw.text)
              const truncated = raw.finishReason === 'length'
              if (parsed && !truncated && hasSummary(parsed)) break
              if (truncated) {
                console.warn(`[review] 出力が途中で切れました（試行${attempt + 1}/${maxAttempts}）。再試行します。`)
              } else if (!parsed) {
                console.warn(`[review] JSON を抽出できませんでした（試行${attempt + 1}/${maxAttempts}）。モデル出力:`, raw.text || '<empty>')
              } else if (!hasSummary(parsed)) {
                console.warn(`[review] summary フィールドが空でした（試行${attempt + 1}/${maxAttempts}）。再試行します。`)
              }
            }
            if (!parsed) {
              set({ error: 'シーンの整理に失敗しました（モデル出力の解釈に失敗）。もう一度お試しください。' })
              return
            }
            if (!hasSummary(parsed)) {
              console.warn('[review] リトライしても summary が空のため、要約は空欄になります。手動で編集してください。')
            }
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
                return ''
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
              relationUpdates: Array.isArray(parsed?.relationUpdates)
                ? parsed.relationUpdates
                    .map((x: any) => {
                      const fromName = String(x?.character ?? x?.name ?? '')
                      const aspects = Array.isArray(x?.aspects)
                        ? x.aspects
                            .map((a: any) => {
                              const def = (world?.relationAspects ?? []).find(
                                (d) => d.name === String(a?.name ?? '').trim(),
                              )
                              return def
                                ? {
                                    aspectId: def.id,
                                    name: def.name,
                                    note: String(a?.note ?? '').trim(),
                                  }
                                : null
                            })
                            .filter(
                              (a: any): a is { aspectId: string; name: string; note: string } =>
                                !!a && !!a.note,
                            )
                        : []
                      return {
                        fromId: findId(fromName) ?? '',
                        fromName,
                        toId: 'hero',
                        toName: refs.persona?.name?.trim() || '主人公',
                        stance: String(x?.stance ?? '').trim(),
                        aspects,
                        flagsAdd: Array.isArray(x?.flagsAdd)
                          ? x.flagsAdd.map((f: any) => String(f).trim()).filter(Boolean)
                          : [],
                        reason: String(x?.reason ?? ''),
                      }
                    })
                    .filter((u: any) => u.fromId && (u.stance || u.aspects.length > 0))
                : [],
              statChanges: Array.isArray(parsed?.statChanges)
                ? parsed.statChanges
                    .map((x: any) => {
                      const def = (world?.stats ?? []).find(
                        (d) => d.name === String(x?.name ?? '').trim(),
                      )
                      if (!def) return null
                      const charName = x?.character ? String(x.character) : undefined
                      const characterId =
                        def.scope === 'character' && charName ? findId(charName) : undefined
                      if (def.scope === 'character' && !characterId) return null
                      return {
                        defId: def.id,
                        name: def.name,
                        characterId,
                        charName: def.scope === 'character' ? charName : undefined,
                        delta: Math.max(-1_000_000, Math.min(1_000_000, Math.round(Number(x?.delta) || 0))),
                        reason: String(x?.reason ?? ''),
                      }
                    })
                    .filter((c: any): c is NonNullable<typeof c> => !!c && c.delta !== 0)
                : [],
              counterEvents: Array.isArray(parsed?.counterEvents)
                ? parsed.counterEvents
                    .map((x: any) => {
                      const def = (world?.counters ?? []).find(
                        (d) => d.name === String(x?.name ?? '').trim(),
                      )
                      if (!def) return null
                      const charName = x?.character ? String(x.character) : undefined
                      const characterId =
                        def.scope === 'character' && charName ? findId(charName) : undefined
                      if (def.scope === 'character' && !characterId) return null
                      return {
                        defId: def.id,
                        name: def.name,
                        characterId,
                        charName: def.scope === 'character' ? charName : undefined,
                        amount: Math.max(1, Math.min(1000, Math.round(Number(x?.amount) || 1))),
                        reason: String(x?.reason ?? ''),
                      }
                    })
                    .filter((c: any): c is NonNullable<typeof c> => !!c)
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
            reviewController = null
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
          const selectedRelUpdates = opts.relationUpdateIdx
            .map((i) => review.relationUpdates[i])
            .filter(Boolean)
          const selectedStats = opts.statChangeIdx
            .map((i) => review.statChanges[i])
            .filter(Boolean)
          const selectedCounters = opts.counterEventIdx
            .map((i) => review.counterEvents[i])
            .filter(Boolean)
          const selectedMoods = opts.moodChangeIdx
            .map((i) => review.moodChanges[i])
            .filter(Boolean)
          const stateWorld = get().worlds.find((w) => w.id === s.worldId)
          // このレビュー適用で新規解除された実績（通知用）
          const newlyUnlocked: AchievementDef[] = []

          // 関係性 prose を全文書き直し・気分上書き・スタットを clamp 加算した新 state を返す
          const applyState = (prev: Session['state']): Session['state'] => {
            const base = prev ?? { relations: [], moods: [], stats: [], counters: [], achievements: [] }
            // 関係性（fromId,toId で upsert。stance は全文置換、flags は和集合）
            const relations = base.relations.map((r) => ({ ...r }))
            for (const u of selectedRelUpdates) {
              const idx = relations.findIndex((r) => r.fromId === u.fromId && r.toId === u.toId)
              const aspects = u.aspects.map((a) => ({ aspectId: a.aspectId, note: a.note }))
              if (idx >= 0) {
                const flags = Array.from(new Set([...relations[idx].flags, ...u.flagsAdd]))
                // aspects は aspectId 単位でマージ：レビューは「変化の無い次元は省略してよい」ため、
                // 配列ごと置換すると省略された次元の記述が失われる。返ってきた次元のみ全文置換する。
                const prev = relations[idx].aspects
                const merged = [
                  ...prev.map((a) => aspects.find((n) => n.aspectId === a.aspectId) ?? a),
                  ...aspects.filter((n) => !prev.some((a) => a.aspectId === n.aspectId)),
                ]
                relations[idx] = {
                  ...relations[idx],
                  stance: u.stance || relations[idx].stance,
                  aspects: merged,
                  flags,
                  updatedAt: Date.now(),
                }
              } else {
                relations.push({
                  fromId: u.fromId,
                  toId: u.toId,
                  stance: u.stance,
                  aspects,
                  flags: u.flagsAdd,
                  updatedAt: Date.now(),
                })
              }
            }
            // 気分
            const moods = base.moods.map((m) => ({ ...m }))
            for (const m of selectedMoods) {
              const idx = moods.findIndex((x) => x.characterId === m.characterId)
              if (idx >= 0) moods[idx].mood = m.mood
              else moods.push({ characterId: m.characterId, mood: m.mood })
            }
            // スタット（defId,characterId で clamp 加算。未存在は default を起点）
            const stats = base.stats.map((sv) => ({ ...sv }))
            for (const c of selectedStats) {
              const def = stateWorld?.stats.find((d) => d.id === c.defId)
              const idx = stats.findIndex(
                (sv) => sv.defId === c.defId && sv.characterId === c.characterId,
              )
              const cur = idx >= 0 ? stats[idx].value : (def?.default ?? 0)
              const val = clampStat(cur + c.delta, def)
              if (idx >= 0) stats[idx].value = val
              else stats.push({ defId: c.defId, characterId: c.characterId, value: val })
            }
            // カウンター（defId,characterId で累計加算）
            const counters = (base.counters ?? []).map((cv) => ({ ...cv }))
            for (const c of selectedCounters) {
              const idx = counters.findIndex(
                (cv) => cv.defId === c.defId && cv.characterId === c.characterId,
              )
              if (idx >= 0) counters[idx].value += c.amount
              else counters.push({ defId: c.defId, characterId: c.characterId, value: c.amount })
            }
            // 実績（数・フラグ・実績のしきい値をコードが自動判定。連鎖依存も解決するまで反復）
            const { state: withAchievements, unlocked } = unlockAchievements(
              { relations, moods, stats, counters, achievements: base.achievements ?? [] },
              stateWorld,
              s.characterIds,
            )
            newlyUnlocked.push(...unlocked)
            return withAchievements
          }

          // 発見ロア・キャラ成長はセッションのオーバーレイへ積む（元 Character/World は不変に保つ）
          const nextOverlay = (prev: Session['overlay'] | undefined): Session['overlay'] => {
            const src = prev ?? { lore: [], characterDevelopments: [] }
            const lore = src.lore.slice()
            if (selectedWorld.length) {
              const loreBase = lore.length
              selectedWorld.forEach((g, i) => {
                lore.push({
                  ...newLoreEntry(loreBase + i),
                  keys: g.keys,
                  content: g.content,
                  addedInStory: true,
                })
              })
            }
            const characterDevelopments = src.characterDevelopments.map((x) => ({
              ...x,
              developments: x.developments.slice(),
            }))
            for (const g of selectedGrowth) {
              const dev = newDevelopment(g.addition)
              const idx = characterDevelopments.findIndex((x) => x.characterId === g.characterId)
              if (idx >= 0) characterDevelopments[idx].developments.push(dev)
              else characterDevelopments.push({ characterId: g.characterId, developments: [dev] })
            }
            return { lore, characterDevelopments }
          }

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
                      overlay: nextOverlay(sess.overlay),
                      updatedAt: Date.now(),
                    }
                  : sess,
              ),
              sceneReview: null,
            }))
            void recordCheckpoint(s.id, 'scene', `📖 ${scene.title}（再レビュー）`, s, scene.timeLabel)
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
                    overlay: nextOverlay(sess.overlay),
                    spriteEmotions: [], // シーンは時間・場面が飛ぶため前シーンの表情を持ち越さない
                    updatedAt: Date.now(),
                  }
                : sess,
            ),
            sceneReview: null,
            newlyUnlockedAchievements: newlyUnlocked,
          }))
          void recordCheckpoint(s.id, 'scene', next.title, s, next.timeLabel)

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
          // 方向性が変わったので次シーン候補を作り直す
          void get().regenerateSuggestions()
        },

        rerollReviewType: async () => {
          const review = get().sceneReview
          const s = active()
          if (!review || !s) return
          const pick = directNextScene(
            s,
            get().worlds.find((w) => w.id === s.worldId),
            get().sceneTypes,
            null,
            true, // イベント判定をスキップして種類のみ抽選（day 無し条件イベントに横取りされないように）
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
          // 引き直した方向性に合わせて次シーン候補を再生成
          await get().regenerateSuggestions()
        },

        regenerateSuggestions: async () => {
          const review = get().sceneReview
          const s = active()
          if (!review || !s || get().isReviewing || get().isRegenSuggestions) return
          const scene = s.scenes.find((sc) => sc.id === review.sceneId)
          if (!scene) return
          const { provider, model } = parseModelRef(reviewModelOf(s), get().providers)
          if (!provider?.apiKey.trim()) {
            set({ error: `接続先「${provider?.label ?? ''}」の API キーが未設定です。` })
            return
          }
          // 過去シーンの再レビューでは、ライブの現在タイムラインではなく既存の次シーンの時刻を使う
          const isPastScene = scene.id !== s.currentSceneId
          set({ isRegenSuggestions: true, error: null })
          try {
            const refs = resolveRefs(s)
            // 方向性テキスト（イベント優先→種類→自由）
            const guidance = review.nextTypeId
              ? (get().sceneTypes.find((t) => t.id === review.nextTypeId)?.guidance ?? '')
              : ''
            const dirText = review.scheduledEventName
              ? `特別イベント「${review.scheduledEventName}」が発生します。`
              : review.nextTypeName
                ? `次シーンの種類は「${review.nextTypeName}」。${guidance}`
                : '特に指定なし（自由に提案）。'
            const sceneIdxForCtx = s.scenes.findIndex((sc) => sc.id === scene.id)
            const existingNextScene = isPastScene ? s.scenes[sceneIdxForCtx + 1] : undefined
            const nextTimeline = !isPastScene && s.timeline.enabled ? advanceTimeline(s.timeline) : null
            const nextTimeLabel = isPastScene
              ? existingNextScene?.timeLabel
              : nextTimeline
                ? timeLabelOf(nextTimeline)
                : undefined
            const ctxParts = [`【これまでのあらすじ】\n${review.summary}`]
            if (refs.world) ctxParts.push(`【世界観】${refs.world.name}: ${refs.world.description}`)
            ctxParts.push(`【次シーンの方向性】${dirText}`)
            if (nextTimeLabel) {
              ctxParts.push(
                `【次シーンの時間】次シーンは「${nextTimeLabel}」。時間が経過した後の場面として書いてください。`,
              )
            }
            reviewController = new AbortController()
            const raw = await streamChat(
              {
                provider,
                model,
                messages: [
                  { role: 'system', content: nextSceneSystem() },
                  { role: 'user', content: ctxParts.join('\n\n') },
                ],
                temperature: 0.7,
                maxTokens: 800,
                signal: reviewController.signal,
              },
              () => {},
            )
            const parsed = extractJson<any>(raw.text)
            const suggestions = Array.isArray(parsed?.suggestions)
              ? parsed.suggestions
                  .filter((x: any) => x && (x.title || x.note))
                  .map((x: any) => ({ title: String(x.title ?? ''), note: String(x.note ?? '') }))
                  .slice(0, 4)
              : []
            const cur = get().sceneReview
            if (cur && cur.sceneId === review.sceneId && suggestions.length > 0) {
              set({ sceneReview: { ...cur, suggestions } })
            }
          } catch (e) {
            if ((e as Error).name !== 'AbortError') set({ error: (e as Error).message })
          } finally {
            reviewController = null
            set({ isRegenSuggestions: false })
          }
        },

        cancelReview: () => set({ sceneReview: null }),

        regenChoices: async () => {
          const s = active()
          if (!s || get().isStreaming || get().isGeneratingChoices || s.choiceMode === 'off') return
          const last = [...s.messages]
            .reverse()
            .find((m) => m.role === 'assistant' && m.content.trim().length > 0)
          if (!last) return
          await genChoices(s, last.id)
        },

        applyChoiceEffects: (effects) => {
          const s = active()
          if (!s || effects.length === 0) return
          const world = get().worlds.find((w) => w.id === s.worldId)
          const stats = s.state.stats.map((sv) => ({ ...sv }))
          for (const eff of effects) {
            const def = world?.stats.find((d) => d.id === eff.defId)
            const idx = stats.findIndex(
              (sv) => sv.defId === eff.defId && sv.characterId === eff.characterId,
            )
            const cur = idx >= 0 ? stats[idx].value : (def?.default ?? 0)
            const val = clampStat(cur + eff.delta, def)
            if (idx >= 0) stats[idx].value = val
            else stats.push({ defId: eff.defId, characterId: eff.characterId, value: val })
          }
          const { state, unlocked } = unlockAchievements({ ...s.state, stats }, world, s.characterIds)
          get().updateSession(s.id, { state })
          if (unlocked.length) set({ newlyUnlockedAchievements: unlocked })
        },

        applyStatusEdit: (edited) => {
          const s = active()
          if (!s) return
          const world = get().worlds.find((w) => w.id === s.worldId)
          // 手動編集された絶対値も、レビュー適用・選択肢加点と同じく def の min..max に丸める
          const stats = edited.stats.map((sv) => ({
            ...sv,
            value: clampStat(sv.value, world?.stats.find((d) => d.id === sv.defId)),
          }))
          const { state, unlocked } = unlockAchievements(
            { ...edited, stats },
            world,
            s.characterIds,
          )
          get().updateSession(s.id, { state })
          if (unlocked.length) set({ newlyUnlockedAchievements: unlocked })
        },

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
          await runCompletion(last.characterId, last.id, CONTINUATION_NUDGE)
        },

        editMessage: (messageId, content) => {
          const s = active()
          if (!s) return
          get().updateSession(s.id, {
            messages: s.messages.map((m) => (m.id === messageId ? { ...m, content } : m)),
          })
          void recordCheckpoint(s.id, 'action', `✏ 編集: ${headOf(content)}`, s)
        },

        deleteMessage: (messageId) => {
          const s = active()
          if (!s || get().isStreaming) return
          get().updateSession(s.id, {
            messages: s.messages.filter((m) => m.id !== messageId),
          })
          void recordCheckpoint(s.id, 'action', '🗑 削除', s)
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
          mainController?.abort()
          mainController = null
          set({ isStreaming: false })
        },

        stopChoices: () => {
          choicesController?.abort()
          choicesController = null
        },

        stopReview: () => {
          reviewController?.abort()
          reviewController = null
        },

        classifyEmotions: async (sessionId) => {
          const session = get().sessions.find((s) => s.id === sessionId)
          if (!session?.spritesEnabled) return
          const castChars = get().characters.filter((c) => session.characterIds.includes(c.id))
          if (!castChars.some((c) => (c.sprites?.length ?? 0) > 0)) return
          const { provider, model } = parseModelRef(choicesModelOf(session), get().providers)
          if (!provider?.apiKey.trim()) return
          const recent = session.messages
            .filter(
              (m) =>
                m.content.trim().length > 0 &&
                m.content !== CONTINUE_PROMPT &&
                m.content !== SCENE_START_PROMPT,
            )
            .slice(-3)
            .map((m) => plainTextOf(m.content))
          if (recent.length === 0) return
          set({ isClassifyingEmotions: true })
          try {
            const raw = await streamChat(
              {
                provider,
                model,
                messages: [
                  { role: 'system', content: emotionSystem(castChars.map((c) => c.name)) },
                  { role: 'user', content: recent.join('\n---\n') },
                ],
                temperature: 0,
                maxTokens: 300,
              },
              () => {},
            )
            const json = extractJson<{ emotions?: { character?: string; emotion?: string }[] }>(raw.text)
            const updates = resolveEmotionUpdates(json?.emotions ?? [], castChars)
            if (updates.length === 0) return
            const cur = get().sessions.find((s) => s.id === sessionId)
            if (!cur) return
            const nextEmotions = [...(cur.spriteEmotions ?? [])]
            for (const u of updates) {
              const idx = nextEmotions.findIndex((e) => e.characterId === u.characterId)
              if (idx >= 0) nextEmotions[idx] = u
              else nextEmotions.push(u)
            }
            get().updateSession(sessionId, { spriteEmotions: nextEmotions })
          } catch (e) {
            // 表情判定は失敗しても本編には影響させない。現状維持（次の応答でまた判定される）
            console.warn('[emotion] 判定に失敗:', (e as Error)?.message)
          } finally {
            set({ isClassifyingEmotions: false })
          }
        },

        exportBundle: async (includeImages) => {
          const { characters, worlds, personas, sceneTypes, sessions } = get()
          // providers（API キー）は localStorage のみに保持し、エクスポートには含めない（共有時の漏洩防止）
          const bundle: ExportBundle = {
            type: 'ai-storytelling-studio',
            version: 1,
            exportedAt: Date.now(),
            characters,
            worlds,
            personas,
            sceneTypes,
            sessions,
          }
          if (includeImages) {
            const ids = collectUsedImageIds(characters, personas, sessions)
            const images: { id: string; mime: string; dataBase64: string }[] = []
            for (const id of ids) {
              const blob = await getImage(id)
              if (!blob) continue
              images.push({ id, mime: blob.type || 'image/png', dataBase64: await blobToBase64(blob) })
            }
            bundle.images = images
          }
          return bundle
        },

        importBundle: async (bundle) => {
          let added = 0
          // 画像込みバンドルなら、参照が指す id をそのまま維持して先に復元する（avatar.imageId 等の書き換え不要）
          if (bundle.images && bundle.images.length > 0) {
            for (const img of bundle.images) {
              await putImageAs(img.id, base64ToBlob(img.dataBase64, img.mime))
            }
          }
          // クリーンブレイク：移行連鎖は廃止。現行スキーマのバンドルのみを id マージする。
          // ワールドは新フィールド欠落に備え最小限だけ補完する。
          const normalizeAvatar = (a: any): Avatar => ({
            color: typeof a?.color === 'string' ? a.color : pickColor(),
            ...(typeof a?.imageId === 'string' ? { imageId: a.imageId } : {}),
          })
          const incomingCharacters = (bundle.characters ?? []).map((c: any) => ({
            ...c,
            avatar: normalizeAvatar(c.avatar),
          }))
          const incomingPersonas = (bundle.personas ?? []).map((p: any) => ({
            ...p,
            avatar: normalizeAvatar(p.avatar),
          }))
          const incomingWorlds = (bundle.worlds ?? []).map((w: any) => ({
            ...w,
            relationAspects: Array.isArray(w.relationAspects) ? w.relationAspects : [],
            stats: Array.isArray(w.stats) ? w.stats : [],
            counters: Array.isArray(w.counters) ? w.counters : [],
            achievements: Array.isArray(w.achievements) ? w.achievements : [],
          }))
          const incomingSessions = (bundle.sessions ?? []).map((sess: any) => ({
            ...sess,
            overlay:
              sess.overlay && Array.isArray(sess.overlay.lore) && Array.isArray(sess.overlay.characterDevelopments)
                ? sess.overlay
                : { lore: [], characterDevelopments: [] },
          }))
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
              personas: mergeById(st.personas, incomingPersonas),
              sceneTypes: mergeById(st.sceneTypes, bundle.sceneTypes ?? []),
              sessions: mergeById(st.sessions, incomingSessions),
              // providers はユーザー固有の設定のためインポート対象外
            }
          })
          return { added }
        },

        importSessionCard: async (bundle) => {
          // 1) 同梱画像を IndexedDB へ登録し直し、旧 id → 新 id の対応表を作る（直列＝IndexedDB を並列で叩かない）
          const idMap = new Map<string, string>()
          for (const entry of bundle.images) {
            const newId = await putImage(sessionCardImageBlob(entry))
            idMap.set(entry.id, newId)
          }
          const remapAvatar = <T extends { avatar: Avatar }>(x: T): T => ({
            ...x,
            avatar: {
              ...x.avatar,
              imageId: x.avatar.imageId ? idMap.get(x.avatar.imageId) : undefined,
            },
          })
          // 立ち絵の imageId も同梱画像への参照なので remap する（忘れるとカード復元で立ち絵が消える）
          const remapSprites = (c: Character): Character =>
            c.sprites && c.sprites.length > 0
              ? { ...c, sprites: c.sprites.map((sp) => ({ ...sp, imageId: idMap.get(sp.imageId) ?? sp.imageId })) }
              : c

          // 2) 素材は importBundle と同じ id マージ（既存 id はスキップ＝既存優先）
          //    セッション本体は常に追加（id 衝突時は新 id 採番）
          set((st) => {
            const now = Date.now()
            const charIds = new Set(st.characters.map((c) => c.id))
            const freshChars = bundle.characters
              .filter((c) => !charIds.has(c.id))
              .map(remapAvatar)
              .map(remapSprites)

            const worldExists = bundle.world && st.worlds.some((w) => w.id === bundle.world!.id)
            const freshWorlds = bundle.world && !worldExists ? [bundle.world] : []

            const personaExists = bundle.persona && st.personas.some((p) => p.id === bundle.persona!.id)
            const freshPersonas = bundle.persona && !personaExists ? [remapAvatar(bundle.persona)] : []

            const sessionIdTaken = st.sessions.some((s) => s.id === bundle.session.id)
            const session: Session = {
              ...bundle.session,
              id: sessionIdTaken ? uid() : bundle.session.id,
              // 挿絵・背景の imageId を remap（対応が無いものは表示フォールバックに任せてそのまま）
              scenes: bundle.session.scenes.map((sc) => ({
                ...sc,
                illustrations: (sc.illustrations ?? []).map((ill) => ({
                  ...ill,
                  imageId: idMap.get(ill.imageId) ?? ill.imageId,
                })),
                ...(sc.backgroundImageId
                  ? { backgroundImageId: idMap.get(sc.backgroundImageId) ?? sc.backgroundImageId }
                  : {}),
              })),
              overlay:
                bundle.session.overlay &&
                Array.isArray(bundle.session.overlay.lore) &&
                Array.isArray(bundle.session.overlay.characterDevelopments)
                  ? bundle.session.overlay
                  : { lore: [], characterDevelopments: [] },
              updatedAt: now,
            }

            return {
              characters: [...freshChars, ...st.characters],
              worlds: [...freshWorlds, ...st.worlds],
              personas: [...freshPersonas, ...st.personas],
              sessions: [session, ...st.sessions],
              activeId: session.id,
              view: 'sessions' as View,
            }
          })
        },

        addIllustration: (sessionId, sceneId, ill) =>
          set((st) => ({
            sessions: st.sessions.map((s) =>
              s.id !== sessionId
                ? s
                : {
                    ...s,
                    scenes: s.scenes.map((sc) =>
                      sc.id !== sceneId ? sc : { ...sc, illustrations: [...(sc.illustrations ?? []), ill] },
                    ),
                  },
            ),
          })),

        removeIllustration: (sessionId, sceneId, illId) =>
          set((st) => ({
            sessions: st.sessions.map((s) =>
              s.id !== sessionId
                ? s
                : {
                    ...s,
                    scenes: s.scenes.map((sc) =>
                      sc.id !== sceneId
                        ? sc
                        : { ...sc, illustrations: (sc.illustrations ?? []).filter((i) => i.id !== illId) },
                    ),
                  },
            ),
          })),

        removeSceneBackground: (sessionId, sceneId) => {
          // 実体削除はしない（GC 一本化。分岐チェックポイントが参照している可能性があるため
          // 参照を外すだけにとどめ、回収は gcUnusedImages に任せる）
          set((st) => ({
            sessions: st.sessions.map((s) =>
              s.id !== sessionId
                ? s
                : {
                    ...s,
                    scenes: s.scenes.map((sc) =>
                      sc.id !== sceneId ? sc : { ...sc, backgroundImageId: undefined },
                    ),
                  },
            ),
          }))
        },

        startImageJob: (args) => {
          const id = uid()
          const job: ImageJob = {
            id,
            label: args.label,
            target: args.target,
            providerId: args.providerId,
            prompt: args.prompt,
            negative: args.negative,
            width: args.width,
            height: args.height,
            count: args.count,
            status: 'running',
            results: [],
            createdAt: Date.now(),
          }
          set((st) => ({ imageJobs: [...st.imageJobs, job] }))
          runImageJobLoop(id, args)
          return id
        },

        startSpriteBatch: (args) => {
          ;(async () => {
            for (const p of args.prompts) {
              const emotionLabel = EMOTIONS.find((e) => e.id === p.emotion)?.label ?? p.emotion
              const id = uid()
              const jobArgs = {
                providerId: args.providerId,
                prompt: p.prompt,
                negative: args.negative,
                width: args.width,
                height: args.height,
                count: 1,
              }
              const job: ImageJob = {
                id,
                label: `立ち絵: ${args.characterName}（${emotionLabel}）`,
                target: { type: 'character-sprite', characterId: args.characterId, emotion: p.emotion },
                ...jobArgs,
                status: 'running',
                results: [],
                createdAt: Date.now(),
              }
              set((st) => ({ imageJobs: [...st.imageJobs, job] }))
              // 前の感情のジョブが完了してから次を起動する（ComfyUI は並列に弱いため）
              await runImageJobLoop(id, jobArgs)
            }
          })()
        },

        cancelImageJob: (jobId) => {
          abortJobController(jobId)
          set((st) => ({
            imageJobs: st.imageJobs.map((j) =>
              j.id === jobId && j.status === 'running' ? { ...j, status: 'canceled' } : j,
            ),
          }))
        },

        dismissImageJob: (jobId) => {
          abortJobController(jobId) // 実行中に dismiss された場合も裏の fetch を確実に止める
          set((st) => ({
            imageJobs: st.imageJobs.filter((j) => j.id !== jobId),
            imageJobToasts: st.imageJobToasts.filter((t) => t.jobId !== jobId),
          }))
        },

        dismissImageJobToasts: () => set({ imageJobToasts: [] }),

        applyImageJobResult: async (jobId, index) => {
          const job = get().imageJobs.find((j) => j.id === jobId)
          if (!job) return
          const blob = job.results[index]
          if (!blob) throw new Error('選択した画像が見つかりません。')
          const target = job.target
          if (target.type === 'scene-illustration') {
            const imageId = await putImage(blob)
            get().addIllustration(target.sessionId, target.sceneId, {
              id: uid(),
              imageId,
              prompt: job.prompt,
              messageId: target.messageId,
              createdAt: Date.now(),
            })
          } else if (target.type === 'character-avatar') {
            if (!get().characters.some((c) => c.id === target.characterId)) {
              throw new Error('対象のキャラクターが見つかりません（削除された可能性があります）。')
            }
            const normalized = await normalizeImage(blob, 512)
            const imageId = await putImage(normalized)
            set((st) => ({
              characters: st.characters.map((c) =>
                c.id === target.characterId ? { ...c, avatar: { ...c.avatar, imageId }, updatedAt: Date.now() } : c,
              ),
            }))
          } else if (target.type === 'persona-avatar') {
            if (!get().personas.some((p) => p.id === target.personaId)) {
              throw new Error('対象のペルソナが見つかりません（削除された可能性があります）。')
            }
            const normalized = await normalizeImage(blob, 512)
            const imageId = await putImage(normalized)
            set((st) => ({
              personas: st.personas.map((p) =>
                p.id === target.personaId ? { ...p, avatar: { ...p.avatar, imageId }, updatedAt: Date.now() } : p,
              ),
            }))
          } else if (target.type === 'character-sprite') {
            const character = get().characters.find((c) => c.id === target.characterId)
            if (!character) {
              throw new Error('対象のキャラクターが見つかりません（削除された可能性があります）。')
            }
            // 旧 imageId の実体削除はしない（GC 一本化。参照を外すだけ・回収は gcUnusedImages）
            const normalized = await normalizeImage(blob, 1024)
            const imageId = await putImage(normalized)
            set((st) => ({
              characters: st.characters.map((c) =>
                c.id !== target.characterId
                  ? c
                  : {
                      ...c,
                      sprites: [
                        ...(c.sprites ?? []).filter((s) => s.emotion !== target.emotion),
                        { emotion: target.emotion, imageId },
                      ],
                      updatedAt: Date.now(),
                    },
              ),
            }))
          } else {
            // scene-background（旧 imageId の実体削除はしない。GC 一本化）
            const imageId = await putImage(blob)
            set((st) => ({
              sessions: st.sessions.map((s) =>
                s.id !== target.sessionId
                  ? s
                  : {
                      ...s,
                      scenes: s.scenes.map((sc) =>
                        sc.id !== target.sceneId ? sc : { ...sc, backgroundImageId: imageId },
                      ),
                    },
              ),
            }))
          }
          get().dismissImageJob(jobId)
        },

        gcUnusedImages: async () => {
          const { characters, personas, sessions, branchTrees } = get()
          const used = collectUsedImageIds(characters, personas, sessions)
          // チェックポイント（分岐ツリー）が参照する画像も使用中扱い（GC 一本化。C1）
          for (const tree of Object.values(branchTrees)) {
            for (const node of tree.nodes) {
              for (const id of node.imageIds) used.add(id)
              if (node.star?.thumbImageId) used.add(node.star.thumbImageId)
            }
          }
          return gcImages(used)
        },
      }
    },
    {
      // クリーンブレイク：Avatar 型刷新（絵文字廃止→画像参照）に伴い persist キーを再度刷新（旧 v2 は破棄）。
      // 後方互換は不要なため migrate 連鎖は持たない。キー文字列は platform.ts の PERSIST_KEY と共有
      // （Tauri のファイル backend が旧 WebView localStorage からの移行判定に使う）。
      name: PERSIST_KEY,
      storage: createJSONStorage(() => stateStorage),
      partialize: (st) => ({
        providers: st.providers,
        // 画像生成の接続先も API キーを含むため localStorage のみ（exportBundle には含めない）
        imageProviders: st.imageProviders,
        lastImageProviderId: st.lastImageProviderId,
        lastDraftModel: st.lastDraftModel,
        favoriteModels: st.favoriteModels,
        characters: st.characters,
        worlds: st.worlds,
        personas: st.personas,
        sceneTypes: st.sceneTypes,
        sessions: st.sessions,
        activeId: st.activeId,
        branchTrees: st.branchTrees,
        ui: st.ui,
      }),
      // 生成中にタブを閉じた/リロードした際の残骸を起動時に掃除する：
      // 空の pending メッセージは削除、内容があるものは途中で切れた可能性が高いため
      // truncated を立てて「⤵ 続きを生成」で復帰できるようにする。
      merge: (persisted, current) => {
        const p = (persisted as Partial<AppState>) ?? {}
        const merged = { ...current, ...p, ui: { ...current.ui, ...(p.ui ?? {}) } }
        merged.sessions = (merged.sessions ?? []).map((s) => {
          if (!s.messages.some((m) => m.pending)) return s
          return {
            ...s,
            messages: s.messages
              .filter((m) => !(m.pending && !m.content.trim()))
              .map((m) => (m.pending ? { ...m, pending: false, truncated: true } : m)),
          }
        })
        return merged
      },
    },
  ),
)
