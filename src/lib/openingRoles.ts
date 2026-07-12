import type { Character, OpeningCharacterSlot, Persona, Session } from '../types'

/** 導入文で受理する予約話者。全角 @ は入力救済としてのみ受理し、出力は半角 @ に統一する。 */
const OPENING_ROLE_RE = /[@＠](ペルソナ|キャラクター([1-9]\d?))(?!\d)/g

export interface OpeningRoleUsage {
  usesPersona: boolean
  characterSlots: number[]
}

export type OpeningRoleIssue =
  | { kind: 'persona' }
  | { kind: 'character'; slot: number }

export type OpeningRoleContext = Pick<Session, 'characterIds' | 'personaId' | 'story'>

/** 導入文に登場する予約ロールを検出する。スロットは重複を除いた数値昇順。 */
export function findOpeningRoles(text: string): OpeningRoleUsage {
  let usesPersona = false
  const slots = new Set<number>()
  for (const match of text.matchAll(OPENING_ROLE_RE)) {
    if (match[1] === 'ペルソナ') usesPersona = true
    else if (match[2]) slots.add(Number(match[2]))
  }
  return { usesPersona, characterSlots: [...slots].sort((a, b) => a - b) }
}

/** 保存前・読込時に導入キャラスロットを正規化する。重複 slot は後ろの値を優先する。 */
export function normalizeOpeningCharacterSlots(
  raw: unknown,
  characterIds?: readonly string[],
): OpeningCharacterSlot[] {
  if (!Array.isArray(raw)) return []
  const allowed = characterIds ? new Set(characterIds) : undefined
  const bySlot = new Map<number, string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { slot, characterId } = item as Partial<OpeningCharacterSlot>
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1 || slot > 99) continue
    if (typeof characterId !== 'string' || !characterId) continue
    if (allowed && !allowed.has(characterId)) continue
    bySlot.set(slot, characterId)
  }
  return [...bySlot.entries()]
    .sort(([a], [b]) => a - b)
    .map(([slot, characterId]) => ({ slot, characterId }))
}

/** 導入ロールを開始できる状態か検証する。予約ロールが無い場合は空配列を返す。 */
export function validateOpeningRoles(
  text: string,
  session: OpeningRoleContext,
  characters: Character[],
  personas: Persona[],
): OpeningRoleIssue[] {
  const usage = findOpeningRoles(text)
  const issues: OpeningRoleIssue[] = []
  if (usage.usesPersona) {
    const persona = session.personaId ? personas.find((p) => p.id === session.personaId) : undefined
    if (!persona || !persona.name.trim()) issues.push({ kind: 'persona' })
  }

  const slots = normalizeOpeningCharacterSlots(session.story.openingCharacterSlots, session.characterIds)
  for (const slot of usage.characterSlots) {
    const binding = slots.find((x) => x.slot === slot)
    const character = binding ? characters.find((c) => c.id === binding.characterId) : undefined
    if (!character || !character.name.trim()) issues.push({ kind: 'character', slot })
  }
  return issues
}

/** エラー表示・UI用の短いロール名 */
export function openingRoleLabel(issue: OpeningRoleIssue): string {
  return issue.kind === 'persona' ? 'ペルソナ' : `キャラクター${issue.slot}`
}

/**
 * 導入本文の予約ロールを実名へ置換する。未解決の予約ロールはそのまま残し、issues で呼び出し元へ返す。
 * テンプレートを永続化し直す用途には使わず、開始時の Message とプレビュー専用に使う。
 */
export function resolveOpeningRoles(
  text: string,
  session: OpeningRoleContext,
  characters: Character[],
  personas: Persona[],
): { content: string; issues: OpeningRoleIssue[] } {
  const issues = validateOpeningRoles(text, session, characters, personas)
  const invalidPersona = issues.some((x) => x.kind === 'persona')
  const invalidSlots = new Set(issues.filter((x): x is Extract<OpeningRoleIssue, { kind: 'character' }> => x.kind === 'character').map((x) => x.slot))
  const persona = session.personaId ? personas.find((p) => p.id === session.personaId) : undefined
  const slots = normalizeOpeningCharacterSlots(session.story.openingCharacterSlots, session.characterIds)

  const content = text.replace(OPENING_ROLE_RE, (whole, role: string, slotText?: string) => {
    if (role === 'ペルソナ') return !invalidPersona && persona ? `@${persona.name}` : whole
    const slot = Number(slotText)
    if (invalidSlots.has(slot)) return whole
    const binding = slots.find((x) => x.slot === slot)
    const character = binding ? characters.find((c) => c.id === binding.characterId) : undefined
    return character ? `@${character.name}` : whole
  })
  return { content, issues }
}
