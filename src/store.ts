import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type {
  AmbientPin,
  Avatar,
  BranchNode,
  BranchTree,
  Cassette,
  Character,
  Choice,
  Development,
  DiscoveredCharacter,
  ExportBundle,
  ImageProvider,
  ImageQuality,
  LoreEntry,
  Message,
  MessageKind,
  MoodChange,
  NextSceneSuggestion,
  OpenRouterModel,
  Provider,
  RelationAspectDef,
  RelationUpdate,
  Scene,
  SceneIllustration,
  SceneReview,
  PendingSlip,
  Session,
  SessionImageRecord,
  SessionMode,
  SessionState,
  TrackerResult,
  UiPrefs,
  UsageRecord,
  World,
} from './types'
import { DEFAULT_UI, normalizeUiPrefs } from './types'
import { fetchModels, streamChat } from './lib/openrouter'
import { base64ToBlob, blobToBase64, gcImages, getImage, listImageIds, putImage, putImageAs } from './lib/imageStore'
import {
  blockStateWrites,
  checkpointStore,
  IMAGE_PROVIDER_SECRET_PREFIX,
  PERSIST_KEY,
  persistProviderSecret,
  PROVIDER_SECRET_PREFIX,
  removeProviderSecret,
  stateStorage,
  stripApiKeyForPersist,
  syncProviderSecrets,
} from './lib/platform'
import {
  APP_STATE_VERSION,
  CURRENT_SCHEMA_VERSIONS,
  migrateAppState,
  migrateSubSchemas,
  type SchemaError,
  type SchemaVersions,
} from './lib/schema'
import { gunzipText, gzipText } from './lib/checkpoint'
import { normalizeImage } from './lib/avatarGen'
import { matchCharacterByName, NARRATION_NAMES, parseStructured, plainTextOf } from './lib/structured'
import { generateImage, resolveImageApiKey } from './lib/imageGen'
import { costKeyOf, withCostSample } from './lib/cost'
import {
  abortJobController,
  clearJobAbort,
  registerJobAbort,
  type ImageJob,
  type ImageJobTarget,
} from './lib/imageJobs'
import {
  attachCardImage,
  freshSessionOf,
  parseCardPng,
  sessionCardImageBlob,
  type CassetteBundle,
} from './lib/cards'
import { parseBundle } from './lib/io'
import { appChoices, appPrompt } from './lib/dialogs'
import {
  buildMessages,
  choicesMessages,
  choicesSystem,
  CONTINUATION_NUDGE,
  CONTINUE_PROMPT,
  isDirective,
  nextSceneSystem,
  reviewSystem,
  trackerSystem,
  SCENE_START_PROMPT,
  selectRawScenes,
  type ResolvedRefs,
  type ReviewPart,
} from './lib/prompts'
import { RAW_WINDOW_TOKENS } from './lib/tokens'
import { extractJson, partialString } from './lib/json'
import {
  CHOICES_SCHEMA,
  jsonModeFor,
  NEXT_SCENE_SCHEMA,
  reviewSchema,
} from './lib/jsonSchemas'
import {
  defaultOpenRouterProvider,
  isProviderUsable,
  parseModelRef,
  providerUnusableMessage,
} from './lib/providers'
import {
  castingIssueLabel,
  normalizeIntroBindings,
  normalizeIntroTags,
  resolveIntroText,
  validateCasting,
} from './lib/casting'

export const DEFAULT_MODEL = 'openrouter/auto'

export type View = 'sessions' | 'characters' | 'worlds' | 'cassettes' | 'system'

/** View が属する領域（レール切替・グリッド制御用。UI-5） */
export function areaOf(view: View): 'play' | 'library' | 'system' {
  if (view === 'sessions') return 'play'
  if (view === 'system') return 'system'
  return 'library'
}

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




/** 画像記録をセッション単位で record id の dedupe 追記マージする（FB6-A。importBundle 用） */
function mergeImageLogs(
  cur: Record<string, SessionImageRecord[]>,
  inc: Record<string, SessionImageRecord[]>,
): Record<string, SessionImageRecord[]> {
  const out = { ...cur }
  for (const [sessionId, records] of Object.entries(inc)) {
    if (!Array.isArray(records)) continue
    const existing = out[sessionId] ?? []
    const ids = new Set(existing.map((r) => r.id))
    const fresh = records.filter(
      (r) => r && typeof r.id === 'string' && typeof r.imageId === 'string' && !ids.has(r.id),
    )
    if (fresh.length > 0) out[sessionId] = [...existing, ...fresh]
  }
  return out
}

/**
 * レビュー確定で選ばれた変更を state へ適用する純関数（E2）。confirmSceneReview 内の applyState
 * クロージャをモジュールレベルへ抽出したもの。confirmSceneReview（確定）と SceneReviewModal
 * （到達プレビュー）の両方がこれを呼ぶことで、モーダルの予告と実際の発火が必ず一致する。
 * 関係性 prose は全文書き直し（aspect は aspectId 単位でマージ）、スタットは clamp 加算、
 * カウンターは累計。
 */
export function applyReviewToState(
  base: SessionState | undefined,
  sel: {
    relationUpdates: RelationUpdate[]
    moodChanges: MoodChange[]
  },
): SessionState {
  const prev = base ?? emptySessionState()
  // 関係性（fromId,toId で upsert。stance は全文置換）
  const relations = prev.relations.map((r) => ({ ...r }))
  for (const u of sel.relationUpdates) {
    const idx = relations.findIndex((r) => r.fromId === u.fromId && r.toId === u.toId)
    const aspects = u.aspects.map((a) => ({ aspectId: a.aspectId, note: a.note }))
    if (idx >= 0) {
      // aspects は aspectId 単位でマージ：返ってきた次元のみ全文置換し、省略された次元は保持する
      const cur = relations[idx].aspects
      const merged = [
        ...cur.map((a) => aspects.find((n) => n.aspectId === a.aspectId) ?? a),
        ...aspects.filter((n) => !cur.some((a) => a.aspectId === n.aspectId)),
      ]
      relations[idx] = {
        ...relations[idx],
        stance: u.stance || relations[idx].stance,
        aspects: merged,
        updatedAt: Date.now(),
      }
    } else {
      relations.push({
        fromId: u.fromId,
        toId: u.toId,
        stance: u.stance,
        aspects,
        updatedAt: Date.now(),
      })
    }
  }
  // 気分
  const moods = prev.moods.map((m) => ({ ...m }))
  for (const m of sel.moodChanges) {
    const idx = moods.findIndex((x) => x.characterId === m.characterId)
    if (idx >= 0) moods[idx].mood = m.mood
    else moods.push({ characterId: m.characterId, mood: m.mood })
  }
  return { ...prev, relations, moods }
}

/**
 * モデルが返した JSON から選択肢を取り出す。
 * 素直な ["a","b"] のほか、`{"choices":[...]}` のラップや
 * `[{"text":"a"}]` のオブジェクト配列にも対応する（モデル差吸収）。
 * 旧形式の effects（P5・選択肢連動加点）は FB7-C で廃止＝出てきても読み捨てる。
 */
function coerceChoices(parsed: unknown): Choice[] {
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
      return { text }
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

export function newLoreEntry(order: number): LoreEntry {
  return { id: uid(), keys: [], content: '', alwaysOn: false, enabled: true, order }
}

export function newDevelopment(text: string): Development {
  return { id: uid(), text, enabled: true }
}

/** 本編生成に使うモデル参照。 */
export function mainModelOf(s: Session): string {
  return s.model || DEFAULT_MODEL
}

/** レビュー（シーン終了解析）用モデル参照。未指定なら本編モデルを使う */
export function reviewModelOf(s: Session): string {
  return s.reviewModel?.trim() || s.model || DEFAULT_MODEL
}

/** 選択肢生成用モデル参照。未指定なら本編モデルを使う */
export function choicesModelOf(s: Session): string {
  return s.choicesModel?.trim() || s.model || DEFAULT_MODEL
}

/** 複製時の名前（G4-a）。「〜のコピー」を付け、同名が既にあれば「〜のコピー2」…と連番にする */
export function copyNameOf(name: string, existing: string[]): string {
  const base = `${name.trim() || '無名'}のコピー`
  if (!existing.includes(base)) return base
  for (let n = 2; ; n++) {
    if (!existing.includes(`${base}${n}`)) return `${base}${n}`
  }
}

/**
 * 新規ワールド。**中立な既定を1組だけ入れる**（G4-b）。
 * `relationAspects` が空のままだとレビューが劣化する（次元未定義＝ stance のみ更新に落ちる。
 * `prompts.ts`）ため、プリセット（廃止）が実際に防いでいた「空設定のまま遊び始めること」を
 * 既定1つで肩代わりする（詳細設計 §4.2）。カウンターは作者が決めるものなので空のまま。
 */
export function newWorld(): World {
  const now = Date.now()
  return {
    id: uid(),
    name: '',
    description: '',
    entries: [],
    relationAspects: [newRelationAspect('信頼')],
    createdAt: now,
    updatedAt: now,
  }
}

/** 開始テンプレートに中身が1項目でもあるか（読み込みボタンの表示・反映要否の判定。W1） */
export function hasStartPreset(world: World | undefined | null): boolean {
  const p = world?.startPreset
  if (!p) return false
  return !!(
    p.genre?.trim() ||
    p.premise?.trim() ||
    p.opening?.trim() ||
    p.openingTitle?.trim() ||
    p.initialDirective?.trim() ||
    p.authorNote?.trim() ||
    p.openingSceneNote?.trim() ||
    !!p.newCharacterPolicy ||
    (p.introTags?.length ?? 0) > 0 ||
    !!p.startNow?.trim() ||
    (p.initialPending?.length ?? 0) > 0
  )
}

/**
 * 世界の開始テンプレートをセッションへ流し込む差分を作る純関数（W1）。
 * overwrite=false（世界選択時の自動反映）は空欄の項目のみ埋め、入力済みを壊さない。
 * overwrite=true（手動ボタン）はテンプレートに値がある項目を全上書きする。
 * コピー方式＝以後の編集はセッション側だけを変え、World 素材は不変
 * （設計は docs/設計_開始テンプレートとゲームカセット.md）。
 * story 系は mode==='story' のみ反映（roleplay では注入も UI も無いため不可視データを作らない）。
 */
export function startPresetPatch(d: Session, world: World, overwrite: boolean): Partial<Session> {
  const p = world.startPreset
  if (!p) return {}
  const patch: Partial<Session> = {}
  if (d.mode === 'story') {
    const story = { ...d.story }
    let changed = false
    if (p.genre?.trim() && (overwrite || !d.story.genre.trim())) {
      story.genre = p.genre
      changed = true
    }
    if (p.premise?.trim() && (overwrite || !d.story.premise.trim())) {
      story.premise = p.premise
      changed = true
    }
    if (p.opening?.trim() && (overwrite || !d.story.opening.trim())) {
      story.opening = p.opening
      changed = true
    }
    if (p.openingTitle?.trim() && (overwrite || !d.story.openingTitle.trim())) {
      story.openingTitle = p.openingTitle
      changed = true
    }
    if (p.initialDirective?.trim() && (overwrite || !(d.story.initialDirective ?? '').trim())) {
      story.initialDirective = p.initialDirective
      changed = true
    }
    if ((p.introTags?.length ?? 0) > 0 && (overwrite || !(d.story.introTags?.length ?? 0))) {
      story.introTags = p.introTags
      changed = true
    }
    if (changed) patch.story = story
  }
  if (p.authorNote?.trim() && (overwrite || !d.authorNote.trim())) patch.authorNote = p.authorNote
  // 新しい登場人物のポリシー（FB7-E）。セッション側の「空欄」= 未設定（undefined）＝既定の allow
  if (p.newCharacterPolicy && (overwrite || !d.newCharacterPolicy)) {
    patch.newCharacterPolicy = p.newCharacterPolicy
  }
  // 開始時点の現在時刻と初期の予定スリップ（§2.1／§2.6）
  if (p.startNow?.trim() && (overwrite || !d.state.now.trim())) {
    patch.state = { ...d.state, now: p.startNow.trim() }
  }
  if ((p.initialPending?.length ?? 0) > 0 && (overwrite || d.state.pending.length === 0)) {
    patch.state = {
      ...(patch.state ?? d.state),
      pending: (p.initialPending ?? []).map((x) => ({
        id: uid(),
        when: x.when,
        what: x.what,
        bornAt: 0,
      })),
    }
  }
  return patch
}

/**
 * 照合用の正規化（空白・記号のゆれを吸収する）。`pendingDone` の引用照合だけに使う。
 */
function normForMatch(t: string): string {
  return t.replace(/[\s　。、．，「」『』（）()]/g, '').toLowerCase()
}

/**
 * レビューが返した「消化した予定」の引用を、実際の `pending` へ照合する（§2.4.3）。
 * **id ではなく引用で受ける**＝id の書き写しは実測で 450回中50回落ちたが、行の引用は得意だった。
 * 判定は正規化した `what` の双方向の部分一致。**候補がちょうど1件の時だけ消す**——
 * 0件（見つからない）でも2件以上（曖昧）でも残す方を選ぶ＝誤って消すより残す方が害が小さい。
 */
export function matchPendingDone(pending: PendingSlip[], quotes: string[] | undefined): Set<string> {
  const done = new Set<string>()
  for (const raw of quotes ?? []) {
    const q = normForMatch(String(raw ?? ''))
    if (!q) continue
    const hits = pending.filter((slip) => {
      if (done.has(slip.id)) return false
      const w = normForMatch(slip.what)
      return !!w && (q.includes(w) || w.includes(q))
    })
    if (hits.length === 1) done.add(hits[0].id)
  }
  return done
}

/** 直近の消化済み表示を何シーンぶん残すか（§2.2。黙って消さずに自然に流す） */
const RECENT_DONE_KEEP = 6

/**
 * 第3の呼び出し（時間と予定）の結果を state へ適用する純関数（§2.4）。
 * `now`/`place`/`presentIds`/`situation` は上書き、`pending` は add と done の2操作だけ。
 */
export function applyTrackerToState(
  base: SessionState,
  tracker: TrackerResult | undefined,
  sceneIndex: number,
): SessionState {
  if (!tracker) return base
  const done = matchPendingDone(base.pending, tracker.pendingDone)
  const kept = base.pending.filter((slip) => !done.has(slip.id))
  const added = (tracker.pendingAdd ?? [])
    .filter((x) => x && String(x.what ?? '').trim())
    .map((x) => ({
      id: uid(),
      when: String(x.when ?? '').trim(),
      what: String(x.what ?? '').trim(),
      bornAt: sceneIndex,
    }))
  const doneNow = base.pending
    .filter((slip) => done.has(slip.id))
    .map((slip) => ({ what: slip.what, at: Date.now() }))
  return {
    ...base,
    now: tracker.now.trim() || base.now,
    place: tracker.place.trim() || base.place,
    presentIds: tracker.presentIds,
    situation: tracker.situation.trim() || base.situation,
    pending: [...kept, ...added],
    recentDone: [...doneNow, ...base.recentDone].slice(0, RECENT_DONE_KEEP),
  }
}

/** 本編プロンプトの【時間】に載せる1行（§2.4.1。now はシーン境界でしか変わらないので system 側） */
export function timelineInfoOf(state: SessionState | undefined): string {
  return state?.now?.trim() ?? ''
}

/** 空のセッション状態（新規セッション・カセット初期化の共通の起点） */
export function emptySessionState(): SessionState {
  return {
    relations: [],
    moods: [],
    now: '',
    place: '',
    presentIds: [],
    situation: '',
    pending: [],
    recentDone: [],
  }
}

export function newRelationAspect(name = ''): RelationAspectDef {
  return { id: uid(), name, guidance: '' }
}

export function newScene(title: string, timeLabel?: string): Scene {
  return {
    id: uid(),
    title,
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
    focusCharacterId: '',
    introBindings: [],
    authorNote: '',
    story: { premise: '', genre: '', opening: '', openingTitle: '', initialDirective: '' },
    scenes: [scene],
    currentSceneId: scene.id,
    choiceMode: 'auto',
    narrativeStyle: mode === 'story' ? 'novel' : 'chat',
    state: emptySessionState(),
    overlay: { lore: [], characterDevelopments: [] },
    structuredOutput: true,
    messages: [],
    temperature: 0.9,
    // max_tokens は打ち切り上限（書き終われば自然に止まる＝大きくてもコスト増なし）。
    // 途中切れ防止を優先し、既定はスライダー最大値（FB2-A1）
    maxTokens: 32768,
    createdAt: now,
    updatedAt: now,
  }
}

/** セッションの現在シーンを返す（無ければ最後のシーン） */
export function currentScene(s: Session): Scene | undefined {
  return s.scenes.find((sc) => sc.id === s.currentSceneId) ?? s.scenes[s.scenes.length - 1]
}

/**
 * 「もう知っている話者」の一覧（発見キャラの判定用。FB7-E）。
 * **現在シーンの顔ぶれではなくセッションの参加キャラ全員**を返す
 * （今のシーンに出ていないだけの参加キャラを「新キャラ」と誤検出しないため）。
 * 中心人物も `characterIds` の一員なので特別扱いは要らない（F3 でペルソナを統合した）。
 * 名前の照合は必ず `matchCharacterByName`（`structured.ts`）へ通す＝別名・前方一致の規則を1本に保つ。
 */
export function knownSpeakersOf(session: Session, characters: Character[]): { id: string; name: string }[] {
  return session.characterIds
    .map((id) => characters.find((c) => c.id === id))
    .filter((c): c is Character => !!c)
    .map((c) => ({ id: c.id, name: c.name }))
}

/**
 * カセットの下書きを作る（FB3-D）。seed を渡すと `freshSessionOf` で開始状態に初期化して種にする
 * （プレイ記録・モデル参照を落とす）。渡さなければ物語モードの新規セッションを素体にする。
 * 返り値はまだ `cassettes` に積まれていない下書き（CassetteEditor が編集し upsertCassette で保存）。
 */
export function newCassette(seed?: Session): Cassette {
  const session = seed ? freshSessionOf(seed) : newSession('story')
  // カセットはモデル参照を持たない（配布先の環境に依存するため。seed 経由は freshSessionOf が空にする）
  if (!seed) session.model = ''
  return {
    id: uid(),
    title: session.title,
    description: '',
    coverImageId: undefined,
    session,
    createdAt: Date.now(),
  }
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
  }
  return ids
}

