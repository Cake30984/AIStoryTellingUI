// 環境差（Web / Tauri）を吸収するアダプタ層。isTauri() 分岐はこのファイル（とストレージ実装ファイル＝imageStore.ts）の外に書かない。

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** R4: OAuth (PKCE) 接続はローカル受け口を Rust 側で立てる関係で Tauri 限定（Web には実装しない） */
export function oauthPkceAvailable(): boolean {
  return isTauri()
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

/**
 * 以後の永続化書き込みを封印する（デバウンス待ちの分も捨てる）。解除手段は持たない＝再起動まで。
 * **セッション本体（SessionStore）の書き込みも同時に止める**（state.json だけ守っても意味がない。P2c）。
 */
export function blockStateWrites(): void {
  stateWritesBlocked = true
  if (stateWriteTimer) {
    clearTimeout(stateWriteTimer)
    stateWriteTimer = null
  }
  pendingStateValue = null
  if (sessionWriteTimer) {
    clearTimeout(sessionWriteTimer)
    sessionWriteTimer = null
  }
  pendingSessionRecords.clear()
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

// --- SessionStore（計画 P2c: セッション本体を state.json / localStorage から出す） ---
//
// zustand persist は `set()` のたびに**全状態**を直列化する。本文が state に乗っている限り、
// ストリーミングの1チャンクごとに全セッションを JSON.stringify することになる（既知の性能問題）。
// そこでセッション本体だけをこのストアへ移し、**1件＝1レコード**で読み書きする。
//
// - **この層は中身（`Session` 型）を解釈しない。** 触るのは `id`／`title`／`updatedAt` だけ
// - 版番 `v` は呼び出し側（`lib/schema.ts` の `SAVE_DATA_VERSION`）が**レコードごとに**刻む。
//   ファイル単位で版が分かるので、移行が途中で落ちても次回は残りだけが上がる＝二重適用にならない
// - **`blockStateWrites()` の安全弁はここにも掛かる**（state.json だけ守っても意味がない）
//
// 実装は P2c の骨組み。ストアへの接続（`partialize` から `sessions` を外す・読み書きの切替）は
// P2c の2回目で行う＝現時点ではどこからも呼ばれていない。

/** SessionStore が持ち回すセッション（中身は解釈しないので index signature で素通しする） */
export interface StoredSession {
  id: string
  title?: string
  updatedAt?: number
  [key: string]: unknown
}

/** SessionStore の1レコード。`v` はそのセッションが書かれた時点のセーブデータ版番 */
export interface SessionRecord {
  v: number
  session: StoredSession
}

/** 本体を読み込まずに一覧へ出すための要約（`bytes` はファイル backend のみ） */
export interface SessionSummary {
  id: string
  v: number
  title: string
  updatedAt: number
  bytes?: number
}

export interface SessionStore {
  /** 一覧（本文は返さない）。Web(IndexedDB) は行ごと読むので読み込み量の節約にはならない */
  list(): Promise<SessionSummary[]>
  /** 全件。チェックポイント・書き出し・カセット・GC が「全セッションの配列」を入力に取るための読み出し口 */
  getAll(): Promise<SessionRecord[]>
  get(id: string): Promise<SessionRecord | undefined>
  put(record: SessionRecord): Promise<void>
  delete(id: string): Promise<void>
}

const SESSION_DB_NAME = 'aist-sessions'
const SESSION_DB_VERSION = 1
const SESSION_STORE_NAME = 'sessions'

/** IndexedDB の行。要約欄を平たく持つ（本文を読まずに一覧へ出せる形を将来に残す） */
interface SessionRow {
  id: string
  v: number
  title: string
  updatedAt: number
  session: StoredSession
}

function rowOf(record: SessionRecord): SessionRow {
  return {
    id: record.session.id,
    v: record.v,
    title: typeof record.session.title === 'string' ? record.session.title : '',
    updatedAt: typeof record.session.updatedAt === 'number' ? record.session.updatedAt : 0,
    session: record.session,
  }
}

function openSessionDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SESSION_DB_NAME, SESSION_DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(SESSION_STORE_NAME)) {
        db.createObjectStore(SESSION_STORE_NAME, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withSessionStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openSessionDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSION_STORE_NAME, mode)
    const req = fn(tx.objectStore(SESSION_STORE_NAME))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Web 実装（IndexedDB）。localStorage の約5MB 上限から出るのがそもそもの目的。
 * structured clone で入るので、**Web 側は保存に JSON.stringify を通らない**
 * （＝`Session` にクローンできない値を入れないこと）。
 */
const webSessionStore: SessionStore = {
  async list() {
    const rows = await withSessionStore<SessionRow[]>('readonly', (store) => store.getAll())
    return rows.map((r) => ({ id: r.id, v: r.v, title: r.title, updatedAt: r.updatedAt }))
  },
  async getAll() {
    const rows = await withSessionStore<SessionRow[]>('readonly', (store) => store.getAll())
    return rows.map((r) => ({ v: r.v, session: r.session }))
  },
  async get(id) {
    const row = await withSessionStore<SessionRow | undefined>('readonly', (store) => store.get(id))
    return row ? { v: row.v, session: row.session } : undefined
  },
  async put(record) {
    if (stateWritesBlocked) return
    await withSessionStore('readwrite', (store) => store.put(rowOf(record)))
  },
  async delete(id) {
    if (stateWritesBlocked) return
    await withSessionStore('readwrite', (store) => store.delete(id))
  },
}

// --- Tauri 実装（%APPDATA%/data/sessions/<id>.json。state.json と同じアトミック書込） ---

const SESSIONS_DIR = 'data/sessions'

/**
 * id をファイル名にする。取り込んだバンドル由来の id はこちらで発行したものとは限らないので、
 * パス区切りを含む値でもディレクトリを抜け出さないようエンコードする。
 * **読み出し時の id はファイル名ではなく中身（`session.id`）から取る**ので復号は要らない。
 */
function sessionFileName(id: string): string {
  return `${encodeURIComponent(id)}.json`
}

async function ensureSessionsDir(): Promise<void> {
  const { mkdir, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  if (!(await exists(SESSIONS_DIR, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(SESSIONS_DIR, { baseDir: BaseDirectory.AppData, recursive: true })
  }
}

// 同じ id への書き込みは直列化する（.tmp をファイル名ごとに分けても、rename 前に次の書込が
// 走ると新旧が混ざる）。チェックポイントの serializeCheckpointWrite と同じ流儀。
const sessionFileWrites = new Map<string, Promise<void>>()

function serializeSessionFileWrite(id: string, fn: () => Promise<void>): Promise<void> {
  const prev = sessionFileWrites.get(id) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  sessionFileWrites.set(id, next)
  void next.finally(() => {
    if (sessionFileWrites.get(id) === next) sessionFileWrites.delete(id)
  })
  return next
}

async function readSessionFiles(): Promise<{ record: SessionRecord; bytes: number }[]> {
  const { readDir, readTextFile, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  if (!(await exists(SESSIONS_DIR, { baseDir: BaseDirectory.AppData }))) return []
  const entries = await readDir(SESSIONS_DIR, { baseDir: BaseDirectory.AppData })
  const out: { record: SessionRecord; bytes: number }[] = []
  for (const entry of entries) {
    if (!entry.isFile || !entry.name.endsWith('.json')) continue
    try {
      const text = await readTextFile(`${SESSIONS_DIR}/${entry.name}`, { baseDir: BaseDirectory.AppData })
      const parsed = JSON.parse(text) as SessionRecord
      if (typeof parsed?.session?.id !== 'string' || typeof parsed?.v !== 'number') continue
      out.push({ record: parsed, bytes: text.length })
    } catch (e) {
      // 壊れた1件でライブラリ全体を読めなくしない（ファイルは消さずに残す＝後から救出できる）
      console.error('[platform] セッションファイルを読めませんでした', entry.name, e)
    }
  }
  return out
}

const tauriSessionStore: SessionStore = {
  async list() {
    const files = await readSessionFiles()
    return files.map(({ record, bytes }) => ({
      id: record.session.id,
      v: record.v,
      title: typeof record.session.title === 'string' ? record.session.title : '',
      updatedAt: typeof record.session.updatedAt === 'number' ? record.session.updatedAt : 0,
      bytes,
    }))
  },
  async getAll() {
    return (await readSessionFiles()).map((f) => f.record)
  },
  async get(id) {
    const { readTextFile, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const path = `${SESSIONS_DIR}/${sessionFileName(id)}`
    if (!(await exists(path, { baseDir: BaseDirectory.AppData }))) return undefined
    try {
      return JSON.parse(await readTextFile(path, { baseDir: BaseDirectory.AppData })) as SessionRecord
    } catch (e) {
      console.error('[platform] セッションファイルを読めませんでした', path, e)
      return undefined
    }
  },
  async put(record) {
    if (stateWritesBlocked) return
    const id = record.session.id
    const value = JSON.stringify(record)
    await serializeSessionFileWrite(id, async () => {
      if (stateWritesBlocked) return
      const { writeTextFile, rename, BaseDirectory } = await import('@tauri-apps/plugin-fs')
      await ensureSessionsDir()
      const path = `${SESSIONS_DIR}/${sessionFileName(id)}`
      await writeTextFile(`${path}.tmp`, value, { baseDir: BaseDirectory.AppData })
      await rename(`${path}.tmp`, path, {
        oldPathBaseDir: BaseDirectory.AppData,
        newPathBaseDir: BaseDirectory.AppData,
      })
    })
  },
  async delete(id) {
    if (stateWritesBlocked) return
    await serializeSessionFileWrite(id, async () => {
      const { remove, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
      const path = `${SESSIONS_DIR}/${sessionFileName(id)}`
      if (await exists(path, { baseDir: BaseDirectory.AppData })) {
        await remove(path, { baseDir: BaseDirectory.AppData })
      }
    })
  },
}

/** 環境に応じたセッション本体のストア。Web は IndexedDB、Tauri は %APPDATA%/data/sessions/ */
export const sessionStore: SessionStore = isTauri() ? tauriSessionStore : webSessionStore

/** 永続データの保存場所（セッション本体。schemaError の案内でバックアップ先として出す） */
export function sessionsLocationLabel(): string {
  return isTauri()
    ? `%APPDATA%\\com.tokatokage.delist\\${SESSIONS_DIR}\\`
    : `ブラウザの IndexedDB（${SESSION_DB_NAME}）`
}

// --- 書き込みのデバウンス（P2c） ---
// セッションは1ターンに何度も差し替わる。同じ id への書き込みを 500ms の窓でまとめる
// （state.json と同じ間隔。窓は最初の1件で開き、後続で伸ばさない＝書き込みが遅れ続けない）。
// **生成中（pending メッセージあり）のセッションは呼び出し側が渡さない**のが規約
// （中断・クラッシュ時の復旧は merge の「空 pending は削除／内容ありは truncated」で足りる）。

const SESSION_WRITE_DEBOUNCE_MS = 500
const pendingSessionRecords = new Map<string, SessionRecord>()
let sessionWriteTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleSessionWrite(record: SessionRecord): void {
  if (stateWritesBlocked) return
  pendingSessionRecords.set(record.session.id, record)
  if (sessionWriteTimer) return
  sessionWriteTimer = setTimeout(() => {
    sessionWriteTimer = null
    void flushSessionWrites()
  }, SESSION_WRITE_DEBOUNCE_MS)
}

/**
 * デバウンス待ちの1件を捨てる。**削除より先に呼ぶこと**——待機中の書き込みが残っていると、
 * `delete` の後にその1件が書き戻されてセッションが復活する。
 */
export function cancelSessionWrite(id: string): void {
  pendingSessionRecords.delete(id)
}

/** デバウンス中の書き込みを確定する（終了時・タブを隠したとき） */
export async function flushSessionWrites(): Promise<void> {
  if (sessionWriteTimer) {
    clearTimeout(sessionWriteTimer)
    sessionWriteTimer = null
  }
  if (stateWritesBlocked || pendingSessionRecords.size === 0) return
  const records = [...pendingSessionRecords.values()]
  pendingSessionRecords.clear()
  for (const record of records) {
    try {
      await sessionStore.put(record)
    } catch (e) {
      console.error('[platform] セッションの保存に失敗', record.session.id, e)
    }
  }
}

// Web はウィンドウの close 要求を捕まえられず、IndexedDB は同期に書けない。タブが隠れた時点で
// 流しておく（pagehide まで待つと書き切れないことがある）。Tauri 側は onCloseRequested で flush する。
if (!isTauri() && typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushSessionWrites()
  })
  window.addEventListener('pagehide', () => {
    void flushSessionWrites()
  })
}

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

// ウィンドウの close 要求時、デバウンス中の書き込みを flush してから閉じる。
//
// **`core:window:allow-destroy` を capabilities に入れておくこと**（`core:window` の既定権限は
// 取得系だけで destroy を含まない）。preventDefault したあと destroy が権限拒否されると
// **閉じるのを止めただけで終わり、ウィンドウが二度と閉じられなくなる**（2026-08-23 に実機で再現）。
// 権限が欠けても詰まないよう、closing フラグを立てて2回目の close 要求は素通しさせる。
if (isTauri()) {
  void (async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    let closing = false
    await win.onCloseRequested(async (event) => {
      if (closing) return // 2回目は既定の閉じる動作に任せる
      event.preventDefault()
      try {
        // セッション本体（P2c）→ 入れ物の順に流す
        await flushSessionWrites()
        await flushStateWrite()
      } catch (e) {
        console.error('[platform] 終了時の書き込みに失敗', e)
      }
      closing = true
      try {
        await win.destroy()
      } catch (e) {
        console.error('[platform] destroy に失敗。close で閉じ直す', e)
        await win.close()
      }
    })
  })()
}
