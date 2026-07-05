// 環境差（Web / Tauri）を吸収するアダプタ層。isTauri() 分岐はこのファイル（とストレージ実装ファイル＝imageStore.ts）の外に書かない。

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** zustand persist の永続化キー。Tauri のファイル移行判定（旧 WebView localStorage の検出）にも使う */
export const PERSIST_KEY = 'ai-storytelling-store-v3'

/** 環境に応じた fetch。Tauri では Rust 側で実行され CORS の制約を受けない */
export async function appFetch(input: string, init?: RequestInit): Promise<Response> {
  if (isTauri()) {
    // 動的 import: Web ビルドに plugin コードを混ぜない
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    return tauriFetch(input, init)
  }
  return window.fetch(input, init)
}

/**
 * blob をファイルとして保存する。Web は `<a download>`（Tauri の WebView では機能しないため
 * ダウンロードは必ずこのアダプタ経由にすること）、Tauri は保存ダイアログ（plugin-dialog の
 * save が選択パスを plugin-fs のスコープへ自動許可するため、追加のスコープ設定は不要）。
 */
export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.') + 1) : undefined
    const path = await save({
      defaultPath: filename,
      filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined,
    })
    if (!path) return // ユーザーがキャンセル
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()))
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** zustand persist の StateStorage 互換インターフェース（async 可） */
export interface StateStorageLike {
  getItem(name: string): string | null | Promise<string | null>
  setItem(name: string, value: string): void | Promise<void>
  removeItem(name: string): void | Promise<void>
}

/** Web 実装（localStorage の薄いラッパ） */
const webStateStorage: StateStorageLike = {
  getItem: (name) => localStorage.getItem(name),
  setItem: (name, value) => localStorage.setItem(name, value),
  removeItem: (name) => localStorage.removeItem(name),
}

// --- Tauri 実装（T3: %APPDATA%/data/state.json へのファイル backend） ---
// アトミック書込（.tmp に書いて rename）＋ 500ms デバウンス（zustand persist は set のたびに
// setItem を呼ぶため、ストリーミング中の delta 毎書き込みを潰す）。ウィンドウの close 要求時は
// 未書き込み分を flush してから閉じる。

const STATE_DIR = 'data'
const STATE_FILE = `${STATE_DIR}/state.json`
const STATE_TMP_FILE = `${STATE_DIR}/state.json.tmp`

let pendingStateValue: string | null = null
let stateWriteTimer: ReturnType<typeof setTimeout> | null = null

async function ensureStateDir(): Promise<void> {
  const { mkdir, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  if (!(await exists(STATE_DIR, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(STATE_DIR, { baseDir: BaseDirectory.AppData, recursive: true })
  }
}

async function writeStateFileNow(value: string): Promise<void> {
  const { writeTextFile, rename, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  await ensureStateDir()
  await writeTextFile(STATE_TMP_FILE, value, { baseDir: BaseDirectory.AppData })
  await rename(STATE_TMP_FILE, STATE_FILE, {
    oldPathBaseDir: BaseDirectory.AppData,
    newPathBaseDir: BaseDirectory.AppData,
  })
}

/** デバウンス中の書き込みを即座に確定する（ウィンドウ close 要求時に使用） */
async function flushStateWrite(): Promise<void> {
  if (stateWriteTimer) {
    clearTimeout(stateWriteTimer)
    stateWriteTimer = null
  }
  if (pendingStateValue === null) return
  const value = pendingStateValue
  pendingStateValue = null
  try {
    await writeStateFileNow(value)
  } catch (e) {
    console.error('[platform] state.json の書き込みに失敗', e)
  }
}

function scheduleStateWrite(value: string): void {
  pendingStateValue = value
  if (stateWriteTimer) clearTimeout(stateWriteTimer)
  stateWriteTimer = setTimeout(() => {
    stateWriteTimer = null
    void flushStateWrite()
  }, 500)
}

// 旧 WebView 内蔵 localStorage からの一度きりの自動移行（state.json が無い場合のみ）。
// WebView 側データは削除しない（ロールバックの余地を残す）。
let stateMigrationDone = false
async function migrateStateFromWebviewStorageIfNeeded(): Promise<void> {
  if (stateMigrationDone) return
  stateMigrationDone = true
  const { exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  if (await exists(STATE_FILE, { baseDir: BaseDirectory.AppData })) return
  const legacy = localStorage.getItem(PERSIST_KEY)
  if (legacy === null) return
  try {
    await writeStateFileNow(legacy)
  } catch (e) {
    console.error('[platform] 旧 localStorage から state.json への移行に失敗', e)
  }
}

const tauriStateStorage: StateStorageLike = {
  async getItem(name) {
    void name // 永続化キーは1つの state.json にそのまま対応するため未使用
    await migrateStateFromWebviewStorageIfNeeded()
    try {
      const { readTextFile, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
      if (!(await exists(STATE_FILE, { baseDir: BaseDirectory.AppData }))) return null
      return await readTextFile(STATE_FILE, { baseDir: BaseDirectory.AppData })
    } catch (e) {
      console.error('[platform] state.json の読み込みに失敗', e)
      return null
    }
  },
  setItem(_name, value) {
    scheduleStateWrite(value)
  },
  async removeItem(_name) {
    if (stateWriteTimer) {
      clearTimeout(stateWriteTimer)
      stateWriteTimer = null
    }
    pendingStateValue = null
    const { remove, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    if (await exists(STATE_FILE, { baseDir: BaseDirectory.AppData })) {
      await remove(STATE_FILE, { baseDir: BaseDirectory.AppData })
    }
  },
}

/** 環境に応じた永続化ストレージ。Web は localStorage、Tauri は %APPDATA%/data/state.json */
export const stateStorage: StateStorageLike = isTauri() ? tauriStateStorage : webStateStorage

// ウィンドウの close 要求時、デバウンス中の書き込みを flush してから閉じる
if (isTauri()) {
  void (async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    await win.onCloseRequested(async (event) => {
      event.preventDefault()
      await flushStateWrite()
      await win.destroy()
    })
  })()
}
