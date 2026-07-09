import type { ReactNode } from 'react'
import { useModalEscape } from '../lib/modalStack'

interface Props {
  url: string
  onClose: () => void
  /** 画像の下にキャプション（プロンプト・日時等）を添える場合。指定時は画像クリックでは閉じない */
  caption?: ReactNode
}

/** 画像クリック拡大の共通オーバーレイ（クリック・Escape で閉じる） */
export default function ZoomOverlay({ url, onClose, caption }: Props) {
  useModalEscape(onClose)
  if (caption) {
    return (
      <div className="overlay" onClick={onClose}>
        <div className="modal-body" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '92vw' }}>
          <img
            src={url}
            alt=""
            style={{ maxWidth: '92vw', maxHeight: '80vh', borderRadius: 'var(--radius)', display: 'block' }}
          />
          {caption}
        </div>
      </div>
    )
  }
  return (
    <div className="overlay" onClick={onClose}>
      <img src={url} alt="" style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 'var(--radius)' }} />
    </div>
  )
}
