// ネイティブ confirm/prompt の置き換え。React 非依存の要求キュー（cards.ts 等の lib からも呼べる）。
// DialogHost.tsx が購読して先頭1件だけを描画し、解決したらキューから除去する。

export interface ConfirmOptions {
  message: string
  title?: string
  okLabel?: string
  danger?: boolean
}

export interface PromptOptions {
  message: string
  title?: string
  initial?: string
  placeholder?: string
}

/** 3択などの選択ダイアログ（FB6-C）。value が返る。キャンセル/Escape は null */
export interface ChoiceOption {
  label: string
  value: string
  danger?: boolean
  primary?: boolean
}

export interface ChoicesOptions {
  message: string
  title?: string
  options: ChoiceOption[]
}

export type DialogRequest =
  | { id: symbol; kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { id: symbol; kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void }
  | { id: symbol; kind: 'choices'; opts: ChoicesOptions; resolve: (v: string | null) => void }

let queue: DialogRequest[] = []
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}

export function subscribeDialogQueue(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getDialogQueue() {
  return queue
}

export function appConfirm(opts: string | ConfirmOptions): Promise<boolean> {
  const o = typeof opts === 'string' ? { message: opts } : opts
  return new Promise((resolve) => {
    queue = [...queue, { id: Symbol(), kind: 'confirm', opts: o, resolve }]
    notify()
  })
}

export function appPrompt(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    queue = [...queue, { id: Symbol(), kind: 'prompt', opts, resolve }]
    notify()
  })
}

/** 選択ダイアログ（FB6-C）。選ばれた option の value、キャンセルなら null を返す */
export function appChoices(opts: ChoicesOptions): Promise<string | null> {
  return new Promise((resolve) => {
    queue = [...queue, { id: Symbol(), kind: 'choices', opts, resolve }]
    notify()
  })
}

/** DialogHost が OK/キャンセル/Escape/Enter 時に呼ぶ。キューから除去して Promise を解決する */
export function settleDialog(req: DialogRequest, value: boolean | string | null) {
  queue = queue.filter((r) => r.id !== req.id)
  notify()
  req.resolve(value as never)
}
