import { useEffect, useState, type CSSProperties } from 'react'
import { useImageUrl } from '../lib/imageStore'
import type { Avatar } from '../types'

interface Props {
  avatar?: Avatar
  /** イニシャルのフォールバック表示に使う名前 */
  name: string
  /** 既存クラス（.avatar / .entity-avatar / .dot-avatar 等）のサイズ・角丸を流用する */
  className?: string
  /** 指定時はクラスの既定サイズを上書き */
  size?: number
  style?: CSSProperties
}

/** 画像があれば表示、なければ色＋名前イニシャルで表示する共通アバター */
export default function EntityAvatar({ avatar, name, className, size, style }: Props) {
  const url = useImageUrl(avatar?.imageId)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [avatar?.imageId])

  const dimStyle: CSSProperties = size ? { width: size, height: size } : {}
  const initial = Array.from(name.trim())[0] ?? '?'

  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        className={className}
        style={{ ...dimStyle, ...style, objectFit: 'cover' }}
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <div
      className={className}
      style={{ ...dimStyle, ...style, background: avatar?.color ?? 'var(--bg-elev2)' }}
    >
      {initial}
    </div>
  )
}
