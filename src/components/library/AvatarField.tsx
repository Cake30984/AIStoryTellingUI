import type { Avatar } from '../../types'

const COLORS = ['#7c5cff', '#ef6f6c', '#4cc9a4', '#f0a76b', '#5b8def', '#d77ad8', '#e0b341', '#8b95a7']

interface Props {
  avatar: Avatar
  onChange: (a: Avatar) => void
}

export default function AvatarField({ avatar, onChange }: Props) {
  return (
    <div className="avatar-field">
      <div className="avatar-preview" style={{ background: avatar.color }}>
        {avatar.emoji || '✦'}
      </div>
      <div className="avatar-controls">
        <input
          className="emoji-input"
          maxLength={2}
          value={avatar.emoji}
          placeholder="絵文字"
          onChange={(e) => onChange({ ...avatar, emoji: e.target.value })}
        />
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
