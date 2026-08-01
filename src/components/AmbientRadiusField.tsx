import { AMBIENT_RADIUS_CHOICES, AMBIENT_RADIUS_LIMITS } from '../lib/ambient'

interface Props {
  value: number
  onChange: (v: number) => void
}

/**
 * 到達半径の入力（AM2追補）。**3段階のボタン＋スライダー**の二段構え。
 * 多くの場合は3択で足り、詰めたい人だけスライダーを触ればよい（`ReaderSettings` の
 * `RsField` が数値入力とスライダーを併記しているのと同じ考え方）。
 *
 * 単位は「チャット表示領域の高さの何倍か」。px 固定にするとウィンドウサイズや文字サイズで
 * 体感の届く範囲が変わってしまうため、画面の高さを基準にしている。
 * 表示は「画面◯個分」＝内部値をそのまま出すと 1.0 が何を意味するか伝わらないので。
 */
export default function AmbientRadiusField({ value, onChange }: Props) {
  return (
    <>
      <div className="ap-radius">
        {AMBIENT_RADIUS_CHOICES.map((r) => (
          <button
            key={r.value}
            className={'scene-btn' + (Math.abs(value - r.value) < 0.001 ? ' on' : '')}
            onClick={() => onChange(r.value)}
          >
            {r.label}
          </button>
        ))}
      </div>
      <input
        type="range"
        className="ap-radius-range"
        min={AMBIENT_RADIUS_LIMITS.min}
        max={AMBIENT_RADIUS_LIMITS.max}
        step={AMBIENT_RADIUS_LIMITS.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="到達半径"
      />
      <div className="ap-hint">画面 {value.toFixed(1)} 個分の距離まで届く</div>
    </>
  )
}