/**
 * バックフィル用: セッション（ライブ or スナップショット）から画像記録の候補を抽出する（FB6-A）。
 * seen に無い imageId のみ record 化し、seen へ追加する（呼び出し側がスナップショット横断で dedupe）。
 */
function extractImageRecords(session: Session, seen: Set<string>): SessionImageRecord[] {
  const out: SessionImageRecord[] = []
  for (const sc of session.scenes) {
    for (const ill of sc.illustrations ?? []) {
      if (seen.has(ill.imageId)) continue
      seen.add(ill.imageId)
      out.push({
        id: uid(),
        imageId: ill.imageId,
        prompt: ill.prompt,
        negative: ill.negative,
        sceneId: sc.id,
        sceneTitle: sc.title || undefined,
        timeLabel: sc.timeLabel,
        messageId: ill.messageId,
        createdAt: ill.createdAt,
      })
    }
  }
  return out
}

/**
 * しおり（C3）のサムネイルをチェックポイントのスナップショットから自動選択する。
 * 新しいシーンから遡り、挿絵（末尾＝最新）で最初に見つかった画像を使う。
 */
function pickThumbFromSnapshot(session: Session): string | undefined {
  for (let i = session.scenes.length - 1; i >= 0; i--) {
    const sc = session.scenes[i]
    const ills = sc.illustrations ?? []
    if (ills.length > 0) return ills[ills.length - 1].imageId
  }
  return undefined
}

/**
 * 使用中の画像 id を収集する（GC・エクスポートの両方から呼ぶ。片方だけ更新される事故を防ぐため
 * 「画像 id を増やしたら GC に追加」の規約はこの関数 1 箇所への追加に集約する＝T0）
 */
export function collectUsedImageIds(
  characters: Character[],
  sessions: Session[],
  cassettes: Cassette[] = [],
  imageLogs: Record<string, SessionImageRecord[]> = {},
): Set<string> {
  const used = new Set<string>()
  for (const c of characters) {
    if (c.avatar.imageId) used.add(c.avatar.imageId)
  }
  for (const s of sessions) for (const id of sessionImageIds(s)) used.add(id)
  // カセット棚（FB2-E）: 表紙＋同梱セッションが参照する画像も使用中扱い
  for (const cas of cassettes) {
    if (cas.coverImageId) used.add(cas.coverImageId)
    for (const id of sessionImageIds(cas.session)) used.add(id)
  }
  // 画像の永続記録（FB6-A）: 分岐・シーンが消えても記録にある画像は使用中扱い
  for (const records of Object.values(imageLogs)) {
    for (const r of records) used.add(r.imageId)
  }
  return used
}

/** レビュー1本ぶんの状態（PC-A A-1）。`waiting`＝送信済みで最初のトークン待ち */
export type ReviewCallStatus = 'waiting' | 'streaming' | 'done' | 'failed'

/**
 * レビュー呼び出し1本ぶんの進行（PC-A A-1）。**呼び出し単位で持つ**のが要点で、
 * 分割実行なら2件並ぶ＝「いま何本走っているか」がそのまま画面に出る。
 * `chars` は受信文字数＝2本が同時に伸びることが並列実行の可視的な証拠になる。
 */
export interface ReviewCallProgress {
  key: ReviewPart
  label: string
  status: ReviewCallStatus
  chars: number
  /** 何回目の試行か（1始まり。途中切れ・JSON 失敗でのリトライで増える） */
  attempt: number
  /** 直近の再試行・失敗の理由（画面に出す。原因が分からないまま再試行だけ見えるのを避ける） */
  note?: string
}

