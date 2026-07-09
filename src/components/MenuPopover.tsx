import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useModalEscape } from '../lib/modalStack'

interface Props {
  onClose: () => void
  align?: 'right' | 'left'
  children: ReactNode
}

/** 汎用ポップオーバー（⋯メニュー・アクティビティ内訳・Aa設定で共用）。親要素に position:relative が必要 */
export default function MenuPopover({ onClose, align = 'right', children }: Props) {
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

  return (
    <div ref={ref} className={'menu-pop' + (align === 'left' ? ' align-left' : '')}>
      {children}
    </div>
  )
}
