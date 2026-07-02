import type { Character, Persona, World } from '../types'
import { readTextChunks, writeTextChunk } from './png'
import { getImage, putImage } from './imageStore'
import { generateDefaultAvatar, normalizeImage } from './avatarGen'
import { downloadBlob } from './io'

function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// UTF-8 文字列を base64 に変換する（btoa は Latin-1 のみのため、直接渡すと日本語で InvalidCharacterError になる）
function b64encode(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function b64decode(s: string): string {
  const bin = atob(s)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export type ParsedCard =
  | { kind: 'character'; character: Character }
  | { kind: 'world'; world: World }
  | { kind: 'persona'; persona: Persona }

/** キャラクターの extensions に格納する独自拡張（model・avatar.imageId は環境固有のため除外） */
interface CharacterExtension {
  version: 1
  kind: 'character'
  character: Omit<Character, 'avatar' | 'model'> & { avatar: { color: string } }
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
  const { avatar, model, ...rest } = character
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

function normalizeWorldFromData(raw: any): World {
  const now = Date.now()
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
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
  }
}

/** PNG バイト列からカード情報を解釈する。カードチャンクが無ければ null */
export function parseCardPng(bytes: Uint8Array): ParsedCard | null {
  const chunks = readTextChunks(bytes)

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
