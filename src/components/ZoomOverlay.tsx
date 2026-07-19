import { type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useModalEscape } from '../lib/modalStack'

interface Props {
  url: string
  onClose: () => void
  /** 画像の下にキャプション（プロンプト・日時等）を添える場合 */
  caption?: ReactNode
}

/**
 * 画像クリック拡大の共通オーバーレイ（FB7-A）。
 * document.body へのポータル描画＝呼び出し元サムネイルの img セレクタ（.job-thumb img 等）や
 * stacking context の影響を受けない。画像は画面いっぱいにフィット表示し、全体が見える。
 * 閉じるのは背景クリック・画像クリック・Escape（キャプションは本文選択のため据え置き）。
 */
export default function ZoomOverlay({ url, onClose, caption }: Props) {
  useModalEscape(onClose)
  return createPortal(
    <div className="overlay zoom-overlay" onClick={onClose}>
      <div className="zoom-overlay-inner">
        <img
          className="zoom-overlay-img"
          src={url}
          alt=""
          title="クリックで閉じる"
          onClick={onClose}
        />
        {caption && (
          <div className="zoom-caption" onClick={(e) => e.stopPropagation()}>
            {caption}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
