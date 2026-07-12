import type { MouseEvent, ReactNode } from 'react'
import { appConfirm } from '../lib/dialogs'
import { useModalEscape } from '../lib/modalStack'
import { Icon } from './icons'

interface Props {
  title: ReactNode
  onClose: () => void
  /** true なら閉じる前に破棄確認を挟む（オーバーレイクリック・Escape 経由のみ。フッターの明示キャンセルは対象外） */
  dirty?: boolean
  discardMessage?: string
  wide?: boolean
  /** 本文だけをスクロールさせる固定ヘッダー・フッター付きレイアウト */
  scrollableBody?: boolean
  bodyClassName?: string
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
  scrollableBody,
  bodyClassName,
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
      <div className={['modal', wide && 'modal-wide', scrollableBody && 'modal-scroll-body'].filter(Boolean).join(' ')}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={requestClose}>
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className={['modal-body', bodyClassName].filter(Boolean).join(' ')}>{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
