import type { Character, Persona, Scene, Session, World, WorldStartPreset } from '../types'
import { readTextChunks, writeTextChunk } from './png'
import { getImage, putImage } from './imageStore'
import { generateDefaultAvatar, normalizeImage } from './avatarGen'
import { downloadBlob } from './io'
import { appConfirm } from './dialogs'
import { normalizeIntroBindings, normalizeIntroTags } from './casting'
import { APP_VERSION, compareVersions, majorOf } from './version'

function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// バイト列 → Latin-1 文字列（チャンク分割。1バイトずつの連結は数MB級で極端に遅い）
function bytesToBinaryString(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let bin = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[])
  }
  return bin
}

// UTF-8 文字列 → base64（btoa は Latin-1 のみのため、直接渡すと日本語で InvalidCharacterError になる）
function b64encode(s: string): string {
  return btoa(bytesToBinaryString(new TextEncoder().encode(s)))
}

function b64decode(s: string): string {
  const bin = atob(s)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** 画像バイナリ blob → base64（テキスト用の b64encode/b64decode とは別物。UTF-8 変換を通してはいけない） */
async function blobToB64(blob: Blob): Promise<string> {
  return btoa(bytesToBinaryString(new Uint8Array(await blob.arrayBuffer())))
}

function b64ToBlob(b64: string): Blob {
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new Blob([bytes as BlobPart], { type: 'image/png' })
}

/** セッションカードの中身（参照素材＋参照画像を base64 で同梱した自己完結バンドル） */
export interface SessionCardBundle {
  session: Session
  characters: Character[]
  world?: World
  persona?: Persona
  /** 参照アバター＋挿絵。id は書き出し元環境の imageId（インポート側で putImage し直して remap する） */
  images: { id: string; b64: string }[]
}

/**
 * ゲームカセット（W2）の中身。セッションカードと同構造だが、session は開始状態に初期化済み
 * （プレイ記録なし）＋カセット固有の紹介文を持つ。1枚で世界観・キャラ・ペルソナ・画像が揃い、
 * 読み込めばすぐ最初から遊べる（設計は docs/設計_開始テンプレートとゲームカセット.md）。
 */
export interface CassetteBundle extends SessionCardBundle {
  /** カセットの紹介文（読み込み確認・一覧表示用） */
  description?: string
}

// ---------- 読み込みの検証入口（R2。docs/設計_公開前実装.md） ----------
// 全ての読み込み経路（Library の D&D・Sidebar の D&D・store.importAnyFile）は parseCardPng を
// 通るので、検証はここ1箇所に集約する。**厳格にしすぎない**：未知のフィールドは無視して読み進み、
// 拒否するのは「本体が古くて正しく読めない（minRuntimeVersion）」「種別・形式が違う」だけ。

/** カードを載せる PNG テキストチャンクのキーワード＝カードの種別 */
export type CardChunkKeyword = 'aist_cassette' | 'aist_world' | 'aist_persona' | 'chara'

/**
 * 書き出すカードに刻む「必要な本体バージョン」。
 * **本体のバージョンに自動追随させない。** カードの中身に破壊的変更を入れて、古い本体では
 * 半分しか動かなくなる時にだけ手で上げる（自動追随させると、形式が変わっていないのに新しい
 * 本体で作ったカードを古い本体が一律で拒否するようになる）。
 */
const CARD_MIN_RUNTIME_VERSION = '0.1.0'

interface CardRule {
  label: string
  /** 受理する spec（種別）。カードに spec が無ければ判定しない（旧カード・chara_card v1 互換） */
  specs: string[]
  /**
   * この本体が読める spec_version。メジャーが上なら拒否し、マイナー増は読み進む（＝未知フィールド無視）。
   * chara_card は他ツール由来で版が独自に進むため判定しない（undefined）
   */
  specVersion?: string
}

const CARD_RULES: Record<CardChunkKeyword, CardRule> = {
  aist_cassette: { label: 'ゲームカセット', specs: ['aist_cassette'], specVersion: '1.0' },
  aist_world: { label: '世界観カード', specs: ['aist_world'], specVersion: '1.0' },
  aist_persona: { label: 'ペルソナカード', specs: ['aist_persona'], specVersion: '1.0' },
  chara: { label: 'キャラカード', specs: ['chara_card_v1', 'chara_card_v2', 'chara_card_v3'] },
}

/**
 * カードの封筒（`{ spec, spec_version, minRuntimeVersion, data }`）を検証する。
 * 読めないものは throw する（呼び出し側は全経路でメッセージをそのまま表示している）。
 */
export function validateCard(parsed: any, chunk: CardChunkKeyword): void {
  const rule = CARD_RULES[chunk]
  if (!parsed || typeof parsed !== 'object') throw new Error('カードのデータが壊れています。')

  // ① 本体が古い場合は明示的に拒否する。黙って半分だけ動くのが最悪の壊れ方
  const min = parsed.minRuntimeVersion
  if (typeof min === 'string' && min.trim() && compareVersions(min, APP_VERSION) > 0) {
    throw new Error(
      `このカードは本体 v${min.trim()} 以降が必要です（この本体は v${APP_VERSION}）。本体を更新してください。`,
    )
  }

  // ② 種別違い（世界観カードをキャラとして読む等）
  const spec = parsed.spec
  if (typeof spec === 'string' && spec.trim() && !rule.specs.includes(spec.trim())) {
    throw new Error(`${rule.label}として読めない形式です（spec: ${spec}）。`)
  }

  // ③ 形式のメジャー版。マイナー増は前方互換として読み進む
  const specVersion = parsed.spec_version
  if (
    rule.specVersion &&
    typeof specVersion === 'string' &&
    specVersion.trim() &&
    majorOf(specVersion) > majorOf(rule.specVersion)
  ) {
    throw new Error(`このカードは新しい形式です（${rule.label} spec_version ${specVersion}）。本体を更新してください。`)
  }

  // ④ 署名（R8）の検証はここへ相乗りさせる。ただし未署名は拒否せず「作者未確認」として通す方針
}

/** カードチャンク（base64 の JSON）を復号し、検証を通してから返す */
function decodeCardChunk(text: string, chunk: CardChunkKeyword): any {
  let parsed: any
  try {
    parsed = JSON.parse(b64decode(text))
  } catch {
    throw new Error('カードのデータが壊れています。')
  }
  validateCard(parsed, chunk)
  return parsed
}

export type ParsedCard =
  | { kind: 'character'; character: Character }
  | { kind: 'world'; world: World }
  | { kind: 'persona'; persona: Persona }
  | { kind: 'cassette'; bundle: CassetteBundle }

/** キャラクターの extensions に格納する独自拡張（model・avatar.imageId は環境固有のため除外） */
interface CharacterExtension {
  version: 1
  kind: 'character'
  character: Omit<Character, 'avatar' | 'model'> & { avatar: { color: string } }
}

interface CharaCardV2 {
  spec: 'chara_card_v2'
  spec_version: '2.0'
  /** この本体独自の追加キー（R2）。chara_card_v2 を読む他ツールは未知キーとして無視する */
  minRuntimeVersion: string
  data: {
    name: string
    description: string
    personality: string
    scenario: string
    first_mes: string
    mes_example: string
    creator_notes: string
    system_prompt: string
    post_history_instructions: string
    alternate_greetings: string[]
    tags: string[]
    creator: string
    character_version: string
    extensions: { aistorytelling?: CharacterExtension }
  }
}

function buildCharaCard(character: Character): CharaCardV2 {
  const description = character.appearance
    ? `${character.persona}\n\n【外見】\n${character.appearance}`
    : character.persona
  const { avatar, ...rest } = character
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    minRuntimeVersion: CARD_MIN_RUNTIME_VERSION,
    data: {
      name: character.name,
      description,
      personality: character.speechStyle,
      scenario: '',
      first_mes: character.greeting,
      mes_example: character.exampleDialogues,
      creator_notes: 'デリストで作成',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: character.tags,
      creator: '',
      character_version: '',
      extensions: {
        aistorytelling: {
          version: 1,
          kind: 'character',
          character: { ...rest, avatar: { color: avatar.color } },
        },
      },
    },
  }
}

