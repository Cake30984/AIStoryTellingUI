import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useModalEscape } from '../lib/modalStack'

interface Props {
  url: string
  onClose: () => void
  /** 画像の下にキャプション（プロンプト・日時等）を添える場合 */
  caption?: ReactNode
}

/**
 * 画像クリック拡大の共通オーバーレイ（FB7-A で再設計）。
 * document.body へのポータル描画＝呼び出し元サムネイルの img セレクタ（.job-thumb img 等）や
 * stacking context の影響を受けない。既定は画像全体が見えるフィット表示、画像クリックで
 * 等倍⇔フィットをトグル（等倍時はスクロールで全域を見る）。閉じるのは背景クリック・Escape。
 */
export default function ZoomOverlay({ url, onClose, caption }: Props) {
  useModalEscape(onClose)
  const [full, setFull] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  // 等倍に切り替えた直後は画像の中央付近から見る
  useEffect(() => {
    if (!full) return
    const el = overlayRef.current
    if (!el) return
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2
    el.scrollTop = (el.scrollHeight - el.clientHeight) / 2
  }, [full])

  return createPortal(
    <div
      ref={overlayRef}
      className={'overlay zoom-overlay' + (full ? ' full' : '')}
      onClick={onClose}
    >
      <div className="zoom-overlay-inner" onClick={(e) => e.stopPropagation()}>
        <img
          className="zoom-overlay-img"
          src={url}
          alt=""
          title={full ? 'クリックで全体表示に戻す' : 'クリックで等倍表示'}
          onClick={() => setFull((f) => !f)}
        />
        {caption && <div className="zoom-caption">{caption}</div>}
      </div>
    </div>,
    document.body,
  )
}
