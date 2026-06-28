import { useEffect, useState } from 'react'

interface Props {
  value: string[]
  onChange: (arr: string[]) => void
  placeholder?: string
  className?: string
  style?: React.CSSProperties
}

const parse = (text: string): string[] =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

/**
 * カンマ区切りの配列を編集する入力。
 * 内部で生テキストを保持するため、直接カンマやスペースを入力できる
 * （配列へは「空要素を除いて」変換して親へ通知する）。
 */
export default function CsvInput({ value, onChange, placeholder, className, style }: Props) {
  const [raw, setRaw] = useState(value.join(', '))

  // 外部から value が「現在の入力内容とは別物」に変わった時だけ追従。
  // 入力中（末尾カンマ等で正規化結果が一致する間）は raw を保持する。
  useEffect(() => {
    const incoming = value.join(', ')
    if (parse(raw).join(', ') !== incoming) setRaw(incoming)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <input
      className={className}
      style={style}
      value={raw}
      placeholder={placeholder}
      onChange={(e) => {
        setRaw(e.target.value)
        onChange(parse(e.target.value))
      }}
      onBlur={() => setRaw(value.join(', '))}
    />
  )
}
