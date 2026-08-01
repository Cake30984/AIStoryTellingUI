import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type {
  AmbientPin,
  AchievementDef,
  Avatar,
  BranchNode,
  BranchTree,
  Cassette,
  Character,
  Choice,
  Clause,
  Condition,
  CounterDef,
  CounterEvent,
  Development,
  EndingDef,
  EndingRecord,
  ExactGroupCandidate,
  ExportBundle,
  GroupSubClause,
  ImageProvider,
  LoreEntry,
  Message,
  MoodChange,
  NextSceneSuggestion,
  Op,
  Partner,
  PartyRef,
  OpenRouterModel,
  Persona,
  Provider,
  RelationAspectDef,
  RelationUpdate,
  RoleAssignment,
  RoleParty,
  Scene,
  ScheduledEvent,
  StatChange,
  SceneIllustration,
  SceneReview,
  Session,
  SessionImageRecord,
  SessionMode,
  SessionState,
  StatDef,
  UiPrefs,
  World,
} from './types'
import { DEFAULT_UI, normalizeUiPrefs } from './types'
import { fetchModels, streamChat } from './lib/openrouter'
import { base64ToBlob, blobToBase64, gcImages, getImage, listImageIds, putImage, putImageAs } from './lib/imageStore'
import { checkpointStore, PERSIST_KEY, stateStorage } from './lib/platform'
import { gunzipText, gzipText } from './lib/checkpoint'
import { normalizeImage } from './lib/avatarGen'
import { parseStructured, plainTextOf } from './lib/structured'
import { generateImage } from './lib/imageGen'
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
  choicesSystem,
  choicesUserNudge,
  CONTINUATION_NUDGE,
  CONTINUE_PROMPT,
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
import {
  castingIssueLabel,
  normalizeIntroBindings,
  normalizeIntroTags,
  normalizeRoleAssignments,
  normalizeWorldRoles,
  resolveIntroText,
  validateCasting,
} from './lib/casting'

export const DEFAULT_MODEL = 'openrouter/auto'

export type View = 'sessions' | 'characters' | 'worlds' | 'personas' | 'cassettes' | 'system'

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

/** スタット値を def の min..max に丸める（未指定は無制限） */
function clampStat(v: number, def?: { min?: number; max?: number }): number {
  let x = Math.round(v)
  if (def?.min != null) x = Math.max(def.min, x)
  if (def?.max != null) x = Math.min(def.max, x)
  return x
}

/**
 * レビュー statChanges の delta を定義の変動幅 deltaMin..deltaMax にクランプする（FB7-C。符号維持）。
 * 0 は「変動なし＝項目を出さない」扱いで対象外（deltaMin は「動かすなら最低これだけ動く」の意味）。
 * 未設定側は従来の ±1,000,000 安全クランプのみ。
 */
export function clampReviewDelta(
  delta: number,
  def?: { deltaMin?: number; deltaMax?: number },
): number {
  let x = Math.round(delta) || 0
  if (x === 0) return 0
  const sign = x < 0 ? -1 : 1
  let abs = Math.abs(x)
  if (def?.deltaMin != null) abs = Math.max(Math.abs(def.deltaMin), abs)
  if (def?.deltaMax != null) abs = Math.min(Math.abs(def.deltaMax), abs)
  abs = Math.min(1_000_000, abs)
  return sign * abs
}

/**
 * レビュー counterEvents の amount を定義の加算幅 amountMin..amountMax にクランプする
 * （FB7-C。既定範囲 1..1000 の中でさらに絞る）。
 */
export function clampCounterAmount(
  amount: number,
  def?: { amountMin?: number; amountMax?: number },
): number {
  let x = Math.max(1, Math.min(1000, Math.round(amount) || 1))
  if (def?.amountMin != null) x = Math.max(Math.max(1, def.amountMin), x)
  if (def?.amountMax != null) x = Math.min(Math.min(1000, def.amountMax), x)
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
    case 'achievement': {
      const has = state.achievements.some((a) => a.defId === clause.defId)
      return has === clause.have
    }
    default:
      return false
  }
}

/** 割り当てキャラ id を Partner（名前つき）へ。名前が引けなければ id を仮名にする */
export function partnersOf(ids: string[], characters: { id: string; name: string }[]): Partner[] {
  return ids.map((id) => ({
    characterId: id,
    name: characters.find((c) => c.id === id)?.name || id,
  }))
}

/** RoleParty（名前つき当事者組）を永続化用の PartyRef（参照のみ）へ落とす。メンバー0人の群は含めない */
export function partiesOf(subjects: RoleParty[]): PartyRef[] {
  return subjects
    .filter((p) => p.members.length > 0)
    .map((p) => ({ roleId: p.roleId, characterIds: p.members.map((m) => m.characterId) }))
}

/** 永続化された PartyRef を表示・置換用の RoleParty（ロール名・現在の実名つき）へ解決する */
export function resolveParties(
  parties: PartyRef[] | undefined,
  world: World | undefined,
  characters: { id: string; name: string }[],
): RoleParty[] {
  return (parties ?? []).map((p) => ({
    roleId: p.roleId,
    roleName: world?.roles?.find((r) => r.id === p.roleId)?.name || '',
    members: partnersOf(p.characterIds, characters),
  }))
}

/** group 節の下位条件（GroupSubClause）を1キャラについて評価する */
function evalGroupSubClause(
  sub: GroupSubClause,
  characterId: string,
  state: SessionState,
  world: World | undefined,
): boolean {
  switch (sub.kind) {
    case 'stat': {
      const def = world?.stats.find((d) => d.id === sub.defId)
      if (!def) return false
      const v =
        state.stats.find((s) => s.defId === sub.defId && s.characterId === characterId)?.value ??
        def.default
      return compareOp(v, sub.op, sub.value)
    }
    case 'counter': {
      const def = world?.counters.find((d) => d.id === sub.defId)
      if (!def) return false
      const v =
        state.counters.find((c) => c.defId === sub.defId && c.characterId === characterId)?.value ?? 0
      return compareOp(v, sub.op, sub.value)
    }
    default:
      return false
  }
}

/** ロール当事者組をロール単位でマージする（同一 roleId は members を id 重複無しで合併） */
function mergeRoleParties(parties: RoleParty[]): RoleParty[] {
  const byRole = new Map<string, RoleParty>()
  for (const p of parties) {
    const cur = byRole.get(p.roleId)
    if (!cur) {
      byRole.set(p.roleId, { ...p, members: [...p.members] })
      continue
    }
    for (const m of p.members) {
      if (!cur.members.some((x) => x.characterId === m.characterId)) cur.members.push(m)
    }
  }
  return Array.from(byRole.values())
}

/**
 * group 節1つを評価する（docs/設計_ロールグループと定量条件.md B-2）。
 * members はロールへ配役された参加キャラ（参加キャラ順）。quantifier で成立を判定し、
 * subject なら当事者（exactly は候補から n 人に絞る。それ以外は satisfying 全員）を返す。
 * exactly な subject 節は満たした全員を `exactCandidates` としても返す（エンディングレビューの
 * n 人選択 UI 用。B-5）。`exactSelections[roleId]` に有効な選択（satisfying の部分集合・ちょうど n 人）
 * があればそれを当事者にし、無ければ参加キャラ順の先頭 n 人を既定にする。
 */
