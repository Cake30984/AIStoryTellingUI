import type { Character, Scene, Session } from '../types'
import { useImageUrl } from '../lib/imageStore'

/** 現在感情 → neutral → 最初の1枚 の順で立ち絵を選ぶ（A-8: 1枚でもあれば表示） */
function spriteImageOf(c: Character, session: Session): string | undefined {
  const emotion = session.spriteEmotions?.find((e) => e.characterId === c.id)?.emotion ?? 'neutral'
  return (
    c.sprites?.find((s) => s.emotion === emotion)?.imageId ??
    c.sprites?.find((s) => s.emotion === 'neutral')?.imageId ??
    c.sprites?.[0]?.imageId
  )
}

function BackdropImg({ imageId, className }: { imageId: string; className: string }) {
  const url = useImageUrl(imageId)
  if (!url) return null
  return <img src={url} alt="" className={className} />
}

interface Props {
  session: Session
  scene?: Scene
  participants: Character[]
}

/** チャット背面のバックドロップ（V5b）。背景と立ち絵を薄く敷く。表示専用・クリック不可 */
export default function StageBackdrop({ session, scene, participants }: Props) {
  const chars = participants
    .map((c) => ({ id: c.id, imageId: spriteImageOf(c, session) }))
    .filter((x): x is { id: string; imageId: string } => !!x.imageId)
  if (!scene?.backgroundImageId && chars.length === 0) return null
  return (
    <div className="stage-backdrop" aria-hidden>
      {scene?.backgroundImageId && (
        <BackdropImg imageId={scene.backgroundImageId} className="stage-backdrop-bg" />
      )}
      {chars.length > 0 && (
        <div className="stage-backdrop-sprites">
          {chars.map(({ id, imageId }) => (
            <div className="stage-backdrop-cell" key={id}>
              {/* key=imageId で表情切替時に再マウント→フェードイン */}
              <BackdropImg key={imageId} imageId={imageId} className="stage-backdrop-sprite" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
