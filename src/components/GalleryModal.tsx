import { useState, type CSSProperties } from 'react'
import { sessionImageIds, storeActions, useStore } from '../store'
import { getImage, useImageUrl } from '../lib/imageStore'
import { downloadBlob } from '../lib/io'
import { appConfirm } from '../lib/dialogs'
import type { Scene, SceneIllustration, Session, SessionImageRecord } from '../types'
import ZoomOverlay from './ZoomOverlay'
import { Icon } from './icons'

/** サムネイル左上の小バッジ（「配置中」表示） */
const THUMB_BADGE_STYLE: CSSProperties = {
  position: 'absolute',
  top: 4,
  left: 4,
  zIndex: 1,
  fontSize: 11,
  padding: '2px 6px',
  borderRadius: 4,
  background: 'rgba(0,0,0,0.6)',
  color: '#fff',
}

/**
 * 拡大表示のキャプション共通部（プロンプト・日時・再生成ボタン）。
 * positive/negative それぞれ見出し＋グレー背景ボックスで表示する（FB7-A追修）。
 * GalleryModal・ChatPanel の挿絵表示から共用する。
 */
export function PromptCaption({
  heading,
  prompt,
  negative,
  createdAt,
  onRegenerate,
}: {
  heading?: string
  prompt?: string
  negative?: string
  createdAt?: number
  onRegenerate?: () => void
}) {
  return (
    <>
      {heading && (
        <p className="desc" style={{ marginTop: 8 }}>
          {heading}
        </p>
      )}
      {prompt && (
        <div className="prompt-box">
          <div className="prompt-box-label">positive:</div>
          <div className="prompt-box-text">{prompt}</div>
        </div>
      )}
      {negative && (
        <div className="prompt-box">
          <div className="prompt-box-label">negative:</div>
          <div className="prompt-box-text">{negative}</div>
        </div>
      )}
      {onRegenerate && (prompt || negative) && (
        <button className="btn" style={{ marginTop: 8 }} onClick={onRegenerate}>
          <Icon name="refresh-cw" size={13} /> 同じプロンプトで再生成
        </button>
      )}
      {createdAt !== undefined && (
        <p className="desc" style={{ marginTop: 8 }}>
          {new Date(createdAt).toLocaleString()}
        </p>
      )}
    </>
  )
}

/** ギャラリー内の挿絵1枚（サムネイル→クリックで拡大・保存・本文から外す・再生成） */
function GalleryThumb({
  ill,
  onRemove,
  onRegenerate,
  onGoToText,
}: {
  ill: SceneIllustration
  onRemove: () => void
  onRegenerate: () => void
  /** 本文の該当箇所（挿絵のアンカー messageId）へスクロールする。messageId が無い挿絵では未指定 */
  onGoToText?: () => void
}) {
  const url = useImageUrl(ill.imageId)
  const [zoom, setZoom] = useState(false)
  if (!url) return null
  return (
    <div className="job-thumb">
      <img src={url} alt={ill.prompt} onClick={() => setZoom(true)} />
      <div className="illustration-actions" style={{ position: 'static', opacity: 1 }}>
        {onGoToText && (
          <button className="icon-btn small" title="本文の該当箇所へ移動" onClick={onGoToText}>
            <Icon name="book-open" size={14} />
          </button>
        )}
        <button
          className="icon-btn small"
          title="画像を保存"
          onClick={async () => {
            const blob = await getImage(ill.imageId)
            if (blob) downloadBlob(blob, `illustration_${ill.id}.png`)
          }}
        >
          <Icon name="download" size={14} />
        </button>
        <button
          className="icon-btn small"
          title="本文から外す"
          onClick={async () => {
            if (
              await appConfirm({
                message: 'この挿絵を本文から外しますか？\n（「すべての記録」には残ります）',
                danger: true,
              })
            )
              onRemove()
          }}
        >
          <Icon name="trash-2" size={14} />
        </button>
      </div>
      {zoom && (
        <ZoomOverlay
          url={url}
          onClose={() => setZoom(false)}
          caption={
            <PromptCaption
              prompt={ill.prompt}
              negative={ill.negative}
              createdAt={ill.createdAt}
              onRegenerate={() => {
                setZoom(false)
                onRegenerate()
              }}
            />
          }
        />
      )}
    </div>
  )
}

/** 「すべての記録」の1枚（FB6-A。分岐・シーンが消えても残る採用画像） */
function RecordThumb({
  record,
  placed,
  onRemove,
  onRegenerate,
  onGoToText,
}: {
  record: SessionImageRecord
  /** 現在の分岐の本文に配置されているか */
  placed: boolean
  onRemove: () => void
  /** 対象シーンが現存する場合のみ渡される（再生成の投入先が無いと開けないため） */
  onRegenerate?: () => void
  /** 記録元が現在の分岐に現存する場合のみ渡される（FB8-D #2） */
  onGoToText?: () => void
}) {
  const url = useImageUrl(record.imageId)
  const [zoom, setZoom] = useState(false)
  if (!url) return null
  const heading = [record.timeLabel, record.sceneTitle].filter(Boolean).join('｜')
  return (
    <div className="job-thumb" style={{ position: 'relative' }}>
      {placed && <span style={THUMB_BADGE_STYLE}>配置中</span>}
      <img src={url} alt={record.prompt || heading || '生成画像'} onClick={() => setZoom(true)} />
      <div className="illustration-actions" style={{ position: 'static', opacity: 1 }}>
        {onGoToText && (
          <button className="icon-btn small" title="本文の該当箇所へ移動" onClick={onGoToText}>
            <Icon name="book-open" size={14} />
          </button>
        )}
        <button
          className="icon-btn small"
          title="画像を保存"
          onClick={async () => {
            const blob = await getImage(record.imageId)
            if (blob) downloadBlob(blob, `record_${record.id}.png`)
          }}
        >
          <Icon name="download" size={14} />
        </button>
        <button
          className="icon-btn small"
          title="記録から削除"
          onClick={async () => {
            if (
              await appConfirm({
                message:
                  '「すべての記録」からこの画像を削除しますか？\n本文・分岐で使われていなければ、実体は System の「未使用画像の整理」で回収されます。',
                danger: true,
              })
            )
              onRemove()
          }}
        >
          <Icon name="trash-2" size={14} />
        </button>
      </div>
      {zoom && (
        <ZoomOverlay
          url={url}
          onClose={() => setZoom(false)}
          caption={
            <PromptCaption
              heading={heading}
              prompt={record.prompt}
              negative={record.negative}
              createdAt={record.createdAt}
              onRegenerate={
                onRegenerate
                  ? () => {
                      setZoom(false)
                      onRegenerate()
                    }
                  : undefined
              }
            />
          }
        />
      )}
    </div>
  )
}

