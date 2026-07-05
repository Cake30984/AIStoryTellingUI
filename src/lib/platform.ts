// 環境差（Web / Tauri）を吸収するアダプタ層。isTauri() 分岐はこのファイルの外に書かない。

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

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

/** zustand persist の StateStorage 互換インターフェース（async 可）。T3 でファイル backend を追加する土台 */
export interface StateStorageLike {
  getItem(name: string): string | null | Promise<string | null>
  setItem(name: string, value: string): void | Promise<void>
  removeItem(name: string): void | Promise<void>
}

/** Web 実装（localStorage の薄いラッパ）。Tauri は当面同じ WebView ストレージを使う（T3 でファイル backend に切替） */
export const stateStorage: StateStorageLike = {
  getItem: (name) => localStorage.getItem(name),
  setItem: (name, value) => localStorage.setItem(name, value),
  removeItem: (name) => localStorage.removeItem(name),
}