/** レビュー呼び出しの表示名（進行表示に出す。何を作っている最中かが分かる粒度にする） */
const REVIEW_CALL_LABEL: Record<ReviewPart, string> = {
  a: 'あらすじ・次シーンの候補',
  b: '関係性・気分の変化',
  t: '時間と予定',
  all: 'シーンの整理（一括）',
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
  /** 新規セッション・カセット開始時の既定モデル（"providerId::modelId"。System で設定。persist のみ・エクスポート除外） */
  defaultModelRef?: string
  favoriteModels: string[]
  characters: Character[]
  worlds: World[]
  sessions: Session[]
  /** ゲームカセット棚（配布物の素材化。FB2-E） */
  cassettes: Cassette[]
  activeId: string | null
  /** セッションごとの分岐ツリー（軽量メタデータのみ。実体は checkpointStore。C1） */
  branchTrees: Record<string, BranchTree>
  /** セッションごとの生成画像の永続記録（FB6-A。分岐・シーンの生死と独立。Session の外に置く） */
  sessionImageLogs: Record<string, SessionImageRecord[]>
  /** 画像記録のバックフィル（全チェックポイント走査）を実施済みか（FB6-A。初回起動時に1回だけ実行） */
  imageLogBackfillDone?: boolean
  /** 右コンテキストドック等の永続 UI 状態（UI-3） */
  ui: UiPrefs

  // ランタイム
  view: View
  modelsByProvider: Record<string, OpenRouterModel[]>
  modelsLoadingFor: string | null
  isStreaming: boolean
  isGeneratingChoices: boolean
  isReviewing: boolean
  /** 次シーン候補（suggestions）だけを再生成中 */
  isRegenSuggestions: boolean
  sceneReview: SceneReview | null
  /**
   * レビュー生成中の途中経過（PC-A A-1。非永続・partialize から除外）。
   * `prepareSceneReview` の開始時に立ち、`sceneReview` が確定するか失敗・中断すると null に戻る。
   * これがあると本文の確定前でもレビューモーダルを開いて進行を見せられる。
   */
  reviewProgress: {
    sessionId: string
    sceneId: string
    /** ストリーミング中のあらすじ（A / all からのみ拾う） */
    summary: string
    /** 実行中の呼び出し（分割実行なら2件＝並列に走っていることが画面に出る） */
    calls: ReviewCallProgress[]
  } | null
  error: string | null
  /** バックグラウンド画像生成ジョブ（Blob を含むため非永続。partialize から除外） */
  imageJobs: ImageJob[]
  /** 選択待ちに変わったジョブの通知（非永続） */
  imageJobToasts: { jobId: string; label: string }[]
  /** 一時的な案内メッセージ（没入モード起動時など。非永続・info トーストで表示。F2） */
  infoNotice: string | null
  /**
   * 永続データを読めなかった理由（R1。非永続・partialize から除外）。
   * セットされている間は App.tsx が本編を描かず案内画面に差し替え、`blockStateWrites()` で
   * 保存済みデータへの上書きも封じている＝この状態から通常操作へ戻る導線は作らない。
   */
  schemaError: SchemaError | null
  /**
   * ツリー行クリックの本文スクロール先（FB7-B。非永続・partialize から除外）。
   * ChatPanel が消化して null に戻す。seq は同じメッセージへの連続移動でも effect を再発火させるための通番。
   */
  scrollTarget: { sessionId: string; messageId: string; seq: number } | null
  /**
   * キャラ化待ちの発見キャラ（FB7-E。非永続・partialize から除外）。
   * 検出の2経路——構造化本文の未解決話者の ？バッジ／レビューの `newCharacters` 承認——を
   * ここへ集約し、ChatPanel が先頭1件ぶんだけ `CharacterDraftModal` を開く（＝採用フローは1本）。
   */
  characterDraftQueue: { sessionId: string; name: string; note?: string }[]
  /** LLM 呼び出しの実測記録（PC0。docs/詳細設計_プロンプト構造とキャッシュ.md §2）。非永続・partialize から除外 */
  usageLog: UsageRecord[]

  // 共通
  setView: (v: View) => void
  clearError: () => void
  /** エンディング到達トーストを閉じる（E2） */
  /** 右コンテキストドック等の UI 設定を部分更新する（UI-3）。没入 OFF→ON で案内を出す（F2） */
  setUiPrefs: (patch: Partial<UiPrefs>) => void
  /** 一時案内メッセージのセット/クリア（F2） */
  setInfoNotice: (msg: string | null) => void
  /** LLM 呼び出し1回ぶんの実測を記録する（PC0）。上限1000件の FIFO */
  recordUsage: (rec: Omit<UsageRecord, 'id' | 'at'>) => void
  /** 実測記録をすべて消去する（PC0） */
  clearUsageLog: () => void

  // 接続先（プロバイダ）
  upsertProvider: (p: Provider) => void
  deleteProvider: (id: string) => void
  loadModels: (providerId: string) => Promise<void>
  toggleFavorite: (modelId: string) => void
  /** 新規セッション・カセット開始時の既定モデルを設定する（空文字でクリア） */
  setDefaultModelRef: (ref: string) => void
  /**
   * 起動時に1回呼ぶ（R3）。providers / imageProviders の apiKey を資格情報ストアの値で埋め直す
   * （Tauri のみ。旧 state.json 由来の平文キーの移行も兼ねる）。Web では no-op。
   */
  hydrateProviderSecrets: () => Promise<void>

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
  upsertWorld: (w: World) => void
  /** カードからのインポート専用。id が既存と衝突する場合は振り直して常に新規追加する */
  importWorldCard: (w: World) => void
  deleteWorld: (id: string) => void
  /**
   * 素材の複製（G4-a。取り込んだカセットの世界観を編集して原本を壊すのを防ぐ導線）。
   * 新 id を返す（見つからなければ undefined）。名前は「〜のコピー」（同名があれば連番）。
   * **世界観の内部 id（ロア・ロール・イベントの id）は振り直さない**
   * ＝既存セッションの世界観を複製先へ差し替えても state の参照が生きる（詳細設計 §4.1）。
   * アバターの画像 id は共有する（画像は不変・GC は使用中集合で判定するので安全）。
   */
  duplicateWorld: (id: string) => string | undefined
  duplicateCharacter: (id: string) => string | undefined

  // セッション
  createSession: (mode: SessionMode) => string
  deleteSession: (id: string) => void
  setActive: (id: string) => void
  updateSession: (id: string, patch: Partial<Session>) => void
  resolveRefs: (session: Session) => ResolvedRefs
  /**
   * チェックポイントへ復元する（C1）。プレイ用ノブ（title/model/reviewModel/choicesModel/
   * temperature/maxTokens）だけ現在値を維持し、それ以外はスナップショットから復元する。
   * 復元自体は何も削除しない（過去を読みに行くだけの移動は安全）。置き去りの記録の削除・確認は
   * 「この地点から物語を進める最初の操作」の冒頭で上書きガード（ensureLineTip）が行う（FB6-C）。
   */
  restoreCheckpoint: (sessionId: string, nodeId: string) => Promise<void>
  /**
   * ツリー行クリック＝その地点を本文で開く（FB7-B）。何も消さない・確認なしのナビゲーション。
   * ノードが現在パス上なら復元せず scrollTarget だけセット。パス外なら乗っている線の先端
   * （lineTipOf）を restoreCheckpoint で読み込んでから scrollTarget をセットする。
   * 生成中はパス外への移動（復元）は restoreCheckpoint が例外を投げる（パス上スクロールは常時可）。
   */
  navigateToNode: (sessionId: string, nodeId: string) => Promise<void>
  /** 現在の分岐の本文を、指定メッセージへスクロールさせる（挿絵→本文リンク等。FB8-D #2） */
  revealMessage: (sessionId: string, messageId: string) => void
  /**
   * 指定ノード以下のサブツリーを削除する（チェックポイント実体も削除。C2）。
   * 現在パス（root→currentId）上のノードは削除不可（例外を投げる。UI 側で confirm 済みの前提）。
   */
  deleteBranchSubtree: (sessionId: string, nodeId: string) => Promise<void>
  /** 現在パス以外のノードを一括削除する「この分岐だけ残す」（C2） */
  pruneToCurrentPath: (sessionId: string) => Promise<void>
  /** しおりを設定する（C3）。サムネイルはノードのスナップショットから自動選択（最新の挿絵） */
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
  /** レビュー内容の編集をストアへ書き戻す（FB5-C。confirm 前に draft を反映し、プレビューと発火を一致させる） */
  updateSceneReview: (review: SceneReview) => void
  confirmSceneReview: (opts: {
    summary: string
    suggestion?: NextSceneSuggestion
    characterGrowthIdx: number[]
    worldGrowthIdx: number[]
    relationUpdateIdx: number[]
    moodChangeIdx: number[]
    /** キャラ化を承認した発見キャラの index（FB7-E。確定後にキャラ化モーダルへ流す） */
    newCharacterIdx?: number[]
  }) => void
  /** 現在の方向性で次シーン候補だけを再生成する */
  regenerateSuggestions: () => Promise<void>
  cancelReview: () => void
  /** 直近のアシスタント応答に対して選択肢を手動で生成し直す */
  regenChoices: () => Promise<void>
  /** 状態パネルの手動編集を保存する */
  applyStatusEdit: (state: SessionState) => void

  // 発見キャラ（FB7-E）
  /**
   * キャラ化待ちに積む。既にセッションの参加キャラ名で解決できる名前と、
   * 同名で待機中の分は積まない（？バッジ連打・レビューとの二重承認で重複させない）。
   */
  queueCharacterDrafts: (sessionId: string, items: DiscoveredCharacter[]) => void
  /** キャラ化待ちを1件取り下げる（キャンセル・保存後の共通の閉じ口） */
  dismissCharacterDraft: (sessionId: string, name: string) => void
  /**
   * 起案・編集したキャラをライブラリへ保存し、そのセッションの参加キャラ（と現在シーンの
   * 登場キャラ）に加える（FB7-E）。**セッション内に埋め込まない**＝カセット定義は開始時
   * スナップショットなので汚れず、カード書き出し・他セッションでの再利用もそのまま効く。
   */
  addDiscoveredCharacter: (sessionId: string, character: Character) => void

  // 生成
  startSession: () => void
  /**
   * ユーザー入力を1通積んで生成を回す。
   * `kind:'directive'`＝主人公のセリフ・行動ではなく**書き手への指示**として積む（IN1）。
   * どちらも送信でそのまま生成が走る（指示は「方向づけ付きの続ける」に相当）。
   */
  send: (text: string, speakerId?: string, kind?: MessageKind) => Promise<void>
  continueStory: (speakerId?: string) => Promise<void>
  regenerate: (speakerId?: string) => Promise<void>
  startStory: () => Promise<void>
  beginScene: () => Promise<void>
  continueLast: () => Promise<void>
  /** メッセージを書き換える（FB6-C で async 化＝上書きガードを通す。キャンセル時は何も変えない） */
  editMessage: (messageId: string, content: string) => Promise<void>
  /** メッセージを削除する（FB6-C で async 化＝上書きガードを通す） */
  deleteMessage: (messageId: string) => Promise<void>
  /**
   * この地点まで巻き戻して作り直す。完結した分岐では既定で拒否し、`opts.fromBranch` で明示的に
   * 許可した時だけ通す（FB9-A。分岐＝新しい世界線を切る操作だけが完結後の続きを描ける）。
   */
  regenerateFrom: (messageId: string, opts?: { fromBranch?: boolean }) => Promise<void>
  /**
   * ⑂ ここから分岐（FB6-C・本文の操作行）。現在の線の先端（currentId）に名前を付けて保護してから
   * 通常の「ここから」（regenerateFrom）を実行する。名前プロンプトのキャンセルで中止。
   * 完結した分岐でも実行でき、巻き戻し先に応じて ending / 完結を解除する（FB9-A）。
   */
  branchFromMessage: (messageId: string) => Promise<void>
  /**
   * ⑂ ここから分岐して再開（FB6-C・ツリー行）。いま進めている線の先端に名前を付けて保護してから
   * 指定ノードへ復元する。名前プロンプトのキャンセルで中止。
   */
  branchFromNode: (sessionId: string, nodeId: string) => Promise<void>
  /** 本編生成の停止（選択肢・レビュー生成には影響しない） */
  stop: () => void
  /** 選択肢生成の停止（本編には影響しない） */
  stopChoices: () => void
  /** レビュー生成（シーン整理・次シーン候補の再生成）の停止 */
  stopReview: () => void

  // 挿絵
  addIllustration: (sessionId: string, sceneId: string, ill: SceneIllustration) => void
  removeIllustration: (sessionId: string, sceneId: string, illId: string) => void

  // 環境音ピン（AM1）。音源は内蔵カタログなので画像と違い GC・実体削除の概念が無い
  addAmbientPin: (sessionId: string, sceneId: string, pin: AmbientPin) => void
  updateAmbientPin: (sessionId: string, sceneId: string, pinId: string, patch: Partial<AmbientPin>) => void
  removeAmbientPin: (sessionId: string, sceneId: string, pinId: string) => void

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
    steps?: number
    sampler?: string
    cfg?: number
    quality?: ImageQuality
    count: number
  }) => string
  cancelImageJob: (jobId: string) => void
  dismissImageJob: (jobId: string) => void
  dismissImageJobToasts: () => void
  /** 候補から採用。保存先は target で分岐（挿絵/キャラアバター）し、完了後ジョブを自動 dismiss */
  applyImageJobResult: (jobId: string, index: number) => Promise<void>

  // データ入出力
  /** includeImages=true で使用中の画像（アバター・挿絵）を base64 同梱する（T0） */
  exportBundle: (includeImages?: boolean) => Promise<ExportBundle>
  importBundle: (bundle: ExportBundle) => Promise<{ added: number }>
  /**
   * PNG カード（キャラ/世界観/カセット）と JSON バンドルを種別自動判別で取り込む。
   * System と Library（作る）のインポート導線で共用。成功時は結果メッセージを返し、失敗は throw。
   */
  importAnyFile: (file: File) => Promise<string>
  /** ゲームカセット（aist_cassette）を「棚に登録」する（素材はマージ・画像 remap・セッションは作らない。FB2-E） */
  importCassette: (bundle: CassetteBundle, cover?: Blob) => Promise<void>
  /** カセット下書きを棚へ追加/更新する（CassetteEditor の保存。FB3-D） */
  upsertCassette: (cassette: Cassette) => void
  /** カセットを新しいセッションに複製して開始する（何度でも最初から遊べる。FB2-E） */
  playCassette: (cassetteId: string) => void
  /** カセットを棚から削除する（表紙・同梱画像は gcUnusedImages で回収。FB2-E） */
  deleteCassette: (cassetteId: string) => void
  /** 未使用のアバター・挿絵画像（IndexedDB）を削除し、削除件数を返す */
  gcUnusedImages: () => Promise<number>

  // 画像の永続記録（FB6-A）
  /** 記録を1件削除する（record 除去のみ。実体は他で未使用なら gcUnusedImages が回収） */
  deleteImageRecord: (sessionId: string, recordId: string) => void
  /**
   * 過去に採用した挿絵を全チェックポイント走査で記録に補完する（FB6-A。初回起動時に1回）。
   * ライブの scenes＋全スナップショットから imageId で dedupe して登録。実在しない画像はスキップ。
   */
  backfillImageLogs: () => Promise<void>
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

/**
 * ノードが乗っている「線の先端」＝nodes 配列順で「最初の子」を辿り続けて到達する葉（FB7-B。export は検証用）。
 * buildGraph のレーン継承（最初の子が親レーンを継ぐ）と同じ規則なので、ツリー表示で
 * クリックした行が乗っているレーンの末端と視覚的に一致する。
 */
export function lineTipOf(tree: BranchTree, nodeId: string): string {
  const firstChildOf = new Map<string, string>()
  for (const n of tree.nodes) {
    if (n.parentId && !firstChildOf.has(n.parentId)) firstChildOf.set(n.parentId, n.id)
  }
  let id = nodeId
  const seen = new Set<string>() // 破損データの循環保険
  while (firstChildOf.has(id) && !seen.has(id)) {
    seen.add(id)
    id = firstChildOf.get(id)!
  }
  return id
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

/** 親→子 id の索引（FB6-C。保護判定・削除対象列挙で共用） */
function childrenIndex(tree: BranchTree): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const n of tree.nodes) {
    if (!n.parentId) continue
    const arr = map.get(n.parentId) ?? []
    arr.push(n.id)
    map.set(n.parentId, arr)
  }
  return map
}

/** サブツリー（自身含む）に保護ノード（⑂名前付き・しおり・エンディング）を含むか（FB6-C・export はテスト用） */
export function subtreeHasProtection(tree: BranchTree, rootId: string): boolean {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]))
  for (const id of subtreeNodeIds(tree, rootId)) {
    const n = byId.get(id)
    if (n && (n.branchName || n.star || n.ending)) return true
  }
  return false
}

/**
 * parentId の直下で「上書きで消してよい暗黙の枝」を列挙する（FB6-C・export はテスト用）。
 * 保護ノードを含む枝は丸ごと温存（部分削除はしない＝いま巻き戻していない枝の中身に触らない）。
 * keepChildId はこれから残す枝（あれば）を除外する。
 */
export function deletableChainsBelow(
  tree: BranchTree,
  parentId: string,
  keepChildId?: string,
): { chains: { topId: string; nodeIds: string[] }[]; crossesScene: boolean } {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]))
  const chains: { topId: string; nodeIds: string[] }[] = []
  let crossesScene = false
  for (const childId of childrenIndex(tree).get(parentId) ?? []) {
    if (childId === keepChildId) continue
    if (subtreeHasProtection(tree, childId)) continue
    const nodeIds = subtreeNodeIds(tree, childId)
    chains.push({ topId: childId, nodeIds })
    if (nodeIds.some((id) => byId.get(id)?.kind === 'scene')) crossesScene = true
  }
  return { chains, crossesScene }
}

/**
 * 巻き戻し後も残るメッセージ集合（keptIds）に対応する「戻り先ノード」を探す（FB3-B1/FB6-C）。
 * currentId から親をたどり、anchorMessageId が keptIds に含まれる最初（最も深い）のノード id を返す。
 * 一致なし（anchor 無しの旧データ等）は null＝従来の直列動作。
 */
function findReanchorTarget(tree: BranchTree | undefined, keptIds: Set<string>): string | null {
  if (!tree || tree.currentId === null) return null
  const byId = new Map(tree.nodes.map((n) => [n.id, n]))
  let id: string | null = tree.currentId
  while (id) {
    const n = byId.get(id)
    if (!n) return null
    if (n.anchorMessageId && keptIds.has(n.anchorMessageId)) return id
    id = n.parentId
  }
  return null
}

/**
 * 巻き戻し後の kept メッセージに対応する scenes/currentSceneId を計算する（regenerateFrom 用。バグ修正）。
 * kept の末尾メッセージが属するシーンが現在の currentSceneId と異なる＝シーン境界をまたいで巻き戻した場合、
 * 置き去りになる後続シーン（scenes 配列上、そのシーンより後ろ）を落とし currentSceneId を戻す。
 * またがない通常のケース（現在シーン内の巻き戻し）は変更なし。sceneId 未設定の旧データはシーンを動かさない。
 */
export function rewindScenesFor(
  session: Pick<Session, 'scenes' | 'currentSceneId'>,
  kept: Message[],
): Pick<Session, 'scenes' | 'currentSceneId'> {
  const lastSceneId = [...kept].reverse().find((m) => m.sceneId)?.sceneId
  if (!lastSceneId || lastSceneId === session.currentSceneId) {
    return { scenes: session.scenes, currentSceneId: session.currentSceneId }
  }
  const idx = session.scenes.findIndex((sc) => sc.id === lastSceneId)
  if (idx < 0) return { scenes: session.scenes, currentSceneId: session.currentSceneId }
  return { scenes: session.scenes.slice(0, idx + 1), currentSceneId: lastSceneId }
}

/** 枝の中で最も新しい葉（＝ほぼ確実に元の先端）。上書きガードの「⑂残す」の命名先に使う（FB6-C） */
function newestLeafOf(tree: BranchTree, chainIds: string[]): string {
  const inChain = new Set(chainIds)
  const byId = new Map(tree.nodes.map((n) => [n.id, n]))
  const hasChildInChain = new Set<string>()
  for (const n of tree.nodes) {
    if (n.parentId && inChain.has(n.parentId) && inChain.has(n.id)) hasChildInChain.add(n.parentId)
  }
  const leaves = chainIds.filter((id) => !hasChildInChain.has(id))
  return (
    leaves.sort((a, b) => (byId.get(b)?.createdAt ?? 0) - (byId.get(a)?.createdAt ?? 0))[0] ?? chainIds[0]
  )
}

function headOf(text: string, max = 24): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** スナップショット末尾のメッセージ id（分岐 anchor 用。FB3-B1） */
function lastMessageId(session: Session): string | undefined {
  return session.messages.length ? session.messages[session.messages.length - 1].id : undefined
}

/**
 * 小ポイント（action）のラベルを、生成された本文の冒頭から決める（FB3-A4）。
 * 「⏩ 続き」等の固定ラベルは中身が分からないので、末尾アシスタント本文の頭を採る。
 */
function actionCheckpointLabel(session: Session): string {
  const lastAssistant = [...session.messages]
    .reverse()
    .find((m) => m.role === 'assistant' && m.content.trim())
  if (lastAssistant) return headOf(plainTextOf(lastAssistant.content), 16)
  // 本文がまだ無い場合はユーザー入力（マーカーを除く）から
  const lastUser = [...session.messages]
    .reverse()
    .find(
      (m) =>
        m.role === 'user' &&
        m.content.trim() &&
        !isDirective(m) && // 「もっと暗くして」等の指示がツリーの行ラベルになると中身が分からない（IN1）
        m.content !== SCENE_START_PROMPT &&
        m.content !== CONTINUE_PROMPT,
    )
  if (lastUser) return headOf(plainTextOf(lastUser.content), 16)
  return '（無題）'
}