function evalGroupClause(
  clause: Extract<Clause, { kind: 'group' }>,
  state: SessionState,
  world: World | undefined,
  characterIds: string[],
  roleAssignments: RoleAssignment[] | undefined,
  characters: { id: string; name: string }[],
  exactSelections?: Record<string, string[]>,
): { ok: boolean; subjects: RoleParty[]; exactCandidates: ExactGroupCandidate[] } {
  const role = world?.roles?.find((r) => r.id === clause.roleId)
  const memberIds = new Set(
    (roleAssignments ?? [])
      .filter((ra) => ra.roleId === clause.roleId)
      .map((ra) => ra.characterId),
  )
  const members = characterIds.filter((cid) => memberIds.has(cid))
  const satisfying = members.filter((cid) =>
    clause.clauses.every((sub) => evalGroupSubClause(sub, cid, state, world)),
  )
  const q = clause.quantifier
  const ok =
    q.kind === 'all'
      ? members.length > 0 && satisfying.length === members.length
      : satisfying.length >= q.n
  if (!clause.subject || !ok) return { ok, subjects: [], exactCandidates: [] }
  if (q.kind !== 'exactly') {
    return {
      ok,
      subjects: [{ roleId: clause.roleId, roleName: role?.name ?? '', members: partnersOf(satisfying, characters) }],
      exactCandidates: [],
    }
  }
  const picked = exactSelections?.[clause.roleId]
  const chosenIds =
    picked && picked.length === q.n && picked.every((id) => satisfying.includes(id))
      ? picked
      : satisfying.slice(0, q.n)
  return {
    ok,
    subjects: [{ roleId: clause.roleId, roleName: role?.name ?? '', members: partnersOf(chosenIds, characters) }],
    exactCandidates: [
      { roleId: clause.roleId, roleName: role?.name ?? '', n: q.n, candidates: partnersOf(satisfying, characters) },
    ],
  }
}

/**
 * 条件式を評価する純関数（docs/設計_ロールグループと定量条件.md B-2）。
 * 平の節（stat/counter/achievement）は「参加キャラの誰か1人が満たす（∃）」のゲートとして
 * evalClause で判定し、当事者にはならない。group 節は evalGroupClause でロールの当事者を求める。
 * all は全節が真、any はいずれかの節が真で成立。当事者は「成立に寄与した」subject な group 節の合併。
 */
export function matchGroups(
  cond: Condition | undefined,
  state: SessionState,
  world: World | undefined,
  characterIds: string[],
  roleAssignments: RoleAssignment[] | undefined,
  characters: { id: string; name: string }[] = [],
  exactSelections?: Record<string, string[]>,
): { ok: boolean; subjects: RoleParty[]; exactCandidates: ExactGroupCandidate[] } {
  if (!cond) return { ok: false, subjects: [], exactCandidates: [] }
  const clauses = 'all' in cond ? cond.all : cond.any
  if (clauses.length === 0) return { ok: false, subjects: [], exactCandidates: [] }
  const isAll = 'all' in cond
  const results = clauses.map((c) =>
    c.kind === 'group'
      ? evalGroupClause(c, state, world, characterIds, roleAssignments, characters, exactSelections)
      : { ok: evalClause(c, state, world, characterIds), subjects: [] as RoleParty[], exactCandidates: [] as ExactGroupCandidate[] },
  )
  const ok = isAll ? results.every((r) => r.ok) : results.some((r) => r.ok)
  const contributing = isAll ? results : results.filter((r) => r.ok)
  return {
    ok,
    subjects: mergeRoleParties(contributing.flatMap((r) => r.subjects)),
    exactCandidates: contributing.flatMap((r) => r.exactCandidates),
  }
}

/**
 * `@ロール名` をその subject ロールの当事者メンバー名（複数は「・」連結）へ置換する。
 * `@相手` は全 subject 当事者名の連結（単一群の簡易記法）。当事者が居ないプレースホルダはそのまま残す。
 */
export function bindRoleNames(text: string, subjects: RoleParty[] | undefined): string {
  if (!text || !subjects || subjects.length === 0) return text
  let out = text
  for (const party of subjects) {
    if (!party.roleName) continue
    const names = party.members.map((m) => m.name).join('・')
    if (!names) continue
    out = out.split(`@${party.roleName}`).join(names)
  }
  const allNames = subjects.flatMap((p) => p.members.map((m) => m.name))
  if (allNames.length > 0) out = out.split('@相手').join(allNames.join('・'))
  return out
}

/** 条件式を評価する（成立するか）。`matchGroups` の互換窓口。節が空なら不成立扱い。 */
export function evalCondition(
  cond: Condition | undefined,
  state: SessionState,
  world: World | undefined,
  characterIds: string[],
  roleAssignments: RoleAssignment[] | undefined,
): boolean {
  return matchGroups(cond, state, world, characterIds, roleAssignments).ok
}

/**
 * 旧「関係フラグ」節（FB9-C で撤去）を World の条件式から取り除く純関数。persist の merge で通す。
 * 残したままだと union から消えた kind が evalClause の `default: return false` に落ち、実績・
 * エンディング・イベントが恒久的に発火しなくなる。節が空になった条件は `matchGroups` が不成立を
 * 返す（空の節リストは false）ので、「条件が空＝常に成立」の事故は起きない。
 * 旧節を持たない World は同一参照のまま返す（起動時の無駄なオブジェクト生成を避ける）。
 */
export function stripLegacyFlagClauses(world: World): World {
  const isLegacy = (c: unknown): boolean =>
    (c as { kind?: string } | null | undefined)?.kind === 'relationFlag'
  const hasLegacy = (cond: Condition | undefined): boolean => {
    if (!cond) return false
    const clauses = ('all' in cond ? cond.all : cond.any) ?? []
    return clauses.some((c) => isLegacy(c) || (c.kind === 'group' && c.clauses.some(isLegacy)))
  }
  const cleanOne = (cond: Condition): Condition => {
    if (!hasLegacy(cond)) return cond
    const clauses = ('all' in cond ? cond.all : cond.any) ?? []
    const kept = clauses
      .filter((c) => !isLegacy(c))
      .map((c) => (c.kind === 'group' ? { ...c, clauses: c.clauses.filter((s) => !isLegacy(s)) } : c))
    return 'all' in cond ? { all: kept } : { any: kept }
  }
  // AchievementDef.condition は必須・EndingDef/ScheduledEvent は任意なので入口を分ける
  const cleanOpt = (cond: Condition | undefined): Condition | undefined =>
    cond ? cleanOne(cond) : cond

  const achievements = world.achievements ?? []
  const endings = world.endings ?? []
  const events = world.scheduledEvents ?? []
  const touched =
    achievements.some((a) => hasLegacy(a.condition)) ||
    endings.some((e) => hasLegacy(e.condition)) ||
    events.some((e) => hasLegacy(e.condition))
  if (!touched) return world
  return {
    ...world,
    achievements: achievements.map((a) => ({ ...a, condition: cleanOne(a.condition) })),
    endings: endings.map((e) => ({ ...e, condition: cleanOpt(e.condition) })),
    scheduledEvents: events.map((e) => ({ ...e, condition: cleanOpt(e.condition) })),
  }
}

/** 新規解除された実績1件（当事者つき。トースト・`@ロール名` 置換に使う） */
export interface UnlockedAchievement {
  def: AchievementDef
  subjects: RoleParty[]
}

/**
 * 実績条件の group 節で `exactly n` を `atLeast n` に読み替える（実績は自動解除で n 人選択 UI が無いため。
 * docs/設計_ロールグループと定量条件.md B-5：exactly は atLeast と同視し当事者＝satisfying 全員とする）。
 */
