import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// 本体バージョンは vite.config.ts と同じく package.json を唯一の出所にする（`__APP_VERSION__` を
// 参照する src/lib/version.ts がテストから間接的に読み込まれるため、ここでも定義が要る）
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

// 純関数のテストだけを置く前提なので jsdom は入れない（DOM が要るものはテストしない）
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
})
