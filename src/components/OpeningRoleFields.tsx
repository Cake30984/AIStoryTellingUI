import { useMemo } from 'react'
import type { Character, OpeningCharacterSlot, Persona, Session } from '../types'
import {
  findOpeningRoles,
  normalizeOpeningCharacterSlots,
  openingRoleLabel,
  resolveOpeningRoles,
} from '../lib/openingRoles'

interface Props {
  /** 編集中の Session / Cassette.session。導入ロールに必要な範囲だけ読む。 */
  session: Pick<Session, 'characterIds' | 'personaId' | 'story'>
  characters: Character[]
  personas: Persona[]
  onChange: (slots: OpeningCharacterSlot[]) => void
}

/**
 * 導入文の @ペルソナ / @キャラクターN を検出し、参加キャラとの対応を編集する共通フィールド。
 * 本文そのものは親の textarea が管理し、この部品は対応表だけを更新する。
 */
export default function OpeningRoleFields({ session, characters, personas, onChange }: Props) {
  const usage = useMemo(() => findOpeningRoles(session.story.opening), [session.story.opening])
  const slots = useMemo(
    () => normalizeOpeningCharacterSlots(session.story.openingCharacterSlots, session.characterIds),
    [session.story.openingCharacterSlots, session.characterIds],
  )
  const participants = useMemo(
    () => session.characterIds.map((id) => characters.find((c) => c.id === id)).filter((c): c is Character => !!c),
    [characters, session.characterIds],
  )
  const persona = session.personaId ? personas.find((p) => p.id === session.personaId) : undefined
  const resolved = useMemo(
    () => resolveOpeningRoles(session.story.opening, session, characters, personas),
    [characters, personas, session],
  )

  if (!usage.usesPersona && usage.characterSlots.length === 0) return null

  const setSlot = (slot: number, characterId: string) => {
    const next = slots.filter((x) => x.slot !== slot)
    if (characterId) next.push({ slot, characterId })
    onChange(normalizeOpeningCharacterSlots(next, session.characterIds))
  }

  const selectedCount = new Map<string, number>()
  for (const slot of slots) selectedCount.set(slot.characterId, (selectedCount.get(slot.characterId) ?? 0) + 1)

  return (
    <div className="opening-roles">
      <div className="opening-roles-title">導入ロール</div>
      <p className="desc">
        導入文では <code>@ペルソナ</code>、<code>@キャラクター1</code> 〜 <code>@キャラクター99</code> を使えます。
        開始時に実名へ置換されるため、構造化セリフのアイコンも表示されます。
      </p>

      {usage.usesPersona && (
        <div className={'opening-role-row' + (!persona?.name.trim() ? ' unresolved' : '')}>
          <span className="opening-role-name">@ペルソナ</span>
          <span className="opening-role-value">{persona?.name.trim() || 'ペルソナが未設定です'}</span>
        </div>
      )}

      {usage.characterSlots.map((slot) => {
        const selectedId = slots.find((x) => x.slot === slot)?.characterId ?? ''
        const duplicate = selectedId && (selectedCount.get(selectedId) ?? 0) > 1
        return (
          <label className={'opening-role-row' + (!selectedId ? ' unresolved' : '')} key={slot}>
            <span className="opening-role-name">@キャラクター{slot}</span>
            <select value={selectedId} onChange={(e) => setSlot(slot, e.target.value)}>
              <option value="">未設定</option>
              {participants.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name || '無名'}
                </option>
              ))}
            </select>
            {duplicate && <span className="opening-role-note">複数の役に同じキャラを指定中</span>}
          </label>
        )
      })}

      {resolved.issues.length > 0 && (
        <p className="opening-role-warning">
          未設定: {resolved.issues.map(openingRoleLabel).join('、')}。このままでは物語を開始できません。
        </p>
      )}
      <details className="opening-role-preview">
        <summary>解決後のプレビュー</summary>
        <pre>{resolved.content || '導入文を入力すると、ここで実名への置換結果を確認できます。'}</pre>
      </details>
    </div>
  )
}
