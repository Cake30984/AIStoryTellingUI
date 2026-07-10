import { useState } from 'react'
import { useStore } from '../store'
import { getImage, useImageUrl } from '../lib/imageStore'
import { downloadBlob } from '../lib/io'
import { appConfirm } from '../lib/dialogs'
import type { Scene, SceneIllustration, Session } from '../types'
import ZoomOverlay from './ZoomOverlay'
import { Icon } from './icons'

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
          <Icon name="download" size={14} />
        </button>
        <button
          className="icon-btn small"
          title="挿絵を削除"
          onClick={async () => {
            if (await appConfirm({ message: 'この挿絵を削除しますか？', danger: true })) onRemove()
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
          <Icon name="download" size={14} />
        </button>
        <button
          className="icon-btn small"
          title="背景を外す"
          onClick={async () => {
            if (await appConfirm({ message: 'この場面の背景を外しますか？', danger: true })) onRemove()
          }}
        >
          <Icon name="trash-2" size={14} />
        </button>
      </div>
      {zoom && <ZoomOverlay url={url} onClose={() => setZoom(false)} />}
    </div>
  )
}

/** シーンごとに挿絵・背景をグリッド表示するギャラリー本体（V3・V5b。UI-3 でコンテキストドックへ移設・モーダル版廃止） */
export function GalleryBody({ session }: { session: Session }) {
  const { removeIllustration, removeSceneBackground } = useStore()

  const scenesWithImages = session.scenes.filter(
    (sc) => (sc.illustrations ?? []).length > 0 || sc.backgroundImageId,
  )

  const sceneHeading = (sc: Scene) => [sc.timeLabel, sc.title].filter(Boolean).join('｜') || 'シーン'

  return scenesWithImages.length === 0 ? (
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
  )
}