function degradeExactlyForAchievement(cond: Condition): Condition {
  const map = (c: Clause): Clause =>
    c.kind === 'group' && c.quantifier.kind === 'exactly'
      ? { ...c, quantifier: { kind: 'atLeast', n: c.quantifier.n } }
      : c
  return 'all' in cond ? { all: cond.all.map(map) } : { any: cond.any.map(map) }
}

/**
 * World 定義の実績を state へ反復評価し、新規解除分を記録して返す（連鎖依存も1パスで解決）。
 * subject な group 節を含む定義は当事者の組ごとに独立に解除する＝解除記録は (defId, 当事者組) 単位。
 * シーン確定時・状態の手動編集時など、state が変わり得るあらゆる場所から共通で呼ぶ。
 */
function unlockAchievements(
  state: SessionState,
  world: World | undefined,
  characterIds: string[],
  roleAssignments: RoleAssignment[] | undefined,
  characters: { id: string; name: string }[] = [],
): { state: SessionState; unlocked: UnlockedAchievement[] } {
  const achievements = state.achievements.map((a) => ({ ...a }))
  const candidate: SessionState = { ...state, achievements }
  const unlocked: UnlockedAchievement[] = []
  const keyOf = (defId: string, parties: PartyRef[]) =>
    `${defId}@${parties
      .map((p) => `${p.roleId}:${[...p.characterIds].sort().join('+')}`)
      .sort()
      .join('|')}`
  const done = new Set(achievements.map((a) => keyOf(a.defId, a.parties ?? [])))
  let progressed = true
  while (progressed) {
    progressed = false
    for (const def of world?.achievements ?? []) {
      const cond = degradeExactlyForAchievement(def.condition)
      const result = matchGroups(cond, candidate, world, characterIds, roleAssignments, characters)
      if (!result.ok) continue
      const parties = partiesOf(result.subjects)
      const key = keyOf(def.id, parties)
      if (done.has(key)) continue
      done.add(key)
      achievements.push({
        defId: def.id,
        unlockedAt: Date.now(),
        ...(parties.length ? { parties } : {}),
      })
      unlocked.push({ def, subjects: result.subjects })
      progressed = true
    }
  }
  return { state: candidate, unlocked }
}

/**
 * 条件成立エンディングを配列順（＝優先度）で1つ返す純関数（E2）。
 * fallback=true・condition 未設定の定義はスキップ（fallback は満了時の受け皿であり条件判定の対象外）。
 * 満了判定・session.ending の既set・過去シーン判定は呼び出し側（confirmSceneReview／モーダル）が行う。
 */
export function checkEndings(
  endings: EndingDef[] | undefined,
  state: SessionState,
  world: World | undefined,
  characterIds: string[],
  roleAssignments: RoleAssignment[] | undefined,
  characters: { id: string; name: string }[] = [],
  exactSelections?: Record<string, string[]>,
): { def: EndingDef; subjects: RoleParty[]; exactCandidates: ExactGroupCandidate[] } | undefined {
  for (const e of endings ?? []) {
    if (e.fallback || !e.condition) continue
    const result = matchGroups(e.condition, state, world, characterIds, roleAssignments, characters, exactSelections)
    if (result.ok) return { def: e, subjects: result.subjects, exactCandidates: result.exactCandidates }
  }
  return undefined
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

/** エンディング到達記録を同値 dedupe でマージする（E3。id を持たないため4フィールドの組で判定） */
function mergeEndingRecords(cur: EndingRecord[], inc: EndingRecord[]): EndingRecord[] {
  // 同一性は (世界観, エンディング, セッション, 到達時刻)。cassetteId はセッションから導かれる従属値
  // なのでキーに含めない（含めると FB9-B 以前の記録と以後の記録が別物になり棚が二重計上する）
  const key = (r: EndingRecord) => `${r.worldId}|${r.endingDefId}|${r.sessionId}|${r.reachedAt}`
  const merged = [...cur]
  const at = new Map(merged.map((r, i) => [key(r), i]))
  for (const r of inc) {
    if (!r || typeof r.worldId !== 'string' || typeof r.endingDefId !== 'string') continue
    const k = key(r)
    const i = at.get(k)
    if (i == null) {
      at.set(k, merged.length)
      merged.push(r)
      continue
    }
    // 既存が FB9-B 以前で出自を持たない場合だけ、取り込み側の cassetteId を補う（棚の取りこぼし防止）
    if (r.cassetteId && !merged[i].cassetteId) merged[i] = { ...merged[i], cassetteId: r.cassetteId }
  }
  return merged
}

/**
 * レビュー確定で選ばれた変更を state へ適用する純関数（E2）。confirmSceneReview 内の applyState
 * クロージャをモジュールレベルへ抽出したもの。confirmSceneReview（確定）と SceneReviewModal
 * （到達プレビュー）の両方がこれを呼ぶことで、モーダルの予告と実際の発火が必ず一致する。
 * 関係性 prose は全文書き直し（aspect は aspectId 単位でマージ）、flags は和集合、スタットは
 * clamp 加算、カウンターは累計、実績は連鎖解決するまで反復評価する。
 */
export function applyReviewToState(
  base: SessionState | undefined,
  world: World | undefined,
  characterIds: string[],
  sel: {
    relationUpdates: RelationUpdate[]
    statChanges: StatChange[]
    counterEvents: CounterEvent[]
    moodChanges: MoodChange[]
  },
  roleAssignments: RoleAssignment[] | undefined,
  characters: { id: string; name: string }[] = [],
): { state: SessionState; unlocked: UnlockedAchievement[] } {
  const prev = base ?? { relations: [], moods: [], stats: [], counters: [], achievements: [] }
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
  // スタット（defId,characterId で clamp 加算。未存在は default を起点）
  const stats = prev.stats.map((sv) => ({ ...sv }))
  for (const c of sel.statChanges) {
    const def = world?.stats.find((d) => d.id === c.defId)
    const idx = stats.findIndex((sv) => sv.defId === c.defId && sv.characterId === c.characterId)
    const curVal = idx >= 0 ? stats[idx].value : (def?.default ?? 0)
    const val = clampStat(curVal + c.delta, def)
    if (idx >= 0) stats[idx].value = val
    else stats.push({ defId: c.defId, characterId: c.characterId, value: val })
  }
  // カウンター（defId,characterId で累計加算）
  const counters = (prev.counters ?? []).map((cv) => ({ ...cv }))
  for (const c of sel.counterEvents) {
    const idx = counters.findIndex((cv) => cv.defId === c.defId && cv.characterId === c.characterId)
    if (idx >= 0) counters[idx].value += c.amount
    else counters.push({ defId: c.defId, characterId: c.characterId, value: c.amount })
  }
  // 実績（数・フラグ・実績のしきい値をコードが自動判定。連鎖依存も解決するまで反復）
  return unlockAchievements(
    { relations, moods, stats, counters, achievements: prev.achievements ?? [] },
    world,
    characterIds,
    roleAssignments,
    characters,
  )
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
    roles: [],
    endings: [],
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
    (p.introTags?.length ?? 0) > 0 ||
    (p.timeline && p.timeline.slots.length > 0)
  )
}

