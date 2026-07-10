import { useState } from 'react'
import { useStore } from '../store'
import MenuPopover from './MenuPopover'
import type { Session, UiPrefs } from '../types'

const FONT_SCALES: { id: UiPrefs['fontScale']; label: string }[] = [
  { id: 's', label: 'S' },
  { id: 'm', label: 'M' },
  { id: 'l', label: 'L' },
  { id: 'xl', label: 'XL' },
]
const LINE_HEIGHTS: { id: UiPrefs['lineHeight']; label: string }[] = [
  { id: 'compact', label: '狭' },
  { id: 'normal', label: '標準' },
  { id: 'wide', label: '広' },
]
const CONTENT_WIDTHS: { id: UiPrefs['contentWidth']; label: string }[] = [
  { id: 'narrow', label: '狭' },
  { id: 'normal', label: '標準' },
  { id: 'wide', label: '広' },
]

interface Props {
  session: Session
}

/** topbar の Aa ボタン→ポップオーバー。文字サイズ・行間・本文幅・セリフ色分け・ステージ濃度・没入モード（UI-4） */
export default function ReaderSettings({ session }: Props) {
  const { ui, setUiPrefs, updateSession } = useStore()
  const [open, setOpen] = useState(false)
  const stageOn = session.spritesEnabled ?? true

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
            <div className="rs-row">
              <span className="rs-label">文字サイズ</span>
              <div className="seg">
                {FONT_SCALES.map((o) => (
                  <button
                    key={o.id}
                    className={ui.fontScale === o.id ? 'on' : ''}
                    onClick={() => setUiPrefs({ fontScale: o.id })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="rs-row">
              <span className="rs-label">行間</span>
              <div className="seg">
                {LINE_HEIGHTS.map((o) => (
                  <button
                    key={o.id}
                    className={ui.lineHeight === o.id ? 'on' : ''}
                    onClick={() => setUiPrefs({ lineHeight: o.id })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="rs-row">
              <span className="rs-label">本文幅</span>
              <div className="seg">
                {CONTENT_WIDTHS.map((o) => (
                  <button
                    key={o.id}
                    className={ui.contentWidth === o.id ? 'on' : ''}
                    onClick={() => setUiPrefs({ contentWidth: o.id })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
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
            <div className="rs-row">
              <span className="rs-label">背景の濃さ</span>
              <div className="range-row">
                <input
                  type="range"
                  min={0}
                  max={0.6}
                  step={0.05}
                  value={ui.stageBgOpacity}
                  onChange={(e) => setUiPrefs({ stageBgOpacity: Number(e.target.value) })}
                />
                <span className="val">{ui.stageBgOpacity.toFixed(2)}</span>
              </div>
            </div>
            <div className="rs-row">
              <span className="rs-label">立ち絵の濃さ</span>
              <div className="range-row">
                <input
                  type="range"
                  min={0}
                  max={0.9}
                  step={0.05}
                  value={ui.stageSpriteOpacity}
                  onChange={(e) => setUiPrefs({ stageSpriteOpacity: Number(e.target.value) })}
                />
                <span className="val">{ui.stageSpriteOpacity.toFixed(2)}</span>
              </div>
            </div>

            <div className="menu-sep" />

            <label className="chk rs-chk">
              <input
                type="checkbox"
                checked={ui.immersive}
                onChange={(e) => setUiPrefs({ immersive: e.target.checked })}
              />
              没入モード（Ctrl+.）
            </label>
          </div>
        </MenuPopover>
      )}
    </div>
  )
}
