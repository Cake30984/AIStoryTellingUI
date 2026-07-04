import { useEffect, useState } from 'react'
import type { EmotionId } from '../types'

/** バックグラウンド画像生成ジョブの対象（保存先）。Blob を含むため store 側でも localStorage には入れない */
export type ImageJobTarget =
  | { type: 'scene-illustration'; sessionId: string; sceneId: string; messageId?: string }
  | { type: 'character-avatar'; characterId: string }
  | { type: 'persona-avatar'; personaId: string }
  | { type: 'character-sprite'; characterId: string; emotion: EmotionId }
  | { type: 'scene-background'; sessionId: string; sceneId: string }

export interface ImageJob {
  id: string
  /** 通知・一覧表示用ラベル（例: '挿絵: 放課後の屋上', 'アバター: 綾瀬'） */
  label: string
  target: ImageJobTarget
  providerId: string
  prompt: string
  negative?: string
  width: number
  height: number
  /** 生成枚数（1〜4） */
  count: number
  status: 'running' | 'selecting' | 'error' | 'canceled'
  /** 完了した分から順次 push される */
  results: Blob[]
  error?: string
  createdAt: number
}

// AbortController は store（永続化対象）に入れず、ここのモジュールレベルで保持する
const abortControllers = new Map<string, AbortController>()

export function registerJobAbort(jobId: string, ctrl: AbortController) {
  abortControllers.set(jobId, ctrl)
}

export function clearJobAbort(jobId: string) {
  abortControllers.delete(jobId)
}

export function abortJobController(jobId: string) {
  abortControllers.get(jobId)?.abort()
}

/** Blob から表示用 objectURL を作り、アンマウント/差し替え時に revoke する */
export function useBlobUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!blob) {
      setUrl(undefined)
      return
    }
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}