/**
 * シーンごとに挿絵をグリッド表示するギャラリー本体（V3。UI-3 でコンテキストドックへ移設）。
 * FB6-A で「この分岐（従来表示）／すべての記録（分岐から独立した永続アルバム）」のタブ切替を追加。
 */
export function GalleryBody({
  session,
  onRegenerateIllustration,
}: {
  session: Session
  /** 再生成モーダルを開く（挿絵）。messageId は元の記録のアンカー */
  onRegenerateIllustration: (sceneId: string, messageId: string | undefined, prompt: string, negative?: string) => void
}) {
  const sessionImageLogs = useStore((st) => st.sessionImageLogs)
  const { removeIllustration, deleteImageRecord, revealMessage } = storeActions()
  const [tab, setTab] = useState<'branch' | 'all'>('branch')

  const records = sessionImageLogs[session.id] ?? []
  const scenesWithImages = session.scenes.filter((sc) => (sc.illustrations ?? []).length > 0)

  const sceneHeading = (sc: Scene) => [sc.timeLabel, sc.title].filter(Boolean).join('｜') || 'シーン'

  const msgIds = new Set(session.messages.map((m) => m.id))
  /**
   * 「本文へ」のジャンプ先を解決する（FB8-D #2。両タブ共用）。
   * アンカー messageId が現在の分岐に残っていればそこ、消えていても同じシーンが残っていれば
   * そのシーン先頭の本文へ。どちらも無い（別分岐・削除済み）なら undefined＝リンクを出さない。
   */
  const jumpTargetFor = (messageId?: string, sceneId?: string): string | undefined => {
    if (messageId && msgIds.has(messageId)) return messageId
    if (!sceneId || !session.scenes.some((sc) => sc.id === sceneId)) return undefined
    return (
      session.messages.find(
        (m) => m.sceneId === sceneId && m.role === 'assistant' && m.content.trim(),
      )?.id ?? session.messages.find((m) => m.sceneId === sceneId)?.id
    )
  }

  const branchView = () =>
    scenesWithImages.length === 0 ? (
      <p className="desc">この分岐にはまだ画像がありません。</p>
    ) : (
      <div className="log-list">
        {scenesWithImages.map((sc) => (
          <div className="log-item" key={sc.id}>
            <div className="log-head">
              <span className="log-title">{sceneHeading(sc)}</span>
            </div>
            <div className="job-thumbs">
              {(sc.illustrations ?? []).map((ill) => (
                <GalleryThumb
                  key={ill.id}
                  ill={ill}
                  onRemove={() => removeIllustration(session.id, sc.id, ill.id)}
                  onRegenerate={() => onRegenerateIllustration(sc.id, ill.messageId, ill.prompt, ill.negative)}
                  onGoToText={(() => {
                    const jumpTo = jumpTargetFor(ill.messageId, sc.id)
                    return jumpTo ? () => revealMessage(session.id, jumpTo) : undefined
                  })()}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    )

  const allView = () => {
    if (records.length === 0) {
      return (
        <p className="desc">
          まだ記録がありません。挿絵を採用すると、分岐やシーンが消えてもここに残ります。
        </p>
      )
    }
    const placedIds = new Set(sessionImageIds(session))
    const sceneIds = new Set(session.scenes.map((sc) => sc.id))
    const sorted = [...records].sort((a, b) => b.createdAt - a.createdAt)
    return (
      <div className="job-thumbs">
        {sorted.map((r) => {
          // 記録元のシーンが現存する時のみ再生成を出す（削除済みシーンには投入先が無い）
          const canRegenerate = !!r.sceneId && sceneIds.has(r.sceneId)
          const jumpTo = jumpTargetFor(r.messageId, r.sceneId)
          return (
            <RecordThumb
              key={r.id}
              record={r}
              placed={placedIds.has(r.imageId)}
              onRemove={() => deleteImageRecord(session.id, r.id)}
              onGoToText={jumpTo ? () => revealMessage(session.id, jumpTo) : undefined}
              onRegenerate={
                canRegenerate
                  ? () => onRegenerateIllustration(r.sceneId!, r.messageId, r.prompt, r.negative)
                  : undefined
              }
            />
          )
        })}
      </div>
    )
  }

  return (
    <>
      <div className="dock-toolbar">
        <div className="seg">
          <button className={tab === 'branch' ? 'on' : ''} onClick={() => setTab('branch')}>
            この分岐
          </button>
          <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
            すべての記録{records.length > 0 ? `（${records.length}）` : ''}
          </button>
        </div>
      </div>
      {tab === 'all' ? allView() : branchView()}
    </>
  )
}
