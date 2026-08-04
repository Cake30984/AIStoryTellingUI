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

/**
 * 原文（要約ではなく本文そのもの）で送るシーン群のトークン予算（PC3）。
 * 保守的な初期値から始め、実測（PC0 の表）を見て上げる。
 * BYOK なので入力の増分はユーザーの請求に直撃する＝キャッシュヒットは確率的（F5）で
 * 「ミス時の全額」が常時起こりうるため、上位設計の目安（1.5万〜2万）より低く置いている。
 * `docs/詳細設計_プロンプト構造とキャッシュ.md` §7.2
 */
export const RAW_WINDOW_TOKENS = 12000

/**
 * 予算を超えた時に**そこまで落とす**割合（畳み方4原則①のヒステリシス）。
 * 「超えたぶんだけ落とす」と毎シーン1つずつ落ち続ける（＝窓が1シーンずつ滑る）ので、
 * 一度畳むときに 60% までまとめて落として次の数シーンぶんの余地を作る。
 */
export const RAW_WINDOW_KEEP_RATIO = 0.6

/**
 * 窓から落ちたシーン群のうち**最後の1シーン**だけ原文の末尾を残す量（畳み方4原則②「橋を残す」）。
 * あらすじだけでは固有名詞・約束・言い回しが落ちて直前シーンとの接続が切れるため。
 */
export const RAW_WINDOW_BRIDGE_TOKENS = 1000

/** 締め時の目安（おおよその往復コスト感に対応） */
export type TokenLevel = 'low' | 'mid' | 'high'
export function tokenLevel(tokens: number): TokenLevel {
  if (tokens < SCENE_WIND_DOWN_TOKENS) return 'low'
  if (tokens < SCENE_WRAP_UP_TOKENS) return 'mid'
  return 'high'
}
