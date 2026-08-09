import type { ImageCostSample, ImageProvider, ImageQuality } from '../types'

/**
 * 概算表示専用の為替レート。**厳密な請求額ではない**（表示は必ず「約」を伴う）。
 * 設定項目にはしない（画像生成の設定を増やさない方針。docs/設計_画像生成の簡易化.md §6.2）。
 */
export const USD_JPY = 150

/** 表示の分母。1枚だと桁が小さすぎ、100枚だと総額が大きく見える（同 §6.1） */
export const COST_UNIT = 10

/**
 * Buzz 1 あたりの USD。Civitai の課金単位は Buzz なので、表示前にここで USD へ寄せて
 * 表示経路を1本に保つ。**概算専用**（購入時のレート・パッケージで前後する）。
 */
export const BUZZ_USD = 0.001

/** コスト実測値のキー。同じ条件でだけ「前回の実績」として使い回す */
export function costKeyOf(model: string, quality: ImageQuality | undefined, width: number, height: number): string {
  return `${model}|${quality ?? '-'}|${width}x${height}`
}

/** USD/枚 → 「10枚で約 3.5 円」。小額でも桁が潰れないよう 10 円未満は小数1桁 */
export function formatCostPerUnit(usdPerImage: number): string {
  const yen = usdPerImage * COST_UNIT * USD_JPY
  const shown = yen < 10 ? yen.toFixed(1) : String(Math.round(yen))
  return `${COST_UNIT}枚で約 ${shown} 円`
}

/** 接続先に記録された実測値から、この条件の「前回の実績」を引く */
export function findCostSample(p: ImageProvider, key: string): ImageCostSample | undefined {
  const samples = p.params?.costSamples
  if (!Array.isArray(samples)) return undefined
  return (samples as ImageCostSample[]).find((s) => s && s.key === key)
}

/**
 * 実測が無いときの目安（USD/枚）。docs/設計_画像生成の簡易化.md §4.1 の実測表から。
 * **必ず「目安」と明示して表示すること**（確定値に見せない）。
 */
export const OPENROUTER_COST_HINT_USD: Record<string, Partial<Record<ImageQuality, number>>> = {
  'openai/gpt-5-image-mini': { low: 0.0023, medium: 0.0084, high: 0.033 },
  'google/gemini-2.5-flash-image': { low: 0.039, medium: 0.039, high: 0.039 },
  'black-forest-labs/flux.2-klein-4b': { low: 0.014, medium: 0.014, high: 0.014 },
}

/**
 * 表示用の1行を作る。実測があればそれを「前回の実績」、無ければ目安、どちらも無ければ null。
 * null のときは行ごと出さない（推測で数字を出さない）。
 */
export function costLineOf(
  p: ImageProvider,
  model: string,
  quality: ImageQuality | undefined,
  width: number,
  height: number,
): string | null {
  const sample = findCostSample(p, costKeyOf(model, quality, width, height))
  if (sample) return `${formatCostPerUnit(sample.usd)}（前回の実績）`
  const hint = OPENROUTER_COST_HINT_USD[model]?.[quality ?? 'low']
  if (hint != null) return `${formatCostPerUnit(hint)}（目安）`
  return null
}

/** 実測値を1件だけ差し替えて返す（同一 key は上書き。無制限に溜めない） */
export function withCostSample(p: ImageProvider, key: string, usd: number): ImageProvider {
  const prev = Array.isArray(p.params?.costSamples) ? (p.params!.costSamples as ImageCostSample[]) : []
  const next = [{ key, usd, at: Date.now() }, ...prev.filter((s) => s && s.key !== key)].slice(0, 20)
  return { ...p, params: { ...(p.params ?? {}), costSamples: next } }
}
