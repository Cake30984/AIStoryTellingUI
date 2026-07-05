import { useEffect, useState } from 'react'
import { isTauri } from './platform'

/** アバター・カード画像を保存するストア（Web は IndexedDB、Tauri は %APPDATA%/data/images/ のファイル） */

const DB_NAME = 'aist-images'
const DB_VERSION = 1
const STORE_NAME = 'images'

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

interface ImageRecord {
  id: string
  blob: Blob
  createdAt: number
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const store = tx.objectStore(STORE_NAME)
    const req = fn(store)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 画像 Blob の保存先の抽象（Web/Tauri で実装を差し替える。公開関数のシグネチャは共通） */
interface BlobStore {
  put(blob: Blob): Promise<string>
  putAs(id: string, blob: Blob): Promise<void>
  get(id: string): Promise<Blob | undefined>
  delete(id: string): Promise<void>
  listIds(): Promise<string[]>
}

/** Web 実装（IndexedDB） */
const webBlobStore: BlobStore = {
  async put(blob) {
    const id = uid()
    const record: ImageRecord = { id, blob, createdAt: Date.now() }
    await withStore('readwrite', (store) => store.put(record))
    return id
  },
  async putAs(id, blob) {
    const record: ImageRecord = { id, blob, createdAt: Date.now() }
    await withStore('readwrite', (store) => store.put(record))
  },
  async get(id) {
    const record = await withStore<ImageRecord | undefined>('readonly', (store) => store.get(id))
    return record?.blob
  },
  async delete(id) {
    await withStore('readwrite', (store) => store.delete(id))
  },
  async listIds() {
    const keys = await withStore<IDBValidKey[]>('readonly', (store) => store.getAllKeys())
    return keys.map((k) => String(k))
  },
}

// --- Tauri 実装（T3: %APPDATA%/data/images/<id>.<ext> のファイル backend） ---
// id は uid() が発行する不透明な文字列（ドットを含まない）なので、拡張子は
// mime から決めてファイル名に付与し、読み出し時は同 id プレフィックスのファイルを
// readDir で探して拡張子から mime を逆引きする（別途インデックスファイルは持たない）。

const TAURI_IMAGES_DIR = 'data/images'
const TAURI_MIGRATION_MARKER = `${TAURI_IMAGES_DIR}/.migrated-from-indexeddb`

function extOfMime(mime: string): string {
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('gif')) return 'gif'
  return 'png'
}

function mimeOfExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    default:
      return 'image/png'
  }
}

