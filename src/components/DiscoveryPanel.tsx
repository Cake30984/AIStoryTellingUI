import { useState } from 'react'
import { useStore } from '../store'
import type { Development, LoreEntry, Session, SessionOverlay } from '../types'
import CsvInput from './CsvInput'

interface Props {
  session: Session
  onClose: () => void
}

/** セッションで発見・深化した設定（オーバーレイ）の閲覧・手動編集パネル。元 World/Character は不変。 */
export default function DiscoveryPanel({ session, onClose }: Props) {
  const { characters, worlds, updateSession, promoteOverlayLore, promoteOverlayDev } = useStore()
  const charName = (id: string) => characters.find((c) => c.id === id)?.name || '無名'
  const worldName = worlds.find((w) => w.id === session.worldId)?.name

  const [ov, setOv] = useState<SessionOverlay>(() => ({
    lore: session.overlay.lore.map((e) => ({ ...e, keys: [...e.keys] })),
    characterDevelopments: session.overlay.characterDevelopments.map((x) => ({
      ...x,
      developments: x.developments.map((d) => ({ ...d })),
    })),
  }))

  const updateLore = (id: string, patch: Partial<LoreEntry>) =>
    setOv((prev) => ({
      ...prev,
      lore: prev.lore.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }))
  const removeLore = (id: string) =>
    setOv((prev) => ({ ...prev, lore: prev.lore.filter((e) => e.id !== id) }))

  const updateDev = (characterId: string, devId: string, patch: Partial<Development>) =>
    setOv((prev) => ({
      ...prev,
      characterDevelopments: prev.characterDevelopments.map((x) =>
        x.characterId === characterId
          ? {
              ...x,
              developments: x.developments.map((d) => (d.id === devId ? { ...d, ...patch } : d)),
            }
          : x,
      ),
    }))
  const removeDev = (characterId: string, devId: string) =>
    setOv((prev) => ({
      ...prev,
      characterDevelopments: prev.characterDevelopments.map((x) =>
        x.characterId === characterId
          ? { ...x, developments: x.developments.filter((d) => d.id !== devId) }
          : x,
      ),
    }))

  const promoteLore = (id: string) => {
    if (!session.worldId) return
    if (
      !confirm(
        `このロアを元のワールド${worldName ? `「${worldName}」` : ''}へ反映しますか？\n以後は発見ログから消え、ワールド編集に表示されます。`,
      )
    )
      return
    updateSession(session.id, { overlay: ov })
    promoteOverlayLore(session.id, id)
    setOv((prev) => ({ ...prev, lore: prev.lore.filter((e) => e.id !== id) }))
  }

  const promoteDev = (characterId: string, devId: string) => {
    if (!confirm(`この設定を「${charName(characterId)}」の正式なプロフィールへ反映しますか？\n以後は発見ログから消え、キャラ編集に表示されます。`))
      return
    updateSession(session.id, { overlay: ov })
    promoteOverlayDev(session.id, characterId, devId)
    setOv((prev) => ({
      ...prev,
      characterDevelopments: prev.characterDevelopments.map((x) =>
        x.characterId === characterId
          ? { ...x, developments: x.developments.filter((d) => d.id !== devId) }
          : x,
      ),
    }))
  }

  const devGroups = ov.characterDevelopments.filter((x) => x.developments.length > 0)
  const isEmpty = ov.lore.length === 0 && devGroups.length === 0

  const save = () => {
    updateSession(session.id, { overlay: ov })
    onClose()
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>📖 発見ログ</h3>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {isEmpty && (
            <p className="inline-empty">
              まだ発見された設定はありません。シーンを終えるとレビューでここに追記されます。
            </p>
          )}

          {ov.lore.length > 0 && (
            <div className="field">
              <label>発見ロア（世界観）</label>
              <div className="desc">
                このセッションで発見された追加ロア。元のワールドは変更されません。
              </div>
              {ov.lore.map((e) => (
                <div key={e.id} className={'lore-entry' + (e.enabled ? '' : ' disabled')}>
                  <div className="lore-entry-top">
                    <CsvInput
                      className="lore-keys"
                      value={e.keys}
                      placeholder="トリガー語（カンマ区切り）"
                      onChange={(keys) => updateLore(e.id, { keys })}
                    />
                    <label className="chk" title="常に注入">
                      <input
                        type="checkbox"
                        checked={e.alwaysOn}
                        onChange={(ev) => updateLore(e.id, { alwaysOn: ev.target.checked })}
                      />
                      常時
                    </label>
                    <label className="chk" title="有効/無効">
                      <input
                        type="checkbox"
                        checked={e.enabled}
                        onChange={(ev) => updateLore(e.id, { enabled: ev.target.checked })}
                      />
                      有効
                    </label>
                    <button
                      className="icon-btn small"
                      onClick={() => promoteLore(e.id)}
                      disabled={!session.worldId}
                      title={session.worldId ? 'ワールドへ昇格' : 'ワールド未設定のため昇格できません'}
                    >
                      ⬆
                    </button>
                    <button className="icon-btn small" onClick={() => removeLore(e.id)} title="削除">
                      ✕
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    className="lore-content"
                    value={e.content}
                    onChange={(ev) => updateLore(e.id, { content: ev.target.value })}
                  />
                </div>
              ))}
            </div>
          )}

          {devGroups.map((x) => (
            <div key={x.characterId} className="field">
              <label>{charName(x.characterId)} の発見設定</label>
              <div className="desc">
                このセッションで判明・深化した設定。チェックを外すとプロンプトに含めません。
              </div>
              <div className="growth-list">
                {x.developments.map((dev) => (
                  <div key={dev.id} className="growth-edit">
                    <input
                      type="checkbox"
                      checked={dev.enabled}
                      title="適用/不適用"
                      onChange={(e) => updateDev(x.characterId, dev.id, { enabled: e.target.checked })}
                    />
                    <textarea
                      rows={2}
                      value={dev.text}
                      className={dev.enabled ? '' : 'dimmed'}
                      onChange={(e) => updateDev(x.characterId, dev.id, { text: e.target.value })}
                    />
                    <button
                      className="icon-btn small"
                      onClick={() => promoteDev(x.characterId, dev.id)}
                      title="キャラへ昇格"
                    >
                      ⬆
                    </button>
                    <button
                      className="icon-btn small"
                      onClick={() => removeDev(x.characterId, dev.id)}
                      title="削除"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <p className="desc" style={{ marginTop: 4 }}>
            関係性・気分・実績は 📊 状態パネルをご覧ください。
          </p>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn primary" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
