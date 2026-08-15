/// <reference types="vite/client" />
// `import.meta.glob`（環境音カタログのアセット解決・AM1）と `?url` インポートの型。

/** package.json の version（vite.config.ts の define で注入）。参照は src/lib/version.ts に一本化する */
declare const __APP_VERSION__: string
