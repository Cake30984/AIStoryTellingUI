import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tauri 起動時（TAURI_ENV_PLATFORM あり）は devUrl とポートがずれると白画面になるため strictPort にする
const isTauri = !!process.env.TAURI_ENV_PLATFORM

export default defineConfig({
  plugins: [react()],
  server: {
    open: !isTauri,
    strictPort: isTauri,
    // src-tauri/target への書き込み(cargo)とファイル監視が競合しロックエラーになるため除外
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
