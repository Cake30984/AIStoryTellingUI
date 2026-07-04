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

/** シーンごとに挿絵をグリッド表示するギャラリー（V3） */
export default function GalleryModal({ session, onClose }: Props) {
  const { removeIllustration } = useStore()

  const scenesWithIllustrations = session.scenes.filter((sc) => (sc.illustrations ?? []).length > 0)

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
          {scenesWithIllustrations.length === 0 ? (
            <p className="desc">まだ挿絵がありません。</p>
          ) : (
            <div className="log-list">
              {scenesWithIllustrations.map((sc) => (
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
