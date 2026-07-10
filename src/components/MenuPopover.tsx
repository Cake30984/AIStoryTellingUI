import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useModalEscape } from '../lib/modalStack'

interface Props {
  onClose: () => void
  align?: 'right' | 'left'
  /** 指定時は fixed 座標で表示（右クリックのコンテキストメニュー用。F3） */
  position?: { x: number; y: number }
  children: ReactNode
}

/** 汎用ポップオーバー（⋯メニュー・アクティビティ内訳・Aa設定・右クリックメニューで共用）。position 無しは親に position:relative が必要 */
export default function MenuPopover({ onClose, align = 'right', position, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const cb = useRef(onClose)
  cb.current = onClose

  useModalEscape(() => cb.current())

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb.current()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // 固定座標モード: 画面下端・右端からはみ出さないよう簡易にクランプ
  const fixedStyle = position
    ? ({
        position: 'fixed',
        left: Math.min(position.x, window.innerWidth - 240),
        top: Math.min(position.y, window.innerHeight - 280),
        right: 'auto',
      } as const)
    : undefined

  return (
    <div
      ref={ref}
      className={'menu-pop' + (align === 'left' ? ' align-left' : '')}
      style={fixedStyle}
    >
      {children}
    </div>
  )
}