/** キャラクターを PNG カード（chara_card_v2 互換）として書き出しダウンロードさせる */
export async function exportCharacterCard(character: Character): Promise<void> {
  const sourceBlob = character.avatar.imageId
    ? (await getImage(character.avatar.imageId)) ?? (await generateDefaultAvatar(character.name || '?', character.avatar.color))
    : await generateDefaultAvatar(character.name || '?', character.avatar.color)

  const normalized = await normalizeImage(sourceBlob, 1024)
  const pngBytes = new Uint8Array(await normalized.arrayBuffer())

  const card = buildCharaCard(character)
  const withChunk = writeTextChunk(pngBytes, 'chara', b64encode(JSON.stringify(card)))
  const outBlob = new Blob([withChunk as BlobPart], { type: 'image/png' })

  downloadBlob(outBlob, `card_${character.name || 'character'}.png`)
}

function normalizeCharacterFromExtension(raw: any): Character {
  const now = Date.now()
  return {
    id: typeof raw.id === 'string' ? raw.id : uid(),
    name: typeof raw.name === 'string' ? raw.name : '',
    persona: typeof raw.persona === 'string' ? raw.persona : '',
    speechStyle: typeof raw.speechStyle === 'string' ? raw.speechStyle : '',
    appearance: typeof raw.appearance === 'string' ? raw.appearance : '',
    exampleDialogues: typeof raw.exampleDialogues === 'string' ? raw.exampleDialogues : '',
    greeting: typeof raw.greeting === 'string' ? raw.greeting : '',
    developments: Array.isArray(raw.developments) ? raw.developments : [],
    avatar: { color: typeof raw.avatar?.color === 'string' ? raw.avatar.color : '#5b8def' },
    imagePrompt: typeof raw.imagePrompt === 'string' ? raw.imagePrompt : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
  }
}

