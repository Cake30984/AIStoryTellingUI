import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
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

/**
 * PWA の Service Worker（`public/sw.js`）にビルド成果物の一覧とビルド ID を差し込む（P5）。
 * `public/` の中身はバンドラを通らないので、**出力後の `dist/sw.js` を書き換える**。
 * 先に一覧を持たせておかないと、初回訪問（SW が効く前に読み込みが終わる）のあとオフラインにすると
 * JS/CSS だけ取れずに白画面になる。Tauri 版は SW を登録しないので、そのビルドでは触らない。
 */
function swAssets(): Plugin {
  let assets: string[] = []
  let outDir = 'dist'
  return {
    name: 'delusia-sw-assets',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    generateBundle(_options, bundle) {
      assets = Object.keys(bundle)
        .filter((name) => name !== 'index.html')
        .map((name) => `./${name}`)
    },
    // public/ のコピーもバンドルの書き出しも終わったあとに差し替える
    closeBundle() {
      const swPath = new URL(`./${outDir}/sw.js`, import.meta.url)
      if (isTauri) {
        // Tauri 版は SW を登録しない。差し替え前の（プレースホルダが残った）ファイルを
        // 同梱しても意味が無く、中身は JS として壊れているので落とす
        rmSync(swPath, { force: true })
        return
      }
      let code: string
      try {
        code = readFileSync(swPath, 'utf-8')
      } catch {
        return // sw.js を置かない構成なら何もしない
      }
      const buildId = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 12)
      writeFileSync(
        swPath,
        code.replace('__BUILD_ID__', buildId).replace('__ASSETS__', JSON.stringify(assets)),
      )
    },
  }
}

const CSP_PLACEHOLDER = '<!--CSP-->'

function cspMeta(): Plugin {
  return {
    name: 'delusia-csp-meta',
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
  /**
   * Web 版は**相対パス**で出す（P5）。静的ホスティングの置き場所（GitHub Pages のリポジトリ名の下・
   * 自サイトの `/delusia/`・ドメイン直下）がどれでも、ビルドし直さずそのまま動く。ルーティングを
   * 持たない1ページのアプリなので、これで困る場面が無い（index.html・manifest・SW も相対で書く）。
   * Tauri 版は `tauri.localhost` の直下に置かれるので既定のまま（実機検証の条件を変えない）。
   */
  base: isTauri ? '/' : './',
  plugins: [react(), cspMeta(), swAssets()],
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
