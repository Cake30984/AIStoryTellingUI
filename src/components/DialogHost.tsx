import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getDialogQueue, settleDialog, subscribeDialogQueue, type DialogRequest } from '../lib/dialogs'
import { useModalEscape } from '../lib/modalStack'

/** appConfirm/appPrompt のキューを描画する常駐ホスト。App.tsx に1つだけ置く */
export default function DialogHost() {
  const queue = useSyncExternalStore(subscribeDialogQueue, getDialogQueue, getDialogQueue)
  const req = queue[0]
  if (!req) return null
  return <DialogView key={req.id.toString()} req={req} />
}

function DialogView({ req }: { req: DialogRequest }) {
  const [value, setValue] = useState(req.kind === 'prompt' ? req.opts.initial ?? '' : '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const cancel = () => settleDialog(req, req.kind === 'prompt' ? null : false)
  const ok = () => settleDialog(req, req.kind === 'prompt' ? value : true)

  useModalEscape(cancel)

  const danger = req.kind === 'confirm' && !!req.opts.danger
  const title = req.opts.title ?? (req.kind === 'confirm' ? '確認' : '入力')
  const okLabel = (req.kind === 'confirm' ? req.opts.okLabel : undefined) ?? 'OK'

  return (
    <div className="overlay" onClick={cancel}>
      <div
        className="modal"
        style={{ maxWidth: 420 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            ok()
          }
        }}
      >
        <div className="modal-head">
          <h3>{title}</h3>
        </div>
        <div className="modal-body">
          <p style={{ margin: req.kind === 'prompt' ? '0 0 12px' : 0, whiteSpace: 'pre-wrap' }}>
            {req.opts.message}
          </p>
          {req.kind === 'prompt' && (
            <input
              ref={inputRef}
              type="text"
              value={value}
              placeholder={req.opts.placeholder}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={cancel}>
            キャンセル
          </button>
          <button className={danger ? 'btn danger' : 'btn primary'} onClick={ok} autoFocus={req.kind === 'confirm'}>
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