function characterFromNativeCard(data: any): Character {
  const now = Date.now()
  return {
    id: uid(),
    name: data.name ?? '',
    persona: data.description ?? '',
    speechStyle: data.personality ?? '',
    appearance: '',
    exampleDialogues: data.mes_example ?? '',
    greeting: data.first_mes ?? '',
    developments: [],
    avatar: { color: '#5b8def' },
    tags: Array.isArray(data.tags) ? data.tags : [],
    createdAt: now,
    updatedAt: now,
  }
}

// ---------- 世界観カード（独自形式。aist_world チャンク） ----------

interface WorldCard {
  spec: 'aist_world'
  spec_version: '1.0'
  minRuntimeVersion: string
  data: Omit<World, never>
}

function buildWorldCard(world: World): WorldCard {
  return { spec: 'aist_world', spec_version: '1.0', minRuntimeVersion: CARD_MIN_RUNTIME_VERSION, data: world }
}

/** 世界観を PNG カード（独自形式）として書き出しダウンロードさせる */
export async function exportWorldCard(world: World): Promise<void> {
  const sourceBlob = await generateDefaultAvatar(world.name || '?', '#4cc9a4')
  const normalized = await normalizeImage(sourceBlob, 1024)
  const pngBytes = new Uint8Array(await normalized.arrayBuffer())

  const card = buildWorldCard(world)
  const withChunk = writeTextChunk(pngBytes, 'aist_world', b64encode(JSON.stringify(card)))
  const outBlob = new Blob([withChunk as BlobPart], { type: 'image/png' })

  downloadBlob(outBlob, `card_${world.name || 'world'}.png`)
}

/** 開始テンプレート（W1）の正規化。文字列項目と timeline 定義のみ受け付け、空なら undefined */
function normalizeStartPreset(raw: any): WorldStartPreset | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const p: WorldStartPreset = {}
  if (typeof raw.genre === 'string') p.genre = raw.genre
  if (typeof raw.premise === 'string') p.premise = raw.premise
  // 導入（FB2-B）。旧カードの protagonist は廃止フィールドのため読み捨てる
  if (typeof raw.opening === 'string') p.opening = raw.opening
  if (typeof raw.openingTitle === 'string') p.openingTitle = raw.openingTitle
  if (typeof raw.initialDirective === 'string') p.initialDirective = raw.initialDirective
  if (typeof raw.authorNote === 'string') p.authorNote = raw.authorNote
  // 開始シーンの状況メモ（CS2）
  if (typeof raw.openingSceneNote === 'string') p.openingSceneNote = raw.openingSceneNote
  // 新しい登場人物の登場ポリシー（FB7-E）。未知の値は読み捨てる
  if (raw.newCharacterPolicy === 'allow' || raw.newCharacterPolicy === 'avoid') {
    p.newCharacterPolicy = raw.newCharacterPolicy
  }
  const introTags = normalizeIntroTags(raw.introTags)
  if (introTags.length > 0) p.introTags = introTags
  if (raw.timeline && Array.isArray(raw.timeline.slots)) {
    p.timeline = {
      slots: raw.timeline.slots.filter((s: any) => typeof s === 'string'),
      totalDays: typeof raw.timeline.totalDays === 'number' ? raw.timeline.totalDays : null,
      spanLabel: typeof raw.timeline.spanLabel === 'string' ? raw.timeline.spanLabel : '',
      ...(typeof raw.timeline.startDay === 'number' ? { startDay: raw.timeline.startDay } : {}),
      ...(typeof raw.timeline.startSlot === 'number' ? { startSlot: raw.timeline.startSlot } : {}),
    }
  }
  return Object.keys(p).length > 0 ? p : undefined
}

