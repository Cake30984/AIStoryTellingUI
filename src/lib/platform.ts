// 環境差（Web / Tauri）を吸収するアダプタ層。isTauri() 分岐はこのファイル（とストレージ実装ファイル＝imageStore.ts）の外に書かない。

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** zustand persist の永続化キー。Tauri のファイル移行判定（旧 WebView localStorage の検出）にも使う */
export const PERSIST_KEY = 'ai-storytelling-store-v3'

export interface AppFetchInit extends RequestInit {
  /**
   * Origin ヘッダを送らない。Tauri の plugin-http は Rust 側で実行するにもかかわらず WebView の
   * origin（dev: `http://localhost:5173` / 本番: `http://tauri.localhost`）を Origin として必ず付与する。
   * ComfyUI を通常起動（`--enable-cors-header` なし）すると origin_only_middleware が
   * 「Host がループバック かつ Origin のホスト名が Host と不一致」を 403 で落とすため、
   * ローカルサーバ相手にはこれを立てて Origin を外す。Web ではブラウザが Origin を管理するので無視される。
   */
  omitOrigin?: boolean
}

/** 環境に応じた fetch。Tauri では Rust 側で実行され CORS の制約を受けない */
export async function appFetch(input: string, init?: AppFetchInit): Promise<Response> {
  const { omitOrigin, ...rest } = init ?? {}
  if (isTauri()) {
    // 動的 import: Web ビルドに plugin コードを混ぜない
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    // 空文字の Origin を渡すと plugin-http 側がヘッダごと削除する（unsafe-headers feature が必要）
    const headers = omitOrigin ? { ...headersToObject(rest.headers), Origin: '' } : rest.headers
    return tauriFetch(input, { ...rest, headers })
  }
  return window.fetch(input, rest)
}

function headersToObject(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return { ...headers }
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

// --- 読めない永続データの封印（R1） ---
// スキーマ移行に失敗した状態でアプリを動かすと、既定値で state を上書きしてユーザーのセーブを
// 復旧不能にする。失敗を検知した時点で以後の書き込みを全て握り潰し、保存済みデータを原状のまま残す。
let stateWritesBlocked = false

/** 以後の永続化書き込みを封印する（デバウンス待ちの分も捨てる）。解除手段は持たない＝再起動まで */
export function blockStateWrites(): void {
  stateWritesBlocked = true
  if (stateWriteTimer) {
    clearTimeout(stateWriteTimer)
    stateWriteTimer = null
  }
  pendingStateValue = null
}

/** 永続データの保存場所（バックアップを促す案内の表示用。identifier は tauri.conf.json と対応） */
export function stateLocationLabel(): string {
  return isTauri()
    ? '%APPDATA%\\com.tokatokage.delist\\data\\state.json'
    : `ブラウザの localStorage（キー: ${PERSIST_KEY}）`
}

/** Web 実装（localStorage の薄いラッパ） */
const webStateStorage: StateStorageLike = {
  getItem: (name) => localStorage.getItem(name),
  setItem: (name, value) => {
    if (stateWritesBlocked) return
    localStorage.setItem(name, value)
  },
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
  if (pendingStateValue === null || stateWritesBlocked) return
  const value = pendingStateValue
  pendingStateValue = null
  try {
    await writeStateFileNow(value)
  } catch (e) {
    console.error('[platform] state.json の書き込みに失敗', e)
  }
}

function scheduleStateWrite(value: string): void {
  if (stateWritesBlocked) return
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

// --- CheckpointStore（C1: セーブ/ロードと分岐周回のチェックポイント実体） ---
// stateStorage / BlobStore と同じ流儀で Web(IndexedDB)/Tauri(ファイル) を切替。
// 実体は gzip 済みバイナリ（呼び出し側で圧縮/伸長する）。

export interface CheckpointStore {
  put(sessionId: string, nodeId: string, data: Uint8Array): Promise<void>
  get(sessionId: string, nodeId: string): Promise<Uint8Array | undefined>
  delete(sessionId: string, nodeId: string): Promise<void>
  /** セッション削除時にまとめて破棄 */
  deleteSession(sessionId: string): Promise<void>
  /** 整合性チェック（木に無い孤児の掃除）用 */
  listNodeIds(sessionId: string): Promise<string[]>
}

const CHECKPOINT_DB_NAME = 'aist-checkpoints'
const CHECKPOINT_DB_VERSION = 1
const CHECKPOINT_STORE_NAME = 'checkpoints'

interface CheckpointRecord {
  key: string
  sessionId: string
  nodeId: string
  data: Uint8Array
  createdAt: number
}

function openCheckpointDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CHECKPOINT_DB_NAME, CHECKPOINT_DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(CHECKPOINT_STORE_NAME)) {
        const store = db.createObjectStore(CHECKPOINT_STORE_NAME, { keyPath: 'key' })
        store.createIndex('sessionId', 'sessionId', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withCheckpointStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openCheckpointDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHECKPOINT_STORE_NAME, mode)
    const store = tx.objectStore(CHECKPOINT_STORE_NAME)
    const req = fn(store)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const webCheckpointStore: CheckpointStore = {
  async put(sessionId, nodeId, data) {
    const record: CheckpointRecord = { key: `${sessionId}/${nodeId}`, sessionId, nodeId, data, createdAt: Date.now() }
    await withCheckpointStore('readwrite', (store) => store.put(record))
  },
  async get(sessionId, nodeId) {
    const record = await withCheckpointStore<CheckpointRecord | undefined>('readonly', (store) =>
      store.get(`${sessionId}/${nodeId}`),
    )
    return record?.data
  },
  async delete(sessionId, nodeId) {
    await withCheckpointStore('readwrite', (store) => store.delete(`${sessionId}/${nodeId}`))
  },
  async deleteSession(sessionId) {
    const db = await openCheckpointDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CHECKPOINT_STORE_NAME, 'readwrite')
      const index = tx.objectStore(CHECKPOINT_STORE_NAME).index('sessionId')
      const req = index.openCursor(IDBKeyRange.only(sessionId))
      req.onsuccess = () => {
        const cursor = req.result
        if (cursor) {
          cursor.delete()
          cursor.continue()
        } else {
          resolve()
        }
      }
      req.onerror = () => reject(req.error)
    })
  },
  async listNodeIds(sessionId) {
    const db = await openCheckpointDb()
    return new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(CHECKPOINT_STORE_NAME, 'readonly')
      const index = tx.objectStore(CHECKPOINT_STORE_NAME).index('sessionId')
      const req = index.getAll(IDBKeyRange.only(sessionId))
      req.onsuccess = () => resolve((req.result as CheckpointRecord[]).map((r) => r.nodeId))
      req.onerror = () => reject(req.error)
    })
  },
}

