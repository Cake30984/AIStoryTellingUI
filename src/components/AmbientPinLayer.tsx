import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import MenuPopover from './MenuPopover'
import { Icon } from './icons'
import { AMBIENT_DEFAULT_RADIUS, AMBIENT_RADIUS_CHOICES, PIN_MARK_ATTR } from '../lib/ambient'
import { ambientSoundLabel } from '../lib/ambientSounds'
import type { AmbientPin } from '../types'

/** ドラッグ中に「今どの行へ落ちるか」を親（ChatPanel）へ伝えるための状態 */
export interface AmbientDrag {
  pinId: string
  /** いまカーソルが乗っているメッセージ（ここの行アンカーだけを描画してもらう） */
  overMessageId: string | null
}

interface Props {
  sessionId: string
  /** シーン内の全ピン（sceneId 付き＝更新・削除に必要） */
  pins: { pin: AmbientPin; sceneId: string }[]
  /** ドラッグ状態。ChatPanel が受けて対象メッセージに行アンカーを描く */
  drag: AmbientDrag | null
  onDragChange: (d: AmbientDrag | null) => void
}

/** ドラッグ開始とみなす移動量（これ未満はクリック＝メニューを開く） */
const DRAG_THRESHOLD_PX = 4

/**
 * 本文の右側に出す環境音のスピーカー（AM2）。
 *
 * 本文フローに差し込んであるのは幅0・高さ0のアンカー（`[data-pin-id]`）だけで、見えるボタンは
 * この層に絶対配置する。**横位置は本文カラムの右端・縦位置はアンカーの実測位置**という
 * 組み合わせが CSS だけでは表現できない（containing block を混ぜられない）ため、
 * 縦位置だけを JS で入れる。スクロールしても層ごと動くので、再計算はレイアウトが
 * 変わった時だけでよい（スクロール中の毎フレーム計算は不要）。
 *
 * 上下ドラッグでピンの位置（`messageId`/`lineIndex`）を変更でき、クリックで設定メニューを開く。
 */
