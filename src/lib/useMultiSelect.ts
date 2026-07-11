import { useCallback, useState } from 'react'
import type { MouseEvent } from 'react'

/**
 * カード一覧の複数選択（Ctrl/Cmd=個別トグル、Shift=範囲選択）＋右クリック選択の共通フック（FB2-D）。
 * `orderedIds` は画面表示順（範囲選択の基準）。通常クリックは呼び出し側の「開く」動作を優先させるため
 * `handleClick` が false を返し、選択操作だったときだけ true を返す（＝開かない）。
 */
export function useMultiSelect(orderedIds: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)

  const clear = useCallback(() => {
    setSelected(new Set())
    setAnchor(null)
  }, [])

  /** カードクリック。修飾キー付き＝選択操作（true を返す＝開かない）。素のクリック＝選択解除して false */
  const handleClick = useCallback(
    (e: MouseEvent, id: string): boolean => {
      if (e.shiftKey && anchor) {
        const a = orderedIds.indexOf(anchor)
        const b = orderedIds.indexOf(id)
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a]
          const range = orderedIds.slice(lo, hi + 1)
          setSelected((prev) => {
            const next = new Set(prev)
            range.forEach((r) => next.add(r))
            return next
          })
          return true
        }
      }
      if (e.ctrlKey || e.metaKey) {
        setSelected((prev) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
        setAnchor(id)
        return true
      }
      // 素のクリック：選択があれば解除だけして（開かない）、無ければ通常動作（開く）
      if (selected.size > 0) {
        clear()
        return true
      }
      return false
    },
    [orderedIds, anchor, selected, clear],
  )

  /** 右クリック時：対象が未選択なら単独選択にする（選択済みなら現在の複数選択を保つ） */
  const selectForContext = useCallback(
    (id: string) => {
      setSelected((prev) => {
        if (prev.has(id)) return prev
        return new Set([id])
      })
      setAnchor(id)
    },
    [],
  )

  return { selected, setSelected, clear, handleClick, selectForContext }
}
