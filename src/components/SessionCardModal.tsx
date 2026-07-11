import { useState } from 'react'
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
            {illustrations.length === 0 ? (
              <div className="desc">挿絵が無いため、タイトルから自動生成した画像を使います。</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  className={'btn' + (selectedId === null ? ' primary' : '')}
                  style={{ width: 96, height: 96 }}
                  onClick={() => setSelectedId(null)}
                >
                  自動生成
                </button>
                {illustrations.map((ill) => (
                  <Thumb key={ill.id} ill={ill} selected={selectedId === ill.id} onSelect={() => setSelectedId(ill.id)} />
                ))}
              </div>
            )}
          </div>
          {error && <p className="notice">{error}</p>}
    </ModalShell>
  )
}