// --- Tauri 実装（T3 で予約済みの %APPDATA%/data/checkpoints/<sessionId>/<nodeId>.bin ） ---

const CHECKPOINTS_DIR = 'data/checkpoints'

async function ensureCheckpointDir(sessionId: string): Promise<void> {
  const { mkdir, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  const dir = `${CHECKPOINTS_DIR}/${sessionId}`
  if (!(await exists(dir, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true })
  }
}

const tauriCheckpointStore: CheckpointStore = {
  async put(sessionId, nodeId, data) {
    await ensureCheckpointDir(sessionId)
    const { writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await writeFile(`${CHECKPOINTS_DIR}/${sessionId}/${nodeId}.bin`, data, { baseDir: BaseDirectory.AppData })
  },
  async get(sessionId, nodeId) {
    const { readFile, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const path = `${CHECKPOINTS_DIR}/${sessionId}/${nodeId}.bin`
    if (!(await exists(path, { baseDir: BaseDirectory.AppData }))) return undefined
    return readFile(path, { baseDir: BaseDirectory.AppData })
  },
  async delete(sessionId, nodeId) {
    const { remove, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const path = `${CHECKPOINTS_DIR}/${sessionId}/${nodeId}.bin`
    if (await exists(path, { baseDir: BaseDirectory.AppData })) {
      await remove(path, { baseDir: BaseDirectory.AppData })
    }
  },
  async deleteSession(sessionId) {
    const { remove, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const dir = `${CHECKPOINTS_DIR}/${sessionId}`
    if (await exists(dir, { baseDir: BaseDirectory.AppData })) {
      await remove(dir, { baseDir: BaseDirectory.AppData, recursive: true })
    }
  },
  async listNodeIds(sessionId) {
    const { readDir, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const dir = `${CHECKPOINTS_DIR}/${sessionId}`
    if (!(await exists(dir, { baseDir: BaseDirectory.AppData }))) return []
    const entries = await readDir(dir, { baseDir: BaseDirectory.AppData })
    return entries.filter((e) => e.isFile && e.name?.endsWith('.bin')).map((e) => e.name.slice(0, -4))
  },
}

/** 環境に応じたチェックポイント実体ストア。Web は IndexedDB、Tauri は %APPDATA%/data/checkpoints/ */
export const checkpointStore: CheckpointStore = isTauri() ? tauriCheckpointStore : webCheckpointStore

// --- 資格情報ストア（R3: API キーを平文 state.json から出す）---
// Tauri: Rust 側の save_secret/load_secret/delete_secret（OS の資格情報ストア）。
// Web: 何もしない（apiKey はこれまで通り partialize でそのまま localStorage に入る。
// Web 版は開発・検証用であり配布物ではないため R3 の対象外）。

/** providers の資格情報ストアの id プレフィックス（Rust 側の account 名） */
export const PROVIDER_SECRET_PREFIX = 'provider:'
/** imageProviders の資格情報ストアの id プレフィックス */
export const IMAGE_PROVIDER_SECRET_PREFIX = 'imageProvider:'

async function tauriSaveSecret(id: string, value: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('save_secret', { id, value })
}

async function tauriLoadSecret(id: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    return (await invoke<string | null>('load_secret', { id })) ?? ''
  } catch (e) {
    console.error('[platform] 資格情報の読み込みに失敗', id, e)
    return ''
  }
}

async function tauriDeleteSecret(id: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    await invoke('delete_secret', { id })
  } catch (e) {
    console.error('[platform] 資格情報の削除に失敗', id, e)
  }
}

/**
 * apiKey を資格情報ストアへ保存する（Tauri のみ。Web は no-op）。
 * store.ts の upsertProvider / upsertImageProvider から呼ぶ。空文字なら削除として扱う
 * （「キーを消して保存」で古い値が資格情報ストアに残り続けるのを防ぐ）。
 */
export async function persistProviderSecret(prefix: string, id: string, apiKey: string): Promise<void> {
  if (!isTauri()) return
  if (!apiKey) {
    await tauriDeleteSecret(`${prefix}${id}`)
    return
  }
  await tauriSaveSecret(`${prefix}${id}`, apiKey)
}

/** 資格情報ストアから削除する（Tauri のみ）。store.ts の deleteProvider / deleteImageProvider から呼ぶ */
export async function removeProviderSecret(prefix: string, id: string): Promise<void> {
  if (!isTauri()) return
  await tauriDeleteSecret(`${prefix}${id}`)
}

/**
 * persist 保存直前に apiKey を落とす（Tauri のみ。Web はそのまま）。store.ts の partialize から呼ぶ。
 * 資格情報ストアが唯一の保存先になるので、ここで落とさないと state.json に平文が残り続ける。
 */
export function stripApiKeyForPersist<T extends { apiKey: string }>(items: T[]): T[] {
  if (!isTauri()) return items
  return items.map((item) => ({ ...item, apiKey: '' }))
}

/**
 * 起動時（ハイドレーション後）に1回呼ぶ。資格情報ストアの値を優先して apiKey を埋め直す。
 * **既存ユーザーの移行も兼ねる**：資格情報ストアが空で、persist から読み込まれた apiKey が
 * まだ残っている（旧 state.json に平文で書かれていた）場合はそれを資格情報ストアへ移し、
 * 以後は partialize が落とすので state.json 側は次回保存時に自然に空へ上書きされる。
 * Web では何もしない（isTauri() でない限り items をそのまま返す）。
 */
export async function syncProviderSecrets<T extends { id: string; apiKey: string }>(
  items: T[],
  prefix: string,
): Promise<T[]> {
  if (!isTauri() || items.length === 0) return items
  return Promise.all(
    items.map(async (item) => {
      const secretId = `${prefix}${item.id}`
      const stored = await tauriLoadSecret(secretId)
      if (stored) return { ...item, apiKey: stored }
      if (item.apiKey) {
        // 旧 state.json 由来の平文キーを資格情報ストアへ移行
        await tauriSaveSecret(secretId, item.apiKey)
        return item
      }
      return { ...item, apiKey: '' }
    }),
  )
}

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
