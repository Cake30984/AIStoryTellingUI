import { useEffect, useState, type CSSProperties } from 'react'

interface Props {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  /** true なら確定時に整数へ丸める */
  integer?: boolean
  className?: string
  style?: CSSProperties
  disabled?: boolean
  placeholder?: string
  title?: string
  'aria-label'?: string
}

/**
 * 数値入力の共通部品（FB8-A #13）。フォーカス中はローカル文字列で保持し、blur/Enter で確定＋クランプする。
 * これにより「0 を一度 backspace で空にしてから 1 を打つ」操作ができる（value が数値に固定されず、
 * `Number('')` が 0/NaN に化けて即スナップする問題を避ける）。空のまま確定・数値でない場合は直前の値へ戻す。
 * ReaderSettings の RsField で実証済みのパターンをそのまま一般化したもの。
 */
export default function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  integer,
  className,
  style,
  disabled,
  placeholder,
  title,
  'aria-label': ariaLabel,
}: Props) {
  const clamp = (n: number) => {
    let v = n
    if (integer) v = Math.round(v)
    if (typeof min === 'number') v = Math.max(min, v)
    if (typeof max === 'number') v = Math.min(max, v)
    return v
  }
  const [text, setText] = useState(String(value))
  const [editing, setEditing] = useState(false)
  // 編集中でなければ外部変更（スライダー・リセット・別入力）を反映
  useEffect(() => {
    if (!editing) setText(String(value))
  }, [value, editing])

  const commit = () => {
    const n = Number(text)
    if (text.trim() !== '' && Number.isFinite(n)) onChange(clamp(n))
    else setText(String(value))
    setEditing(false)
  }

  return (
    <input
      type="number"
      className={className}
      style={style}
      disabled={disabled}
      placeholder={placeholder}
      title={title}
      aria-label={ariaLabel}
      min={min}
      max={max}
      step={step}
      value={text}
      onFocus={() => setEditing(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}