async function ensureImagesDir(): Promise<void> {
  const { mkdir, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  if (!(await exists(TAURI_IMAGES_DIR, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(TAURI_IMAGES_DIR, { baseDir: BaseDirectory.AppData, recursive: true })
  }
}

async function findFileFor(id: string): Promise<string | undefined> {
  await ensureImagesDir()
  const { readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  const entries = await readDir(TAURI_IMAGES_DIR, { baseDir: BaseDirectory.AppData })
  return entries.find((e) => e.name?.startsWith(`${id}.`))?.name
}

async function writeImageFile(id: string, blob: Blob): Promise<void> {
  await ensureImagesDir()
  const { writeFile, remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  const existing = await findFileFor(id)
  if (existing) await remove(`${TAURI_IMAGES_DIR}/${existing}`, { baseDir: BaseDirectory.AppData })
  const ext = extOfMime(blob.type || 'image/png')
  await writeFile(`${TAURI_IMAGES_DIR}/${id}.${ext}`, new Uint8Array(await blob.arrayBuffer()), {
    baseDir: BaseDirectory.AppData,
  })
}

// 旧 WebView 内蔵 IndexedDB からの一度きりの自動移行（マーカーファイルが無い場合のみ）。
// IndexedDB 側データは削除しない（state.json 側の移行と同じくロールバックの余地を残す）。
let imageMigrationPromise: Promise<void> | null = null
function ensureImagesMigrated(): Promise<void> {
  if (!imageMigrationPromise) imageMigrationPromise = migrateImagesFromIndexedDbIfNeeded()
  return imageMigrationPromise
}
async function migrateImagesFromIndexedDbIfNeeded(): Promise<void> {
  await ensureImagesDir()
  const { exists, writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  if (await exists(TAURI_MIGRATION_MARKER, { baseDir: BaseDirectory.AppData })) return
  try {
    const ids = await webBlobStore.listIds()
    for (const id of ids) {
      const blob = await webBlobStore.get(id)
      if (blob) await writeImageFile(id, blob)
    }
  } catch (e) {
    console.error('[imageStore] IndexedDB からファイルへの画像移行に失敗', e)
  }
  await writeFile(TAURI_MIGRATION_MARKER, new Uint8Array(), { baseDir: BaseDirectory.AppData })
}

const tauriBlobStore: BlobStore = {
  async put(blob) {
    await ensureImagesMigrated()
    const id = uid()
    await writeImageFile(id, blob)
    return id
  },
  async putAs(id, blob) {
    await ensureImagesMigrated()
    await writeImageFile(id, blob)
  },
  async get(id) {
    await ensureImagesMigrated()
    const name = await findFileFor(id)
    if (!name) return undefined
    const { readFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const bytes = await readFile(`${TAURI_IMAGES_DIR}/${name}`, { baseDir: BaseDirectory.AppData })
    const ext = name.slice(name.lastIndexOf('.') + 1)
    return new Blob([bytes as BlobPart], { type: mimeOfExt(ext) })
  },
  async delete(id) {
    await ensureImagesMigrated()
    const name = await findFileFor(id)
    if (!name) return
    const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await remove(`${TAURI_IMAGES_DIR}/${name}`, { baseDir: BaseDirectory.AppData })
  },
  async listIds() {
    await ensureImagesMigrated()
    const { readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const entries = await readDir(TAURI_IMAGES_DIR, { baseDir: BaseDirectory.AppData })
    return entries.filter((e) => e.isFile && !e.name.startsWith('.')).map((e) => e.name.slice(0, e.name.lastIndexOf('.')))
  },
}

const blobStore: BlobStore = isTauri() ? tauriBlobStore : webBlobStore

/** 画像を保存し、新規発行した id を返す */
export function putImage(blob: Blob): Promise<string> {
  return blobStore.put(blob)
}

/** id を指定して画像を保存する（インポート復元用。既存 id があれば上書き＝同一画像とみなす） */
export function putImageAs(id: string, blob: Blob): Promise<void> {
  return blobStore.putAs(id, blob)
}

export function getImage(id: string): Promise<Blob | undefined> {
  return blobStore.get(id)
}

export function deleteImage(id: string): Promise<void> {
  return blobStore.delete(id)
}

export function listImageIds(): Promise<string[]> {
  return blobStore.listIds()
}

/** 使用中でない画像を削除し、削除件数を返す */
export async function gcImages(usedIds: Set<string>): Promise<number> {
  const ids = await listImageIds()
  const unused = ids.filter((id) => !usedIds.has(id))
  for (const id of unused) await deleteImage(id)
  return unused.length
}

// バイト列 → Latin-1 文字列（チャンク分割。1バイトずつの連結は数MB級で極端に遅い）
function bytesToBinaryString(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let bin = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[])
  }
  return bin
}

/** 画像 blob → base64 文字列（エクスポート用） */
export async function blobToBase64(blob: Blob): Promise<string> {
  return btoa(bytesToBinaryString(new Uint8Array(await blob.arrayBuffer())))
}

/** base64 文字列 → 画像 blob（インポート用） */
export function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new Blob([bytes as BlobPart], { type: mime })
}

// 表示用 objectURL キャッシュ（アプリ寿命で保持。revoke はしない）
const urlCache = new Map<string, string>()

export async function imageUrlOf(id: string): Promise<string | undefined> {
  const cached = urlCache.get(id)
  if (cached) return cached
  const blob = await getImage(id)
  if (!blob) return undefined
  const url = URL.createObjectURL(blob)
  urlCache.set(id, url)
  return url
}

/** 画像 id から表示用 objectURL を取得する React hook。未ロード中・無しは undefined */
export function useImageUrl(id: string | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(id ? urlCache.get(id) : undefined)

  useEffect(() => {
    if (!id) {
      setUrl(undefined)
      return
    }
    const cached = urlCache.get(id)
    if (cached) {
      setUrl(cached)
      return
    }
    let cancelled = false
    imageUrlOf(id).then((u) => {
      if (!cancelled) setUrl(u)
    })
    return () => {
      cancelled = true
    }
  }, [id])

  return url
}
