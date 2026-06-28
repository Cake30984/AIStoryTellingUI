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
    if (/[぀-ヿ㐀-鿿豈-﫿ｦ-ﾟ]/.test(ch)) cjk++
    else other++
  }
  return Math.round(cjk + other / 4)
}

/** 締め時の目安（おおよその往復コスト感に対応） */
export type TokenLevel = 'low' | 'mid' | 'high'
export function tokenLevel(tokens: number): TokenLevel {
  if (tokens < 3000) return 'low'
  if (tokens < 6000) return 'mid'
  return 'high'
}