/**
 * 世界の開始テンプレートをセッションへ流し込む差分を作る純関数（W1）。
 * overwrite=false（世界選択時の自動反映）は空欄の項目のみ埋め、入力済みを壊さない。
 * overwrite=true（手動ボタン）はテンプレートに値がある項目を全上書きする。
 * コピー方式＝以後の編集はセッション側だけを変え、World 素材は不変
 * （設計は docs/設計_開始テンプレートとゲームカセット.md）。
 * story 系は mode==='story' のみ反映（roleplay では注入も UI も無いため不可視データを作らない）。
 * timeline の「空欄」= enabled が false（一度も有効化していない）。startDay/startSlot があれば
 * その時点から開始（範囲外の値は防御的にクランプ。FB4-A）。
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
  if (p.timeline && p.timeline.slots.length > 0 && (overwrite || !d.timeline.enabled)) {
    const startDay = Math.max(1, p.timeline.startDay ?? 1)
    const startSlot = Math.min(Math.max(0, p.timeline.startSlot ?? 0), p.timeline.slots.length - 1)
    patch.timeline = {
      enabled: true,
      slots: p.timeline.slots,
      totalDays: p.timeline.totalDays,
      spanLabel: p.timeline.spanLabel,
      currentDay: startDay,
      currentSlot: startSlot,
      startDay,
      startSlot,
    }
  }
  return patch
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

export function newEndingDef(name = ''): EndingDef {
  return {
    id: uid(),
    name,
    description: '',
    condition: { all: [] },
    epilogueGuidance: '',
    auto: false,
    hidden: false,
    fallback: false,
  }
}

/** 条件節の既定値（kind 選択時の初期形） */
export function newClause(kind: Clause['kind'], world: World): Clause {
  switch (kind) {
    case 'stat':
      return { kind: 'stat', defId: world.stats[0]?.id ?? '', op: '>=', value: 0 }
    case 'counter':
      return { kind: 'counter', defId: world.counters[0]?.id ?? '', op: '>=', value: 1 }
    case 'achievement':
      return { kind: 'achievement', defId: '', have: true }
    case 'group':
      return {
        kind: 'group',
        roleId: world.roles?.[0]?.id ?? '',
        quantifier: { kind: 'all' },
        subject: false,
        clauses: [],
      }
  }
}

/** group 節の下位条件（GroupSubClause）の既定値（kind 選択時の初期形。キャラ別スタット/カウンターのみ対象） */
export function newGroupSubClause(kind: GroupSubClause['kind'], world: World): GroupSubClause {
  switch (kind) {
    case 'stat':
      return { kind: 'stat', defId: world.stats.find((d) => d.scope === 'character')?.id ?? '', op: '>=', value: 0 }
    case 'counter':
      return {
        kind: 'counter',
        defId: world.counters.find((d) => d.scope === 'character')?.id ?? '',
        op: '>=',
        value: 1,
      }
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
    roleAssignments: [],
    introBindings: [],
    authorNote: '',
    story: { premise: '', genre: '', opening: '', openingTitle: '', initialDirective: '' },
    scenes: [scene],
    currentSceneId: scene.id,
    timeline: defaultTimeline(),
    choiceMode: 'auto',
    narrativeStyle: mode === 'story' ? 'novel' : 'chat',
    eventAutoFire: true,
    usedEventIds: [],
    state: { relations: [], moods: [], stats: [], counters: [], achievements: [] },
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
  personas: Persona[],
  sessions: Session[],
  cassettes: Cassette[] = [],
  imageLogs: Record<string, SessionImageRecord[]> = {},
): Set<string> {
  const used = new Set<string>()
  for (const c of characters) {
    if (c.avatar.imageId) used.add(c.avatar.imageId)
  }
  for (const p of personas) if (p.avatar.imageId) used.add(p.avatar.imageId)
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
  personas: Persona[]
  sessions: Session[]
  /** ゲームカセット棚（配布物の素材化。FB2-E） */
  cassettes: Cassette[]
  /** エンディング到達記録（E3。エピローグ突入時に追記・persist・export/import 対象。集計はセッション単位／カセット単位＝FB9-B） */
  endingRecords: EndingRecord[]
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
  /** 開始時に未配役だったセッション。null なら配役モーダルを閉じる */
  castingSessionId: string | null
  error: string | null
  /** 直近のシーン確定で新規解除された実績（通知用・非永続。当事者名つき＝FB7-D） */
  newlyUnlockedAchievements: UnlockedAchievement[]
  /** 直近のエンディング到達（🏁 到達トースト用・非永続。エピローグ突入時にセット） */
  endingToast: { name: string } | null
  /** バックグラウンド画像生成ジョブ（Blob を含むため非永続。partialize から除外） */
  imageJobs: ImageJob[]
  /** 選択待ちに変わったジョブの通知（非永続） */
  imageJobToasts: { jobId: string; label: string }[]
  /** 一時的な案内メッセージ（没入モード起動時など。非永続・info トーストで表示。F2） */
  infoNotice: string | null
  /**
   * ツリー行クリックの本文スクロール先（FB7-B。非永続・partialize から除外）。
   * ChatPanel が消化して null に戻す。seq は同じメッセージへの連続移動でも effect を再発火させるための通番。
   */
  scrollTarget: { sessionId: string; messageId: string; seq: number } | null

  // 共通
  setView: (v: View) => void
  clearError: () => void
  dismissNewAchievements: () => void
  /** エンディング到達トーストを閉じる（E2） */
  dismissEndingToast: () => void
  /** 右コンテキストドック等の UI 設定を部分更新する（UI-3）。没入 OFF→ON で案内を出す（F2） */
  setUiPrefs: (patch: Partial<UiPrefs>) => void
  /** 一時案内メッセージのセット/クリア（F2） */
  setInfoNotice: (msg: string | null) => void

  // 接続先（プロバイダ）
  upsertProvider: (p: Provider) => void
  deleteProvider: (id: string) => void
  loadModels: (providerId: string) => Promise<void>
  toggleFavorite: (modelId: string) => void
  /** 新規セッション・カセット開始時の既定モデルを設定する（空文字でクリア） */
  setDefaultModelRef: (ref: string) => void

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
  upsertWorld: (w: World) => void
  /** カードからのインポート専用。id が既存と衝突する場合は振り直して常に新規追加する */
  importWorldCard: (w: World) => void
  deleteWorld: (id: string) => void
  upsertPersona: (p: Persona) => void
  /** カードからのインポート専用。id が既存と衝突する場合は振り直して常に新規追加する */
  importPersonaCard: (p: Persona) => void
  deletePersona: (id: string) => void

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
    statChangeIdx: number[]
    counterEventIdx: number[]
    moodChangeIdx: number[]
    /** 到達エンディングへ進む場合の EndingDef.id（レビューで「エンディングへ進む」を選んだとき。E2） */
    endingDefId?: string
    /** exactly な subject group 節の n 人選択（roleId→選んだ characterId 配列。レビューのプルダウン。B-5） */
    endingExactSelections?: Record<string, string[]>
  }) => void
  /**
   * エピローグシーンを締めて物語を完結する（E2）。レビューをスキップして scene.endedAt をセットし、
   * チェックポイントを記録する。次シーンは作らない。
   */
  finalizeStory: () => void
  /** 現在の方向性で次シーン候補だけを再生成する */
  regenerateSuggestions: () => Promise<void>
  cancelReview: () => void
  /** 直近のアシスタント応答に対して選択肢を手動で生成し直す */
  regenChoices: () => Promise<void>
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
    count: number
  }) => string
  cancelImageJob: (jobId: string) => void
  dismissImageJob: (jobId: string) => void
  dismissImageJobToasts: () => void
  /** 候補から採用。保存先は target で分岐（挿絵/キャラアバター/ペルソナアバター）し、完了後ジョブを自動 dismiss */
  applyImageJobResult: (jobId: string, index: number) => Promise<void>

  // データ入出力
  /** includeImages=true で使用中の画像（アバター・挿絵）を base64 同梱する（T0） */
  exportBundle: (includeImages?: boolean) => Promise<ExportBundle>
  importBundle: (bundle: ExportBundle) => Promise<{ added: number }>
  /**
   * PNG カード（キャラ/世界観/ペルソナ/カセット）と JSON バンドルを種別自動判別で取り込む。
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

/**
 * 巻き戻し後の scenes を見て ending / 完結を整理する（FB9-A）。`rewindScenesFor` の結果に対して掛ける。
 * - エピローグシーンごと消えた → `ending` を解除（普通の物語に戻り、続きを書ける）
 * - エピローグシーンが残った   → `ending` は保ち `endedAt` だけ解除（エピローグ継続中＝再び締められる）
 * `ending` が無ければ何もしないので、未完結の通常の巻き戻しでも無条件に通してよい。
 */