/**
 * 状態（関係性 prose ＋ 気分 ＋ 注入対象スタット）をプロンプト用テキストに整形（空なら ''）。
 * 関係性は prose（LLM が読む）、スタットは inject:true のものだけ数値を併記。
 */
function buildStateInfo(
  session: Session,
  characters: Character[],
  world?: World,
): string {
  const relations = session.state?.relations ?? []
  // 関係性 prose の宛先＝中心人物（F3。'hero' という特別値は無くなった）
  const heroLabel =
    characters.find((c) => c.id === session.focusCharacterId)?.name.trim() || '主人公'
  const moods = session.state?.moods ?? []
  const nameOf = (id: string) => characters.find((c) => c.id === id)?.name ?? 'キャラ'
  const aspectName = (id: string) => world?.relationAspects.find((a) => a.id === id)?.name ?? ''
  const moodOf = (id: string) => moods.find((m) => m.characterId === id)?.mood

  const lines: string[] = []
  // 関係性 prose（キャラ→中心人物）
  for (const r of relations) {
    if (!r.stance.trim() && r.aspects.every((a) => !a.note.trim())) continue
    lines.push(`- ${nameOf(r.fromId)} → ${heroLabel}: ${r.stance.trim()}`)
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
  return lines.join('\n')
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

      /** 画像の永続記録へ1件追記する（FB6-A。採用時とバックフィルの書き込み口） */
      const appendImageRecord = (sessionId: string, record: SessionImageRecord) =>
        set((st) => ({
          sessionImageLogs: {
            ...st.sessionImageLogs,
            [sessionId]: [...(st.sessionImageLogs[sessionId] ?? []), record],
          },
        }))

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
        rootLabel?: string,
        ending?: string,
      ): Promise<void> {
        await serializeCheckpointWrite(sessionId, async () => {
          const session = get().sessions.find((s) => s.id === sessionId)
          if (!session) return
          let tree = get().branchTrees[sessionId]
          if (!tree || tree.nodes.length === 0) {
            const rootSession = beforeSession ?? session
            const rootId = uid()
            const bytes = await writeCheckpointNode(sessionId, rootId, rootSession)
            // rootLabel 指定時はルート自体を意味のある地点として名付ける（導入をルート1つに畳む用。FB3追補）
            const rootNode: BranchNode = {
              id: rootId,
              parentId: null,
              kind: 'scene',
              label: rootLabel ?? '開始時点',
              timeLabel: rootLabel ? timeLabel : undefined,
              createdAt: Date.now(),
              imageIds: sessionImageIds(rootSession),
              bytes,
              anchorMessageId: lastMessageId(rootSession),
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
            anchorMessageId: lastMessageId(session),
            ...(ending ? { ending } : {}),
          }
          set((st) => {
            const cur = st.branchTrees[sessionId] ?? tree!
            return { branchTrees: { ...st.branchTrees, [sessionId]: { currentId: nodeId, nodes: [...cur.nodes, node] } } }
          })
        })
      }

      /**
       * 巻き戻し操作の直前に currentId を「切り詰め後も残る地点」の祖先へ戻す（FB3-B1）。
       * 計算は findReanchorTarget（純関数）。一致なし（anchor 無しの旧データ等）なら動かさない。
       * FB6-C 以降、置き去りの記録は事前の ensureLineTip が削除済み（または保護済み）なので、
       * ここは currentId の付け替えだけを行う。
       */
      function reanchorBranch(sessionId: string, keptIds: Set<string>): void {
        const tree = get().branchTrees[sessionId]
        const target = findReanchorTarget(tree, keptIds)
        if (target && tree && target !== tree.currentId) {
          set((st) => ({
            branchTrees: { ...st.branchTrees, [sessionId]: { ...st.branchTrees[sessionId], currentId: target } },
          }))
        }
      }

      /** ⑂ 名前をノードへ付ける（FB6-C。ensureLineTip・branchFrom* から使う） */
      function setBranchNameOn(sessionId: string, nodeId: string, name: string): void {
        set((st) => {
          const t = st.branchTrees[sessionId]
          if (!t) return {}
          return {
            branchTrees: {
              ...st.branchTrees,
              [sessionId]: {
                ...t,
                nodes: t.nodes.map((n) => (n.id === nodeId ? { ...n, branchName: name } : n)),
              },
            },
          }
        })
      }

      /**
       * 上書きガード（FB6-C）。「これから parentNodeId の子として記録を積む」物語操作の冒頭で呼ぶ。
       * 置き去りになる暗黙の枝（保護＝⑂/しおり/🏁 を含まない、parentNodeId 直下の子サブツリー）を
       * チェックポイントごと即時削除する。削除対象にシーン（レビュー確定）ノードが含まれる場合のみ
       * 3択で確認し、「⑂ 分岐として残す」なら枝の先端に名前を付けて温存する（Q2 合意=大きい時だけ確認）。
       * 戻り値 false = キャンセル（呼び出し元は操作を中止する）。
       * recordCheckpoint 側では剪定しない（fail-open。ガードを通らない経路で兄弟ができたら従来どおり表示され、
       * 取り漏らしをバグとして発見できる）。
       */
      async function ensureLineTip(sessionId: string, parentNodeId: string | null | undefined): Promise<boolean> {
        if (!parentNodeId) return true
        const tree = get().branchTrees[sessionId]
        if (!tree) return true
        const { chains, crossesScene } = deletableChainsBelow(tree, parentNodeId)
        if (chains.length === 0) return true
        if (crossesScene) {
          const total = chains.reduce((sum, c) => sum + c.nodeIds.length, 0)
          const choice = await appChoices({
            title: '上書きの確認',
            message: `ここから先の記録 ${total} 件（シーンの区切りを含む）が、この操作で上書きされて消えます。`,
            options: [
              { label: '分岐として残して進む', value: 'branch', primary: true },
              { label: '上書きして進む（記録を消す）', value: 'overwrite', danger: true },
            ],
          })
          if (choice === null) return false
          if (choice === 'branch') {
            for (const chain of chains) {
              const tipId = newestLeafOf(tree, chain.nodeIds)
              const tip = tree.nodes.find((n) => n.id === tipId)
              const name = await appPrompt({
                title: '分岐の名前',
                message: '残しておく続きに名前を付けてください',
                initial: (tip?.label ?? '分岐').slice(0, 24),
              })
              if (name === null) return false
              setBranchNameOn(sessionId, tipId, name.trim() || tip?.label || '分岐')
            }
            return true
          }
        }
        const toDelete = new Set(chains.flatMap((c) => c.nodeIds))
        set((st) => {
          const t = st.branchTrees[sessionId]
          if (!t) return {}
          return {
            branchTrees: {
              ...st.branchTrees,
              [sessionId]: {
                ...t,
                // 同一線の巻き戻しでは currentId 自身が削除対象に入る。宙吊りにせず、
                // これから続きを積む親（＝戻り先）へ付け替える
                currentId: t.currentId && toDelete.has(t.currentId) ? parentNodeId : t.currentId,
                nodes: t.nodes.filter((n) => !toDelete.has(n.id)),
              },
            },
          }
        })
        await Promise.all([...toDelete].map((id) => checkpointStore.delete(sessionId, id)))
        return true
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
        const { characters, worlds } = get()
        const scene = currentScene(session)
        // 素材＋オーバーレイの実効ビュー
        const effWorld = effectiveWorld(
          worlds.find((w) => w.id === session.worldId),
          session.overlay,
        )
        // 登場キャラはセッションの顔ぶれで固定（CS1。シーン単位の絞り込みは廃止し、
        // 「その場に誰が居るか」は【現在の場面】＝ scene.note が伝える）
        const sessionCharacters = session.characterIds
          .map((id) => characters.find((c) => c.id === id))
          .filter((c): c is Character => !!c)
          .map((c) => effectiveCharacter(c, session.overlay))
        return {
          characters: sessionCharacters,
          world: effWorld,
          focus: sessionCharacters.find((c) => c.id === session.focusCharacterId),
          priorSummaries: session.scenes
            .filter((sc) => sc.id !== scene?.id && sc.summary.trim().length > 0)
            .map((sc) => ({ title: sc.title, summary: sc.summary.trim() })),
          sceneNote: scene?.note ?? '',
          currentSceneId: scene?.id ?? null,
          timelineInfo: timelineInfoOf(session.state),
          foreground: scene?.foreground ?? '',
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
        const { provider, model: mainModel } = parseModelRef(mainModelOf(s), get().providers)
        // ローカル接続先（Ollama / LM Studio）はキーを持たないので `isProviderUsable` で見る
        if (!isProviderUsable(provider)) {
          set({ error: providerUnusableMessage(provider) })
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

        const structuredOn = !!s.structuredOutput
        let acc = appendToId ? (target()?.messages.find((m) => m.id === appendToId)?.content ?? '') : ''

        const writeDelta = (chunk: string) => {
          const cur = target()
          if (!cur) return
          patchTarget({
            messages: cur.messages.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + chunk } : m,
            ),
          })
          acc += chunk
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
          const t0 = performance.now()
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
            get().recordUsage({
              kind: 'main',
              modelRef: mainModelOf(s),
              upstream: res.usage?.upstream,
              promptTokens: res.usage?.promptTokens ?? 0,
              cachedTokens: res.usage?.cachedTokens ?? 0,
              completionTokens: res.usage?.completionTokens ?? 0,
              cost: res.usage?.cost,
              ms: performance.now() - t0,
              sessionId,
            })
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
      }

      /** 直近のアシスタント応答に対する選択肢を生成して付与 */
      async function genChoices(session: Session, messageId: string): Promise<void> {
        const { provider, model } = parseModelRef(choicesModelOf(session), get().providers)
        if (!isProviderUsable(provider)) {
          console.warn(
            `[choices] 選択肢用モデルを利用できないため生成をスキップしました: ${providerUnusableMessage(provider)}`,
          )
          return
        }
        const mode = session.choiceMode === 'auto' ? 'auto' : 'always'
        set({ isGeneratingChoices: true })
        try {
          const refs = resolveRefs(session)
          // 本編の system・履歴全文は使わず、選択肢に効く要素だけへ圧縮した専用文脈を使う（PC2'）
          const base = choicesMessages(session, refs, mode)
          // 対応モデルなら JSON を強制する（スキーマが通る相手は system の書式指示も包んだ形へ揃える）
          const jsonMode = jsonModeFor(model, get().modelsByProvider[provider.id])
          const jsonSchema = jsonMode === 'none' ? undefined : CHOICES_SCHEMA
          const msgs = [
            { role: 'system' as const, content: choicesSystem(mode, jsonMode === 'schema') },
            ...base.slice(1),
          ]
          // always はモデルが本編を続けてしまうことがあるため最大2回試行（auto の空配列は正当なので1回）
          // truncated（途中切れ）の場合も抽出漏れの原因になるため再試行対象に含める。
          // ただし再試行で結果が悪化しても、それまでの最良の結果（最も多く抽出できたもの）を採用する。
          const maxAttempts = mode === 'always' ? 2 : 1
          let choices: Choice[] = []
          let bestChoices: Choice[] = []
          choicesController = new AbortController()
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const t0 = performance.now()
            const raw = await streamChat(
              {
                provider,
                model,
                messages: msgs,
                temperature: 0.5,
                maxTokens: 600,
                signal: choicesController.signal,
                jsonSchema,
                jsonMode,
              },
              () => {},
            )
            get().recordUsage({
              kind: 'choices',
              modelRef: choicesModelOf(session),
              upstream: raw.usage?.upstream,
              promptTokens: raw.usage?.promptTokens ?? 0,
              cachedTokens: raw.usage?.cachedTokens ?? 0,
              completionTokens: raw.usage?.completionTokens ?? 0,
              cost: raw.usage?.cost,
              ms: performance.now() - t0,
              sessionId: session.id,
            })
            const parsedChoices = coerceChoices(extractJson<unknown>(raw.text))
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
       * 画像生成ジョブ1件分の直列生成ループ。
       * ジョブは呼び出し側が事前に imageJobs へ追加済みであること。完了まで待つ Promise を返す
       * （バッチ生成は前のジョブがこれを await し終えてから次を起動する）。
       */
      async function runImageJobLoop(
        id: string,
        args: {
          providerId: string
          prompt: string
          negative?: string
          width: number
          height: number
          steps?: number
          sampler?: string
          cfg?: number
          quality?: ImageQuality
          count: number
        },
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
            // openrouter-image はキーが空なら文章側の OpenRouter プロバイダのキーを流用する
            const resolved = { ...provider, apiKey: resolveImageApiKey(provider, get().providers) }
            const { blob, cost } = await generateImage(
              resolved,
              {
                prompt: args.prompt,
                negative: args.negative,
                width: args.width,
                height: args.height,
                steps: args.steps,
                sampler: args.sampler,
                cfg: args.cfg,
                quality: args.quality,
              },
              ctrl.signal,
            )
            set((st) => ({
              imageJobs: st.imageJobs.map((j) => (j.id === id ? { ...j, results: [...j.results, blob] } : j)),
            }))
            if (cost) {
              // 「前回の実績」として同条件のときだけ表示に使う（推測値を確定値に見せない）
              const key = costKeyOf(provider.model, args.quality, args.width, args.height)
              get().upsertImageProvider(withCostSample(provider, key, cost))
            }
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
        defaultModelRef: undefined,
        favoriteModels: [],
        characters: [],
        worlds: [],
        sessions: [],
        cassettes: [],
        activeId: null,
        branchTrees: {},
        sessionImageLogs: {},
        ui: DEFAULT_UI,

        view: 'sessions',
        modelsByProvider: {},
        modelsLoadingFor: null,
        isStreaming: false,
        isGeneratingChoices: false,
        isReviewing: false,
        isRegenSuggestions: false,
        sceneReview: null,
        reviewProgress: null,
        error: null,
        imageJobs: [],
        imageJobToasts: [],
        infoNotice: null,
        schemaError: null,
        scrollTarget: null,
        characterDraftQueue: [],
        usageLog: [],

        setView: (view) => set({ view }),
        clearError: () => set({ error: null }),
        setUiPrefs: (patch) =>
          set((s) => {
            // 没入モードを OFF→ON にした瞬間だけ操作方法を案内する（バーが消えて戸惑うため。F2/A8）
            const enteringImmersive = patch.immersive === true && !s.ui.immersive
            return {
              ui: { ...s.ui, ...patch },
              infoNotice: enteringImmersive
                ? '没入モード: 上端にマウスでバーを表示 / Esc で解除'
                : s.infoNotice,
            }
          }),
        setInfoNotice: (msg) => set({ infoNotice: msg }),
        recordUsage: (rec) =>
          set((st) => {
            const next = [...st.usageLog, { ...rec, id: uid(), at: Date.now() }]
            return { usageLog: next.length > 1000 ? next.slice(next.length - 1000) : next }
          }),
        clearUsageLog: () => set({ usageLog: [] }),

        upsertProvider: (p) => {
          set((st) => ({
            providers: st.providers.some((x) => x.id === p.id)
              ? st.providers.map((x) => (x.id === p.id ? p : x))
              : [...st.providers, p],
          }))
          void persistProviderSecret(PROVIDER_SECRET_PREFIX, p.id, p.apiKey)
        },

        deleteProvider: (id) => {
          set((st) => ({
            providers: st.providers.length > 1 ? st.providers.filter((p) => p.id !== id) : st.providers,
          }))
          void removeProviderSecret(PROVIDER_SECRET_PREFIX, id)
        },

        upsertImageProvider: (p) => {
          set((st) => ({
            imageProviders: st.imageProviders.some((x) => x.id === p.id)
              ? st.imageProviders.map((x) => (x.id === p.id ? p : x))
              : [...st.imageProviders, p],
          }))
          void persistProviderSecret(IMAGE_PROVIDER_SECRET_PREFIX, p.id, p.apiKey)
        },

        deleteImageProvider: (id) => {
          set((st) => ({ imageProviders: st.imageProviders.filter((p) => p.id !== id) }))
          void removeProviderSecret(IMAGE_PROVIDER_SECRET_PREFIX, id)
        },

        hydrateProviderSecrets: async () => {
          const st = get()
          const [providers, imageProviders] = await Promise.all([
            syncProviderSecrets(st.providers, PROVIDER_SECRET_PREFIX),
            syncProviderSecrets(st.imageProviders, IMAGE_PROVIDER_SECRET_PREFIX),
          ])
          set({ providers, imageProviders })
        },

        setLastImageProviderId: (id) => set({ lastImageProviderId: id }),
        setLastDraftModel: (ref) => set({ lastDraftModel: ref }),
        setDefaultModelRef: (ref) => set({ defaultModelRef: ref || undefined }),

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
            const updated = { ...c, updatedAt: Date.now() }
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
              state: {
                ...s.state,
                relations: s.state.relations.filter((r) => r.fromId !== id && r.toId !== id),
                moods: s.state.moods.filter((m) => m.characterId !== id),
              },
              overlay: {
                ...s.overlay,
                characterDevelopments: s.overlay.characterDevelopments.filter(
                  (x) => x.characterId !== id,
                ),
              },
            })),
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

        duplicateWorld: (id) => {
          const src = get().worlds.find((w) => w.id === id)
          if (!src) return undefined
          const now = Date.now()
          const copy: World = {
            ...src,
            id: uid(),
            name: copyNameOf(src.name, get().worlds.map((w) => w.name)),
            createdAt: now,
            updatedAt: now,
          }
          set((st) => ({ worlds: [copy, ...st.worlds] }))
          return copy.id
        },

        duplicateCharacter: (id) => {
          const src = get().characters.find((c) => c.id === id)
          if (!src) return undefined
          const now = Date.now()
          const copy: Character = {
            ...src,
            id: uid(),
            name: copyNameOf(src.name, get().characters.map((c) => c.name)),
            // developments はそのままコピー（配列だけ複製先で独立させる）
            developments: src.developments.map((dv) => ({ ...dv })),
            createdAt: now,
            updatedAt: now,
          }
          set((st) => ({ characters: [copy, ...st.characters] }))
          return copy.id
        },

        createSession: (mode) => {
          const s = newSession(mode)
          // System で設定した既定モデルがあれば、最初から選択済みの状態で始める
          s.model = get().defaultModelRef || s.model
          set((st) => ({ sessions: [s, ...st.sessions], activeId: s.id, view: 'sessions' }))
          return s.id // 呼び出し側で作成直後に設定モーダルを開くため（F3/R15）
        },

        deleteSession: (id) => {
          set((st) => {
            const sessions = st.sessions.filter((s) => s.id !== id)
            const activeId = st.activeId === id ? (sessions[0]?.id ?? null) : st.activeId
            const branchTrees = { ...st.branchTrees }
            delete branchTrees[id]
            // 画像の永続記録もセッションと運命を共にする（FB6-A。実体は GC が回収）
            const sessionImageLogs = { ...st.sessionImageLogs }
            delete sessionImageLogs[id]
            return {
              sessions,
              activeId,
              branchTrees,
              sessionImageLogs,
              // 消えたセッション宛のキャラ化待ちは残さない（FB7-E）
              characterDraftQueue: st.characterDraftQueue.filter((q) => q.sessionId !== id),
            }
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
            archived: cur.archived,
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

        navigateToNode: async (sessionId, nodeId) => {
          const tree = get().branchTrees[sessionId]
          if (!tree) return
          const node = tree.nodes.find((n) => n.id === nodeId)
          if (!node) return
          // パス外なら乗っている線の先端を読み込む（読みに行くだけの移動＝何も消さない。FB6-C）
          if (!currentPathIds(tree).has(nodeId)) {
            await get().restoreCheckpoint(sessionId, lineTipOf(tree, nodeId))
          }
          // アンカー解決: anchorMessageId → 旧ノードは自身のスナップショット末尾 → 無ければスクロールしない
          let messageId = node.anchorMessageId
          if (!messageId) {
            const raw = await checkpointStore.get(sessionId, nodeId)
            if (raw) {
              const parsed = JSON.parse(await gunzipText(raw)) as { v: number; session: Session }
              messageId = lastMessageId(parsed.session)
            }
          }
          if (messageId) {
            set((st) => ({
              scrollTarget: { sessionId, messageId, seq: (st.scrollTarget?.seq ?? 0) + 1 },
            }))
          }
        },

        revealMessage: (sessionId, messageId) =>
          set((st) => ({
            scrollTarget: { sessionId, messageId, seq: (st.scrollTarget?.seq ?? 0) + 1 },
          })),

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
          // レビュー確定はシーンノードを積む＝復元で線の途中に居るならここで上書きガード（FB6-C）
          if (!(await ensureLineTip(s.id, get().branchTrees[s.id]?.currentId))) return
          // 書き手への指示は「起きたこと」ではないのでレビューの評価対象から落とす（IN1）
          const sceneMsgs = s.messages.filter(
            (m) => m.sceneId === scene.id && m.content.trim().length > 0 && !isDirective(m),
          )
          if (sceneMsgs.length === 0) {
            set({ error: 'このシーンにはまだ会話がありません。' })
            return
          }

          // レビュー用モデルを解決
          const { provider, model } = parseModelRef(reviewModelOf(s), get().providers)
          if (!isProviderUsable(provider)) {
            set({ error: providerUnusableMessage(provider) })
            return
          }

          // 過去シーンの再レビューかどうか（登場キャラ・時刻の文脈組み立てを分岐させる）
          const isPastScene = scene.id !== s.currentSceneId
          // 2本に分けて並列実行するか（PC-A A-2。既定 ON＝undefined は true 扱い）
          const split = s.reviewSplit !== false
          // 時間と予定（t）は入力が小さく独立して投げられるので、常に別の1本として並べる（§2.4.2）
          const parts: ReviewPart[] = [...(split ? (['a', 'b'] as ReviewPart[]) : (['all'] as ReviewPart[])), 't']
          set({
            isReviewing: true,
            error: null,
            // 進行表示を先に立てる＝「シーン終了」直後にモーダルが開く（PC-A A-1）
            reviewProgress: {
              sessionId: s.id,
              sceneId: scene.id,
              summary: '',
              calls: parts.map((key) => ({
                key,
                label: REVIEW_CALL_LABEL[key],
                status: 'waiting' as const,
                chars: 0,
                attempt: 1,
              })),
            },
          })
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
                  ? `${refs.focus?.name || 'ユーザー'}: ${m.content}`
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
            // 未解禁キャラ（CG1）はレビューにも渡さない。`refs.characters` が唯一の「解禁済み」の
            // 供給元なので、そこから可視の id を作って以降の一覧（関係性・数）を絞る。
            // **発見キャラの重複判定（newCharacters / ？バッジ）はゲート前の `s.characterIds` を
            // 見続ける**＝未解禁キャラの名前が本文に出ても新キャラとして二重に起案されない（設計 §1.4）
            const visibleIds = new Set(refs.characters.map((c) => c.id))
            // 中心人物は自分自身への関係を持たない（F3）
            visibleIds.delete(s.focusCharacterId)
            const ctxParts: string[] = []
            if (castDefs) ctxParts.push(`【登場人物の現行設定】\n${castDefs}`)
            if (refs.world) ctxParts.push(`【世界観】${refs.world.name}: ${refs.world.description}`)
            if (refs.timelineInfo) ctxParts.push(`【時間】${refs.timelineInfo}`)

            // 次シーンの時刻は第3の呼び出し（tracker）が決めるので、ここでは指示しない

            // ワールド固定の関係次元（レビューを拘束）
            const world = refs.world
            const aspectNames = (world?.relationAspects ?? []).map((a) => a.name).filter(Boolean)
            // 関係性 prose の宛先＝中心人物（F3。ペルソナ廃止で 'hero' という特別値は無くなった）
            const focusName = refs.focus?.name.trim() ?? ''
            const heroLabel = focusName || '主人公'
            const context = ctxParts.join('\n')

            // 現在の関係性 prose（レビューが書き直すための起点）
            const relNow = (s.state?.relations ?? [])
              .filter((r) => visibleIds.has(r.fromId))
              .map((r) => {
                const who = get().characters.find((c) => c.id === r.fromId)?.name ?? 'キャラ'
                const asp = r.aspects
                  .map((a) => {
                    const an = world?.relationAspects.find((x) => x.id === a.aspectId)?.name
                    return an && a.note.trim() ? `${an}: ${a.note.trim()}` : ''
                  })
                  .filter(Boolean)
                  .join(' / ')
                return `- ${who}→${heroLabel}: ${r.stance}${asp ? `（${asp}）` : ''}`
              })
              .join('\n')
            const relBlock = relNow ? `\n\n【現在の関係性】\n${relNow}` : ''

            // 時間と予定の呼び出し用の文脈（§2.4.2）。小さく保つのが要点
            const pendingLines = (s.state?.pending ?? [])
              .map((x) => `- いつ: ${x.when} / なに: ${x.what}`)
              .join('\n')
            const trackerUserContent =
              `【現在】${s.state?.now?.trim() || '（未設定）'}` +
              `\n【場所】${s.state?.place?.trim() || '（未設定）'}` +
              `\n【登場しうる人物】${refs.characters.map((c) => c.name).join('・') || '（なし）'}` +
              (pendingLines
                ? `\n\n【これから起きること】\n${pendingLines}`
                : `\n\n【これから起きること】（なし）`) +
              `\n\n【シーン「${scene.title}」の会話】\n${transcript}`

            const userContent = `${context}${relBlock}\n\n【シーン「${scene.title}」の会話】\n${transcript}`
            // max_tokens は打ち切り上限であり、モデルは書き終われば自然に停止するため
            // 十分大きく取っても無駄な出力やコスト増にはならない（長大な JSON でも途中で切れないように余裕を持たせる）。
            const REVIEW_MAX_TOKENS = 8000
            const maxAttempts = 2
            const hasSummary = (p: any) =>
              (typeof p?.summary === 'string' && p.summary.trim().length > 0) ||
              (Array.isArray(p?.summary) && p.summary.length > 0)

            // 進行表示の更新（PC-A A-1）。呼び出し1本ぶんの状態と、流れてきたあらすじを書く。
            // 呼び出しごとに独立して更新される＝並列実行では2件が同時に伸びる。
            const bumpProgress = (
              part: ReviewPart,
              patch: { summary?: string } & Partial<Omit<ReviewCallProgress, 'key' | 'label'>>,
            ) => {
              const cur = get().reviewProgress
              if (!cur || cur.sceneId !== scene.id) return
              const summary = patch.summary ?? cur.summary
              const calls = cur.calls.map((c) => (c.key === part ? { ...c, ...patch } : c))
              const same =
                summary === cur.summary &&
                calls.every((c, i) => {
                  const p = cur.calls[i]
                  return (
                    c.status === p.status &&
                    c.chars === p.chars &&
                    c.attempt === p.attempt &&
                    c.note === p.note
                  )
                })
              if (same) return
              set({ reviewProgress: { ...cur, summary, calls } })
            }

            // 中断は1つの controller を共有する＝stopReview で分割した2本とも止まる
            const controller = new AbortController()
            reviewController = controller

            /**
             * レビュー1本ぶん（リトライ込み）。解釈できた JSON を返す（全試行で取れなければ null）。
             * B には summary が無いので summary 検査は A / all のときだけ適用する。
             */
            const runReviewCall = async (part: ReviewPart): Promise<any | null> => {
              const system =
                part === 't' ? trackerSystem(world?.calendarFormat) : reviewSystem(part, aspectNames, focusName)
              // t は本文＋現在＋予定＋名前だけ＝キャラ定義もロアも関係性も渡さない（§2.4.2）
              const body = part === 't' ? trackerUserContent : userContent
              const wantsSummary = part !== 'b' && part !== 't'
              const tag = part === 'all' ? 'review' : `review:${part}`
              // 対応モデルなら JSON を強制する＝解釈失敗による再試行がそもそも起きなくなる
              const jsonMode = jsonModeFor(model, get().modelsByProvider[provider.id])
              const jsonSchema = jsonMode === 'none' ? undefined : reviewSchema(part)
              let parsed: any = null
              // 直前の失敗を伝える追伸（PC-A 追修）。**同じリクエストを投げ直しても結果は運任せ**なので、
              // 再試行では何が駄目だったかを1文だけ足して条件を変える。
              let retryHint = ''
              let note: string | undefined
              for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const t0 = performance.now()
                let acc = ''
                let lastPush = 0
                const pushProgress = (status: ReviewCallStatus) =>
                  bumpProgress(part, {
                    summary: wantsSummary ? partialString(acc, 'summary') : undefined,
                    status,
                    chars: acc.length,
                    attempt: attempt + 1,
                    note,
                  })
                pushProgress('waiting') // 送信直後＝最初のトークン待ち（リトライ時は文字数が0に戻る）
                const raw = await streamChat(
                  {
                    provider,
                    model,
                    messages: [
                      { role: 'system', content: system },
                      { role: 'user', content: body },
                      ...(retryHint ? [{ role: 'user' as const, content: retryHint }] : []),
                    ],
                    temperature: 0.4,
                    maxTokens: REVIEW_MAX_TOKENS,
                    signal: controller.signal,
                    jsonSchema,
                    jsonMode,
                  },
                  (d) => {
                    acc += d
                    // 毎トークン set すると再描画が重いので 16ms でスロットリングする
                    const now = performance.now()
                    if (now - lastPush < 16) return
                    lastPush = now
                    pushProgress('streaming')
                  },
                )
                pushProgress('streaming') // 最後の未反映ぶん
                parsed = extractJson<any>(raw.text)
                get().recordUsage({
                  kind: 'review',
                  modelRef: reviewModelOf(s),
                  upstream: raw.usage?.upstream,
                  promptTokens: raw.usage?.promptTokens ?? 0,
                  cachedTokens: raw.usage?.cachedTokens ?? 0,
                  completionTokens: raw.usage?.completionTokens ?? 0,
                  cost: raw.usage?.cost,
                  ms: performance.now() - t0,
                  sessionId: s.id,
                })
                const truncated = raw.finishReason === 'length'
                if (parsed && !truncated && (!wantsSummary || hasSummary(parsed))) break
                if (truncated) {
                  note = '出力が途中で切れたため'
                  retryHint =
                    '前回の出力は長すぎて途中で切れました。各項目を簡潔にまとめ直し、JSON だけを出力してください。'
                  console.warn(`[${tag}] 出力が途中で切れました（試行${attempt + 1}/${maxAttempts}）。再試行します。`)
                } else if (!parsed) {
                  note = 'JSON として読み取れなかったため'
                  retryHint =
                    '前回の出力は JSON として読み取れませんでした。前後に文章やコードフェンスを付けず、JSON だけを出力してください。文字列の中の改行は \\n と書いてください。'
                  console.warn(`[${tag}] JSON を抽出できませんでした（試行${attempt + 1}/${maxAttempts}）。モデル出力:`, raw.text || '<empty>')
                } else {
                  note = 'あらすじ（summary）が空だったため'
                  retryHint =
                    '前回の出力には summary がありませんでした。summary を必ず文字列で含めた JSON だけを出力してください。'
                  console.warn(`[${tag}] summary フィールドが空でした（試行${attempt + 1}/${maxAttempts}）。再試行します。`)
                }
              }
              bumpProgress(part, { status: parsed ? 'done' : 'failed', note })
              return parsed
            }

            // 並列実行（PC-A A-2 ＋ §2.4.2 の第3の呼び出し）。
            // 1本だけ失敗しても続行する＝そのぶんの項目が空になるだけで、レビュー全体は成立する。
            let callError: Error | null = null
            const runSafe = async (part: ReviewPart) => {
              try {
                return await runReviewCall(part)
              } catch (e) {
                // 中断は全部を止める＝そのまま外へ投げる。それ以外は1本の失敗として飲み込む
                if ((e as Error).name === 'AbortError') throw e
                callError ??= e as Error
                bumpProgress(part, { status: 'failed' })
                console.warn(`[review:${part}] 呼び出しに失敗しました:`, e)
                return null
              }
            }
            const results = await Promise.all(parts.map((part) => runSafe(part)))
            const byPart = new Map(parts.map((part, i) => [part, results[i]]))
            const rt = byPart.get('t')
            if (!rt) console.warn('[review] 時間と予定が取れなかったため、このシーンでは時刻・予定を更新しません。')
            let parsed: any = null
            if (split) {
              const ra = byPart.get('a')
              const rb = byPart.get('b')
              if (!ra && !rb) {
                set({
                  error:
                    (callError as Error | null)?.message ??
                    'シーンの整理に失敗しました（モデル出力の解釈に失敗）。もう一度お試しください。',
                })
                return
              }
              if (!ra) console.warn('[review] A（あらすじ・次シーン候補）が取れなかったため、該当項目は空になります。')
              if (!rb) console.warn('[review] B（関係性・気分）が取れなかったため、該当項目は空になります。')
              // A の項目を優先（B が余計なキーを返しても A の結果で上書きされる）
              parsed = { ...(rb ?? {}), ...(ra ?? {}) }
            } else {
              parsed = byPart.get('all')
              if (!parsed) {
                set({ error: 'シーンの整理に失敗しました（モデル出力の解釈に失敗）。もう一度お試しください。' })
                return
              }
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
              sessionId: s.id,
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
                        toId: s.focusCharacterId,
                        toName: heroLabel,
                        stance: String(x?.stance ?? '').trim(),
                        aspects,
                        reason: String(x?.reason ?? ''),
                      }
                    })
                    .filter((u: any) => u.fromId && (u.stance || u.aspects.length > 0))
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
              // 発見キャラ（FB7-E）。既知の話者に解決できる名前・地の文の予約語・重複は落とす
              // ＝レビューが参加キャラを「新登場」と誤って挙げても提案には出さない
              newCharacters: Array.isArray(parsed?.newCharacters)
                ? (() => {
                    const known = knownSpeakersOf(s, sessionChars)
                    const seen = new Set<string>()
                    return parsed.newCharacters
                      .map((x: any) => ({
                        name: String(x?.name ?? '').trim(),
                        note: String(x?.note ?? '').trim(),
                      }))
                      .filter((x: DiscoveredCharacter) => {
                        if (!x.name || NARRATION_NAMES.has(x.name.toLowerCase())) return false
                        if (matchCharacterByName(x.name, known)) return false
                        if (seen.has(x.name)) return false
                        seen.add(x.name)
                        return true
                      })
                      .slice(0, 5)
                  })()
                : [],
              // 時間と予定（第3の呼び出し）。取れなければ undefined＝このシーンでは更新しない
              tracker: rt
                ? {
                    now: String(rt.now ?? '').trim(),
                    place: String(rt.place ?? '').trim(),
                    presentIds: Array.isArray(rt.present)
                      ? (rt.present as unknown[])
                          .map((n) => findId(String(n ?? '')))
                          .filter((id): id is string => !!id)
                      : [],
                    situation: String(rt.situation ?? '').trim(),
                    foreground: String(rt.foreground ?? '').trim(),
                    pendingAdd: Array.isArray(rt.pendingAdd)
                      ? (rt.pendingAdd as any[])
                          .map((x) => ({ when: String(x?.when ?? '').trim(), what: String(x?.what ?? '').trim() }))
                          .filter((x) => x.what)
                      : [],
                    pendingDone: Array.isArray(rt.pendingDone)
                      ? (rt.pendingDone as unknown[]).map((x) => String(x ?? ""))
                      : [],
                  }
                : undefined,
            }
            set({ sceneReview: review })
          } catch (e) {
            if ((e as Error).name !== 'AbortError') set({ error: (e as Error).message })
          } finally {
            reviewController = null
            // 進行表示は確定・失敗・中断のいずれでも畳む（確定時は sceneReview 側の表示へ切り替わる）
            set({ isReviewing: false, reviewProgress: null })
          }
        },

        updateSceneReview: (review) => {
          const cur = get().sceneReview
          if (!cur || cur.sceneId !== review.sceneId) return
          set({ sceneReview: review })
        },

        confirmSceneReview: (opts) => {
          const review = get().sceneReview
          const s = active()
          if (!review || !s) return
          const sceneIdx = s.scenes.findIndex((sc) => sc.id === review.sceneId)
          const scene = s.scenes[sceneIdx]
          if (!scene) return

          // 承認された発見キャラはキャラ化待ちへ積むだけ（FB7-E）。実際の保存は起案 → CharacterEditor →
          // `addDiscoveredCharacter` の採用フローが行う＝？バッジ経路と1本に保つ。
          // 分岐（過去シーン再レビュー／エンディング突入／通常）より前に置く＝どの経路でも同じ扱いになる。
          const approvedNewChars = (opts.newCharacterIdx ?? [])
            .map((i) => review.newCharacters?.[i])
            .filter((x): x is DiscoveredCharacter => !!x)
          if (approvedNewChars.length) get().queueCharacterDrafts(s.id, approvedNewChars)

          const selectedGrowth = opts.characterGrowthIdx
            .map((i) => review.characterGrowth[i])
            .filter(Boolean)
          const selectedWorld = opts.worldGrowthIdx
            .map((i) => review.worldGrowth[i])
            .filter(Boolean)
          const selectedRelUpdates = opts.relationUpdateIdx
            .map((i) => review.relationUpdates[i])
            .filter(Boolean)
          const selectedMoods = opts.moodChangeIdx
            .map((i) => review.moodChanges[i])
            .filter(Boolean)

          // レビュー適用後の新 state を1度だけ計算（純関数 applyReviewToState に一本化。E2）。
          // エンディング判定・シーン確定の両方でこの同一結果を使う＝プレビューと発火の不一致を防ぐ。
          const applied = applyReviewToState(
            s.state,
            { relationUpdates: selectedRelUpdates, moodChanges: selectedMoods },
          )
          const newState = applied

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
            set((st) => ({
              sessions: st.sessions.map((sess) =>
                sess.id === s.id
                  ? {
                      ...sess,
                      scenes: sess.scenes.map((sc) => {
                        if (sc.id === scene.id)
                          return { ...sc, summary: opts.summary.trim() }
                        if (nextScene && sc.id === nextScene.id && sug) {
                          const base = sug?.title || sc.title
                          return {
                            ...sc,
                            title: base || sc.title,
                            note: sug?.note || sc.note,
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
            void recordCheckpoint(s.id, 'scene', `${scene.title}（再レビュー）`, s, scene.timeLabel)
            return
          }

          // 現在シーンの通常フロー。時刻は第3の呼び出し（tracker）が決める
          const sceneIndex = s.scenes.length
          const trackedState = applyTrackerToState(newState, review.tracker, sceneIndex)
          const nextLabel = trackedState.now.trim() || undefined

          const sug = opts.suggestion
          const base = sug?.title || ''
          const title =
            [nextLabel, base].filter(Boolean).join('：') ||
            `シーン ${s.scenes.length + 1}`
          const next = newScene(title, nextLabel)
          next.note = sug?.note || ''
          // 次のシーンが持つ前景（§2.4）。空なら深さ0へ何も入らない
          if (review.tracker?.foreground.trim()) next.foreground = review.tracker.foreground.trim()

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
                    state: trackedState,
                    overlay: nextOverlay(sess.overlay),
                    updatedAt: Date.now(),
                  }
                : sess,
            ),
            sceneReview: null,
          }))
          void recordCheckpoint(s.id, 'scene', next.title, s, next.timeLabel)

          // 新シーンの導入を自動生成（→ 続けて選択肢が提示される）
          void get().beginScene()
        },

        regenerateSuggestions: async () => {
          const review = get().sceneReview
          const s = active()
          if (!review || !s || get().isReviewing || get().isRegenSuggestions) return
          const scene = s.scenes.find((sc) => sc.id === review.sceneId)
          if (!scene) return
          const { provider, model } = parseModelRef(reviewModelOf(s), get().providers)
          if (!isProviderUsable(provider)) {
            set({ error: providerUnusableMessage(provider) })
            return
          }
          // 過去シーンの再レビューでは、ライブの現在タイムラインではなく既存の次シーンの時刻を使う
          const isPastScene = scene.id !== s.currentSceneId
          set({ isRegenSuggestions: true, error: null })
          try {
            const refs = resolveRefs(s)
            const dirText = '特に指定なし（自由に提案）。'
            const sceneIdxForCtx = s.scenes.findIndex((sc) => sc.id === scene.id)
            const existingNextScene = isPastScene ? s.scenes[sceneIdxForCtx + 1] : undefined
            const nextTimeLabel = isPastScene ? existingNextScene?.timeLabel : undefined
            const ctxParts = [`【これまでのあらすじ】\n${review.summary}`]
            if (refs.world) ctxParts.push(`【世界観】${refs.world.name}: ${refs.world.description}`)
            ctxParts.push(`【次シーンの方向性】${dirText}`)
            if (nextTimeLabel) {
              ctxParts.push(
                `【次シーンの時間】次シーンは「${nextTimeLabel}」。時間が経過した後の場面として書いてください。`,
              )
            }
            reviewController = new AbortController()
            const t0 = performance.now()
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
                jsonSchema: NEXT_SCENE_SCHEMA,
                jsonMode: jsonModeFor(model, get().modelsByProvider[provider.id]),
              },
              () => {},
            )
            get().recordUsage({
              kind: 'nextScene',
              modelRef: reviewModelOf(s),
              upstream: raw.usage?.upstream,
              promptTokens: raw.usage?.promptTokens ?? 0,
              cachedTokens: raw.usage?.cachedTokens ?? 0,
              completionTokens: raw.usage?.completionTokens ?? 0,
              cost: raw.usage?.cost,
              ms: performance.now() - t0,
              sessionId: s.id,
            })
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

        // 生成中に閉じた場合も進行表示を残さない（生成自体の中断は stopReview の担当）
        cancelReview: () => set({ sceneReview: null, reviewProgress: null }),

        regenChoices: async () => {
          const s = active()
          if (!s || get().isStreaming || get().isGeneratingChoices || s.choiceMode === 'off') return
          const last = [...s.messages]
            .reverse()
            .find((m) => m.role === 'assistant' && m.content.trim().length > 0)
          if (!last) return
          await genChoices(s, last.id)
        },

        applyStatusEdit: (edited) => {
          const s = active()
          if (!s) return
          get().updateSession(s.id, { state: edited })
        },

        // ── 発見キャラ（FB7-E）────────────────────────────────
        queueCharacterDrafts: (sessionId, items) => {
          const s = get().sessions.find((x) => x.id === sessionId)
          if (!s) return
          const known = knownSpeakersOf(s, get().characters)
          // **ライブラリに同名がいる場合も「新キャラ」ではない。** 参加していないだけの既存キャラを
          // ここで作ると同名が二重にできる（レビューの newCharacters 承認経路もここを通る）
          const library = get().characters.map((c) => ({ id: c.id, name: c.name }))
          set((st) => {
            const queued = st.characterDraftQueue
            const add: { sessionId: string; name: string; note?: string }[] = []
            for (const item of items) {
              const name = item.name.trim()
              if (!name || NARRATION_NAMES.has(name.toLowerCase())) continue
              // 既存の参加キャラ・ライブラリに解決できる名前は「新キャラ」ではない
              if (matchCharacterByName(name, known)) continue
              if (matchCharacterByName(name, library)) continue
              const dup = (x: { sessionId: string; name: string }) =>
                x.sessionId === sessionId && x.name === name
              if (queued.some(dup) || add.some(dup)) continue
              add.push({ sessionId, name, ...(item.note?.trim() ? { note: item.note.trim() } : {}) })
            }
            return add.length ? { characterDraftQueue: [...queued, ...add] } : {}
          })
        },

        dismissCharacterDraft: (sessionId, name) =>
          set((st) => ({
            characterDraftQueue: st.characterDraftQueue.filter(
              (q) => !(q.sessionId === sessionId && q.name === name),
            ),
          })),

        addDiscoveredCharacter: (sessionId, character) => {
          get().upsertCharacter(character)
          const s = get().sessions.find((x) => x.id === sessionId)
          if (!s || s.characterIds.includes(character.id)) return
          get().updateSession(sessionId, {
            characterIds: [...s.characterIds, character.id],
          })
        },

        startSession: () => {
          const s = active()
          if (!s || s.messages.length > 0) return
          // 開始シーンの状況メモ（CS2）。2シーン目以降はレビューが書くが、1シーン目だけは
          // 書き手が居ないので世界観の開始テンプレートから写す。既に何か書かれていれば触らない
          // （ユーザーの記入 > テンプレート）。ここで入れておけば、最初の生成より前に
          // シーン設定で読んで直せる。
          const preset = get().worlds.find((w) => w.id === s.worldId)?.startPreset
          const openingNote = preset?.openingSceneNote?.trim()
          const cur = currentScene(s)
          if (openingNote && cur && !cur.note.trim()) {
            patchActive({
              scenes: s.scenes.map((sc) => (sc.id === cur.id ? { ...sc, note: openingNote } : sc)),
            })
          }
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

        send: async (text, speakerId, kind) => {
          const s = active()
          if (!s || get().isStreaming || false) return
          const trimmed = text.trim()
          if (!trimmed) return
          // 復元で線の途中に居る場合の上書きガード（FB6-C）
          if (!(await ensureLineTip(s.id, get().branchTrees[s.id]?.currentId))) return
          patchActive({
            messages: [
              ...s.messages,
              {
                id: uid(),
                role: 'user',
                ...(kind ? { kind } : {}),
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
          if (!s || get().isStreaming || false) return
          if (!(await ensureLineTip(s.id, get().branchTrees[s.id]?.currentId))) return
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
          if (!s || get().isStreaming || false) return
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
          // 上書きガード → 切り詰め後に残る地点へ戻してから生成（FB3-B1/FB6-C）
          const keptIds = new Set(msgs.map((m) => m.id))
          const tree = get().branchTrees[s.id]
          if (!(await ensureLineTip(s.id, findReanchorTarget(tree, keptIds) ?? tree?.currentId))) return
          reanchorBranch(s.id, keptIds)
          patchActive({ messages: msgs })
          await runCompletion(speakerId)
        },

        startStory: async () => {
          const s = active()
          if (!s || get().isStreaming) return
          const scene = currentScene(s)
          if (!scene) return

          // 導入文は開始前にだけ置換タグを実名へ解決する。未解決のまま履歴・チェックポイント・イベント消化を
          // 作らないことで、@タグが few-shot としてモデルへ流れるのを防ぐ（A-1）。
          const openingTemplate = s.mode === 'story' ? s.story.opening.trim() : ''
          let opening = openingTemplate
          // 中心人物は必須（F3。物語モードでは視点、ロールプレイでは演じる人物）
          if (!s.characterIds.includes(s.focusCharacterId)) {
            set({ error: '中心人物が未選択です。セッション設定の「基本」で登場キャラから1人選んでください。' })
            return
          }
          // roleplay では導入文を掲載しないため、残存する導入文中の @タグ で開始をブロックしない
          const validationSession =
            s.mode === 'story' ? s : { ...s, story: { ...s.story, opening: '' } }
          const issues = validateCasting(validationSession, get().characters)
          if (issues.length > 0) {
            // 配役モーダルは F1-d で撤去したので、置換タグの不足はエラー文言で伝える
            set({ error: issues.map(castingIssueLabel).join(' ') })
            return
          }
          if (openingTemplate) {
            const resolved = resolveIntroText(openingTemplate, {
              tags: s.story.introTags,
              bindings: s.introBindings,
              characters: get().characters.filter((c) => s.characterIds.includes(c.id)),
            })
            if (resolved.issues.length > 0) {
              set({ error: `開始できません。${resolved.issues.map(castingIssueLabel).join(' ')}` })
              return
            }
            opening = resolved.content
          }

          // 復元後の開始やり直し（開始時点へ戻った場合等）の上書きガード（FB6-C）
          if (!(await ensureLineTip(s.id, get().branchTrees[s.id]?.currentId))) return

          const label = s.state.now.trim() || undefined
          const drafted = label || scene.title
          // 導入（そのまま掲載）モードでは見出しを openingTitle 優先に（FB2-B）
          const openingTitle = s.mode === 'story' ? s.story.openingTitle.trim() : ''
          const title = opening && openingTitle ? openingTitle : drafted

          get().updateSession(s.id, {
            scenes: s.scenes.map((sc) =>
              sc.id === scene.id
                ? {
                    ...sc,
                    title,
                    timeLabel: label ?? sc.timeLabel,
                    note: sc.note,
                  }
                : sc,
            ),
          })

          // 導入文があれば AI 生成せず、そのまま最初の本文（assistant メッセージ）として掲載する（FB2-B）
          if (opening) {
            const assistantId = uid()
            const live = active()
            patchActive({
              messages: [
                ...(live?.messages ?? []),
                {
                  id: assistantId,
                  role: 'assistant',
                  sceneId: s.currentSceneId ?? undefined,
                  content: opening,
                  createdAt: Date.now(),
                },
              ],
            })
            // 選択肢（off 以外）を導入文に対して生成
            const after = get().sessions.find((x) => x.id === s.id)
            if (after && after.choiceMode !== 'off') {
              await genChoices(after, assistantId)
            }
            // チェックポイント（導入時点）。導入は決め打ちの本文なので「空の開始時点＋導入」の2ノードに割らず、
            // 導入後の状態を「シーンのタイトル」を持つルート1つとして記録する（beforeSession=導入後 で子はdedupe）
            const afterOpening = get().sessions.find((x) => x.id === s.id)
            void recordCheckpoint(s.id, 'scene', title, afterOpening, label, title)
            return
          }

          await get().beginScene()
        },

        beginScene: async () => {
          const s = active()
          if (!s || get().isStreaming) return
          if (!(await ensureLineTip(s.id, get().branchTrees[s.id]?.currentId))) return
          // 原文で送るシーン範囲をここで1回だけ確定する（PC3。シーン途中では動かさない＝
          // 毎ターン計算するとシーンの途中で畳まれてしまうため、結果を状態として持つ）
          const raw = selectRawScenes(
            s.scenes,
            s.messages,
            s.currentSceneId,
            RAW_WINDOW_TOKENS,
            s.rawWindowFromSceneId,
          )
          patchActive({
            rawWindowFromSceneId: raw.fromSceneId,
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
          if (!s || get().isStreaming || false) return
          const last = [...s.messages].reverse().find((m) => m.role === 'assistant')
          if (!last) return
          if (!(await ensureLineTip(s.id, get().branchTrees[s.id]?.currentId))) return
          await runCompletion(last.characterId, last.id, CONTINUATION_NUDGE)
        },

        editMessage: async (messageId, content) => {
          const s = active()
          if (!s) return
          const idx = s.messages.findIndex((m) => m.id === messageId)
          // 上書きガード（FB6-C）。キャンセルなら本文も変更しない
          const keptIds = new Set(s.messages.slice(0, Math.max(idx, 0)).map((m) => m.id))
          const tree = get().branchTrees[s.id]
          const parent = idx >= 0 ? (findReanchorTarget(tree, keptIds) ?? tree?.currentId) : tree?.currentId
          if (!(await ensureLineTip(s.id, parent))) return
          get().updateSession(s.id, {
            messages: s.messages.map((m) => (m.id === messageId ? { ...m, content } : m)),
          })
          // 編集で内容が変わるので、編集対象より前を残す地点へ戻す（FB3-B1）
          if (idx >= 0) reanchorBranch(s.id, keptIds)
          void recordCheckpoint(s.id, 'action', `✏ 編集: ${headOf(content)}`, s)
        },

        deleteMessage: async (messageId) => {
          const s = active()
          if (!s || get().isStreaming) return
          const remaining = s.messages.filter((m) => m.id !== messageId)
          const keptIds = new Set(remaining.map((m) => m.id))
          const tree = get().branchTrees[s.id]
          if (!(await ensureLineTip(s.id, findReanchorTarget(tree, keptIds) ?? tree?.currentId))) return
          get().updateSession(s.id, { messages: remaining })
          reanchorBranch(s.id, keptIds)
          void recordCheckpoint(s.id, 'action', '削除', s)
        },

        regenerateFrom: async (messageId, opts) => {
          const s = active()
          if (!s || get().isStreaming) return
          // 完結した分岐を作り直せるのは「分岐」経由だけ（FB9-A）。通常の「ここから」は拒否し続ける
          if (false && !opts?.fromBranch) return
          const idx = s.messages.findIndex((m) => m.id === messageId)
          if (idx < 0) return
          const target = s.messages[idx]
          // アシスタント発言: それ自身と以降を破棄して再生成
          // ユーザー発言: その発言は残し、以降を破棄して応答を作り直す
          const keepUpto = target.role === 'assistant' ? idx : idx + 1
          const speaker = target.role === 'assistant' ? target.characterId : undefined
          const kept = s.messages.slice(0, keepUpto)
          // 上書きガード → 切り詰め後に残る地点へ戻してから生成（FB3-B1/FB6-C）
          const keptIds = new Set(kept.map((m) => m.id))
          const tree = get().branchTrees[s.id]
          if (!(await ensureLineTip(s.id, findReanchorTarget(tree, keptIds) ?? tree?.currentId))) return
          reanchorBranch(s.id, keptIds)
          // シーン境界をまたいで巻き戻した場合、置き去りの後続シーン（stale な見出し・あらすじ）を
          // scenes/currentSceneId から落とす（バグ修正。跨がなければ変更なし）
          const rewound = rewindScenesFor(s, kept)
          patchActive({ messages: kept, ...rewound })
          await runCompletion(speaker)
        },

        branchFromMessage: async (messageId) => {
          const s = active()
          if (!s || get().isStreaming) return
          if (!s.messages.some((m) => m.id === messageId)) return
          const tree = get().branchTrees[s.id]
          // 現在の線の先端（currentId）に名前を付けて保護（git のブランチ ref 相当）。
          // 以降の上書きガードはこの線を消さないので、regenerateFrom はそのまま兄弟分岐を作る
          if (tree?.currentId) {
            const tip = tree.nodes.find((n) => n.id === tree.currentId)
            const name = await appPrompt({
              title: 'ここから分岐',
              message: '今の続きを分岐として残します。名前を付けてください',
              initial: (tip?.label ?? '分岐').slice(0, 24),
            })
            if (name === null) return
            setBranchNameOn(s.id, tree.currentId, name.trim() || tip?.label || '分岐')
          }
          await get().regenerateFrom(messageId, { fromBranch: true })
        },

        branchFromNode: async (sessionId, nodeId) => {
          const tree = get().branchTrees[sessionId]
          if (!tree || tree.currentId === nodeId || !tree.nodes.some((n) => n.id === nodeId)) return
          if (tree.currentId) {
            const tip = tree.nodes.find((n) => n.id === tree.currentId)
            const name = await appPrompt({
              title: 'ここから分岐して再開',
              message: 'いま進めている続きを分岐として残します。名前を付けてください',
              initial: (tip?.label ?? '分岐').slice(0, 24),
            })
            if (name === null) return
            setBranchNameOn(sessionId, tree.currentId, name.trim() || tip?.label || '分岐')
          }
          await get().restoreCheckpoint(sessionId, nodeId)
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

        exportBundle: async (includeImages) => {
          const { characters, worlds, sessions, cassettes, sessionImageLogs } = get()
          // providers（API キー）は localStorage のみに保持し、エクスポートには含めない（共有時の漏洩防止）
          const bundle: ExportBundle = {
            type: 'ai-storytelling-studio',
            version: 1,
            exportedAt: Date.now(),
            characters,
            worlds,
            sessions,
            cassettes,
            sessionImageLogs,
          }
          if (includeImages) {
            const ids = collectUsedImageIds(characters, sessions, cassettes, sessionImageLogs)
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
          const incomingWorlds = (bundle.worlds ?? []).map((w: any) => ({
            ...w,
            relationAspects: Array.isArray(w.relationAspects) ? w.relationAspects : [],
            ...(w.startPreset
              ? { startPreset: { ...w.startPreset, introTags: normalizeIntroTags(w.startPreset.introTags) } }
              : {}),
          }))
          const incomingSessions = (bundle.sessions ?? []).map((sess: any) => ({
            ...sess,
            introBindings: normalizeIntroBindings(sess.introBindings),
            story: { ...sess.story, introTags: normalizeIntroTags(sess.story?.introTags) },
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
              sessions: mergeById(st.sessions, incomingSessions),
              cassettes: mergeById(
                st.cassettes,
                (bundle.cassettes ?? []).map((cassette: any) => ({
                  ...cassette,
                  session: cassette.session
                    ? {
                        ...cassette.session,
                        introBindings: normalizeIntroBindings(cassette.session.introBindings),
                        story: {
                          ...cassette.session.story,
                          introTags: normalizeIntroTags(cassette.session.story?.introTags),
                        },
                      }
                    : cassette.session,
                })),
              ),
              // 画像の永続記録はセッション単位で record id の dedupe マージ（FB6-A）
              sessionImageLogs: mergeImageLogs(st.sessionImageLogs, bundle.sessionImageLogs ?? {}),
              // providers はユーザー固有の設定のためインポート対象外
            }
          })
          return { added }
        },

        // PNG カード / JSON バンドルの種別自動判別取り込み（System・Library 共通の入口）
        importAnyFile: async (file) => {
          const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')
          if (isPng) {
            const bytes = new Uint8Array(await file.arrayBuffer())
            const parsed = parseCardPng(bytes)
            if (!parsed) throw new Error('カード情報が見つかりません。')
            if (parsed.kind === 'character') {
              const withImage = await attachCardImage(parsed.character, bytes)
              get().importCharacterCard(withImage)
              return `カードから「${withImage.name || '無名'}」を追加しました。`
            }
            if (parsed.kind === 'cassette') {
              await get().importCassette(parsed.bundle, new Blob([bytes as BlobPart], { type: 'image/png' }))
              return `ゲームカセット「${parsed.bundle.session.title || '無題'}」を棚に登録しました（「作る > カセット」から遊べます）。`
            }
            get().importWorldCard(parsed.world)
            return `カードから「${parsed.world.name || '無名の世界'}」を追加しました。`
          }
          const bundle = parseBundle(await file.text())
          const { added } = await get().importBundle(bundle)
          const imgNote =
            bundle.images && bundle.images.length > 0 ? `（画像 ${bundle.images.length} 件を含む）` : ''
          return `インポート完了：${added} 件を追加しました（既存は保持）。${imgNote}`
        },

        // ゲームカセットは「棚に登録」する（FB2-E）。素材（キャラ/世界）はライブラリへ
        // マージ・同梱画像は remap するが、セッションは作らず Cassette として cassettes に積む。
        // 実際に遊ぶのは playCassette（複製してセッション化）。
        importCassette: async (bundle, cover) => {
          // 1) 同梱画像を IndexedDB へ登録し直し、旧 id → 新 id の対応表を作る（直列）
          const idMap = new Map<string, string>()
          for (const entry of bundle.images) {
            const newId = await putImage(sessionCardImageBlob(entry))
            idMap.set(entry.id, newId)
          }
          // 2) 表紙＝取り込んだカード PNG そのものを保存（無ければ表紙なし）
          let coverImageId: string | undefined
          if (cover) coverImageId = await putImage(cover)

          const remapAvatar = <T extends { avatar: Avatar }>(x: T): T => ({
            ...x,
            avatar: { ...x.avatar, imageId: x.avatar.imageId ? idMap.get(x.avatar.imageId) : undefined },
          })
          set((st) => {
            const now = Date.now()
            const charIds = new Set(st.characters.map((c) => c.id))
            const freshChars = bundle.characters
              .filter((c) => !charIds.has(c.id))
              .map(remapAvatar)
            const worldExists = bundle.world && st.worlds.some((w) => w.id === bundle.world!.id)
            const freshWorlds = bundle.world && !worldExists ? [bundle.world] : []

            // カセットの同梱セッションは開始状態（freshSessionOf 済み）。挿絵の remap のみ行う
            const session: Session = {
              ...bundle.session,
              scenes: bundle.session.scenes.map((sc) => ({
                ...sc,
                illustrations: (sc.illustrations ?? []).map((ill) => ({
                  ...ill,
                  imageId: idMap.get(ill.imageId) ?? ill.imageId,
                })),
              })),
            }
            const cassette: Cassette = {
              id: uid(),
              title: bundle.session.title || '無題のカセット',
              description: bundle.description ?? '',
              coverImageId,
              session,
              createdAt: now,
            }
            return {
              characters: [...freshChars, ...st.characters],
              worlds: [...freshWorlds, ...st.worlds],
              cassettes: [cassette, ...st.cassettes],
            }
          })
        },

        upsertCassette: (cassette) =>
          set((st) => {
            const exists = st.cassettes.some((c) => c.id === cassette.id)
            return {
              cassettes: exists
                ? st.cassettes.map((c) => (c.id === cassette.id ? cassette : c))
                : [cassette, ...st.cassettes],
            }
          }),

        playCassette: (cassetteId) => {
          const cas = get().cassettes.find((c) => c.id === cassetteId)
          if (!cas) return
          const now = Date.now()
          // 同梱セッションを丸ごと複製して新しい id で開始（何度でも最初から遊べる）
          const cloned = JSON.parse(JSON.stringify(cas.session)) as Session
          // カセットはモデル参照を持たない（freshSessionOf が空にする）ため既定モデルで開始する。
          // 旧カセット（DEFAULT_MODEL が刻印されたままの下書き）も未設定として扱う
          const model =
            cloned.model && cloned.model !== DEFAULT_MODEL
              ? cloned.model
              : get().defaultModelRef || DEFAULT_MODEL
          // 出自を刻む（FB9-B。カセット棚の到達エンディング数はこれを集計キーにする）
          const session: Session = {
            ...cloned,
            id: uid(),
            model,
            originCassetteId: cas.id,
            createdAt: now,
            updatedAt: now,
          }
          set((st) => ({
            sessions: [session, ...st.sessions],
            activeId: session.id,
            view: 'sessions' as View,
          }))
        },

        deleteCassette: (cassetteId) =>
          set((st) => ({ cassettes: st.cassettes.filter((c) => c.id !== cassetteId) })),

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

        // ── 環境音ピン（AM1）──────────────────────────────
        // Scene の中に持つので、チェックポイント（分岐）には何もせずそのまま乗る。
        // 削除は参照除去のみ＝内蔵カタログの音源実体には触らない（挿絵の GC 規約と同じ精神）。
        addAmbientPin: (sessionId, sceneId, pin) =>
          set((st) => ({
            sessions: st.sessions.map((s) =>
              s.id !== sessionId
                ? s
                : {
                    ...s,
                    scenes: s.scenes.map((sc) =>
                      sc.id !== sceneId ? sc : { ...sc, ambientPins: [...(sc.ambientPins ?? []), pin] },
                    ),
                  },
            ),
          })),

        updateAmbientPin: (sessionId, sceneId, pinId, patch) =>
          set((st) => ({
            sessions: st.sessions.map((s) =>
              s.id !== sessionId
                ? s
                : {
                    ...s,
                    scenes: s.scenes.map((sc) =>
                      sc.id !== sceneId
                        ? sc
                        : {
                            ...sc,
                            ambientPins: (sc.ambientPins ?? []).map((p) =>
                              p.id === pinId ? { ...p, ...patch } : p,
                            ),
                          },
                    ),
                  },
            ),
          })),

        removeAmbientPin: (sessionId, sceneId, pinId) =>
          set((st) => ({
            sessions: st.sessions.map((s) =>
              s.id !== sessionId
                ? s
                : {
                    ...s,
                    scenes: s.scenes.map((sc) =>
                      sc.id !== sceneId
                        ? sc
                        : { ...sc, ambientPins: (sc.ambientPins ?? []).filter((p) => p.id !== pinId) },
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
            steps: args.steps,
            sampler: args.sampler,
            cfg: args.cfg,
            quality: args.quality,
            count: args.count,
            status: 'running',
            results: [],
            createdAt: Date.now(),
          }
          set((st) => ({ imageJobs: [...st.imageJobs, job] }))
          runImageJobLoop(id, args)
          return id
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
            // 先に永続記録へ追記する（FB6-A）。配置先シーンが分岐切替で消えていても記録には残る
            const scene = get()
              .sessions.find((s) => s.id === target.sessionId)
              ?.scenes.find((sc) => sc.id === target.sceneId)
            appendImageRecord(target.sessionId, {
              id: uid(),
              imageId,
              prompt: job.prompt,
              negative: job.negative,
              sceneId: target.sceneId,
              sceneTitle: scene?.title || undefined,
              timeLabel: scene?.timeLabel,
              messageId: target.messageId,
              createdAt: Date.now(),
            })
            get().addIllustration(target.sessionId, target.sceneId, {
              id: uid(),
              imageId,
              prompt: job.prompt,
              negative: job.negative,
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
          }
          get().dismissImageJob(jobId)
        },

        gcUnusedImages: async () => {
          const { characters, sessions, cassettes, branchTrees, sessionImageLogs } = get()
          const used = collectUsedImageIds(characters, sessions, cassettes, sessionImageLogs)
          // チェックポイント（分岐ツリー）が参照する画像も使用中扱い（GC 一本化。C1）
          for (const tree of Object.values(branchTrees)) {
            for (const node of tree.nodes) {
              for (const id of node.imageIds) used.add(id)
              if (node.star?.thumbImageId) used.add(node.star.thumbImageId)
            }
          }
          return gcImages(used)
        },

        deleteImageRecord: (sessionId, recordId) =>
          set((st) => {
            const records = st.sessionImageLogs[sessionId]
            if (!records) return {}
            return {
              sessionImageLogs: {
                ...st.sessionImageLogs,
                [sessionId]: records.filter((r) => r.id !== recordId),
              },
            }
          }),

        backfillImageLogs: async () => {
          if (get().imageLogBackfillDone) return
          // 実在する画像だけ登録する（GC 済みの参照は record 化しない）
          let existing: Set<string>
          try {
            existing = new Set(await listImageIds())
          } catch {
            return // 画像ストアが読めない時はフラグを立てず次回起動時に再試行
          }
          const { sessions, branchTrees } = get()
          const patch: Record<string, SessionImageRecord[]> = {}
          let total = 0
          for (const session of sessions) {
            const seen = new Set((get().sessionImageLogs[session.id] ?? []).map((r) => r.imageId))
            // ライブの本文にある分（プロンプト・アンカー付きで最も情報が正確なので先に）
            const records = extractImageRecords(session, seen)
            // 全スナップショット走査（他分岐にしか無い画像を拾う）
            for (const node of branchTrees[session.id]?.nodes ?? []) {
              // 未知の imageId を含まないノードは展開しない（gunzip の節約）
              if (!node.imageIds.some((id) => !seen.has(id))) continue
              try {
                const raw = await checkpointStore.get(session.id, node.id)
                if (!raw) continue
                const parsed = JSON.parse(await gunzipText(raw)) as { v: number; session: Session }
                records.push(...extractImageRecords(parsed.session, seen))
              } catch {
                continue // 壊れたスナップショットはスキップ
              }
            }
            const valid = records.filter((r) => existing.has(r.imageId))
            if (valid.length === 0) continue
            valid.sort((a, b) => a.createdAt - b.createdAt)
            patch[session.id] = [...(get().sessionImageLogs[session.id] ?? []), ...valid]
            total += valid.length
          }
          set((st) => ({
            sessionImageLogs: { ...st.sessionImageLogs, ...patch },
            imageLogBackfillDone: true,
            ...(total > 0
              ? { infoNotice: `過去の画像 ${total} 件をギャラリーの「すべての記録」に登録しました` }
              : {}),
          }))
        },
      }
    },
    {
      // キー文字列は platform.ts の PERSIST_KEY と共有（Tauri のファイル backend が旧 WebView
      // localStorage からの移行判定に使う）。
      name: PERSIST_KEY,
      storage: createJSONStorage(() => stateStorage),
      // スキーマ版番（R1）。入れ物＝ここ、セーブデータとカセット定義＝partialize の schemaVersions。
      // 移行の定義は lib/schema.ts に集約する（**この2行と migrate 本体を消さない**）
      version: APP_STATE_VERSION,
      migrate: (persisted, from) => {
        const result = migrateAppState(persisted, from)
        if (result.ok) return result.state
        // 読めないデータを既定値で上書きしない。書き込みを封印したまま案内画面へ（App.tsx）
        blockStateWrites()
        return { schemaError: result.error } as Partial<AppState>
      },
      partialize: (st) => ({
        // セーブデータ／カセット定義の版番（入れ物の版番が据え置きでも単独で上げられる）
        schemaVersions: CURRENT_SCHEMA_VERSIONS,
        // R3: Tauri では apiKey を落として保存する（唯一の保存先は資格情報ストア。stripApiKeyForPersist）
        providers: stripApiKeyForPersist(st.providers),
        // 画像生成の接続先も API キーを含むため localStorage のみ（exportBundle には含めない）
        imageProviders: stripApiKeyForPersist(st.imageProviders),
        lastImageProviderId: st.lastImageProviderId,
        lastDraftModel: st.lastDraftModel,
        defaultModelRef: st.defaultModelRef,
        favoriteModels: st.favoriteModels,
        characters: st.characters,
        worlds: st.worlds,
        sessions: st.sessions,
        cassettes: st.cassettes,
        activeId: st.activeId,
        branchTrees: st.branchTrees,
        sessionImageLogs: st.sessionImageLogs,
        imageLogBackfillDone: st.imageLogBackfillDone,
        ui: st.ui,
      }),
      // 生成中にタブを閉じた/リロードした際の残骸を起動時に掃除する：
      // 空の pending メッセージは削除、内容があるものは途中で切れた可能性が高いため
      // truncated を立てて「⤵ 続きを生成」で復帰できるようにする。
      merge: (persisted, current) => {
        // セーブデータ／カセット定義の移行はここで毎回判定する（入れ物の版番が変わらない限り
        // zustand の migrate は呼ばれないため。R1）
        const sub = migrateSubSchemas(persisted ?? {})
        if (!sub.ok) {
          blockStateWrites()
          return { ...current, schemaError: sub.error }
        }
        // 版番はストアの状態としては持ち回らない（書き出しは partialize が毎回付け直す）
        const { schemaVersions: _versions, ...rest } = (sub.state ?? {}) as Partial<AppState> & {
          schemaVersions?: SchemaVersions
        }
        const p = rest
        // ui は normalizeUiPrefs で現行スキーマへ正規化（旧・段階式の文字列値を数値へ引き継ぐ。F2）
        const merged = { ...current, ...p, ui: normalizeUiPrefs({ ...current.ui, ...(p.ui ?? {}) }) }
        merged.worlds = (merged.worlds ?? []).map((world) => ({
          ...world,
          ...(world.startPreset
            ? { startPreset: { ...world.startPreset, introTags: normalizeIntroTags(world.startPreset.introTags) } }
            : {}),
        }))
        merged.sessions = (merged.sessions ?? []).map((s) => {
          // story に opening/openingTitle を後方補完（旧セッションは undefined のため .trim() が例外になる。FB2-B）。
          // s.story を先に spread してから既定値を当てることで initialDirective 等の他フィールドを落とさない。
          const story = {
            ...s.story,
            premise: s.story?.premise ?? '',
            genre: s.story?.genre ?? '',
            opening: s.story?.opening ?? '',
            openingTitle: s.story?.openingTitle ?? '',
            introTags: normalizeIntroTags(s.story?.introTags),
          }
          const messages = s.messages.some((m) => m.pending)
            ? s.messages
                .filter((m) => !(m.pending && !m.content.trim()))
                .map((m) => (m.pending ? { ...m, pending: false, truncated: true } : m))
            : s.messages
          return {
            ...s,
            story,
            introBindings: normalizeIntroBindings(s.introBindings),
            messages,
          }
        })
        merged.cassettes = (merged.cassettes ?? []).map((cassette) => ({
          ...cassette,
          session: {
            ...cassette.session,
            introBindings: normalizeIntroBindings(cassette.session?.introBindings),
            story: {
              ...cassette.session?.story,
              introTags: normalizeIntroTags(cassette.session?.story?.introTags),
            },
          },
        }))
        return merged
      },
    },
  ),
)