function normalizeWorldFromData(raw: any): World {
  const now = Date.now()
  const startPreset = normalizeStartPreset(raw.startPreset)
  return {
    id: typeof raw.id === 'string' ? raw.id : uid(),
    name: typeof raw.name === 'string' ? raw.name : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    entries: Array.isArray(raw.entries) ? raw.entries : [],
    scheduledEvents: Array.isArray(raw.scheduledEvents) ? raw.scheduledEvents : [],
    relationAspects: Array.isArray(raw.relationAspects) ? raw.relationAspects : [],
    ...(startPreset ? { startPreset } : {}),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
  }
}

// ---------- ペルソナカード（独自形式。aist_persona チャンク） ----------

interface PersonaCard {
  spec: 'aist_persona'
  spec_version: '1.0'
  minRuntimeVersion: string
  data: Omit<Persona, 'avatar'> & { avatar: { color: string } }
}

function buildPersonaCard(persona: Persona): PersonaCard {
  return {
    spec: 'aist_persona',
    spec_version: '1.0',
    minRuntimeVersion: CARD_MIN_RUNTIME_VERSION,
    data: { ...persona, avatar: { color: persona.avatar.color } },
  }
}

/** ペルソナを PNG カード（独自形式）として書き出しダウンロードさせる */
export async function exportPersonaCard(persona: Persona): Promise<void> {
  const sourceBlob = persona.avatar.imageId
    ? (await getImage(persona.avatar.imageId)) ?? (await generateDefaultAvatar(persona.name || '?', persona.avatar.color))
    : await generateDefaultAvatar(persona.name || '?', persona.avatar.color)

  const normalized = await normalizeImage(sourceBlob, 1024)
  const pngBytes = new Uint8Array(await normalized.arrayBuffer())

  const card = buildPersonaCard(persona)
  const withChunk = writeTextChunk(pngBytes, 'aist_persona', b64encode(JSON.stringify(card)))
  const outBlob = new Blob([withChunk as BlobPart], { type: 'image/png' })

  downloadBlob(outBlob, `card_${persona.name || 'persona'}.png`)
}

function normalizePersonaFromData(raw: any): Persona {
  const now = Date.now()
  return {
    id: typeof raw.id === 'string' ? raw.id : uid(),
    name: typeof raw.name === 'string' ? raw.name : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    avatar: { color: typeof raw.avatar?.color === 'string' ? raw.avatar.color : '#5b8def' },
    imagePrompt: typeof raw.imagePrompt === 'string' ? raw.imagePrompt : undefined,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
  }
}

// ---------- セッションカード（独自形式。aist_session チャンク。G4） ----------

/**
 * セッション/カセットが参照する画像を収集し base64 同梱用に変換する（セッションカード・ゲームカセット共通）。
 * 対象＝キャラのアバター、ペルソナのアバター、各シーンの挿絵。
 * 消失画像はスキップ（インポート側でフォールバック表示）。合計バイト数も返す（サイズ警告用）。
 */
