import { useState } from 'react'
import { useStore } from '../store'
import type { Development, LoreEntry, Session, SessionOverlay } from '../types'
import CsvInput from './CsvInput'
import { appConfirm } from '../lib/dialogs'
import ModalShell from './ModalShell'
import { Icon } from './icons'

/** 発見ログ編集のスコープ（世界観ロア or 特定キャラの発見設定）。F4で編集画面を分割 */
export type DiscoveryScope = 'lore' | { characterId: string }

interface Props {
  session: Session
  scope: DiscoveryScope
  onClose: () => void
}

/** セッションで発見・深化した設定（オーバーレイ）の閲覧・手動編集パネル。元 World/Character は不変。 */
export default function DiscoveryPanel({ session, scope, onClose }: Props) {
  const { characters, worlds, updateSession, promoteOverlayLore, promoteOverlayDev } = useStore()
  const charName = (id: string) => characters.find((c) => c.id === id)?.name || '無名'
  const worldName = worlds.find((w) => w.id === session.worldId)?.name
  const isLore = scope === 'lore'
  const scopeCharId = isLore ? null : scope.characterId

  const [ov, setOv] = useState<SessionOverlay>(() => ({
    lore: session.overlay.lore.map((e) => ({ ...e, keys: [...e.keys] })),
    characterDevelopments: session.overlay.characterDevelopments.map((x) => ({
      ...x,
      developments: x.developments.map((d) => ({ ...d })),
    })),
  }))
  const [dirty, setDirty] = useState(false)
  const mutateOv = (updater: (prev: SessionOverlay) => SessionOverlay) => {
    setOv(updater)
    setDirty(true)
  }

  const updateLore = (id: string, patch: Partial<LoreEntry>) =>
    mutateOv((prev) => ({
      ...prev,
      lore: prev.lore.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }))
  const removeLore = (id: string) =>
    mutateOv((prev) => ({ ...prev, lore: prev.lore.filter((e) => e.id !== id) }))

  const updateDev = (characterId: string, devId: string, patch: Partial<Development>) =>
    mutateOv((prev) => ({
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
    mutateOv((prev) => ({
      ...prev,
      characterDevelopments: prev.characterDevelopments.map((x) =>
        x.characterId === characterId
          ? { ...x, developments: x.developments.filter((d) => d.id !== devId) }
          : x,
      ),
    }))

  // 昇格はローカル編集済みの内容（entry/dev）をそのまま store へ渡す。
  const promoteLore = async (entry: LoreEntry) => {
    if (!session.worldId) return
    if (
      !(await appConfirm(
        `このロアを元のワールド${worldName ? `「${worldName}」` : ''}へ反映しますか？\n以後は発見ログから消え、ワールド編集に表示されます。\n（素材への反映はすべてのセッション・すべての分岐に共有され、分岐を戻しても巻き戻りません）`,
      ))
    )
      return
    promoteOverlayLore(session.id, entry)
    mutateOv((prev) => ({ ...prev, lore: prev.lore.filter((e) => e.id !== entry.id) }))
  }

  const promoteDev = async (characterId: string, dev: Development) => {
    if (
      !(await appConfirm(
        `この設定を「${charName(characterId)}」の正式なプロフィールへ反映しますか？\n以後は発見ログから消え、キャラ編集に表示されます。\n（素材への反映はすべてのセッション・すべての分岐に共有され、分岐を戻しても巻き戻りません）`,
      ))
    )
      return
    promoteOverlayDev(session.id, characterId, dev)
    mutateOv((prev) => ({
      ...prev,
      characterDevelopments: prev.characterDevelopments.map((x) =>
        x.characterId === characterId
          ? { ...x, developments: x.developments.filter((d) => d.id !== dev.id) }
          : x,
      ),
    }))
  }

  // 保存は「編集中に別スコープへレビュー追記が入っても巻き戻さない」ため、live 起点でスコープ分だけ差し替える
  const save = () => {
    const live =
      useStore.getState().sessions.find((x) => x.id === session.id)?.overlay ?? session.overlay
    let merged: SessionOverlay
    if (isLore) {
      merged = { ...live, lore: ov.lore }
    } else {
      const cid = scopeCharId!
      const draftEntry = ov.characterDevelopments.find((x) => x.characterId === cid)
      const has = live.characterDevelopments.some((x) => x.characterId === cid)
      const characterDevelopments = has
        ? live.characterDevelopments.map((x) => (x.characterId === cid ? (draftEntry ?? x) : x))
        : draftEntry
          ? [...live.characterDevelopments, draftEntry]
          : live.characterDevelopments
      merged = { ...live, characterDevelopments }
    }
    updateSession(session.id, { overlay: merged })
    onClose()
  }

  const scopeGroup = isLore
    ? null
    : ov.characterDevelopments.find((x) => x.characterId === scopeCharId)
  const scopeEmpty = isLore ? ov.lore.length === 0 : (scopeGroup?.developments.length ?? 0) === 0

  return (
    <ModalShell
      title={isLore ? '📖 発見ロア（世界観）' : `📖 「${charName(scopeCharId!)}」の発見設定`}
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
      {scopeEmpty && (
        <p className="inline-empty">
          まだ発見された設定はありません。シーンを終えるとレビューでここに追記されます。
        </p>
      )}

      {isLore && ov.lore.length > 0 && (
        <div className="field">
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
                  onClick={() => promoteLore(e)}
                  disabled={!session.worldId}
                  title={session.worldId ? 'ワールドへ昇格' : 'ワールド未設定のため昇格できません'}
                >
                  <Icon name="arrow-up" size={13} />
                </button>
                <button className="icon-btn small" onClick={() => removeLore(e.id)} title="削除">
                  <Icon name="x" size={13} />
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

      {!isLore && scopeGroup && scopeGroup.developments.length > 0 && (
        <div className="field">
          <div className="desc">
            このセッションで判明・深化した設定。チェックを外すとプロンプトに含めません。
          </div>
          <div className="growth-list">
            {scopeGroup.developments.map((dev) => (
              <div key={dev.id} className="growth-edit">
                <input
                  type="checkbox"
                  checked={dev.enabled}
                  title="適用/不適用"
                  onChange={(e) => updateDev(scopeCharId!, dev.id, { enabled: e.target.checked })}
                />
                <textarea
                  rows={2}
                  value={dev.text}
                  className={dev.enabled ? '' : 'dimmed'}
                  onChange={(e) => updateDev(scopeCharId!, dev.id, { text: e.target.value })}
                />
                <button
                  className="icon-btn small"
                  onClick={() => promoteDev(scopeCharId!, dev)}
                  title="キャラへ昇格"
                >
                  <Icon name="arrow-up" size={13} />
                </button>
                <button
                  className="icon-btn small"
                  onClick={() => removeDev(scopeCharId!, dev.id)}
                  title="削除"
                >
                  <Icon name="x" size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </ModalShell>
  )
}
