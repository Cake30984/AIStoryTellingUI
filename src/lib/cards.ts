import type { Character, EmotionId, Persona, Scene, Session, World, WorldStartPreset } from '../types'
import { readTextChunks, writeTextChunk } from './png'
import { getImage, putImage } from './imageStore'
import { generateDefaultAvatar, normalizeImage } from './avatarGen'
import { downloadBlob } from './io'
import { appConfirm } from './dialogs'
import { normalizeRoleAssignments, normalizeWorldRoles } from './casting'

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

export type ParsedCard =
  | { kind: 'character'; character: Character }
  | { kind: 'world'; world: World }
  | { kind: 'persona'; persona: Persona }
  | { kind: 'cassette'; bundle: CassetteBundle }

/** キャラクターの extensions に格納する独自拡張（model・avatar.imageId・sprites は環境固有のため除外） */
interface CharacterExtension {
  version: 1
  kind: 'character'
  character: Omit<Character, 'avatar' | 'model' | 'sprites'> & { avatar: { color: string } }
}

interface CharaCardV2 {
  spec: 'chara_card_v2'
  spec_version: '2.0'
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
  const { avatar, model, sprites, ...rest } = character
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: character.name,
      description,
      personality: character.speechStyle,
      scenario: '',
      first_mes: character.greeting,
      mes_example: character.exampleDialogues,
      creator_notes: 'AI Storytelling Studio で作成',
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
  // sprites の imageId は同梱画像への参照（セッションカード経由のみ持つ。通常カードには無い）。
  // インポート側（importCassette）で remap するためそのまま保持する。
  const sprites: { emotion: EmotionId; imageId: string }[] | undefined = Array.isArray(raw.sprites)
    ? raw.sprites.filter(
        (s: any) => typeof s?.emotion === 'string' && typeof s?.imageId === 'string',
      )
    : undefined
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
    ...(sprites && sprites.length > 0 ? { sprites } : {}),
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
  data: Omit<World, never>
}

function buildWorldCard(world: World): WorldCard {
  return { spec: 'aist_world', spec_version: '1.0', data: world }
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
  if (typeof raw.authorNote === 'string') p.authorNote = raw.authorNote
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
    stats: Array.isArray(raw.stats) ? raw.stats : [],
    counters: Array.isArray(raw.counters) ? raw.counters : [],
    achievements: Array.isArray(raw.achievements) ? raw.achievements : [],
    roles: normalizeWorldRoles(raw.roles),
    // カード往復でエンディング定義が消えないよう明示的に引き継ぐ（E1）
    endings: Array.isArray(raw.endings) ? raw.endings : [],
    ...(startPreset ? { startPreset } : {}),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
  }
}

// ---------- ペルソナカード（独自形式。aist_persona チャンク） ----------

interface PersonaCard {
  spec: 'aist_persona'
  spec_version: '1.0'
  data: Omit<Persona, 'avatar'> & { avatar: { color: string } }
}

function buildPersonaCard(persona: Persona): PersonaCard {
  return {
    spec: 'aist_persona',
    spec_version: '1.0',
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
 * 対象＝キャラのアバター＋立ち絵、ペルソナのアバター、各シーンの挿絵＋背景。
 * 消失画像はスキップ（インポート側でフォールバック表示）。合計バイト数も返す（サイズ警告用）。
 */
async function collectCardImages(
  session: Session,
  refs: { characters: Character[]; persona?: Persona },
): Promise<{ images: { id: string; b64: string }[]; totalBytes: number }> {
  const imageIds = new Set<string>()
  for (const c of refs.characters) {
    if (c.avatar.imageId) imageIds.add(c.avatar.imageId)
    for (const sp of c.sprites ?? []) imageIds.add(sp.imageId)
  }
  if (refs.persona?.avatar.imageId) imageIds.add(refs.persona.avatar.imageId)
  for (const sc of session.scenes) {
    for (const ill of sc.illustrations ?? []) imageIds.add(ill.imageId)
    if (sc.backgroundImageId) imageIds.add(sc.backgroundImageId)
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

/** キャラの model（ModelRef）は環境固有のため除外する（受け手側で providers[0] にフォールバック） */
function stripCharacterModels(characters: Character[]): Character[] {
  return characters.map((c) => {
    const { model, ...rest } = c
    return rest as Character
  })
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
    activeCharacterIds: session.characterIds,
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
    state: { relations: [], moods: [], stats: [], counters: [], achievements: [] },
    overlay: { lore: [], characterDevelopments: [] },
    usedEventIds: [],
    // 到達エンディングを初期化（忘れるとカセット出力→新規プレイで即「完結済み」表示になる。E1）
    ending: undefined,
    spriteEmotions: [],
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
 * アバター/立ち絵画像を1枚に同梱し、読み込めば最初から遊べる状態を配布できる。
 * セッションカードとの違いは「開始状態に初期化して同梱する」点（挿絵/背景は初期化で自然に対象外）。
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
    characters: stripCharacterModels(refs.characters),
    world: refs.world,
    persona: refs.persona,
    images,
    ...(description.trim() ? { description: description.trim() } : {}),
  }

  const normalized = await normalizeImage(cardImageBlob, 1024)
  const pngBytes = new Uint8Array(await normalized.arrayBuffer())
  const card = { spec: 'aist_cassette', spec_version: '1.0', data: bundle }
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
    session: { ...raw.session, roleAssignments: normalizeRoleAssignments(raw.session?.roleAssignments) },
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

/** PNG バイト列からカード情報を解釈する。カードチャンクが無ければ null */
export function parseCardPng(bytes: Uint8Array): ParsedCard | null {
  const chunks = readTextChunks(bytes)

  // ゲームカセット（W2）はセッションカードより先に判定する
  const cassetteChunk = chunks.find((c) => c.keyword === 'aist_cassette')
  if (cassetteChunk) {
    const json = JSON.parse(b64decode(cassetteChunk.text))
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
    const json = JSON.parse(b64decode(worldChunk.text))
    return { kind: 'world', world: normalizeWorldFromData(json.data ?? json) }
  }

  const personaChunk = chunks.find((c) => c.keyword === 'aist_persona')
  if (personaChunk) {
    const json = JSON.parse(b64decode(personaChunk.text))
    return { kind: 'persona', persona: normalizePersonaFromData(json.data ?? json) }
  }

  const charaChunk = chunks.find((c) => c.keyword === 'chara')
  if (charaChunk) {
    const json = JSON.parse(b64decode(charaChunk.text))
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