async function collectCardImages(
  session: Session,
  refs: { characters: Character[]; persona?: Persona },
): Promise<{ images: { id: string; b64: string }[]; totalBytes: number }> {
  const imageIds = new Set<string>()
  for (const c of refs.characters) {
    if (c.avatar.imageId) imageIds.add(c.avatar.imageId)
  }
  if (refs.persona?.avatar.imageId) imageIds.add(refs.persona.avatar.imageId)
  for (const sc of session.scenes) {
    for (const ill of sc.illustrations ?? []) imageIds.add(ill.imageId)
  }

  const images: { id: string; b64: string }[] = []
  let totalBytes = 0
  for (const id of imageIds) {
    const blob = await getImage(id)
    if (!blob) continue
    totalBytes += blob.size
    images.push({ id, b64: await blobToB64(blob) })
  }
  return { images, totalBytes }
}

/** 同梱画像の合計が閾値を超える時に確認する。続行不可なら false */
async function confirmImageSize(totalBytes: number): Promise<boolean> {
  if (totalBytes > 30 * 1024 * 1024) {
    const mb = Math.round(totalBytes / 1024 / 1024)
    return appConfirm(`同梱画像の合計が約 ${mb}MB あり、カードファイルが大きくなります。続行しますか？`)
  }
  return true
}

/**
 * セッションを「開始状態」に初期化する（ゲームカセット書き出し・カセット下書き用。W2 / FB3-D）。
 * プレイ記録（会話・シーン・状態・オーバーレイ・消化イベント・表情）を全て空にし、
 * タイムラインは1日目へ戻す。モデル参照は環境固有のため空へ（受け手側でフォールバック）。
 * 残すのは設定（title/story/authorNote/顔ぶれ/世界/ペルソナ/進行設定/文体/timeline 定義 等）。
 */
export function freshSessionOf(session: Session): Session {
  const now = Date.now()
  const scene: Scene = {
    id: uid(),
    title: 'シーン 1',
    note: '',
    summary: '',
    createdAt: now,
  }
  return {
    ...session,
    model: '',
    reviewModel: '',
    choicesModel: '',
    messages: [],
    scenes: [scene],
    currentSceneId: scene.id,
    // 原文窓は種セッションのシーン id を指しているので落とす（PC3。残っても参照切れで
    // 無視されるだけだが、配布物に死んだ id を載せない）
    rawWindowFromSceneId: undefined,
    state: { relations: [], moods: [] },
    overlay: { lore: [], characterDevelopments: [] },
    usedEventIds: [],
    // 出自カセットは引き継がない（FB9-B。playCassette が改めて刻む）
    originCassetteId: undefined,
    // 開始時点（startDay/startSlot）へ巻き戻す。指定が無ければ従来どおり1日目・先頭スロット（FB2-B）。
    // 区切り編集後に範囲外となった開始時点は防御的にクランプ（FB4-A）
    timeline: {
      ...session.timeline,
      currentDay: Math.max(1, session.timeline.startDay ?? 1),
      currentSlot: Math.min(
        Math.max(0, session.timeline.startSlot ?? 0),
        Math.max(0, session.timeline.slots.length - 1),
      ),
    },
    archived: false,
    updatedAt: now,
  }
}

/**
 * ゲームカセット（W2）を PNG カードとして書き出す。世界観・登場キャラ・ペルソナ・設定・
 * アバター画像を1枚に同梱し、読み込めば最初から遊べる状態を配布できる。
 * セッションカードとの違いは「開始状態に初期化して同梱する」点（挿絵は初期化で自然に対象外）。
 */
export async function exportCassetteCard(
  session: Session,
  refs: { characters: Character[]; world?: World; persona?: Persona },
  cardImageBlob: Blob,
  description: string,
): Promise<void> {
  const fresh = freshSessionOf(session)
  const { images, totalBytes } = await collectCardImages(fresh, refs)
  if (!(await confirmImageSize(totalBytes))) return

  const bundle: CassetteBundle = {
    session: fresh,
    characters: refs.characters,
    world: refs.world,
    persona: refs.persona,
    images,
    ...(description.trim() ? { description: description.trim() } : {}),
  }

  const normalized = await normalizeImage(cardImageBlob, 1024)
  const pngBytes = new Uint8Array(await normalized.arrayBuffer())
  const card = {
    spec: 'aist_cassette',
    spec_version: '1.0',
    minRuntimeVersion: CARD_MIN_RUNTIME_VERSION,
    data: bundle,
  }
  const withChunk = writeTextChunk(pngBytes, 'aist_cassette', b64encode(JSON.stringify(card)))
  const outBlob = new Blob([withChunk as BlobPart], { type: 'image/png' })
  downloadBlob(outBlob, `cassette_${session.title || 'story'}.png`)
}

