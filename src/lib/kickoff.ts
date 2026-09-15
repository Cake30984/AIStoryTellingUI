/**
 * 一行の前提からの起案（P4）の正規化。**純関数**（store を import しない）。
 *
 * 裏方 LLM が返した JSON（`KICKOFF_SCHEMA`）を、そのままライブラリへ置ける `World`／`Character` に詰める。
 * スキーマを無視する接続先・降格して素で投げた経路も通るため、**受け側で形を整えるのがここの仕事**:
 * 件数の上下限・空欄・名前のゆれは全部ここで吸収する（プロンプトで頼むだけにしない）。
 */
import type { Character, LoreEntry, RelationAspectDef, World, WorldStartPreset } from '../types'

/** 起案由来の素材に付ける印（ライブラリで後から見分けるため。P4） */
export const KICKOFF_TAG = '起案'

/** ロアの上限（世界の骨組みだけ。増やすと最初の1本が重くなる） */
const MAX_ENTRIES = 5
/** 関係性の次元（レビューがこの次元名でだけ書く。増やすと毎シーンの記述が薄くなる） */
const MAX_ASPECTS = 2
/** 起案する登場人物（先頭が中心人物） */
const MIN_CHARACTERS = 1
const MAX_CHARACTERS = 4

/** 話者名の上限（`parseLine` が名前として拾う長さと揃える） */
const MAX_NAME_LEN = 24

/**
 * アバターの既定色。`store.ts` の `COLORS` と同じ並びだが、
 * ここは lib（store を import しない）なので**索引で配る**——起案した人物どうしの色が被らない。
 */
const COLORS = ['#7c5cff', '#ef6f6c', '#4cc9a4', '#f0a76b', '#5b8def', '#d77ad8', '#e0b341']

function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** 配列で受ける項目。**文字列で返ってきても拾う**（スキーマ無しの経路では改行区切りの1文字列が来る） */
function list(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : []
  return raw.map((x) => String(x).trim()).filter(Boolean)
}

function record(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}

/**
 * 話者名の表記を整える。**空白を落とす**のが本体（P3 の罠）——
 * `matchCharacterByName` の前方一致は「七海 すず」と `@七海` を結べず、
 * 定義したのに ？バッジが出たままになる。
 */
export function compactName(raw: string): string {
  return raw.replace(/\s+/g, '').slice(0, MAX_NAME_LEN)
}

/**
 * 導入本文の話者ラベル（行頭 `@名前「`）を `compactName` と同じ規則へ揃える。
 * 登場人物側の名前だけ直しても、本文が「@七海 すず「…」」のままなら解決できない。
 */
export function compactSpeakerTags(opening: string): string {
  return opening
    .split('\n')
    .map((line) => (line.startsWith('@') ? line.replace(/^@([^「]{1,40})/, (_m, n) => `@${compactName(n)}`) : line))
    .join('\n')
}

export interface KickoffDraft {
  world: World
  /** **先頭が中心人物**（`Session.focusCharacterId` に据える） */
  characters: Character[]
  /** セッション名の候補 */
  title: string
}

/**
 * 起案結果を素材へ正規化する。読み取れなければ `null`（呼び出し側は空の下書きへ倒す）。
 * `premise` は利用者が書いた一行で、モデルが前提を返さなかった時の埋め草に使う。
 */
export function normalizeKickoff(raw: unknown, premise: string): KickoffDraft | null {
  const root = record(raw)
  if (!root) return null
  const w = record(root.world) ?? {}
  const p = record(w.startPreset) ?? {}
  const line = premise.trim()

  // 名前は「見分けがつくこと」だけ担保する（同名は前方一致の照合が別人を拾うため落とす）
  const seen = new Set<string>()
  const characters: Character[] = []
  for (const item of Array.isArray(root.characters) ? root.characters : []) {
    const c = record(item)
    if (!c) continue
    const name = compactName(text(c.name))
    if (!name || seen.has(name)) continue
    seen.add(name)
    const now = Date.now()
    characters.push({
      id: uid(),
      name,
      persona: text(c.persona),
      speechStyle: text(c.speechStyle),
      appearance: text(c.appearance),
      // `Character.exampleDialogues` は「1行1セリフ」の1文字列（編集画面の textarea と同じ形）
      exampleDialogues: list(c.exampleDialogues).join('\n'),
      greeting: text(c.greeting),
      developments: [],
      avatar: { color: COLORS[characters.length % COLORS.length] },
      // 「起案」は残す＝起案由来だと後から辿れる（P4）
      tags: [...new Set([KICKOFF_TAG, ...list(c.tags)])],
      createdAt: now,
      updatedAt: now,
    })
    if (characters.length >= MAX_CHARACTERS) break
  }
  // 中心人物が居ないものは素材にならない（`focusCharacterId` 未選択＝開始できない）
  if (characters.length < MIN_CHARACTERS) return null

  const entries: LoreEntry[] = (Array.isArray(w.entries) ? w.entries : [])
    .map((item) => record(item))
    .filter((e): e is Record<string, unknown> => !!e && !!text(e.content))
    .slice(0, MAX_ENTRIES)
    .map((e, i) => ({
      id: uid(),
      keys: list(e.keys),
      content: text(e.content),
      alwaysOn: e.alwaysOn === true,
      enabled: true,
      order: i,
    }))

  const aspects: RelationAspectDef[] = (Array.isArray(w.relationAspects) ? w.relationAspects : [])
    .map((item) => record(item))
    .filter((a): a is Record<string, unknown> => !!a && !!text(a.name))
    .slice(0, MAX_ASPECTS)
    .map((a) => ({ id: uid(), name: text(a.name), guidance: text(a.guidance) || undefined }))
  // 次元が空のままだとレビューが stance だけの更新に落ちる（`newWorld` と同じ既定で肩代わりする）
  if (aspects.length === 0) aspects.push({ id: uid(), name: '信頼' })

  const startPreset: WorldStartPreset = {
    genre: text(p.genre),
    premise: text(p.premise) || line,
    opening: compactSpeakerTags(text(p.opening)),
    openingTitle: text(p.openingTitle),
    openingSceneNote: text(p.openingSceneNote),
    initialDirective: text(p.initialDirective),
    startNow: text(p.startNow),
    // 起案では触らない項目。置換タグは実名で書かせている（素材ではなく1本の物語のための起案）ので空
    introTags: [],
  }

  const name = text(w.name) || text(p.openingTitle) || line.slice(0, MAX_NAME_LEN) || '起案した世界'
  const now = Date.now()
  const world: World = {
    id: uid(),
    name,
    description: text(w.description) || line,
    entries,
    relationAspects: aspects,
    calendarFormat: text(w.calendarFormat) || undefined,
    startPreset,
    createdAt: now,
    updatedAt: now,
  }

  return { world, characters, title: name }
}
