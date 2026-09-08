import type { ExportBundle } from '../types'
import { saveBlob } from './platform'

/** バンドルをファイルとしてダウンロードさせる */
export async function downloadBundle(bundle: ExportBundle): Promise<void> {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
  const stamp = new Date().toISOString().slice(0, 10)
  await saveBlob(blob, `storytelling-backup-${stamp}.json`)
}

/** 任意の blob をファイルとしてダウンロードさせる */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  await saveBlob(blob, filename)
}

/**
 * JSON 文字列を検証してバンドルとして解釈（R2）。
 * **ホワイトリスト再構築をしない。** 既知キーは型を検証して整えるが、未知のトップレベルキーは
 * そのまま持ち回る（新しいバージョンで足された項目を古い本体が黙って捨てるのを防ぐ）。
 */
export function parseBundle(text: string): ExportBundle {
  const obj = JSON.parse(text)
  if (obj?.type !== 'ai-storytelling-studio') {
    throw new Error('対応していないファイル形式です。')
  }
  return {
    ...obj,
    type: 'ai-storytelling-studio',
    version: obj.version ?? 1,
    exportedAt: obj.exportedAt ?? Date.now(),
    characters: Array.isArray(obj.characters) ? obj.characters : [],
    worlds: Array.isArray(obj.worlds) ? obj.worlds : [],
    sessions: Array.isArray(obj.sessions) ? obj.sessions : [],
    cassettes: Array.isArray(obj.cassettes) ? obj.cassettes : undefined,
    // 旧実装のホワイトリストから漏れており、インポートで黙って消えていた（未知キー保存へ変えた副産物。R2）
    sessionImageLogs:
      obj.sessionImageLogs && typeof obj.sessionImageLogs === 'object' ? obj.sessionImageLogs : undefined,
    providers: Array.isArray(obj.providers) ? obj.providers : undefined,
    images: Array.isArray(obj.images) ? obj.images : undefined,
  }
}
