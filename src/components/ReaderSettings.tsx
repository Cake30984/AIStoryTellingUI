import { useEffect, useState } from 'react'
import { useStore } from '../store'
import MenuPopover from './MenuPopover'
import { DEFAULT_UI, UI_LIMITS, type Session } from '../types'

interface Props {
  session: Session
}

/**
 * ラベル＋数値入力（上段）＋スライダー（下段）の共通行。数値入力・スライダーどちらでも変更できる（F2）。
 * 数値入力はフォーカス中はローカル文字列で保持し blur/Enter で確定＋クランプする（「18」等を途中で丸めず打てる）。
 */
function RsField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  const [text, setText] = useState(String(value))
  const [editing, setEditing] = useState(false)
  // 編集中でなければ外部変更（スライダー・リセット）を数値入力へ反映
  useEffect(() => {
    if (!editing) setText(String(value))
  }, [value, editing])

  const commit = () => {
    const n = Number(text)
    if (Number.isFinite(n)) onChange(clamp(n))
    else setText(String(value))
    setEditing(false)
  }

  return (
    <div className="rs-field">
      <div className="rs-field-top">
        <span className="rs-label">{label}</span>
        <input
          className="rs-num"
          type="number"
          min={min}
          max={max}
          step={step}
          value={text}
          onFocus={() => setEditing(true)}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
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

/** topbar の Aa ボタン→ポップオーバー。文字サイズ・行間・本文幅・セリフ色分け・ステージ濃度・没入モード（UI-4・F2で数値化） */
export default function ReaderSettings({ session }: Props) {
  const { ui, setUiPrefs, updateSession } = useStore()
  const [open, setOpen] = useState(false)
  const stageOn = session.spritesEnabled ?? true

  const resetReader = () =>
    setUiPrefs({
      fontSize: DEFAULT_UI.fontSize,
      lineHeight: DEFAULT_UI.lineHeight,
      contentWidth: DEFAULT_UI.contentWidth,
      dialogueTint: DEFAULT_UI.dialogueTint,
      stageBgOpacity: DEFAULT_UI.stageBgOpacity,
      stageSpriteOpacity: DEFAULT_UI.stageSpriteOpacity,
    })

  return (
    <div className="menu-anchor">
      <button
        className="icon-btn"
        onClick={() => setOpen((v) => !v)}
        title="表示設定（文字サイズ・行間・ステージ・没入モード）"
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
            <label className="chk rs-chk">
              <input
                type="checkbox"
                checked={ui.dialogueTint}
                onChange={(e) => setUiPrefs({ dialogueTint: e.target.checked })}
              />
              セリフを色分け
            </label>

            <div className="menu-sep" />

            <label className="chk rs-chk">
              <input
                type="checkbox"
                checked={stageOn}
                onChange={() => updateSession(session.id, { spritesEnabled: !stageOn })}
              />
              背景・立ち絵を表示
            </label>
            <RsField
              label="背景の濃さ"
              value={ui.stageBgOpacity}
              {...UI_LIMITS.stageBgOpacity}
              onChange={(stageBgOpacity) => setUiPrefs({ stageBgOpacity })}
            />
            <RsField
              label="立ち絵の濃さ"
              value={ui.stageSpriteOpacity}
              {...UI_LIMITS.stageSpriteOpacity}
              onChange={(stageSpriteOpacity) => setUiPrefs({ stageSpriteOpacity })}
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
