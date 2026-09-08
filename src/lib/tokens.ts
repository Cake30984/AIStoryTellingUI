/**
 * 長さの単位は用途で固定する（F5・`docs/設計_物語の簡素化.md` §2.8）。
 *
 * | 用途 | 単位 |
 * |---|---|
 * | **ユーザーに見せる長さ**（シーンの分量・収束/締めナッジの閾値） | **文字数** |
 * | **コストと文脈窓の管理**（原文窓の予算・橋の量・実測記録） | **トークン** |
 *
 * **選択制にはしない。** 「800字くらい」は直感的だが日本語のトークン係数は誰にも読めず、
 * 逆に窓とコストを文字数で管理すると計算が合わない。ユーザーに選ぶ基準がない設定は増やさない。
 */

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
 * 本文の文字数（コードポイント数・空白は数えない。F5）。
 * **ユーザーに見せる長さはこれで数える。** 何を「本文」とみなすか（進行マーカーと
 * 書き手への指示を除く）を決めるのは `prompts.ts` の `sceneCharsOf`＝
 * メッセージの意味を知っているのはあちらなので、ここは純粋な数え役に徹する。
 */
export function countChars(text: string): number {
  return text ? [...text.replace(/\s+/g, '')].length : 0
}

/**
 * シーンのペース制御閾値（**本文の文字数**。FB5-①／F5 で単位をトークンから文字へ）。
 * 目標は1シーン＝3〜5千字で一区切り。日本語の本文では推定トークン数とほぼ同値なので、
 * 単位を替えても発火点はほとんど動かない＝**変えたのは「何を見せ、何で測るか」であって挙動ではない**。
 * 超過すると buildMessages が本編の末尾（深さ0）に収束/締めのナッジを注入し、
 * ChatPanel はバッジ「締め時」とシーン終了の提案チップを出す（自動でレビューは開かない）。
 */
export const SCENE_WIND_DOWN_CHARS = 3000
export const SCENE_WRAP_UP_CHARS = 4500

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

/** 締め時の目安（**本文の文字数**で判定する。F5） */
export type LengthLevel = 'low' | 'mid' | 'high'
export function lengthLevel(chars: number): LengthLevel {
  if (chars < SCENE_WIND_DOWN_CHARS) return 'low'
  if (chars < SCENE_WRAP_UP_CHARS) return 'mid'
  return 'high'
}