export default function AmbientPinLayer({ sessionId, pins, drag, onDragChange }: Props) {
  const { updateAmbientPin, removeAmbientPin } = useStore()
  const layerRef = useRef<HTMLDivElement>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [dropTop, setDropTop] = useState<number | null>(null)
  // 文字サイズ・行間・本文幅が変わると行の位置が動くので、再レンダリング（→再レイアウト）のために購読する
  useStore((s) => s.ui)

  /** 各ボタンをアンカーの位置へ合わせる。アンカーが無いピン（畳まれた過去シーン等）は隠す */
  const layout = () => {
    const layer = layerRef.current
    if (!layer) return
    const base = layer.getBoundingClientRect().top
    for (const { pin } of pins) {
      const wrap = layer.querySelector<HTMLElement>(`[data-pin-btn="${pin.id}"]`)
      if (!wrap) continue
      const anchor = document.querySelector(`[${PIN_MARK_ATTR}="${pin.id}"]`)
      if (!anchor) {
        wrap.style.display = 'none'
        continue
      }
      wrap.style.display = ''
      // アンカーは行頭にあるので、行の高さぶん下げて行の中心あたりに置く
      wrap.style.top = `${anchor.getBoundingClientRect().top - base + 2}px`
    }
  }

  // 本文・表示設定・ピンの変化でレイアウトし直す。
  // **同期の1回だけでは足りない**のが要点: 文字サイズ・行間・本文幅は App.tsx の useEffect が
  // CSS 変数へ書くので、子の useLayoutEffect の後に効く。同期分だけだと古い行の高さで測ってしまい、
  // 表示設定を変えた直後にスピーカーが本文と最大100px以上ずれる（下の行ほど大きくずれる）。
  // タイマー（現在のタスクの後＝CSS 変数反映後）と rAF（描画前）の両方で測り直して収束させる。
  useLayoutEffect(() => {
    layout()
    const t = window.setTimeout(layout, 0)
    const raf = requestAnimationFrame(layout)
    return () => {
      window.clearTimeout(t)
      cancelAnimationFrame(raf)
    }
  })

  // 要素サイズの変化も監視する（挿絵の遅延読み込み・シーンの展開/折りたたみ・ウィンドウ幅の変更）
  useEffect(() => {
    const parent = layerRef.current?.parentElement
    if (!parent || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => layout())
    ro.observe(parent)
    return () => ro.disconnect()
    // ピンが 0 件の間は層自体を描かない＝親が取れないので、増えた時に張り直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins.length > 0])

  /** ポインタ位置から「落ちる先」を決める。行アンカーがあればその行、無ければメッセージ先頭 */
  const dropTargetAt = (clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY)
    const msgEl = el?.closest<HTMLElement>('[data-msg-id]')
    if (!msgEl) return null
    const messageId = msgEl.dataset.msgId!
    const anchors = [...msgEl.querySelectorAll<HTMLElement>('[data-line-anchor]')]
    if (anchors.length === 0) return { messageId, lineIndex: 0, top: msgEl.getBoundingClientRect().top }
    let best = anchors[0]
    let bestDist = Infinity
    for (const a of anchors) {
      const d = Math.abs(a.getBoundingClientRect().top - clientY)
      if (d < bestDist) {
        bestDist = d
        best = a
      }
    }
    return {
      messageId,
      lineIndex: Number(best.dataset.lineAnchor),
      top: best.getBoundingClientRect().top,
    }
  }

  const startDrag = (e: React.PointerEvent, pin: AmbientPin, sceneId: string) => {
    if (e.button !== 0) return
    const startY = e.clientY
    const btn = e.currentTarget as HTMLElement
    let moved = false
    // 捕捉に失敗してもドラッグ自体は成立させる（失敗で以降の登録が飛ぶと、
    // クリックでメニューすら開かなくなる）
    try {
      btn.setPointerCapture(e.pointerId)
    } catch {
      /* 捕捉できない環境・ポインタでも続行 */
    }

    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD_PX) return
      if (!moved) {
        moved = true
        btn.classList.add('dragging')
      }
      const target = dropTargetAt(ev.clientX, ev.clientY)
      onDragChange({ pinId: pin.id, overMessageId: target?.messageId ?? null })
      const base = layerRef.current?.getBoundingClientRect().top ?? 0
      setDropTop(target ? target.top - base : null)
    }

    const onUp = (ev: PointerEvent) => {
      try {
        btn.releasePointerCapture(ev.pointerId)
      } catch {
        /* 捕捉していなければ何もしない */
      }
      btn.removeEventListener('pointermove', onMove)
      btn.removeEventListener('pointerup', onUp)
      btn.classList.remove('dragging')
      setDropTop(null)
      if (moved) {
        const target = dropTargetAt(ev.clientX, ev.clientY)
        if (target && (target.messageId !== pin.messageId || target.lineIndex !== pin.lineIndex)) {
          updateAmbientPin(sessionId, sceneId, pin.id, {
            messageId: target.messageId,
            lineIndex: target.lineIndex,
          })
        }
      } else {
        setMenuFor((v) => (v === pin.id ? null : pin.id))
      }
      onDragChange(null)
    }

    btn.addEventListener('pointermove', onMove)
    btn.addEventListener('pointerup', onUp)
  }

  if (pins.length === 0) return null

  return (
    <div className="ambient-layer" ref={layerRef}>
      {drag && dropTop !== null && <div className="ambient-drop-line" style={{ top: dropTop }} />}
      {pins.map(({ pin, sceneId }) => (
        <div className="ambient-pin-wrap menu-anchor" data-pin-btn={pin.id} key={pin.id}>
          <button
            className="ambient-pin"
            onPointerDown={(e) => startDrag(e, pin, sceneId)}
            title={`環境音: ${ambientSoundLabel(pin.soundId)}（ドラッグで移動・クリックで設定）`}
            aria-label={`環境音 ${ambientSoundLabel(pin.soundId)}`}
          >
            <Icon name="volume-2" size={12} />
          </button>
          {menuFor === pin.id && (
            <MenuPopover onClose={() => setMenuFor(null)}>
              <div className="ambient-menu">
                <div className="ambient-menu-title">
                  <Icon name="volume-2" size={14} />
                  {ambientSoundLabel(pin.soundId)}
                </div>
                <div className="ambient-menu-row">
                  <span className="rs-label">
                    音量の上限 {Math.round((pin.maxGain ?? 1) * 100)}%
                  </span>
                  <input
                    type="range"
                    min={5}
                    max={100}
                    step={5}
                    value={Math.round((pin.maxGain ?? 1) * 100)}
                    onChange={(e) =>
                      updateAmbientPin(sessionId, sceneId, pin.id, {
                        maxGain: Number(e.target.value) / 100,
                      })
                    }
                    aria-label="音量の上限"
                  />
                </div>
                <div className="ambient-menu-row">
                  <span className="rs-label">どこまで届くか</span>
                  <div className="ap-radius">
                    {AMBIENT_RADIUS_CHOICES.map((r) => (
                      <button
                        key={r.value}
                        className={
                          'scene-btn' +
                          ((pin.radius ?? AMBIENT_DEFAULT_RADIUS) === r.value ? ' on' : '')
                        }
                        onClick={() => updateAmbientPin(sessionId, sceneId, pin.id, { radius: r.value })}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ambient-hint">上下にドラッグすると位置を動かせます</div>
                <div className="menu-sep" />
                <button
                  className="menu-item danger"
                  onClick={() => {
                    setMenuFor(null)
                    removeAmbientPin(sessionId, sceneId, pin.id)
                  }}
                >
                  <Icon name="trash-2" size={15} /> この環境音を削除
                </button>
              </div>
            </MenuPopover>
          )}
        </div>
      ))}
    </div>
  )
}
