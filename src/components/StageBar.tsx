import { useState } from 'react'
import type { Character, Scene, Session } from '../types'
import { reviewModelOf, useStore } from '../store'
import { useImageUrl } from '../lib/imageStore'
import { backgroundContextUser, backgroundPromptSystem } from '../lib/prompts'
import ImageGenModal from './ImageGenModal'

function StageBg({ imageId }: { imageId?: string }) {
  const url = useImageUrl(imageId)
  if (!imageId || !url) return null
  return <img src={url} alt="" className="stage-bg-img" />
}

function StageSprite({ imageId, name }: { imageId: string; name: string }) {
  const url = useImageUrl(imageId)
  if (!url) return null
  return <img src={url} alt={name} className="stage-sprite-img" />
}

interface Props {
  session: Session
  scene?: Scene
  participants: Character[]
}

/** 立ち絵ステージ表示（V4）。背景＋現在の感情に応じた立ち絵を横並びで表示する */
export default function StageBar({ session, scene, participants }: Props) {
  const world = useStore((s) => s.worlds.find((w) => w.id === session.worldId))
  const [showBgGen, setShowBgGen] = useState(false)

  const spriteChars = participants.filter((c) => (c.sprites?.length ?? 0) > 0)
  const spriteImageOf = (c: Character): string | undefined => {
    const emotion = session.spriteEmotions?.find((e) => e.characterId === c.id)?.emotion ?? 'neutral'
    return (
      c.sprites?.find((s) => s.emotion === emotion)?.imageId ??
      c.sprites?.find((s) => s.emotion === 'neutral')?.imageId
    )
  }

  return (
    <div className="stage">
      <StageBg imageId={scene?.backgroundImageId} />
      <div className="stage-overlay" />
      <div className="stage-sprites">
        {spriteChars.map((c) => {
          const imageId = spriteImageOf(c)
          return imageId ? <StageSprite key={c.id + ':' + imageId} imageId={imageId} name={c.name} /> : null
        })}
      </div>
      {scene && (
        <button
          className="icon-btn stage-bg-btn"
          onClick={() => setShowBgGen(true)}
          title="この場面の背景を生成"
        >
          🏞
        </button>
      )}
      {showBgGen && scene && (
        <ImageGenModal
          title="場面の背景を生成"
          draftContext={{
            system: backgroundPromptSystem(),
            user: backgroundContextUser({
              sceneTitle: scene.title,
              sceneNote: scene.note,
              timeLabel: scene.timeLabel,
              worldDescription: world?.description,
              recentMessages: session.messages
                .filter((m) => (m.sceneId === scene.id || !m.sceneId) && m.content.trim())
                .slice(-6)
                .map((m) => m.content),
            }),
            modelRef: reviewModelOf(session),
          }}
          defaultSizeIdx={1}
          target={{ type: 'scene-background', sessionId: session.id, sceneId: scene.id }}
          label={`背景: ${scene.title || 'シーン'}`}
          onClose={() => setShowBgGen(false)}
        />
      )}
    </div>
  )
}
