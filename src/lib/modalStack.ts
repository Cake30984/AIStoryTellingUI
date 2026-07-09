import { useEffect, useRef } from 'react'

const stack: symbol[] = []

/** マウント中のレイヤーをスタックに積み、最前面のときだけ Escape で onEscape を呼ぶ */
export function useModalEscape(onEscape: () => void) {
  const cb = useRef(onEscape)
  cb.current = onEscape
  useEffect(() => {
    const id = Symbol()
    stack.push(id)
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === id) {
        e.preventDefault()
        cb.current()
      }
    }
    window.addEventListener('keydown', h)
    return () => {
      const i = stack.indexOf(id)
      if (i >= 0) stack.splice(i, 1)
      window.removeEventListener('keydown', h)
    }
  }, [])
}

/** 現在スタックに積まれているモーダルレイヤー数（UI-4 の没入 Escape・UI-7 が使う） */
export function modalStackSize() {
  return stack.length
}
