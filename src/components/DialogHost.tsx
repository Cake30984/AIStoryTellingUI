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

  const cancel = () => settleDialog(req, req.kind === 'confirm' ? false : null)
  const ok = () => {
    if (req.kind === 'choices') return // 選択肢ボタンからのみ解決する（Enter では選ばない）
    settleDialog(req, req.kind === 'prompt' ? value : true)
  }

  useModalEscape(cancel)

  const danger = req.kind === 'confirm' && !!req.opts.danger
  const title = req.opts.title ?? (req.kind === 'confirm' ? '確認' : req.kind === 'choices' ? '確認' : '入力')
  const okLabel = (req.kind === 'confirm' ? req.opts.okLabel : undefined) ?? 'OK'

  return (
    <div className="overlay" onClick={cancel}>
      <div
        className="modal"
        style={{ maxWidth: 420 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && req.kind !== 'choices') {
            e.preventDefault()
            ok()
          }
        }}
      >
        <div className="modal-head">
          <h3>{title}</h3>
        </div>
        <div className="modal-body">
          <p style={{ margin: req.kind === 'confirm' ? 0 : '0 0 12px', whiteSpace: 'pre-wrap' }}>
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
          {req.kind === 'choices' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {req.opts.options.map((o) => (
                <button
                  key={o.value}
                  className={o.danger ? 'btn danger' : o.primary ? 'btn primary' : 'btn'}
                  onClick={() => settleDialog(req, o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={cancel}>
            キャンセル
          </button>
          {req.kind !== 'choices' && (
            <button className={danger ? 'btn danger' : 'btn primary'} onClick={ok} autoFocus={req.kind === 'confirm'}>
              {okLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