export function rewindEndingFor(
  session: Pick<Session, 'ending'>,
  scenes: Scene[],
): { ending?: Session['ending']; scenes: Scene[] } {
  if (!session.ending) return { scenes }
  const epId = session.ending.epilogueSceneId
  if (!scenes.some((sc) => sc.id === epId)) return { ending: undefined, scenes }
  return {
    ending: session.ending,
    scenes: scenes.map((sc) => (sc.id === epId ? { ...sc, endedAt: undefined } : sc)),
  }
}

/**
 * この物語（分岐）が完結済みか。`ending` が設定され、そのエピローグシーンに `endedAt` が付いた状態。
 * FB8-B（#3/#15）: 完結した分岐では続ける/やり直す/入力を止める（明確な終わりを保つ）。
 * FB9-A: 続きを描く手段は本文の「分岐」だけ＝`branchFromMessage`（`regenerateFrom` の `fromBranch`）。
 * 一番最後の生成文からは分岐させない（同じ線の続きになり、廃止した branchToContinue と等価になるため）。
 */
export function isSessionFinalized(s: Session): boolean {
  if (!s.ending) return false
  const ep = s.scenes.find((sc) => sc.id === s.ending!.epilogueSceneId)
  return !!ep?.endedAt
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
 * 特別イベントの消化キー。global・当事者無し条件は素の eventId、当事者ありは
 * `eventId@charId1[+charId2]`。当事者の組ごとに独立発火させるためのキー。
 */
export function eventUsedKey(eventId: string, subjects: RoleParty[]): string {
  const ids = subjects.flatMap((p) => p.members.map((m) => m.characterId))
  return ids.length ? `${eventId}@${ids.join('+')}` : eventId
}

/**
 * 次シーンの特別イベントを決める（FB3-C。演出タイプ抽選は廃止し、世界観イベントに一本化）。
 * 未消化かつ day/slot 到来かつ条件成立のイベントを日時順・参加キャラ順で1つ返す（subject な group 節を
 * 含む条件は当事者の組ごとに独立発火＝当事者の組が変われば別キーとして再度候補になる）。
 * slot はラベル一致で解決し、不一致またはタイムライン無効時は時間帯条件を無視する（FB4-C）。
 * 人の承認なしでコードが自動判定して発火する（ADR-1）。`session.eventAutoFire === false` なら発火しない。
 * 旧データの素の eventId は「全組み消化済み」として扱う。
 */
function nextScheduledEvent(
  session: Session,
  world: World | undefined,
  nextDay: number | null,
  nextSlot: number | null,
  characters: { id: string; name: string }[] = [],
): { eventId?: string; eventName?: string; eventKey?: string; eventSubjects?: RoleParty[] } {
  if (!world || session.eventAutoFire === false) return {}
  const slotIndexOf = (slot: string | undefined) =>
    slot == null ? -1 : session.timeline.slots.indexOf(slot)
  type Cand = { event: ScheduledEvent; subjects: RoleParty[]; key: string }
  const cands: Cand[] = []
  for (const e of world.scheduledEvents ?? []) {
    // 素の eventId が消化済み＝旧データ・global 発火済み。全割り当てを消化済み扱いにする（安全側）
    if (session.usedEventIds.includes(e.id)) continue
    if (e.day != null && (nextDay == null || e.day > nextDay)) continue
    const eventSlot = slotIndexOf(e.slot)
    if (
      eventSlot >= 0 &&
      nextSlot != null &&
      (e.day == null || e.day === nextDay) &&
      eventSlot > nextSlot
    )
      continue
    if (e.condition) {
      const result = matchGroups(e.condition, session.state, world, session.characterIds, session.roleAssignments, characters)
      if (!result.ok) continue
      const key = eventUsedKey(e.id, result.subjects)
      if (session.usedEventIds.includes(key)) continue
      cands.push({ event: e, subjects: result.subjects, key })
    } else {
      cands.push({ event: e, subjects: [], key: e.id })
    }
  }
  cands.sort((a, b) => {
    const dayDiff = (a.event.day ?? Infinity) - (b.event.day ?? Infinity)
    if (dayDiff !== 0) return dayDiff
    const slotDiff = slotIndexOf(a.event.slot) - slotIndexOf(b.event.slot)
    if (slotDiff !== 0) return slotDiff
    // 同日時は参加キャラ順で安定化（当事者の先頭キャラの参加インデックス）
    const idx = (c: Cand) => {
      const firstId = c.subjects[0]?.members[0]?.characterId
      return firstId ? session.characterIds.indexOf(firstId) : -1
    }
    return idx(a) - idx(b)
  })
  const pick = cands[0]
  if (!pick) return {}
  return {
    eventId: pick.event.id,
    eventName: pick.event.name,
    eventKey: pick.key,
    eventSubjects: pick.subjects,
  }
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
        const allCharacters = session.characterIds
          .map((id) => characters.find((c) => c.id === id))
          .filter((c): c is Character => !!c)
          .map((c) => effectiveCharacter(c, session.overlay))
        return {
          characters: castIds
            .map((id) => characters.find((c) => c.id === id))
            .filter((c): c is Character => !!c)
            .map((c) => effectiveCharacter(c, session.overlay)),
          allCharacters,
          world: effWorld,
          persona: personas.find((p) => p.id === session.personaId) ?? undefined,
          priorSummaries: session.scenes
            .filter((sc) => sc.id !== scene?.id && sc.summary.trim().length > 0)
            .map((sc) => ({ title: sc.title, summary: sc.summary.trim() })),
          sceneNote: scene?.note ?? '',
          currentSceneId: scene?.id ?? null,
          timelineInfo: timelinePromptInfo(session.timeline),
          // ending が set の間は nearEnd を出さない（「クライマックスへ収束」とエピローグ指示が矛盾するため）
          nearEnd: session.ending ? false : isNearEnd(session.timeline),
          stateInfo: buildStateInfo(session, characters, effWorld),
          // エピローグシーン滞在中だけエンディング指示を注入する（他シーンでは自由な文体へ戻る）
          ending:
            session.ending && scene?.id === session.ending.epilogueSceneId
              ? (() => {
                  const subjects = resolveParties(session.ending!.parties, effWorld, characters)
                  return {
                    name: session.ending!.name,
                    // エピローグ指針の @ロール名/@相手 を当事者名へ置換して注入
                    guidance: bindRoleNames(
                      effWorld?.endings?.find((e) => e.id === session.ending!.defId)?.epilogueGuidance ?? '',
                      subjects,
                    ),
                    subjects,
                  }
                })()
              : undefined,
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
          const base = buildMessages(session, refs)
          // 末尾に user の念押しを積み、本編の続き（地の文）ではなく JSON を出させる
          const msgs = [
            { role: 'system' as const, content: choicesSystem(mode) },
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
            const blob = await generateImage(
              provider,
              {
                prompt: args.prompt,
                negative: args.negative,
                width: args.width,
                height: args.height,
                steps: args.steps,
                sampler: args.sampler,
                cfg: args.cfg,
              },
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
        defaultModelRef: undefined,
        favoriteModels: [],
        characters: [],
        worlds: [],
        personas: [],
        sessions: [],
        cassettes: [],
        endingRecords: [],
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
        castingSessionId: null,
        error: null,
        newlyUnlockedAchievements: [],
        endingToast: null,
        imageJobs: [],
        imageJobToasts: [],
        infoNotice: null,
        scrollTarget: null,

        setView: (view) => set({ view }),
        clearError: () => set({ error: null }),
        dismissNewAchievements: () => set({ newlyUnlockedAchievements: [] }),
        dismissEndingToast: () => set({ endingToast: null }),
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
              roleAssignments: (s.roleAssignments ?? []).filter((assignment) => assignment.characterId !== id),
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
            // 該当ワールドのエンディング到達記録を掃除する（E3）
            endingRecords: st.endingRecords.filter((r) => r.worldId !== id),
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
            return { sessions, activeId, branchTrees, sessionImageLogs }
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

            // 次シーンの特別イベント判定（FB3-C。演出タイプ抽選は廃止）。
            // 過去シーンの再レビューではライブの現在日での日付/条件付き判定を行わない。
            const nextDay = !isPastScene && nextTimeline ? nextTimeline.currentDay : null
            const nextSlot = !isPastScene && nextTimeline ? nextTimeline.currentSlot : null
            const pick = isPastScene
              ? {}
              : nextScheduledEvent(s, refs.world, nextDay, nextSlot, get().characters)
            const event = pick.eventId
              ? refs.world?.scheduledEvents.find((e) => e.id === pick.eventId)
              : undefined
            if (event) {
              // note の @ロール名/@相手 を当事者名へ置換して文脈に載せる
              const evNote = bindRoleNames(event.note, pick.eventSubjects)
              const evName = bindRoleNames(event.name, pick.eventSubjects)
              ctxParts.push(
                `【次のシーンの方向性】特別イベント「${evName}」が発生します。${evNote}\nsuggestions はこのイベントに沿った内容にしてください。`,
              )
            }
            // ワールド固定の関係次元・ステータス定義（レビューを拘束。変動幅つき列挙＝FB7-C）
            const world = refs.world
            const aspectNames = (world?.relationAspects ?? []).map((a) => a.name).filter(Boolean)
            const statSpecs = (world?.stats ?? [])
              .filter((d) => d.name.trim())
              .map((d) => ({ name: d.name, deltaMin: d.deltaMin, deltaMax: d.deltaMax }))
            // note（どんな時に計上するか）も渡す＝作者が「一度きりの出来事」を狙って計上させる担保（FB9-C）
            const counterSpecs = (world?.counters ?? [])
              .filter((d) => d.name.trim())
              .map((d) => ({
                name: d.name,
                note: d.note,
                amountMin: d.amountMin,
                amountMax: d.amountMax,
              }))

            // 現在のステータス/カウンター値（FB7-C。レビュー指針の条件参照
            // 「所持金が尽きたら…」「デート回数が3以上なら…」を可能にするため毎回注入）
            const stateLines: string[] = []
            for (const def of world?.stats ?? []) {
              if (!def.name.trim()) continue
              if (def.scope === 'global') {
                const v =
                  s.state?.stats.find((x) => x.defId === def.id && !x.characterId)?.value ??
                  def.default
                stateLines.push(`- ${def.name}: ${v}`)
              } else {
                const vals = s.characterIds
                  .map((id) => {
                    const c = get().characters.find((x) => x.id === id)
                    if (!c) return ''
                    const v =
                      s.state?.stats.find((x) => x.defId === def.id && x.characterId === id)
                        ?.value ?? def.default
                    return `${c.name} ${v}`
                  })
                  .filter(Boolean)
                if (vals.length) stateLines.push(`- ${def.name}: ${vals.join(' / ')}`)
              }
            }
            for (const def of world?.counters ?? []) {
              if (!def.name.trim()) continue
              if (def.scope === 'global') {
                const v =
                  s.state?.counters.find((x) => x.defId === def.id && !x.characterId)?.value ?? 0
                stateLines.push(`- ${def.name}: ${v}`)
              } else {
                const vals = s.characterIds
                  .map((id) => {
                    const c = get().characters.find((x) => x.id === id)
                    if (!c) return ''
                    const v =
                      s.state?.counters.find((x) => x.defId === def.id && x.characterId === id)
                        ?.value ?? 0
                    return `${c.name} ${v}`
                  })
                  .filter(Boolean)
                if (vals.length) stateLines.push(`- ${def.name}: ${vals.join(' / ')}`)
              }
            }
            if (stateLines.length) {
              ctxParts.push(`【現在のステータス・カウンター】\n${stateLines.join('\n')}`)
            }
            const context = ctxParts.join('\n')

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
              {
                role: 'system' as const,
                content: reviewSystem(aspectNames, statSpecs, counterSpecs, world?.reviewGuidance),
              },
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
                        toId: 'hero',
                        toName: refs.persona?.name?.trim() || '主人公',
                        stance: String(x?.stance ?? '').trim(),
                        aspects,
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
                        // 定義の変動幅 deltaMin..deltaMax にクランプ（FB7-C。0 は変動なしのまま除外）
                        delta: clampReviewDelta(Number(x?.delta) || 0, def),
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
                        // 定義の加算幅 amountMin..amountMax にクランプ（FB7-C。既定 1..1000 の内側）
                        amount: clampCounterAmount(Number(x?.amount) || 1, def),
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
              scheduledEventId: event?.id,
              scheduledEventName: event?.name,
              scheduledEventKey: pick.eventKey,
              scheduledEventSubjects: pick.eventSubjects,
            }
            set({ sceneReview: review })
          } catch (e) {
            if ((e as Error).name !== 'AbortError') set({ error: (e as Error).message })
          } finally {
            reviewController = null
            set({ isReviewing: false })
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

          // レビュー適用後の新 state を1度だけ計算（純関数 applyReviewToState に一本化。E2）。
          // エンディング判定・シーン確定の両方でこの同一結果を使う＝プレビューと発火の不一致を防ぐ。
          const characters = get().characters
          const applied = applyReviewToState(
            s.state,
            stateWorld,
            s.characterIds,
            {
              relationUpdates: selectedRelUpdates,
              statChanges: selectedStats,
              counterEvents: selectedCounters,
              moodChanges: selectedMoods,
            },
            s.roleAssignments,
            characters,
          )
          const newState = applied.state
          // このレビュー適用で新規解除された実績（通知用・当事者つき）
          const newlyUnlocked: UnlockedAchievement[] = [...applied.unlocked]

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
            const evSubjects = review.scheduledEventSubjects
            const evName = event ? bindRoleNames(event.name, evSubjects) : ''
            const evNote = event ? bindRoleNames(event.note, evSubjects) : ''
            set((st) => ({
              sessions: st.sessions.map((sess) =>
                sess.id === s.id
                  ? {
                      ...sess,
                      scenes: sess.scenes.map((sc) => {
                        if (sc.id === scene.id)
                          return { ...sc, summary: opts.summary.trim() }
                        if (nextScene && sc.id === nextScene.id && (sug || event)) {
                          // ユーザーが編集/記入したタイトルをイベント名より優先する（FB5-C。note と同じ優先順）
                          const base = sug?.title || evName || sc.title
                          return {
                            ...sc,
                            title: base || sc.title,
                            note: sug?.note || evNote || sc.note,
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

          // 現在シーンの通常フロー
          const tl = s.timeline.enabled ? advanceTimeline(s.timeline) : s.timeline
          const nextLabel = s.timeline.enabled ? timeLabelOf(tl) : undefined

          // ── エンディング判定（E2）。session.ending が既 set なら判定・発火しない（到達済み）。
          // 判定は newState（このレビュー適用後の state）に対して行い、モーダルのプレビューと一致させる。
          const endings = stateWorld?.endings ?? []
          // checkEndings は「最上位成立エンディング」の当事者組を返す
          const topMatch = s.ending
            ? undefined
            : checkEndings(
                endings,
                newState,
                stateWorld,
                s.characterIds,
                s.roleAssignments,
                characters,
                opts.endingExactSelections,
              )
          // 満了モード：確定後に進む先が totalDays を超えるか（enabled かつ totalDays 指定時のみ）
          const isExpiry =
            !s.ending &&
            s.timeline.enabled &&
            s.timeline.totalDays != null &&
            tl.currentDay > s.timeline.totalDays
          // 発火する結末を confirm 側で最終決定する（防御）：
          //  1) 最上位成立が auto なら opts に依らず強制突入
          //  2) それ以外は opts.endingDefId が渡され、確定後 state で実際に成立（または満了 fallback）する時のみ
          let firing: EndingDef | undefined
          let firingSubjects: RoleParty[] = []
          if (!s.ending) {
            if (topMatch?.def.auto) {
              firing = topMatch.def
              firingSubjects = topMatch.subjects
            } else if (opts.endingDefId) {
              const chosen = endings.find((e) => e.id === opts.endingDefId)
              if (chosen?.fallback) {
                if (isExpiry) firing = chosen
              } else if (chosen) {
                const result = matchGroups(
                  chosen.condition,
                  newState,
                  stateWorld,
                  s.characterIds,
                  s.roleAssignments,
                  characters,
                  opts.endingExactSelections,
                )
                if (result.ok) {
                  firing = chosen
                  firingSubjects = result.subjects
                }
              }
            }
          }

          if (firing) {
            // ── エピローグシーンへ突入（E2）。タイムラインは進めない（もう時間の意味が無い）。
            const ending = firing
            const subjects = firingSubjects
            const parties = partiesOf(subjects)
            const endingName = bindRoleNames(ending.name, subjects)
            const epiScene = newScene(`エピローグ：${endingName}`, scene.activeCharacterIds, 'エピローグ')
            // エピローグ指針の @ロール名/@相手 を当事者名へ置換して注入
            epiScene.note = bindRoleNames(ending.epilogueGuidance, subjects)
            const reachedAt = Date.now()
            set((st) => ({
              sessions: st.sessions.map((sess) =>
                sess.id === s.id
                  ? {
                      ...sess,
                      scenes: sess.scenes
                        .map((sc) =>
                          sc.id === scene.id
                            ? { ...sc, summary: opts.summary.trim(), endedAt: reachedAt }
                            : sc,
                        )
                        .concat(epiScene),
                      currentSceneId: epiScene.id,
                      // タイムライン・usedEventIds は据え置き（特別イベント同時発火はエンディングが勝つ＝未消化のまま残す）
                      state: newState,
                      overlay: nextOverlay(sess.overlay),
                      ending: {
                        defId: ending.id,
                        name: endingName,
                        reachedAt,
                        epilogueSceneId: epiScene.id,
                        ...(parties.length ? { parties } : {}),
                      },
                      updatedAt: reachedAt,
                    }
                  : sess,
              ),
              sceneReview: null,
              newlyUnlockedAchievements: newlyUnlocked,
              endingToast: { name: endingName },
              // 到達記録（E3）。突入時に追記＝完結ボタンの押し忘れで漏れないため。再到達も追記し表示側で distinct。
              // 集計はセッション単位（ステータス）とカセット単位（棚の通算）の2軸（FB9-B）
              endingRecords: s.worldId
                ? [
                    ...st.endingRecords,
                    {
                      worldId: s.worldId,
                      endingDefId: ending.id,
                      sessionId: s.id,
                      ...(s.originCassetteId ? { cassetteId: s.originCassetteId } : {}),
                      reachedAt,
                      ...(parties.length ? { parties } : {}),
                    },
                  ]
                : st.endingRecords,
            }))
            void recordCheckpoint(
              s.id,
              'scene',
              `エピローグ：${endingName}`,
              s,
              'エピローグ',
              undefined,
              endingName,
            )
            // エピローグ導入を自動生成（締めの場面。選択肢も choiceMode に従う）
            void get().beginScene()
            return
          }

          const sug = opts.suggestion
          const event = review.scheduledEventId
            ? get().worlds
                .find((w) => w.id === s.worldId)
                ?.scheduledEvents.find((e) => e.id === review.scheduledEventId)
            : undefined
          // イベントの当事者名で @ロール名/@相手 を置換（タイトル・note）
          const evSubjects = review.scheduledEventSubjects
          const evName = event ? bindRoleNames(event.name, evSubjects) : ''
          const evNote = event ? bindRoleNames(event.note, evSubjects) : ''
          // ユーザーが編集/記入したタイトルをイベント名より優先する（FB5-C。note と同じ優先順）
          const base = sug?.title || evName || ''
          const title =
            [nextLabel, base].filter(Boolean).join('：') ||
            `シーン ${s.scenes.length + 1}`
          const next = newScene(title, scene.activeCharacterIds, nextLabel)
          next.note = sug?.note || evNote || ''
          // キャラの組ごとの独立発火（FB7-D）: 消化キーは eventKey（`eventId@charId…`）を積む
          const usedEventIds = event
            ? [...s.usedEventIds, review.scheduledEventKey ?? event.id]
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
                    state: newState,
                    overlay: nextOverlay(sess.overlay),
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

        finalizeStory: () => {
          const s = active()
          if (!s || !s.ending) return
          if (get().isStreaming || get().isReviewing) return
          const sceneId = s.ending.epilogueSceneId
          const scene = s.scenes.find((sc) => sc.id === sceneId)
          if (!scene || scene.endedAt) return
          const endedAt = Date.now()
          set((st) => ({
            sessions: st.sessions.map((sess) =>
              sess.id === s.id
                ? {
                    ...sess,
                    scenes: sess.scenes.map((sc) =>
                      sc.id === sceneId ? { ...sc, endedAt } : sc,
                    ),
                    updatedAt: endedAt,
                  }
                : sess,
            ),
          }))
          void recordCheckpoint(
            s.id,
            'scene',
            `完結：${s.ending.name}`,
            s,
            'エピローグ',
            undefined,
            s.ending.name,
          )
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
            // 方向性テキスト（イベント有無のみ。FB3-C で演出タイプは廃止）
            const dirText = review.scheduledEventName
              ? `特別イベント「${review.scheduledEventName}」が発生します。`
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

        applyStatusEdit: (edited) => {
          const s = active()
          if (!s) return
          const world = get().worlds.find((w) => w.id === s.worldId)
          // 手動編集された絶対値も、レビュー適用と同じく def の min..max に丸める
          const stats = edited.stats.map((sv) => ({
            ...sv,
            value: clampStat(sv.value, world?.stats.find((d) => d.id === sv.defId)),
          }))
          const { state, unlocked } = unlockAchievements(
            { ...edited, stats },
            world,
            s.characterIds,
            s.roleAssignments,
            get().characters,
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
          if (!s || get().isStreaming || isSessionFinalized(s)) return
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
          if (!s || get().isStreaming || isSessionFinalized(s)) return
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
          if (!s || get().isStreaming || isSessionFinalized(s)) return
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
          const refs = resolveRefs(s)
          let opening = openingTemplate
          // roleplay では導入文を掲載しないため、残存する導入文中の @タグ で開始をブロックしない
          // （required ロールは opening 非依存なので、そのまま開始ブロッカーとして機能する）
          const validationSession =
            s.mode === 'story' ? s : { ...s, story: { ...s.story, opening: '' } }
          const issues = validateCasting(validationSession, refs.world, get().characters, get().personas)
          if (issues.length > 0) {
            set({ castingSessionId: s.id, error: null })
            return
          }
          if (openingTemplate) {
            const resolved = resolveIntroText(openingTemplate, {
              tags: s.story.introTags,
              bindings: s.introBindings,
              characters: get().characters.filter((c) => s.characterIds.includes(c.id)),
              persona: refs.persona,
            })
            if (resolved.issues.length > 0) {
              set({ error: `開始できません。${resolved.issues.map(castingIssueLabel).join(' ')}` })
              return
            }
            opening = resolved.content
          }

          // 復元後の開始やり直し（開始時点へ戻った場合等）の上書きガード（FB6-C）
          if (!(await ensureLineTip(s.id, get().branchTrees[s.id]?.currentId))) return

          // 開始時のシーン選出：世界イベント確認＋時間帯決定（FB3-C で演出タイプ抽選は廃止）
          const day = s.timeline.enabled ? s.timeline.currentDay : null
          const slot = s.timeline.enabled ? s.timeline.currentSlot : null
          const pick = nextScheduledEvent(s, refs.world, day, slot, get().characters)
          const event = pick.eventId
            ? refs.world?.scheduledEvents.find((e) => e.id === pick.eventId)
            : undefined
          const evName = event ? bindRoleNames(event.name, pick.eventSubjects) : ''
          const evNote = event ? bindRoleNames(event.note, pick.eventSubjects) : ''
          const label = s.timeline.enabled ? timeLabelOf(s.timeline) : undefined
          const baseName = evName || ''
          const drafted = [label, baseName].filter(Boolean).join('：') || scene.title
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
                    note: sc.note || evNote || '',
                  }
                : sc,
            ),
            usedEventIds: event ? [...s.usedEventIds, pick.eventKey ?? event.id] : s.usedEventIds,
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
          if (!s || get().isStreaming || isSessionFinalized(s)) return
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
          if (isSessionFinalized(s) && !opts?.fromBranch) return
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
          // エピローグより前まで戻ったら ending を、エピローグ内なら完結だけを解除する（FB9-A。
          // rewindScenesFor の後に掛けること＝順序が逆だと scenes が上書きされて解除が消える）
          patchActive({ messages: kept, ...rewound, ...rewindEndingFor(s, rewound.scenes) })
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
          const { characters, worlds, personas, sessions, cassettes, endingRecords, sessionImageLogs } = get()
          // providers（API キー）は localStorage のみに保持し、エクスポートには含めない（共有時の漏洩防止）
          const bundle: ExportBundle = {
            type: 'ai-storytelling-studio',
            version: 1,
            exportedAt: Date.now(),
            characters,
            worlds,
            personas,
            sessions,
            cassettes,
            endingRecords,
            sessionImageLogs,
          }
          if (includeImages) {
            const ids = collectUsedImageIds(characters, personas, sessions, cassettes, sessionImageLogs)
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
            roles: normalizeWorldRoles(w.roles),
            endings: Array.isArray(w.endings) ? w.endings : [],
            ...(w.startPreset
              ? { startPreset: { ...w.startPreset, introTags: normalizeIntroTags(w.startPreset.introTags) } }
              : {}),
          }))
          const incomingSessions = (bundle.sessions ?? []).map((sess: any) => ({
            ...sess,
            roleAssignments: normalizeRoleAssignments(sess.roleAssignments),
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
              personas: mergeById(st.personas, incomingPersonas),
              sessions: mergeById(st.sessions, incomingSessions),
              cassettes: mergeById(
                st.cassettes,
                (bundle.cassettes ?? []).map((cassette: any) => ({
                  ...cassette,
                  session: cassette.session
                    ? {
                        ...cassette.session,
                        roleAssignments: normalizeRoleAssignments(cassette.session.roleAssignments),
                        introBindings: normalizeIntroBindings(cassette.session.introBindings),
                        story: {
                          ...cassette.session.story,
                          introTags: normalizeIntroTags(cassette.session.story?.introTags),
                        },
                      }
                    : cassette.session,
                })),
              ),
              // エンディング到達記録は同値 dedupe でマージ（E3。id を持たないため組み合わせで判定）
              endingRecords: mergeEndingRecords(st.endingRecords, bundle.endingRecords ?? []),
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
            if (parsed.kind === 'persona') {
              const withImage = await attachCardImage(parsed.persona, bytes)
              get().importPersonaCard(withImage)
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

        // ゲームカセットは「棚に登録」する（FB2-E）。素材（キャラ/世界/ペルソナ）はライブラリへ
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
            const personaExists = bundle.persona && st.personas.some((p) => p.id === bundle.persona!.id)
            const freshPersonas = bundle.persona && !personaExists ? [remapAvatar(bundle.persona)] : []

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
              personas: [...freshPersonas, ...st.personas],
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
          }
          get().dismissImageJob(jobId)
        },

        gcUnusedImages: async () => {
          const { characters, personas, sessions, cassettes, branchTrees, sessionImageLogs } = get()
          const used = collectUsedImageIds(characters, personas, sessions, cassettes, sessionImageLogs)
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
        defaultModelRef: st.defaultModelRef,
        favoriteModels: st.favoriteModels,
        characters: st.characters,
        worlds: st.worlds,
        personas: st.personas,
        sessions: st.sessions,
        cassettes: st.cassettes,
        endingRecords: st.endingRecords,
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
        const p = (persisted as Partial<AppState>) ?? {}
        // ui は normalizeUiPrefs で現行スキーマへ正規化（旧・段階式の文字列値を数値へ引き継ぐ。F2）
        const merged = { ...current, ...p, ui: normalizeUiPrefs({ ...current.ui, ...(p.ui ?? {}) }) }
        merged.worlds = (merged.worlds ?? []).map((w) => stripLegacyFlagClauses(w)).map((world) => ({
          ...world,
          roles: normalizeWorldRoles(world.roles),
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
            roleAssignments: normalizeRoleAssignments(s.roleAssignments),
            introBindings: normalizeIntroBindings(s.introBindings),
            messages,
          }
        })
        merged.cassettes = (merged.cassettes ?? []).map((cassette) => ({
          ...cassette,
          session: {
            ...cassette.session,
            roleAssignments: normalizeRoleAssignments(cassette.session?.roleAssignments),
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
