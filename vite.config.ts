import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tauri 起動時（TAURI_ENV_PLATFORM あり）は devUrl とポートがずれると白画面になるため strictPort にする
const isTauri = !!process.env.TAURI_ENV_PLATFORM

// 本体バージョン（カードの minRuntimeVersion 判定に使う。R2）。package.json を唯一の出所にして
// ソース側に二重管理しない。src-tauri/tauri.conf.json の version とは手で揃える
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

export default defineConfig({
  plugins: [react()],
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
