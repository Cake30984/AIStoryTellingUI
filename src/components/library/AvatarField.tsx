import { useEffect, useRef, useState } from 'react'
import type { Avatar } from '../../types'
import { normalizeImage } from '../../lib/avatarGen'
import { putImage } from '../../lib/imageStore'
import type { ImageJobTarget } from '../../lib/imageJobs'
import { avatarContextUser, illustrationPromptSystem } from '../../lib/prompts'
import { useStore } from '../../store'
import EntityAvatar from '../EntityAvatar'
import ImageGenModal from '../ImageGenModal'

const COLORS = ['#7c5cff', '#ef6f6c', '#4cc9a4', '#f0a76b', '#5b8def', '#d77ad8', '#e0b341', '#8b95a7']

type AvatarTarget = Extract<ImageJobTarget, { type: 'character-avatar' | 'persona-avatar' }>

interface Props {
  avatar: Avatar
  name: string
  /** 「✨ 生成」の文脈（Character/Persona エディタが渡す。未指定なら生成ボタン非表示） */
  genContext?: { name: string; appearance?: string; imagePrompt?: string }
  /** バックグラウンド生成ジョブの保存先。未保存の新規素材では未指定にして生成ボタンを無効化する呼び出し元もある */
  target?: AvatarTarget
  onChange: (a: Avatar) => void
}

export default function AvatarField({ avatar, name, genContext, target, onChange }: Props) {
  const imageProviders = useStore((s) => s.imageProviders)
  const characters = useStore((s) => s.characters)
  const personas = useStore((s) => s.personas)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [showGen, setShowGen] = useState(false)

  // 既存素材かどうか（新規未保存の素材には生成できない。store には avatar 変更を書き戻す先が無いため）
  const savedExists = !target
    ? true
    : target.type === 'character-avatar'
      ? characters.some((c) => c.id === target.characterId)
      : personas.some((p) => p.id === target.personaId)

  // バックグラウンド生成ジョブがこのエディタの外（ジョブパネル）で採用された場合に draft の avatar へ取り込む
  const liveImageId = !target
    ? undefined
    : target.type === 'character-avatar'
      ? characters.find((c) => c.id === target.characterId)?.avatar.imageId
      : personas.find((p) => p.id === target.personaId)?.avatar.imageId

  useEffect(() => {
    if (savedExists && liveImageId !== undefined && liveImageId !== avatar.imageId) {
      onChange({ ...avatar, imageId: liveImageId })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveImageId])

  const onPickFile = async (file: File) => {
    setBusy(true)
    try {
      const normalized = await normalizeImage(file, 512)
      const imageId = await putImage(normalized)
      onChange({ ...avatar, imageId })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="avatar-field">
      <EntityAvatar className="avatar-preview" avatar={avatar} name={name} />
      <div className="avatar-controls">
        <div className="avatar-upload-row">
          <button
            type="button"
            className="btn"
            style={{ fontSize: 12, padding: '5px 12px' }}
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            {busy ? '処理中…' : '📁 画像を選ぶ'}
          </button>
          {genContext && imageProviders.length > 0 && (
            <button
              type="button"
              className="btn"
              style={{ fontSize: 12, padding: '5px 12px' }}
              onClick={() => setShowGen(true)}
              disabled={!savedExists}
              title={savedExists ? undefined : '先に保存してから生成してください（未保存の新規素材には生成できません）'}
            >
              ✨ 生成
            </button>
          )}
          {avatar.imageId && (
            <button
              type="button"
              className="btn"
              style={{ fontSize: 12, padding: '5px 12px' }}
              onClick={() => onChange({ ...avatar, imageId: undefined })}
            >
              ✕ 画像を外す
            </button>
          )}
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
        </div>
        <div className="color-row">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={'color-dot' + (avatar.color === c ? ' on' : '')}
              style={{ background: c }}
              onClick={() => onChange({ ...avatar, color: c })}
            />
          ))}
        </div>
      </div>
      {showGen && genContext && target && (
        <ImageGenModal
          title="アバター画像を生成"
          draftContext={{ system: illustrationPromptSystem(), user: avatarContextUser(genContext), modelRef: '' }}
          initialPrompt={genContext.imagePrompt}
          target={target}
          label={`アバター: ${genContext.name}`}
          onClose={() => setShowGen(false)}
        />
      )}
    </div>
  )
}