/** セッションカードの images 内 blob を取り出す（インポート側で putImage する用） */
export function sessionCardImageBlob(entry: { id: string; b64: string }): Blob {
  return b64ToBlob(entry.b64)
}

function normalizeSessionBundle(raw: any): SessionCardBundle | null {
  if (!raw?.session?.id) return null
  // 通常カードと違い、avatar.imageId は同梱 images への参照なので保持する（インポート側で remap）
  const keepImageId = <T extends { avatar: { color: string; imageId?: string } }>(norm: T, src: any): T =>
    typeof src?.avatar?.imageId === 'string'
      ? { ...norm, avatar: { ...norm.avatar, imageId: src.avatar.imageId } }
      : norm
  return {
    session: {
      ...raw.session,
      introBindings: normalizeIntroBindings(raw.session?.introBindings),
      story: { ...raw.session.story, introTags: normalizeIntroTags(raw.session?.story?.introTags) },
    },
    characters: Array.isArray(raw.characters)
      ? raw.characters.map((c: any) => keepImageId(normalizeCharacterFromExtension(c), c))
      : [],
    world: raw.world ? normalizeWorldFromData(raw.world) : undefined,
    persona: raw.persona ? keepImageId(normalizePersonaFromData(raw.persona), raw.persona) : undefined,
    images: Array.isArray(raw.images)
      ? raw.images.filter((i: any) => typeof i?.id === 'string' && typeof i?.b64 === 'string')
      : [],
  }
}

/**
 * PNG バイト列からカード情報を解釈する。カードチャンクが無ければ null。
 * 読める形式でない場合（本体が古い・種別違い・破損）は理由を持った Error を throw する（R2）。
 */
export function parseCardPng(bytes: Uint8Array): ParsedCard | null {
  const chunks = readTextChunks(bytes)

  // ゲームカセット（W2）はセッションカードより先に判定する
  const cassetteChunk = chunks.find((c) => c.keyword === 'aist_cassette')
  if (cassetteChunk) {
    const json = decodeCardChunk(cassetteChunk.text, 'aist_cassette')
    const raw = json.data ?? json
    const bundle = normalizeSessionBundle(raw)
    if (bundle) {
      const description = typeof raw.description === 'string' ? raw.description : undefined
      return { kind: 'cassette', bundle: { ...bundle, ...(description ? { description } : {}) } }
    }
    return null
  }

  const worldChunk = chunks.find((c) => c.keyword === 'aist_world')
  if (worldChunk) {
    const json = decodeCardChunk(worldChunk.text, 'aist_world')
    return { kind: 'world', world: normalizeWorldFromData(json.data ?? json) }
  }

  const personaChunk = chunks.find((c) => c.keyword === 'aist_persona')
  if (personaChunk) {
    const json = decodeCardChunk(personaChunk.text, 'aist_persona')
    return { kind: 'persona', persona: normalizePersonaFromData(json.data ?? json) }
  }

  const charaChunk = chunks.find((c) => c.keyword === 'chara')
  if (charaChunk) {
    const json = decodeCardChunk(charaChunk.text, 'chara')
    // chara_card_v2（data ラッパあり）/ v1（トップレベル）どちらも許容
    const data = json.data ?? json
    const ext = data?.extensions?.aistorytelling
    if (ext?.kind === 'character' && ext.character) {
      return { kind: 'character', character: normalizeCharacterFromExtension(ext.character) }
    }
    return { kind: 'character', character: characterFromNativeCard(data) }
  }

  return null
}

/** カード PNG 自体を正規化してアバター画像として登録し、キャラクター/ペルソナに設定する */
export async function attachCardImage<T extends { avatar: { color: string; imageId?: string } }>(
  entity: T,
  pngBytes: Uint8Array,
): Promise<T> {
  const normalized = await normalizeImage(new Blob([pngBytes as BlobPart], { type: 'image/png' }), 512)
  const imageId = await putImage(normalized)
  return { ...entity, avatar: { ...entity.avatar, imageId } }
}
