import { useState, type CSSProperties } from 'react'
import { sessionImageIds, useStore } from '../store'
import { getImage, useImageUrl } from '../lib/imageStore'
import { downloadBlob } from '../lib/io'
import { appConfirm } from '../lib/dialogs'
import type { Scene, SceneIllustration, Session, SessionImageRecord } from '../types'
import ZoomOverlay from './ZoomOverlay'
import { Icon } from './icons'

/** サムネイル左上の小バッジ（背景・配置中の表示に共用） */
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

/** ギャラリー内の挿絵1枚（サムネイル→クリックで拡大・保存・本文から外す） */
function GalleryThumb({
  ill,
  onRemove,
}: {
  ill: SceneIllustration
  onRemove: () => void
}) {
  const url = useImageUrl(ill.imageId)
  const [zoom, setZoom] = useState(false)
  if (!url) return null
  return (
    <div className="job-thumb">
      <img src={url} alt={ill.prompt} onClick={() => setZoom(true)} />
      <div className="illustration-actions" style={{ position: 'static', opacity: 1 }}>
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
            <>
              <p className="desc" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
                {ill.prompt}
              </p>
              <p className="desc">{new Date(ill.createdAt).toLocaleString()}</p>
            </>
          }
        />
      )}
    </div>
  )
}

/** ギャラリー内の背景1枚（サムネイル→クリックで拡大・保存・外す。V5b） */
function BackgroundThumb({ imageId, sceneId, onRemove }: { imageId: string; sceneId: string; onRemove: () => void }) {
  const url = useImageUrl(imageId)
  const [zoom, setZoom] = useState(false)
  if (!url) return null
  return (
    <div className="job-thumb" style={{ position: 'relative' }}>
      <span style={THUMB_BADGE_STYLE}>背景</span>
      <img src={url} alt="背景" onClick={() => setZoom(true)} />
      <div className="illustration-actions" style={{ position: 'static', opacity: 1 }}>
        <button
          className="icon-btn small"
          title="画像を保存"
          onClick={async () => {
            const blob = await getImage(imageId)
            if (blob) downloadBlob(blob, `background_${sceneId}.png`)
          }}
        >
          <Icon name="download" size={14} />
        </button>
        <button
          className="icon-btn small"
          title="背景を外す"
          onClick={async () => {
            if (
              await appConfirm({
                message: 'この場面の背景を外しますか？\n（「すべての記録」には残ります）',
                danger: true,
              })
            )
              onRemove()
          }}
        >
          <Icon name="trash-2" size={14} />
        </button>
      </div>
      {zoom && <ZoomOverlay url={url} onClose={() => setZoom(false)} />}
    </div>
  )
}

/** 「すべての記録」の1枚（FB6-A。分岐・シーンが消えても残る採用画像） */
function RecordThumb({
  record,
  placed,
  onRemove,
}: {
  record: SessionImageRecord
  /** 現在の分岐の本文に配置されているか */
  placed: boolean
  onRemove: () => void
}) {
  const url = useImageUrl(record.imageId)
  const [zoom, setZoom] = useState(false)
  if (!url) return null
  const heading = [record.timeLabel, record.sceneTitle].filter(Boolean).join('｜')
  const badge = [record.kind === 'background' ? '背景' : null, placed ? '配置中' : null]
    .filter(Boolean)
    .join('・')
  return (
    <div className="job-thumb" style={{ position: 'relative' }}>
      {badge && <span style={THUMB_BADGE_STYLE}>{badge}</span>}
      <img src={url} alt={record.prompt || heading || '生成画像'} onClick={() => setZoom(true)} />
      <div className="illustration-actions" style={{ position: 'static', opacity: 1 }}>
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
            <>
              {heading && (
                <p className="desc" style={{ marginTop: 8 }}>
                  {heading}
                </p>
              )}
              {record.prompt && (
                <p className="desc" style={{ whiteSpace: 'pre-wrap' }}>
                  {record.prompt}
                </p>
              )}
              <p className="desc">{new Date(record.createdAt).toLocaleString()}</p>
            </>
          }
        />
      )}
    </div>
  )
}

/**
 * シーンごとに挿絵・背景をグリッド表示するギャラリー本体（V3・V5b。UI-3 でコンテキストドックへ移設）。
 * FB6-A で「この分岐（従来表示）／すべての記録（分岐から独立した永続アルバム）」のタブ切替を追加。
 */
export function GalleryBody({ session }: { session: Session }) {
  const { removeIllustration, removeSceneBackground, deleteImageRecord, sessionImageLogs } = useStore()
  const [tab, setTab] = useState<'branch' | 'all'>('branch')

  const records = sessionImageLogs[session.id] ?? []
  const scenesWithImages = session.scenes.filter(
    (sc) => (sc.illustrations ?? []).length > 0 || sc.backgroundImageId,
  )

  const sceneHeading = (sc: Scene) => [sc.timeLabel, sc.title].filter(Boolean).join('｜') || 'シーン'

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
              {sc.backgroundImageId && (
                <BackgroundThumb
                  imageId={sc.backgroundImageId}
                  sceneId={sc.id}
                  onRemove={() => removeSceneBackground(session.id, sc.id)}
                />
              )}
              {(sc.illustrations ?? []).map((ill) => (
                <GalleryThumb
                  key={ill.id}
                  ill={ill}
                  onRemove={() => removeIllustration(session.id, sc.id, ill.id)}
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
          まだ記録がありません。挿絵・背景を採用すると、分岐やシーンが消えてもここに残ります。
        </p>
      )
    }
    const placedIds = new Set(sessionImageIds(session))
    const sorted = [...records].sort((a, b) => b.createdAt - a.createdAt)
    return (
      <div className="job-thumbs">
        {sorted.map((r) => (
          <RecordThumb
            key={r.id}
            record={r}
            placed={placedIds.has(r.imageId)}
            onRemove={() => deleteImageRecord(session.id, r.id)}
          />
        ))}
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
