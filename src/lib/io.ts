import type { ExportBundle } from '../types'

/** バンドルをファイルとしてダウンロードさせる */
export function downloadBundle(bundle: ExportBundle): void {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 10)
  a.href = url
  a.download = `storytelling-backup-${stamp}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/** 任意の blob をファイルとしてダウンロードさせる */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** JSON 文字列を検証してバンドルとして解釈 */
export function parseBundle(text: string): ExportBundle {
  const obj = JSON.parse(text)
  if (obj?.type !== 'ai-storytelling-studio') {
    throw new Error('対応していないファイル形式です。')
  }
  return {
    type: 'ai-storytelling-studio',
    version: obj.version ?? 1,
    exportedAt: obj.exportedAt ?? Date.now(),
    characters: Array.isArray(obj.characters) ? obj.characters : [],
    worlds: Array.isArray(obj.worlds) ? obj.worlds : [],
    personas: Array.isArray(obj.personas) ? obj.personas : [],
    sessions: Array.isArray(obj.sessions) ? obj.sessions : [],
    sceneTypes: Array.isArray(obj.sceneTypes) ? obj.sceneTypes : undefined,
    providers: Array.isArray(obj.providers) ? obj.providers : undefined,
  }
}
