import { useState } from 'react'
import { useStore } from '../store'
import type { Session } from '../types'
import type { DiscoveryScope } from './DiscoveryPanel'
import EntityAvatar from './EntityAvatar'
import { Icon } from './icons'

interface Props {
  session: Session
  onEdit: (scope: DiscoveryScope) => void
}

/** セッションで発見・深化した設定（オーバーレイ）の読み取り専用ビュー（ドック用。編集は DiscoveryPanel モーダルで行う。F4でタブ化） */
export default function DiscoveryView({ session, onEdit }: Props) {
  const { characters } = useStore()
  const ov = session.overlay
  const devGroups = ov.characterDevelopments.filter((x) => x.developments.length > 0)
  const isEmpty = ov.lore.length === 0 && devGroups.length === 0

  // タブキー: 'lore' またはキャラ id
  const tabs: { key: string; label: string; count: number; charId?: string }[] = [
    { key: 'lore', label: '🌍 世界観', count: ov.lore.length },
    ...devGroups.map((g) => ({
      key: g.characterId,
      label: characters.find((c) => c.id === g.characterId)?.name || '無名',
      count: g.developments.length,
      charId: g.characterId,
    })),
  ]
  // 既定は発見のあるロア、無ければ最初のキャラ
  const defaultKey = ov.lore.length > 0 ? 'lore' : (devGroups[0]?.characterId ?? 'lore')
  const [sel, setSel] = useState<string>(defaultKey)
  const selKey = tabs.some((t) => t.key === sel) ? sel : defaultKey
  const scope: DiscoveryScope = selKey === 'lore' ? 'lore' : { characterId: selKey }

  if (isEmpty) {
    return (
      <p className="inline-empty">
        まだ発見された設定はありません。シーンを終えるとレビューでここに追記されます。
      </p>
    )
  }

  const selGroup = devGroups.find((g) => g.characterId === selKey)

  return (
    <>
      <div className="disc-tabbar">
        <div className="dock-chip-row">
          {tabs.map((t) => {
            const c = t.charId ? characters.find((x) => x.id === t.charId) : undefined
            return (
              <button
                key={t.key}
                className={'pick-chip' + (selKey === t.key ? ' on' : '')}
                onClick={() => setSel(t.key)}
              >
                {c ? (
                  <EntityAvatar className="dot-avatar" avatar={c.avatar} name={c.name || '無名'} />
                ) : null}
                {t.label}
                {t.count > 0 && <span className="disc-count">{t.count}</span>}
              </button>
            )
          })}
        </div>
        <button className="btn disc-edit" onClick={() => onEdit(scope)} title="この内容を編集">
          <Icon name="pencil" size={13} /> 編集
        </button>
      </div>

      {selKey === 'lore' ? (
        ov.lore.length === 0 ? (
          <p className="inline-empty">世界観の発見はまだありません。</p>
        ) : (
          ov.lore.map((e) => (
            <div key={e.id} className={'lore-entry' + (e.enabled ? '' : ' disabled')}>
              <div className="lore-entry-top">
                <span className="desc" style={{ flex: 1, fontWeight: 600 }}>
                  {e.keys.join('、') || '（トリガー語未設定）'}
                </span>
                {e.alwaysOn && <span className="badge">常時</span>}
                {!e.enabled && <span className="badge">無効</span>}
              </div>
              <p className="desc" style={{ whiteSpace: 'pre-wrap' }}>
                {e.content}
              </p>
            </div>
          ))
        )
      ) : selGroup ? (
        <div className="growth-list">
          {selGroup.developments.map((dev) => (
            <p
              key={dev.id}
              className="desc"
              style={{ whiteSpace: 'pre-wrap', opacity: dev.enabled ? 1 : 0.5 }}
            >
              {dev.text}
            </p>
          ))}
        </div>
      ) : (
        <p className="inline-empty">このキャラの発見はまだありません。</p>
      )}
    </>
  )
}
