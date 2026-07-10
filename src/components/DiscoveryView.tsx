import { useStore } from '../store'
import type { Session } from '../types'

interface Props {
  session: Session
}

/** セッションで発見・深化した設定（オーバーレイ）の読み取り専用ビュー（ドック用。編集は DiscoveryPanel モーダルで行う） */
export default function DiscoveryView({ session }: Props) {
  const { characters } = useStore()
  const charName = (id: string) => characters.find((c) => c.id === id)?.name || '無名'
  const ov = session.overlay
  const devGroups = ov.characterDevelopments.filter((x) => x.developments.length > 0)
  const isEmpty = ov.lore.length === 0 && devGroups.length === 0

  return (
    <>
      {isEmpty && (
        <p className="inline-empty">
          まだ発見された設定はありません。シーンを終えるとレビューでここに追記されます。
        </p>
      )}

      {ov.lore.length > 0 && (
        <div className="field">
          <label>発見ロア（世界観）</label>
          {ov.lore.map((e) => (
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
          ))}
        </div>
      )}

      {devGroups.map((x) => (
        <div key={x.characterId} className="field">
          <label>{charName(x.characterId)} の発見設定</label>
          <div className="growth-list">
            {x.developments.map((dev) => (
              <p
                key={dev.id}
                className="desc"
                style={{ whiteSpace: 'pre-wrap', opacity: dev.enabled ? 1 : 0.5 }}
              >
                {dev.text}
              </p>
            ))}
          </div>
        </div>
      ))}

      <p className="desc" style={{ marginTop: 4 }}>
        関係性・気分・実績は「状態」タブをご覧ください。
      </p>
    </>
  )
}
