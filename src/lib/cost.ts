import type { ImageProvider } from '../types'

/**
 * 生成コストの表示（I1・I5 で単位方針を改訂）。
 *
 * **円に換算しない。各サービスが実際に課金する単位のまま出す。**
 * 換算すると (a) 前払いクレジットは購入時のレート・パッケージで実額が変わり、
 * (b) USD 建ては為替で変わるため、**こちらが示した額とユーザーの実負担がずれる**。
 * ずれはそのままトラブルの原因になる。Buzz は Buzz、USD は USD で見せる。
 * 円の目安が要るのは「買う前」なので、それは説明書側の仕事にする。
 */

/** そのサービスの課金単位での、画像1枚あたりのコスト */
export interface ImageCost {
  unit: 'usd' | 'buzz'
  /** 1枚あたりの量 */
  amount: number
}

/** 同一条件（モデル・品質・サイズ）での直近1回の実測。「前回の実績」としてのみ表示する */
export interface ImageCostSample extends ImageCost {
  /** `${model}|${quality}|${width}x${height}` */
  key: string
  at: number
}

/** USD 表示の分母。1枚だと桁が小さすぎて読めないため（$0.0023 → $0.023/10枚） */
export const USD_UNIT = 10

/** コスト実測値のキー。同じ条件でだけ「前回の実績」として使い回す */
export function costKeyOf(model: string, quality: string | undefined, width: number, height: number): string {
  return `${model}|${quality ?? '-'}|${width}x${height}`
}

function formatUsd(v: number): string {
  if (v < 0.01) return `$${v.toFixed(4)}`
  if (v < 1) return `$${v.toFixed(3)}`
  return `$${v.toFixed(2)}`
}

/**
 * 課金単位のまま1行にする。
 * - `buzz` … `1枚 3 Buzz`（Buzz は整数で桁も手頃なので1枚あたりが読みやすい）
 * - `usd`  … `10枚で $0.023`（1枚あたりだと桁が小さすぎる）
 */
export function formatCost(cost: ImageCost): string {
  if (cost.unit === 'buzz') {
    const n = Number.isInteger(cost.amount) ? String(cost.amount) : cost.amount.toFixed(1)
    return `1枚 ${n} Buzz`
  }
  return `${USD_UNIT}枚で ${formatUsd(cost.amount * USD_UNIT)}`
}

/** 接続先に記録された実測値から、この条件の「前回の実績」を引く */
export function findCostSample(p: ImageProvider, key: string): ImageCostSample | undefined {
  const samples = p.params?.costSamples
  if (!Array.isArray(samples)) return undefined
  return (samples as ImageCostSample[]).find((s) => s && s.key === key)
}

/**
 * 表示用の1行。**実測があるときだけ出す**（無ければ null＝行ごと出さない）。
 * 推測の数字を出さないための設計。目安は説明書側で扱う。
 */
export function costLineOf(
  p: ImageProvider,
  model: string,
  quality: string | undefined,
  width: number,
  height: number,
): string | null {
  const s = findCostSample(p, costKeyOf(model, quality, width, height))
  return s ? `${formatCost(s)}（前回の実績）` : null
}

/** 実測値を1件だけ差し替えて返す（同一 key は上書き。無制限に溜めない） */
export function withCostSample(p: ImageProvider, key: string, cost: ImageCost): ImageProvider {
  const prev = Array.isArray(p.params?.costSamples) ? (p.params!.costSamples as ImageCostSample[]) : []
  const next = [{ key, ...cost, at: Date.now() }, ...prev.filter((s) => s && s.key !== key)].slice(0, 20)
  return { ...p, params: { ...(p.params ?? {}), costSamples: next } }
}
