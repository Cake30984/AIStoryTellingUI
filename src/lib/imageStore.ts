import { useEffect, useState } from 'react'

/** アバター・カード画像を保存する IndexedDB ストア（localStorage には入れない） */

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

/** 画像を保存し、新規発行した id を返す */
export async function putImage(blob: Blob): Promise<string> {
  const id = uid()
  const record: ImageRecord = { id, blob, createdAt: Date.now() }
  await withStore('readwrite', (store) => store.put(record))
  return id
}

export async function getImage(id: string): Promise<Blob | undefined> {
  const record = await withStore<ImageRecord | undefined>('readonly', (store) => store.get(id))
  return record?.blob
}

export async function deleteImage(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id))
}

export async function listImageIds(): Promise<string[]> {
  const keys = await withStore<IDBValidKey[]>('readonly', (store) => store.getAllKeys())
  return keys.map((k) => String(k))
}

/** 使用中でない画像を削除し、削除件数を返す */
export async function gcImages(usedIds: Set<string>): Promise<number> {
  const ids = await listImageIds()
  const unused = ids.filter((id) => !usedIds.has(id))
  for (const id of unused) await deleteImage(id)
  return unused.length
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
