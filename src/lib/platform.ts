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
