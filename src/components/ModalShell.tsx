import type { MouseEvent, ReactNode } from 'react'
import { appConfirm } from '../lib/dialogs'
import { useModalEscape } from '../lib/modalStack'

interface Props {
  title: ReactNode
  onClose: () => void
  /** true なら閉じる前に破棄確認を挟む（オーバーレイクリック・Escape 経由のみ。フッターの明示キャンセルは対象外） */
  dirty?: boolean
  discardMessage?: string
  wide?: boolean
  footer?: ReactNode
  children: ReactNode
}

/** overlay＋modal＋head＋body＋foot の共通シェル（Escape・draft破棄確認込み） */
export default function ModalShell({
  title,
  onClose,
  dirty,
  discardMessage = '編集内容を破棄しますか？',
  wide,
  footer,
  children,
}: Props) {
  const requestClose = async () => {
    if (dirty && !(await appConfirm({ message: discardMessage, okLabel: '破棄', danger: true }))) return
    onClose()
  }

  useModalEscape(requestClose)

  const onOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) void requestClose()
  }

  return (
    <div className="overlay" onClick={onOverlayClick}>
      <div className={wide ? 'modal modal-wide' : 'modal'}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={requestClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
