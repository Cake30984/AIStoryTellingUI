import MenuPopover from '../MenuPopover'
import { Icon } from '../icons'

/** 選択中に一覧上部へ出すバー（件数・まとめて削除・解除）。FB2-D */
export function SelectionBar({
  count,
  noun,
  onDelete,
  onClear,
}: {
  count: number
  noun: string
  onDelete: () => void
  onClear: () => void
}) {
  if (count < 2) return null
  return (
    <div className="sel-bar">
      <span className="sel-bar-count">{count} 件の{noun}を選択中</span>
      <div style={{ flex: 1 }} />
      <button className="btn danger" onClick={onDelete}>
        <Icon name="trash-2" size={13} /> 選択した {count} 件を削除
      </button>
      <button className="btn" onClick={onClear}>
        選択を解除
      </button>
    </div>
  )
}

/** カード右クリックのコンテキストメニュー。単一なら編集も出す。FB2-D */
export function CardContextMenu({
  pos,
  count,
  noun,
  onEdit,
  onDuplicate,
  onDelete,
  onClose,
  extra,
}: {
  pos: { x: number; y: number }
  count: number
  noun: string
  onEdit?: () => void
  /** 複製（G4-a）。複数選択時は一括複製。複製後もエディタは開かない（一覧に増えるだけ） */
  onDuplicate?: () => void
  onDelete: () => void
  onClose: () => void
  extra?: React.ReactNode
}) {
  const multi = count > 1
  return (
    <MenuPopover position={pos} onClose={onClose}>
      {!multi && onEdit && (
        <button
          className="menu-item"
          onClick={() => {
            onEdit()
            onClose()
          }}
        >
          <Icon name="pencil" size={14} /> 編集
        </button>
      )}
      {onDuplicate && (
        <button
          className="menu-item"
          onClick={() => {
            onDuplicate()
            onClose()
          }}
        >
          <Icon name="layers" size={14} /> {multi ? `選択した ${count} 件を複製` : '複製'}
        </button>
      )}
      {!multi && extra}
      <button
        className="menu-item danger"
        onClick={() => {
          onDelete()
          onClose()
        }}
      >
        <Icon name="trash-2" size={14} /> {multi ? `選択した ${count} 件を削除` : `この${noun}を削除`}
      </button>
    </MenuPopover>
  )
}
