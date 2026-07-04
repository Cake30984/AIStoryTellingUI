import { useState } from 'react'
import { useStore } from '../store'
import { getImage, useImageUrl } from '../lib/imageStore'
import { downloadBlob } from '../lib/io'
import type { Scene, SceneIllustration, Session } from '../types'

interface Props {
  session: Session
  onClose: () => void
}

/** ギャラリー内の挿絵1枚（サムネイル→クリックで拡大・保存・削除） */
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
          ⬇
        </button>
        <button
          className="icon-btn small"
          title="挿絵を削除"
          onClick={() => {
            if (confirm('この挿絵を削除しますか？')) onRemove()
          }}
        >
          🗑
        </button>
      </div>
      {zoom && (
        <div className="overlay" onClick={() => setZoom(false)}>
          <div className="modal-body" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '92vw' }}>
            <img src={url} alt="" style={{ maxWidth: '92vw', maxHeight: '80vh', borderRadius: 'var(--radius)', display: 'block' }} />
            <p className="desc" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
              {ill.prompt}
            </p>
            <p className="desc">{new Date(ill.createdAt).toLocaleString()}</p>
          </div>
        </div>
      )}
    </div>
  )
}

/** ギャラリー内の背景1枚（サムネイル→クリックで拡大・保存・削除。V5b） */
function BackgroundThumb({ imageId, sceneId, onRemove }: { imageId: string; sceneId: string; onRemove: () => void }) {
  const url = useImageUrl(imageId)
  const [zoom, setZoom] = useState(false)
  if (!url) return null
  return (
    <div className="job-thumb" style={{ position: 'relative' }}>
      <span
        style={{
          position: 'absolute',
          top: 4,
          left: 4,
          zIndex: 1,
          fontSize: 11,
          padding: '2px 6px',
          borderRadius: 4,
          background: 'rgba(0,0,0,0.6)',
          color: '#fff',
        }}
      >
        背景
      </span>
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
          ⬇
        </button>
        <button
          className="icon-btn small"
          title="背景を外す"
          onClick={() => {
            if (confirm('この場面の背景を外しますか？')) onRemove()
          }}
        >
          🗑
        </button>
      </div>
      {zoom && (
        <div className="overlay" onClick={() => setZoom(false)}>
          <img src={url} alt="" style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 'var(--radius)' }} />
        </div>
      )}
    </div>
  )
}

/** シーンごとに挿絵・背景をグリッド表示するギャラリー（V3・V5b） */
export default function GalleryModal({ session, onClose }: Props) {
  const { removeIllustration, removeSceneBackground } = useStore()

  const scenesWithImages = session.scenes.filter(
    (sc) => (sc.illustrations ?? []).length > 0 || sc.backgroundImageId,
  )

  const sceneHeading = (sc: Scene) => [sc.timeLabel, sc.title].filter(Boolean).join('｜') || 'シーン'

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>🖼 画像ギャラリー</h3>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {scenesWithImages.length === 0 ? (
            <p className="desc">まだ画像がありません。</p>
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
          )}
        </div>
        <div className="modal-foot">
          <div style={{ flex: 1 }} />
          <button className="btn primary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
