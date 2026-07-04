import { useRef, useState } from 'react'
import { EMOTIONS, type EmotionId } from '../../types'
import { useStore } from '../../store'
import { putImage, useImageUrl } from '../../lib/imageStore'
import { normalizeImage } from '../../lib/avatarGen'
import { applyStylePreset } from '../../lib/imagePresets'
import { avatarContextUser, illustrationPromptSystem } from '../../lib/prompts'
import ImageGenModal from '../ImageGenModal'

const SPRITE_BASE_TAGS = 'standing, upper body, simple background, solo'

function spritePrompt(imagePrompt: string | undefined, emotion: EmotionId): string {
  const tags = EMOTIONS.find((e) => e.id === emotion)!.tags
  return [imagePrompt, tags, SPRITE_BASE_TAGS].filter(Boolean).join(', ')
}

interface SlotProps {
  characterId: string
  name: string
  appearance?: string
  imagePrompt?: string
  emotion: EmotionId
  imageId?: string
}

/** 立ち絵1枠（既存画像 or 空枠 → ✨生成 / 📁 手動アップロード / ✕ 外す） */
function SpriteSlot({ characterId, name, appearance, imagePrompt, emotion, imageId }: SlotProps) {
  const url = useImageUrl(imageId)
  const setCharacterSprite = useStore((s) => s.setCharacterSprite)
  const [showGen, setShowGen] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const label = EMOTIONS.find((e) => e.id === emotion)!.label

  const onPickFile = async (file: File) => {
    setBusy(true)
    try {
      const normalized = await normalizeImage(file, 1024)
      const newImageId = await putImage(normalized)
      await setCharacterSprite(characterId, emotion, newImageId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sprite-slot">
      <div className="sprite-thumb">
        {url ? <img src={url} alt={label} /> : <div className="sprite-empty">未生成</div>}
      </div>
      <div className="sprite-label">{label}</div>
      <div className="sprite-slot-actions">
        <button
          type="button"
          className="btn"
          style={{ fontSize: 11, padding: '3px 8px' }}
          onClick={() => fileRef.current?.click()}
          disabled={!characterId || busy}
          title={characterId ? undefined : '先に保存してください'}
        >
          {busy ? '処理中…' : '📁 画像を選ぶ'}
        </button>
        <button
          type="button"
          className="btn"
          style={{ fontSize: 11, padding: '3px 8px' }}
          onClick={() => setShowGen(true)}
          disabled={!characterId}
          title={characterId ? undefined : '先に保存してください'}
        >
          ✨ 生成
        </button>
        {imageId && (
          <button
            type="button"
            className="btn"
            style={{ fontSize: 11, padding: '3px 8px' }}
            onClick={() => setCharacterSprite(characterId, emotion, undefined)}
          >
            ✕ 外す
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onPickFile(f)
          e.target.value = ''
        }}
      />
      {showGen && (
        <ImageGenModal
          title={`立ち絵（${label}）を生成`}
          draftContext={{
            system: illustrationPromptSystem(),
            user: avatarContextUser({ name, appearance, imagePrompt }),
            modelRef: '',
          }}
          initialPrompt={spritePrompt(imagePrompt, emotion)}
          defaultSizeIdx={2}
          target={{ type: 'character-sprite', characterId, emotion }}
          label={`立ち絵: ${name}（${label}）`}
          onClose={() => setShowGen(false)}
        />
      )}
    </div>
  )
}

interface Props {
  /** 未保存の新規キャラでは '' を渡し、生成ボタンを無効化する */
  characterId: string
  name: string
  appearance?: string
  imagePrompt?: string
}

/** キャラクターの表情つき立ち絵セット（V4）。6感情スロット＋一括生成 */
export default function SpriteSetField({ characterId, name, appearance, imagePrompt }: Props) {
  // 保存済み素材の live な sprites を直接購読する（draft には持たせない。AvatarField と同じ理由:
  // バックグラウンドジョブが直接 store を書き換えるため、draft 経由だと反映されない）
  const sprites = useStore((s) => s.characters.find((c) => c.id === characterId)?.sprites ?? [])
  const imageProviders = useStore((s) => s.imageProviders)
  const lastImageStyle = useStore((s) => s.lastImageStyle)
  const startSpriteBatch = useStore((s) => s.startSpriteBatch)

  const spriteFor = (e: EmotionId) => sprites.find((s) => s.emotion === e)?.imageId

  const batchGenerate = () => {
    if (!characterId || imageProviders.length === 0) return
    const style = lastImageStyle ?? ''
    const negative = applyStylePreset({ prompt: '', negative: '' }, style).negative
    const prompts = EMOTIONS.map((e) => ({
      emotion: e.id,
      prompt: applyStylePreset({ prompt: spritePrompt(imagePrompt, e.id), negative: '' }, style).prompt,
    }))
    startSpriteBatch({
      characterId,
      characterName: name || '無名',
      providerId: imageProviders[0].id,
      prompts,
      negative: negative || undefined,
      width: 832,
      height: 1216,
    })
  }

  return (
    <div className="field">
      <label>🎭 立ち絵セット（6感情）</label>
      <div className="desc">
        会話中の感情に応じてステージ表示（ChatPanel の🎭）で自動的に切り替わります。
      </div>
      <div className="sprite-grid">
        {EMOTIONS.map((e) => (
          <SpriteSlot
            key={e.id}
            characterId={characterId}
            name={name}
            appearance={appearance}
            imagePrompt={imagePrompt}
            emotion={e.id}
            imageId={spriteFor(e.id)}
          />
        ))}
      </div>
      <button
        type="button"
        className="btn"
        style={{ fontSize: 12, padding: '5px 12px', marginTop: 8 }}
        onClick={batchGenerate}
        disabled={!characterId || imageProviders.length === 0}
        title={!characterId ? '先に保存してください' : undefined}
      >
        ⚡ 全感情を一括生成
      </button>
    </div>
  )
}
