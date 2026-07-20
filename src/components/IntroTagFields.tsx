import { findIntroTagRefs, resolveIntroText } from '../lib/casting'
import type { Character, IntroTagBinding, Persona, Session } from '../types'

interface Props {
  session: Pick<Session, 'characterIds' | 'personaId' | 'introBindings' | 'story'>
  characters: Character[]
  personas: Persona[]
  onChange: (bindings: IntroTagBinding[]) => void
}

/**
 * 置換タグ（`@タグ`）→ ペルソナ/参加キャラ の対応付け欄（A-1）。
 * タグ定義はセッションへコピー済みの `session.story.introTags` を参照するため World は不要。
 * セッション設定・カセット・開始時モーダルで共有する。
 */
export default function IntroTagFields({ session, characters, personas, onChange }: Props) {
  const tags = (session.story.introTags ?? []).filter((tag) => tag.tag.trim())
  const usedTagNames = new Set(findIntroTagRefs(session.story.opening, tags))
  const participants = session.characterIds
    .map((id) => characters.find((character) => character.id === id))
    .filter((character): character is Character => !!character)
  const persona = session.personaId ? personas.find((p) => p.id === session.personaId) : undefined
  const bindings = session.introBindings ?? []
  const bindingByTag = new Map(bindings.map((b) => [b.tag, b]))

  if (tags.length === 0) return null

  const setBinding = (tag: string, value: string) => {
    const rest = bindings.filter((b) => b.tag !== tag)
    if (!value) return onChange(rest)
    if (value === 'persona') return onChange([...rest, { tag, kind: 'persona' }])
    onChange([...rest, { tag, kind: 'character', characterId: value }])
  }

  const preview = resolveIntroText(session.story.opening, {
    tags,
    bindings,
    characters: participants,
    persona,
  })

  return (
    <div className="casting-fields">
      <div className="casting-fields-head">
        <label>置換タグの対応付け</label>
        <p className="desc">導入文の @タグ を、ペルソナまたは参加キャラの実名へ対応付けます。</p>
      </div>

      {tags.map((tag) => {
        const binding = bindingByTag.get(tag.tag)
        const selected = binding ? (binding.kind === 'persona' ? 'persona' : binding.characterId) : ''
        const used = usedTagNames.has(tag.tag)
        const unresolved =
          used &&
          (!binding ||
            (binding.kind === 'persona'
              ? !persona?.name.trim()
              : !participants.some((c) => c.id === binding.characterId)))
        return (
          <div key={tag.id} className={'casting-role' + (unresolved ? ' unresolved' : '')}>
            <div className="casting-role-copy">
              <strong>@{tag.tag}</strong>
              <span className={used ? 'badge warn' : 'badge'}>{used ? '導入で使用中' : '未使用'}</span>
              {tag.note?.trim() && <p>{tag.note.trim()}</p>}
            </div>
            <select value={selected} onChange={(event) => setBinding(tag.tag, event.target.value)}>
              <option value="">（未対応）</option>
              <option value="persona">ペルソナ（{persona?.name.trim() || '未選択'}）</option>
              {participants.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name || '無名のキャラ'}
                </option>
              ))}
            </select>
          </div>
        )
      })}

      {session.story.opening.trim() && (
        <details className="casting-preview">
          <summary>導入文の実名プレビュー</summary>
          <pre>{preview.issues.length === 0 ? preview.content : 'タグを対応付けると実名へ解決した本文を確認できます。'}</pre>
        </details>
      )}
    </div>
  )
}
