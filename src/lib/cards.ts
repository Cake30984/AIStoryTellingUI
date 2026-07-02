import type { Character } from '../types'
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

export type ParsedCard = { kind: 'character'; character: Character }

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

/** PNG バイト列からカード情報を解釈する。カードチャンクが無ければ null */
export function parseCardPng(bytes: Uint8Array): ParsedCard | null {
  const chunks = readTextChunks(bytes)
  const charaChunk = chunks.find((c) => c.keyword === 'chara')
  if (!charaChunk) return null

  const json = JSON.parse(b64decode(charaChunk.text))
  // chara_card_v2（data ラッパあり）/ v1（トップレベル）どちらも許容
  const data = json.data ?? json
  const ext = data?.extensions?.aistorytelling
  if (ext?.kind === 'character' && ext.character) {
    return { kind: 'character', character: normalizeCharacterFromExtension(ext.character) }
  }
  return { kind: 'character', character: characterFromNativeCard(data) }
}

/** カード PNG 自体を正規化してアバター画像として登録し、キャラクターに設定する */
export async function attachCardImage(character: Character, pngBytes: Uint8Array): Promise<Character> {
  const normalized = await normalizeImage(new Blob([pngBytes as BlobPart], { type: 'image/png' }), 512)
  const imageId = await putImage(normalized)
  return { ...character, avatar: { ...character.avatar, imageId } }
}
