import { useRef, useState } from 'react'
import type { Avatar } from '../../types'
import { normalizeImage } from '../../lib/avatarGen'
import { putImage } from '../../lib/imageStore'
import { avatarContextUser, illustrationPromptSystem } from '../../lib/prompts'
import { useStore } from '../../store'
import EntityAvatar from '../EntityAvatar'
import ImageGenModal from '../ImageGenModal'

const COLORS = ['#7c5cff', '#ef6f6c', '#4cc9a4', '#f0a76b', '#5b8def', '#d77ad8', '#e0b341', '#8b95a7']

interface Props {
  avatar: Avatar
  name: string
  /** 「✨ 生成」の文脈（Character/Persona エディタが渡す。未指定なら生成ボタン非表示） */
  genContext?: { name: string; appearance?: string; imagePrompt?: string }
  onChange: (a: Avatar) => void
}

export default function AvatarField({ avatar, name, genContext, onChange }: Props) {
  const imageProviders = useStore((s) => s.imageProviders)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [showGen, setShowGen] = useState(false)

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
      {showGen && genContext && (
        <ImageGenModal
          title="アバター画像を生成"
          draftContext={{ system: illustrationPromptSystem(), user: avatarContextUser(genContext), modelRef: '' }}
          initialPrompt={genContext.imagePrompt}
          onAccept={async (blob) => {
            const normalized = await normalizeImage(blob, 512)
            const imageId = await putImage(normalized)
            onChange({ ...avatar, imageId })
          }}
          onClose={() => setShowGen(false)}
        />
      )}
    </div>
  )
}
