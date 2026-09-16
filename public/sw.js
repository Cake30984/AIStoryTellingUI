// PWA の Service Worker（計画 P5）。**アプリシェルのキャッシュだけ**を担当する。
//
// 方針（ここから外れる機能を足さない）:
// - 触るのは **同一オリジンの GET だけ**。LLM・画像生成・OpenRouter の API は別オリジンなので
//   この SW を一切通らない（`fetch` ハンドラの最初で弾く）
// - 保存データ（localStorage / IndexedDB）には触らない。オフライン再生の責任は持たない
// - ページ（ナビゲーション）は**ネットワーク優先**。デプロイし直したとき古い index.html に
//   貼り付かないようにする。ハッシュ付きの `assets/` は中身が変わらないのでキャッシュ優先
//
// Tauri 版では登録しない（`platform.ts` の `registerServiceWorker` が isTauri で降りる）。

// ビルドごとに変わる名前（`vite.config.ts` の swAssets プラグインが差し替える）。
// 名前が変われば activate で前のビルドのキャッシュが丸ごと消える＝取りこぼしが残らない
const CACHE = 'delist-shell-__BUILD_ID__'

// インストール時に取るもの。`./` はナビゲーションのフォールバック。末尾の展開はビルド成果物
// （ハッシュ付きの JS/CSS）の一覧で、ビルド ID と同じくプラグインが差し替える。
// **ここで先に取っておかないと**、最初の読み込みは SW が効く前に済んでしまい、
// オフラインにした途端 JS/CSS だけ取れずに白画面になる
const SHELL = [
  './',
  './manifest.webmanifest',
  './favicon.png',
  './icon-192.png',
  './icon-512.png',
  ...__ASSETS__,
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // 1つ落ちてもインストールごと失敗させない（アイコンの取りこぼしで SW が入らないのは割に合わない）
      await Promise.allSettled(SHELL.map((url) => cache.add(url)))
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

/** 中身が変わらない（ファイル名にハッシュが入る）ビルド成果物か */
function isHashedAsset(url) {
  return url.pathname.includes('/assets/')
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // **別オリジン（＝API・モデル提供元）は素通し。** ここで return するとブラウザが通常どおり投げる
  if (url.origin !== self.location.origin) return
  // Range 付き（音声・動画の部分取得）はキャッシュと相性が悪いので触らない
  if (req.headers.has('range')) return

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req)
          const cache = await caches.open(CACHE)
          void cache.put('./', res.clone())
          return res
        } catch {
          // オフライン時はキャッシュしたアプリシェルを返す（保存データはブラウザ側にある）
          const cached = await caches.match('./', { ignoreSearch: true })
          if (cached) return cached
          throw new Error('offline and no cached shell')
        }
      })(),
    )
    return
  }

  if (isHashedAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req)
        if (cached) return cached
        const res = await fetch(req)
        if (res.ok) {
          const cache = await caches.open(CACHE)
          void cache.put(req, res.clone())
        }
        return res
      })(),
    )
    return
  }

  // それ以外の同一オリジン（アイコン・manifest 等）はネットワーク優先・失敗したらキャッシュ
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req)
        if (res.ok) {
          const cache = await caches.open(CACHE)
          void cache.put(req, res.clone())
        }
        return res
      } catch {
        const cached = await caches.match(req)
        if (cached) return cached
        throw new Error('offline')
      }
    })(),
  )
})
