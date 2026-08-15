// 本体バージョンと、ドット区切りバージョンの比較（カードの minRuntimeVersion 判定・R2）。

/** 実行中の本体バージョン（package.json 由来。vite.config.ts の define で注入） */
export const APP_VERSION: string = __APP_VERSION__

/** "1.2.3" → [1, 2, 3]。数値でない部分（プレリリース表記等）は 0 として扱う */
function parts(v: string): number[] {
  return v
    .trim()
    .split('.')
    .map((s) => {
      const n = Number.parseInt(s, 10)
      return Number.isFinite(n) ? n : 0
    })
}

/** a < b なら負、a === b なら 0、a > b なら正。桁数が違う場合は短い側を 0 で埋める */
export function compareVersions(a: string, b: string): number {
  const pa = parts(a)
  const pb = parts(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** メジャー番号（"1.0" → 1）。形式の互換性はメジャーだけで判定する */
export function majorOf(v: string): number {
  return parts(v)[0] ?? 0
}
