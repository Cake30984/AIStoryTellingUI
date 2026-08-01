import { useEffect, useRef } from 'react'
import type { AmbientPin, Message, Scene } from '../types'
import { applyTargets, stopAll } from './ambientAudio'
import { ambientSoundById } from './ambientSounds'

/**
 * 環境音ピンの位置解決と音量計算（AM1）。純関数群＋スクロール追従フック。
 * 設計は `docs/設計_環境音ピン.md` §4。
 */

/** 到達半径の既定値＝チャット表示領域の高さの何倍か */
export const AMBIENT_DEFAULT_RADIUS = 1.0

/** 到達半径の選択肢（数値入力は作らない＝要望書 §3.2「調整子はせいぜい1つ」） */
export const AMBIENT_RADIUS_CHOICES = [
  { value: 0.6, label: '狭い' },
  { value: 1.0, label: 'ふつう' },
  { value: 1.6, label: '広い' },
] as const

/** 同時に鳴らす音の上限。近接ピンが増えても混ざって泥にならないよう上位だけ残す */
export const AMBIENT_MAX_VOICES = 3

/**
 * 距離 → 音量。`t = d/R` の raised cosine で、中心 1・端 0・**両端で傾き 0**。
 * 端の傾きが 0 なのが要点で、ピンの縁を通過する瞬間に音量が跳ねない。
 * 最後の指数は聴感補正（線形だと中間が大きく聞こえる）。
 */
export function ambientGain(distancePx: number, radiusPx: number): number {
  if (!(radiusPx > 0)) return 0
  const t = Math.min(1, Math.abs(distancePx) / radiusPx)
  const w = 0.5 * (1 + Math.cos(Math.PI * t))
  return Math.pow(w, 1.5)
}

/** 本文が短くなって範囲外になった行番号を最終行へ丸める（本文編集・やり直し対策） */
export function clampLineIndex(lineIndex: number, lineCount: number): number {
  if (!Number.isFinite(lineIndex) || lineIndex < 0) return 0
  return Math.min(Math.max(0, Math.floor(lineIndex)), Math.max(0, lineCount - 1))
}

/**
 * ピンのアンカー先メッセージを解決する。指定メッセージが消えていたら**シーン末尾の
 * メッセージ**へ実行時フォールバックする（挿絵の orphan と同じ規約＝永続データは書き換えない）。
 * 解決できなければ undefined（＝描かれず鳴らない）。
 */
export function resolvePinAnchor(pin: AmbientPin, sceneMessages: Message[]): Message | undefined {
  const hit = sceneMessages.find((m) => m.id === pin.messageId)
  if (hit) return hit
  return sceneMessages[sceneMessages.length - 1]
}

/**
 * 「メッセージ id → 行番号 → そこに置くピン」の索引を組む。レンダラはこれを引いて
 * 該当行の直前に不可視マーカーを差し込む。行番号は本文の行数でクランプ済み。
 */
export function pinsByAnchor(
  scenes: Scene[],
  messages: Message[],
): Map<string, Map<number, AmbientPin[]>> {
  const out = new Map<string, Map<number, AmbientPin[]>>()
  const byId = new Map(messages.map((m) => [m.id, m]))
  for (const sc of scenes) {
    const pins = sc.ambientPins ?? []
    if (pins.length === 0) continue
    const sceneMsgs = messages.filter((m) => m.sceneId === sc.id)
    for (const pin of pins) {
      const anchor = byId.get(pin.messageId) ?? resolvePinAnchor(pin, sceneMsgs)
      if (!anchor) continue
      const lines = anchor.content.split('\n').length
      const line = clampLineIndex(pin.lineIndex, lines)
      const perMessage = out.get(anchor.id) ?? new Map<number, AmbientPin[]>()
      perMessage.set(line, [...(perMessage.get(line) ?? []), pin])
      out.set(anchor.id, perMessage)
    }
  }
  return out
}

/** 1つのピンの実測位置（マーカー要素の画面上の Y） */
export interface PinPosition {
  pin: AmbientPin
  y: number
}

/**
 * 実測位置から「いま鳴らしたい音量」の一覧を作る。
 * 同じ soundId は max で1本に畳み、上位 `AMBIENT_MAX_VOICES` 本だけ残す。
 * DOM にマーカーが無いピン（畳まれた過去シーン等）は呼び出し側で除外済みの前提。
 */
export function mergeTargets(
  positions: PinPosition[],
  centerY: number,
  viewportHeight: number,
  maxVoices = AMBIENT_MAX_VOICES,
): { soundId: string; gain: number }[] {
  const bySound = new Map<string, number>()
  for (const { pin, y } of positions) {
    const radiusPx = (pin.radius ?? AMBIENT_DEFAULT_RADIUS) * viewportHeight
    // 距離カーブに、そのピンの音量上限を掛ける（素材ごとの主張の強さを1本ずつ抑えるため）
    const g = ambientGain(y - centerY, radiusPx) * Math.min(1, Math.max(0, pin.maxGain ?? 1))
    if (g <= 0) continue
    bySound.set(pin.soundId, Math.max(bySound.get(pin.soundId) ?? 0, g))
  }
  return [...bySound.entries()]
    .map(([soundId, gain]) => ({ soundId, gain }))
    .sort((a, b) => b.gain - a.gain)
    .slice(0, maxVoices)
}

/** ピンのマーカー要素に付ける属性名（測定と CSS の両方がこれを使う） */
export const PIN_MARK_ATTR = 'data-pin-id'

/** スクロール追従のティック間隔（ms）。rAF 毎に測ると getBoundingClientRect が重い */
const TICK_MS = 80

/**
 * スクロール位置に応じて各ピンの音量を更新し続けるフック。
 *
 * マーカー要素（`[data-pin-id]`）の実測 Y をそのまま使うので、折り返し・画像の遅延読み込み・
 * 文字サイズ変更でレイアウトが動いても追加の補正が要らない。DOM に無いピンは対象外＝
 * 畳まれた過去シーンの音は鳴らない（仕様）。
 */
export function useAmbientScape(
  scrollElRef: React.RefObject<HTMLElement>,
  pins: AmbientPin[],
  enabled: boolean,
): void {
  // ピンの実体は毎ティック DOM から引くので、参照だけ最新に保てばよい
  const pinsRef = useRef(pins)
  pinsRef.current = pins

  useEffect(() => {
    if (!enabled || pins.length === 0) {
      stopAll()
      return
    }
    let timer = 0
    const tick = () => {
      const el = scrollElRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const centerY = rect.top + rect.height / 2
      const positions: PinPosition[] = []
      for (const pin of pinsRef.current) {
        // カタログに無い音（別バージョンで消えた・未同梱）は先に落とす。ここで落とさないと
        // 鳴らないピンが同時発音数の枠を1つ食って、鳴るはずのピンが押し出される
        if (!ambientSoundById(pin.soundId)) continue
        const mark = document.querySelector(`[${PIN_MARK_ATTR}="${pin.id}"]`)
        if (!mark) continue
        positions.push({ pin, y: mark.getBoundingClientRect().top })
      }
      applyTargets(mergeTargets(positions, centerY, rect.height))
    }
    timer = window.setInterval(tick, TICK_MS)
    tick()
    return () => {
      window.clearInterval(timer)
      stopAll()
    }
    // pins は「有無」と「件数」だけが購読対象（中身の変化は pinsRef 経由で毎ティック読む）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pins.length, scrollElRef])
}
