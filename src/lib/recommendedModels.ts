import type { OpenRouterModel } from '../types'

/**
 * 初回ウィザードで示す OpenRouter の推奨モデル（P7 段階 A-1）。
 *
 * 2026-09-20 に 7 モデル × 5 場面のブラインドテスト（`docs/決定記録.md` §10）で確定した 4 件。
 * README の「推奨モデル」表もこの定数から書く（二重管理しない）。
 *
 * - **価格はここに持たない。** 表示のたびに `/api/v1/models` から取り直す（`joinWithLiveModels`）
 * - **一覧に無くなった id は表示しない**（廃止・改名で消えたモデルを勧めない）
 * - 版は固定する。`~x-ai/grok-latest` のような「常に最新」別名は使わない（Grok 4.5 → 4.6 で
 *   表現の制限が大きく変わった実例がある。新版で挙動が変わると説明文が嘘になる）
 * - 並びは価格順（確定時点）。初期選択は表示できる先頭
 * - 接続テストに失敗しても自動で別のモデルへは切り替えない
 *   （利用者が別の推奨モデルを選び直す。勝手に変わると拒否や文体の変化の理由を追えない）
 */
export interface RecommendedModel {
  id: string
  name: string
  desc: string
}

export const RECOMMENDED_MODELS: readonly RecommendedModel[] = [
  {
    id: 'deepseek/deepseek-v4-flash-0731',
    name: 'DeepSeek V4 Flash',
    desc: '最も安く、表現の制限も緩い。迷ったらこれ',
  },
  {
    id: 'deepseek/deepseek-v4-pro-0813',
    name: 'DeepSeek V4 Pro',
    desc: 'Flash の上位版。価格は上がるが品質も少し良くなる',
  },
  {
    id: 'openai/gpt-5.6-terra',
    name: 'GPT-5.6 Terra',
    desc: '高品質で高価。普通の表現の範囲なら制限はほとんどない',
  },
  {
    id: 'anthropic/claude-sonnet-5',
    name: 'Claude Sonnet 5',
    desc: 'Terra と同じ位置づけ。どちらかといえば Terra のほうがおすすめ',
  },
]

export function isRecommendedModel(id: string): boolean {
  return RECOMMENDED_MODELS.some((m) => m.id === id)
}

/** 推奨モデルに、いま `/models` が返した価格を付けたもの */
export interface LiveRecommendedModel extends RecommendedModel {
  /** 100 万トークンあたりの価格（$）。API が返さなければ `null` */
  promptPerMillion: number | null
  completionPerMillion: number | null
}

/**
 * 推奨リストを `/models` の結果と突き合わせる。**一覧に無い id は落とす**（順序は推奨リストのまま）。
 * 価格は OpenRouter の値（$/トークンの文字列）を 100 万トークンあたりに直す。
 */
export function joinWithLiveModels(models: readonly Pick<OpenRouterModel, 'id' | 'pricing'>[]): LiveRecommendedModel[] {
  const byId = new Map(models.map((m) => [m.id, m] as const))
  const out: LiveRecommendedModel[] = []
  for (const r of RECOMMENDED_MODELS) {
    const live = byId.get(r.id)
    if (!live) continue
    out.push({
      ...r,
      promptPerMillion: perMillion(live.pricing?.prompt),
      completionPerMillion: perMillion(live.pricing?.completion),
    })
  }
  return out
}

function perMillion(perToken: string | undefined): number | null {
  if (perToken == null || perToken === '') return null
  const n = Number(perToken)
  if (!Number.isFinite(n) || n < 0) return null
  return n * 1_000_000
}

/** `$0.04` / `$1.73` / `$12` のように、桁に応じて小数を切り詰めて表示する（100 万トークンあたり） */
export function formatPerMillion(v: number | null): string {
  if (v == null) return '—'
  if (v === 0) return '$0'
  const digits = v >= 10 ? 0 : v >= 1 ? 2 : 3
  const fixed = v.toFixed(digits)
  // 末尾のゼロを落とすのは小数部だけ（`10` の 0 を消して `1` にしない）
  return '$' + (fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed)
}
