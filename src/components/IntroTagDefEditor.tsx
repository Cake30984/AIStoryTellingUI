import { useRef } from 'react'
import { uid } from '../store'
import type { IntroTag } from '../types'

interface Props {
  tags: IntroTag[]
  onChange: (tags: IntroTag[]) => void
  /** 指定すると、タグ名の変更時に導入文中の @旧タグ名 を追従して書き換える（WorldEditor の旧ロール追従と同じ方式） */
  opening?: string
  onOpeningChange?: (opening: string) => void
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 置換タグの定義編集（追加・削除・メモ）。WorldEditor の開始テンプレート／SessionEditor／
 * CassetteEditor で共有する（A-1）。実キャラ・ペルソナへの対応付けは `IntroTagFields` が別途担う。
 */
export default function IntroTagDefEditor({ tags, onChange, opening, onOpeningChange }: Props) {
  const renameFrom = useRef<Record<string, string>>({})

  const addTag = () => onChange([...tags, { id: uid(), tag: '' }])
  const updateTag = (id: string, patch: Partial<IntroTag>) =>
    onChange(tags.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  const removeTag = (id: string) => onChange(tags.filter((t) => t.id !== id))

  const beginRename = (tag: IntroTag) => {
    renameFrom.current[tag.id] = tag.tag
  }
  const commitRename = (tag: IntroTag) => {
    const from = renameFrom.current[tag.id]
    delete renameFrom.current[tag.id]
    if (from === undefined || !opening || !onOpeningChange) return
    const oldName = from.trim()
    const nextTrimmed = tag.tag.trim()
    if (!oldName || !nextTrimmed || oldName === nextTrimmed) return
    const longerSuffixes = tags
      .filter((item) => item.id !== tag.id && item.tag.startsWith(oldName) && item.tag !== oldName)
      .map((item) => item.tag.slice(oldName.length))
      .sort((a, b) => b.length - a.length)
    const suffixGuard = longerSuffixes.length ? `(?!${longerSuffixes.map(escapeRegExp).join('|')})` : ''
    const next = opening.replace(
      new RegExp(`[@＠]${escapeRegExp(oldName)}${suffixGuard}`, 'g'),
      () => `@${nextTrimmed}`,
    )
    if (next !== opening) onOpeningChange(next)
  }

  return (
    <div className="field">
      <label>置換タグ定義</label>
      <div className="desc">
        導入文で使う自由なプレースホルダを定義します（実名は含めません）。タグ名には <code>@</code> を付けません
        （入力しても自動で外れます）。導入文の本文では <code>@タグ名</code> のように @ を付けて書いてください。
        対応する実キャラ・ペルソナはセッション/カセット側の「置換タグの対応付け」で割り当てます。
      </div>
      {tags.length === 0 && <p className="inline-empty">置換タグはまだありません。</p>}
      {tags.map((tag) => (
        <div key={tag.id} className="lore-entry">
          <div className="lore-entry-top">
            <input
              className="lore-keys"
              value={tag.tag}
              placeholder="タグ名（@は付けません。例: ヒロイン）"
              onFocus={() => beginRename(tag)}
              onChange={(e) => updateTag(tag.id, { tag: e.target.value.replace(/^[@＠]+/, '') })}
              onBlur={() => commitRename(tag)}
            />
            <button className="icon-btn small" onClick={() => removeTag(tag.id)} title="タグを削除">
              ✕
            </button>
          </div>
          <input
            className="lore-content"
            value={tag.note ?? ''}
            placeholder="メモ（任意）"
            onChange={(e) => updateTag(tag.id, { note: e.target.value })}
          />
        </div>
      ))}
      <button className="btn" style={{ marginTop: 4 }} onClick={addTag}>
        ＋ タグを追加
      </button>
    </div>
  )
}
