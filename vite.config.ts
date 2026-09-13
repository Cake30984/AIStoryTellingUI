import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Tauri 起動時（TAURI_ENV_PLATFORM あり）は devUrl とポートがずれると白画面になるため strictPort にする
const isTauri = !!process.env.TAURI_ENV_PLATFORM

// 本体バージョン（カードの minRuntimeVersion 判定に使う。R2）。package.json を唯一の出所にして
// ソース側に二重管理しない。src-tauri/tauri.conf.json の version とは手で揃える
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

/**
 * Web 版の CSP（計画 P2a）。**Tauri 版の正は `src-tauri/tauri.conf.json` の `security.csp`** で、
 * そちらは Tauri が自分でヘッダとして注入する（meta と二重に掛けると Tauri 側の nonce と噛み合わない）ため、
 * TAURI_ENV_PLATFORM があるビルドにはこの meta を入れない。
 *
 * - `connect-src` は接続先がユーザー指定（ローカル LLM・ComfyUI・任意の OpenAI 互換）なので広く取る
 * - `style-src` の `'unsafe-inline'` は現状 style 属性を使っているため必要
 * - dev だけ `ws:`（Vite の HMR）と `'unsafe-inline'` スクリプト（@vitejs/plugin-react が
 *   react-refresh のプリアンブルをインラインで差し込む）を許す。**ビルド成果物には入れない**
 */
function cspContent(dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self'${dev ? " 'unsafe-inline'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    `connect-src http: https:${dev ? ' ws://localhost:5173' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    // frame-ancestors は meta 経由では無視される（ブラウザが console にエラーを出す）。
    // 埋め込み防止が要るときはホスティング側のヘッダで入れる
  ].join('; ')
}

const CSP_PLACEHOLDER = '<!--CSP-->'

function cspMeta(): Plugin {
  return {
    name: 'delist-csp-meta',
    transformIndexHtml(html, ctx) {
      // 置き場所は index.html 側の目印で決める（CSP は自分より後ろの読み込みにしか効かないので、
      // script/link より前＝head の先頭近くに置く必要がある）
      const tag = isTauri
        ? ''
        : `<meta http-equiv="Content-Security-Policy" content="${cspContent(!!ctx.server)}" />`
      return html.replace(CSP_PLACEHOLDER, tag)
    },
  }
}

export default defineConfig({
  plugins: [react(), cspMeta()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    open: !isTauri,
    strictPort: isTauri,
    // src-tauri/target への書き込み(cargo)とファイル監視が競合しロックエラーになるため除外
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
