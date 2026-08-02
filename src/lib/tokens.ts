import type { Session } from '../types'

/**
 * 簡易トークン推定（日本語/英語混在向けのヒューリスティック）。
 * 正確なトークナイザではないが、シーンの締め時の目安には十分。
 * - CJK 文字: 約 1 トークン/文字
 * - その他（英数・記号・空白）: 約 1 トークン/4 文字
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (const ch of text) {
    if (/[぀-ヿ㐀-鿿豈-﫿ｦ-ﾟ]/.test(ch)) cjk++
    else other++
  }
  return Math.round(cjk + other / 4)
}

/**
 * シーンのペース制御閾値（推定トークン。FB5-①）。目標は1シーン＝4〜5千トークンで一区切り。
 * 超過すると buildMessages が本編の末尾（深さ0）に収束/締めのナッジを注入し、
 * ChatPanel はバッジ「締め時」とシーン終了の提案チップを出す（自動でレビューは開かない）。
 */
export const SCENE_WIND_DOWN_TOKENS = 3000
export const SCENE_WRAP_UP_TOKENS = 4500

/** 現在シーンの推定トークン量（バッジ表示とペース制御ナッジの共通判定） */
export function sceneTokensOf(session: Session): number {
  const sceneId = session.currentSceneId ?? session.scenes[session.scenes.length - 1]?.id
  if (!sceneId) return 0
  return estimateTokens(
    session.messages
      .filter((m) => m.sceneId === sceneId)
      .map((m) => m.content)
      .join('\n'),
  )
}

/** 締め時の目安（おおよその往復コスト感に対応） */
export type TokenLevel = 'low' | 'mid' | 'high'
export function tokenLevel(tokens: number): TokenLevel {
  if (tokens < SCENE_WIND_DOWN_TOKENS) return 'low'
  if (tokens < SCENE_WRAP_UP_TOKENS) return 'mid'
  return 'high'
}
