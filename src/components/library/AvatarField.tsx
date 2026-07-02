import type { Avatar } from '../../types'

const COLORS = ['#7c5cff', '#ef6f6c', '#4cc9a4', '#f0a76b', '#5b8def', '#d77ad8', '#e0b341', '#8b95a7']

interface Props {
  avatar: Avatar
  name: string
  onChange: (a: Avatar) => void
}

// TODO(P2): 画像アップロード（putImage）と EntityAvatar 表示に置き換える。現状は色のみの暫定実装。
export default function AvatarField({ avatar, name, onChange }: Props) {
  return (
    <div className="avatar-field">
      <div className="avatar-preview" style={{ background: avatar.color }}>
        {Array.from(name.trim())[0] ?? '?'}
      </div>
      <div className="avatar-controls">
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
    </div>
  )
}
