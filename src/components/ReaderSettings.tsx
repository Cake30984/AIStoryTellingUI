import { useState } from 'react'
import { useStore } from '../store'
import MenuPopover from './MenuPopover'
import NumberInput from './NumberInput'
import { DEFAULT_UI, UI_LIMITS } from '../types'

/**
 * ラベル＋数値入力（上段）＋スライダー（下段）の共通行。数値入力・スライダーどちらでも変更できる（F2）。
 * 数値入力は共通部品 `NumberInput`（フォーカス中は文字列保持・blur/Enter で確定＋クランプ）を使う（FB8-A #13）。
 */
function RsField({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  /** 数値の後ろに添える単位表示（例: '%'。FB8-E4） */
  unit?: string
  onChange: (v: number) => void
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n))

  return (
    <div className="rs-field">
      <div className="rs-field-top">
        <span className="rs-label">{label}</span>
        <NumberInput
          className="rs-num"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={onChange}
          aria-label={label}
        />
        {unit && <span className="rs-unit">{unit}</span>}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        aria-label={label}
      />
    </div>
  )
}

/** topbar の Aa ボタン→ポップオーバー。文字サイズ・行間・本文幅・セリフ色分け・環境音・没入モード（UI-4・F2で数値化） */
export default function ReaderSettings() {
  const { ui, setUiPrefs } = useStore()
  const [open, setOpen] = useState(false)

  const resetReader = () =>
    setUiPrefs({
      fontSize: DEFAULT_UI.fontSize,
      lineHeight: DEFAULT_UI.lineHeight,
      contentWidth: DEFAULT_UI.contentWidth,
      speakerIconSize: DEFAULT_UI.speakerIconSize,
      dialogueTint: DEFAULT_UI.dialogueTint,
      ambientEnabled: DEFAULT_UI.ambientEnabled,
      ambientVolume: DEFAULT_UI.ambientVolume,
    })

  return (
    <div className="menu-anchor">
      <button
        className="icon-btn"
        onClick={() => setOpen((v) => !v)}
        title="表示設定（文字サイズ・行間・話者アイコン・環境音・没入モード）"
      >
        Aa
      </button>
      {open && (
        <MenuPopover onClose={() => setOpen(false)}>
          <div className="reader-settings">
            <RsField
              label="文字サイズ"
              value={ui.fontSize}
              {...UI_LIMITS.fontSize}
              onChange={(fontSize) => setUiPrefs({ fontSize })}
            />
            <RsField
              label="行間"
              value={ui.lineHeight}
              {...UI_LIMITS.lineHeight}
              onChange={(lineHeight) => setUiPrefs({ lineHeight })}
            />
            <RsField
              label="本文幅"
              value={ui.contentWidth}
              {...UI_LIMITS.contentWidth}
              onChange={(contentWidth) => setUiPrefs({ contentWidth })}
            />
            {/* 文字サイズを上げるとアイコンだけ相対的に小さく見えるので、同じ場所で揃えられるようにする */}
            <RsField
              label="話者アイコン"
              value={ui.speakerIconSize}
              {...UI_LIMITS.speakerIconSize}
              onChange={(speakerIconSize) => setUiPrefs({ speakerIconSize })}
            />
            <label className="chk rs-chk">
              <input
                type="checkbox"
                checked={ui.dialogueTint}
                onChange={(e) => setUiPrefs({ dialogueTint: e.target.checked })}
              />
              セリフを色分け
            </label>

            <div className="menu-sep" />

            {/* 環境音ピン（AM1）。ピン自体は本文のデータなので、ここで切れるのは鳴らすかどうかだけ */}
            <label className="chk rs-chk">
              <input
                type="checkbox"
                checked={ui.ambientEnabled}
                onChange={(e) => setUiPrefs({ ambientEnabled: e.target.checked })}
              />
              環境音を鳴らす
            </label>
            <RsField
              label="環境音の音量"
              value={Math.round(ui.ambientVolume * 100)}
              min={Math.round(UI_LIMITS.ambientVolume.min * 100)}
              max={Math.round(UI_LIMITS.ambientVolume.max * 100)}
              step={5}
              unit="%"
              onChange={(v) => setUiPrefs({ ambientVolume: v / 100 })}
            />

            <div className="menu-sep" />

            <label className="chk rs-chk">
              <input
                type="checkbox"
                checked={ui.immersive}
                onChange={(e) => {
                  // 没入 ON でバー・ポップオーバーが消えて戸惑わないよう、閉じる（案内トーストは store が出す。F2/A8）
                  if (e.target.checked) setOpen(false)
                  setUiPrefs({ immersive: e.target.checked })
                }}
              />
              没入モード（上端ホバーでバー / Esc解除）
            </label>

            <button className="link rs-reset" onClick={resetReader}>
              表示を既定に戻す
            </button>
          </div>
        </MenuPopover>
      )}
    </div>
  )
}
