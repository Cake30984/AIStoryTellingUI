import { useState } from 'react'
import { appConfirm } from '../lib/dialogs'
import { useStore } from '../store'
import type { Character, Scene, Session } from '../types'
import EntityAvatar from './EntityAvatar'
import { Icon } from './icons'

interface Props {
  session: Session
  scene: Scene
}

/**
 * 別視点の幕間（F6・`docs/設計_物語の簡素化.md` §2.9）。
 *
 * 同じ場面を中心人物以外の視点で描き直す、なろう系の幕間（特に**勘違い系**——中心人物は
 * 無自覚だが、他者から見ると神業や自己犠牲に映るという型）。
 *
 * **読み専用・非正典。** 生成しても状態は一切動かず、本編プロンプトにも積まれない。
 * 気に入った解釈だけ「関係性へ反映」でユーザーが取り込む。
 */
export default function InterludePanel({ session, scene }: Props) {
  const {
    characters,
    generatingInterlude,
    generateInterlude,
    deleteInterlude,
    reflectInterlude,
    isReflectingInterlude,
    interludeReflection,
    cancelInterludeReflection,
    confirmInterludeReflection,
    isStreaming,
  } = useStore()
  const [pickerOpen, setPickerOpen] = useState(false)

  const items = scene.interludes ?? []
  // 中心人物は自分の視点を持たない（本編がそれ）。候補はいま居合わせている人を先に出す
  const present = new Set(session.state?.presentIds ?? [])
  const candidates: Character[] = session.characterIds
    .filter((id) => id !== session.focusCharacterId)
    .map((id) => characters.find((c) => c.id === id))
    .filter((c): c is Character => !!c)
    .sort((a, b) => Number(present.has(b.id)) - Number(present.has(a.id)))

  const nameOf = (id: string) => characters.find((c) => c.id === id)?.name ?? 'ある人物'
  const busy = !!generatingInterlude
  const reflection =
    interludeReflection?.sceneId === scene.id ? interludeReflection : null

  if (candidates.length === 0 && items.length === 0) return null

  return (
    <div className="interludes">
      {items.map((it) => (
        <div key={it.id} className="interlude">
          <div className="interlude-head">
            <EntityAvatar
              className="dot-avatar"
              avatar={characters.find((c) => c.id === it.characterId)?.avatar}
              name={nameOf(it.characterId)}
            />
            <span className="interlude-who">幕間 ―― {nameOf(it.characterId)}の視点</span>
            <div className="interlude-actions">
              <button
                onClick={() => generateInterlude(scene.id, it.characterId)}
                disabled={busy || isStreaming}
                title="同じ視点で書き直す（元の幕間は残ります）"
              >
                <Icon name="rotate-ccw" size={12} /> 引き直す
              </button>
              <button
                onClick={() => reflectInterlude(scene.id, it.id)}
                disabled={isReflectingInterlude || busy}
                title="この幕間の解釈を、この人物から中心人物への関係性へ取り込む"
              >
                <Icon name="check" size={12} /> 関係性へ反映
              </button>
              <button
                onClick={async () => {
                  if (await appConfirm({ message: 'この幕間を削除しますか？', danger: true }))
                    deleteInterlude(scene.id, it.id)
                }}
                title="削除"
              >
                <Icon name="trash-2" size={12} />
              </button>
            </div>
          </div>
          <div className="interlude-body">{it.text}</div>
        </div>
      ))}

      {reflection && (
        <div className="interlude-reflect">
          <div className="interlude-reflect-head">
            {nameOf(reflection.characterId)} → 中心人物 の関係性をこう書き直します
          </div>
          {reflection.stance && <p className="desc">{reflection.stance}</p>}
          {reflection.aspects.map((a) => (
            <div key={a.aspectId} className="sub-field">
              <span className="sub-label">{a.name}</span>
              <p className="desc">{a.note}</p>
            </div>
          ))}
          <div className="row">
            <button className="btn" onClick={() => cancelInterludeReflection()}>
              やめる
            </button>
            <button className="btn primary" onClick={() => confirmInterludeReflection()}>
              反映する
            </button>
          </div>
        </div>
      )}

      {candidates.length > 0 && (
        <div className="interlude-add">
          {busy ? (
            <span className="desc">
              {nameOf(generatingInterlude!.split(':')[1])}の視点で書いています…
            </span>
          ) : pickerOpen ? (
            <>
              <span className="desc">誰の視点で読みますか？</span>
              {candidates.map((c) => (
                <button
                  key={c.id}
                  className="pick-chip"
                  onClick={() => {
                    setPickerOpen(false)
                    generateInterlude(scene.id, c.id)
                  }}
                  disabled={isStreaming}
                >
                  <EntityAvatar className="dot-avatar" avatar={c.avatar} name={c.name || '無名'} />
                  {c.name || '無名'}
                </button>
              ))}
              <button className="link" onClick={() => setPickerOpen(false)}>
                やめる
              </button>
            </>
          ) : (
            <button
              className="link"
              onClick={() => setPickerOpen(true)}
              disabled={isStreaming}
              title="同じ場面を、中心人物以外の視点で描き直します（読み物・本編には影響しません）"
            >
              <Icon name="users" size={13} /> 別の視点で読む
            </button>
          )}
        </div>
      )}
    </div>
  )
}
