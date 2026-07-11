import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { exportCassetteCard, exportSessionCard } from '../lib/cards'
import { getImage, useImageUrl } from '../lib/imageStore'
import { generateDefaultAvatar } from '../lib/avatarGen'
import type { SceneIllustration, Session } from '../types'
import ModalShell from './ModalShell'
import { Icon } from './icons'

type CardMode = 'session' | 'cassette'

interface Props {
  session: Session
  onClose: () => void
}

function Thumb({ ill, selected, onSelect }: { ill: SceneIllustration; selected: boolean; onSelect: () => void }) {
  const url = useImageUrl(ill.imageId)
  if (!url) return null
  return (
    <button
      type="button"
      onClick={onSelect}
      title={ill.prompt}
      style={{
        padding: 0,
        border: selected ? '3px solid var(--accent)' : '3px solid transparent',
        borderRadius: 'var(--radius-sm)',
        background: 'none',
        cursor: 'pointer',
        lineHeight: 0,
      }}
    >
      <img src={url} alt="" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 6 }} />
    </button>
  )
}

/** セッションを1枚のPNGカードに書き出す（続きから＝セッションカード / 最初から＝ゲームカセット） */
export default function SessionCardModal({ session, onClose }: Props) {
  const { characters, worlds, personas } = useStore()
  const [mode, setMode] = useState<CardMode>('session')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // 「自動生成」はタイトルから作るプレースホルダ画像の選択肢。押しても何も見えないと
  // 反応しないボタンに見えるため、開いた時点で実際に生成してプレビュー表示する（FB2-A3）
  const [autoUrl, setAutoUrl] = useState('')

  useEffect(() => {
    let disposed = false
    let url = ''
    void generateDefaultAvatar(session.title || '物語', '#7c5cff').then((blob) => {
      if (disposed) return
      url = URL.createObjectURL(blob)
      setAutoUrl(url)
    })
    return () => {
      disposed = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [session.title])

  const illustrations = session.scenes.flatMap((sc) => sc.illustrations ?? [])

  const exportCard = async () => {
    setBusy(true)
    setError('')
    try {
      const refs = {
        characters: session.characterIds
          .map((id) => characters.find((c) => c.id === id))
          .filter((c): c is NonNullable<typeof c> => !!c),
        world: worlds.find((w) => w.id === session.worldId),
        persona: personas.find((p) => p.id === session.personaId),
      }
      const selected = illustrations.find((i) => i.id === selectedId)
      const cardImage = selected
        ? (await getImage(selected.imageId)) ?? (await generateDefaultAvatar(session.title || '物語', '#7c5cff'))
        : await generateDefaultAvatar(session.title || '物語', '#7c5cff')
      if (mode === 'cassette') {
        await exportCassetteCard(session, refs, cardImage, description)
      } else {
        await exportSessionCard(session, refs, cardImage)
      }
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <ModalShell
      title="カードとして書き出す"
      onClose={onClose}
      footer={
        <>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn primary" onClick={exportCard} disabled={busy}>
            {busy ? (
              '書き出し中…'
            ) : (
              <>
                <Icon name="credit-card" size={14} />{' '}
                {mode === 'cassette' ? 'ゲームカセットとして保存' : 'カードとして保存'}
              </>
            )}
          </button>
        </>
      }
    >
          {/* 書き出し種別の切替 */}
          <div className="seg" style={{ marginBottom: 12 }}>
            <button className={mode === 'session' ? 'on' : ''} onClick={() => setMode('session')}>
              続きから（セッションカード）
            </button>
            <button className={mode === 'cassette' ? 'on' : ''} onClick={() => setMode('cassette')}>
              最初から（ゲームカセット）
            </button>
          </div>

          {mode === 'session' ? (
            <div className="desc">
              会話・状態・参照素材・画像をすべて1枚の PNG に埋め込みます。読み込むと物語がまるごと（続きから）復元されます。
            </div>
          ) : (
            <div className="desc">
              世界観・登場キャラ・ペルソナ・開始設定・画像を1枚に同梱した「ゲームカセット」を書き出します。
              会話などのプレイ記録は含まず、読み込むと誰でも最初から遊べます（世界観・キャラは自動でライブラリに登録され、個別に再利用・コピーもできます）。
            </div>
          )}

          {mode === 'cassette' && (
            <div className="field">
              <label>紹介文（任意）</label>
              <textarea
                rows={2}
                value={description}
                placeholder="例: 記憶を失った剣士として、滅びかけた王国を巡る物語。"
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          )}

          <div className="field">
            <label>カードの画像</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                title="タイトルの頭文字から自動生成した画像を使う"
                style={{
                  padding: 0,
                  border: selectedId === null ? '3px solid var(--accent)' : '3px solid transparent',
                  borderRadius: 'var(--radius-sm)',
                  background: 'none',
                  cursor: 'pointer',
                  display: 'grid',
                  gap: 2,
                  justifyItems: 'center',
                }}
              >
                {autoUrl ? (
                  <img
                    src={autoUrl}
                    alt="タイトルから自動生成"
                    style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 6 }}
                  />
                ) : (
                  <span
                    style={{
                      width: 96,
                      height: 96,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      color: 'var(--text-dim)',
                    }}
                  >
                    生成中…
                  </span>
                )}
                <span style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>タイトルから自動</span>
              </button>
              {illustrations.map((ill) => (
                <Thumb key={ill.id} ill={ill} selected={selectedId === ill.id} onSelect={() => setSelectedId(ill.id)} />
              ))}
            </div>
            {illustrations.length === 0 && (
              <div className="desc" style={{ marginTop: 6 }}>
                挿絵を生成しているセッションでは、ここに挿絵も候補として並びます。
              </div>
            )}
          </div>
          {error && <p className="notice">{error}</p>}
    </ModalShell>
  )
}
