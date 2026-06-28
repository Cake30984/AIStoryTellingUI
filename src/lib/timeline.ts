import type { Timeline } from '../types'

export function defaultTimeline(): Timeline {
  return {
    enabled: false,
    slots: ['朝', '昼', '夜'],
    totalDays: null,
    spanLabel: '',
    currentDay: 1,
    currentSlot: 0,
  }
}

/** 現在（または任意位置）の時刻ラベルを作る（例: 3日目 夜 / 3日目） */
export function timeLabelOf(tl: Timeline, day = tl.currentDay, slot = tl.currentSlot): string {
  const slotName = tl.slots[slot] ?? ''
  const dayPart = `${day}日目`
  // スロットが「1日」だけのような単一区切りなら日付のみ
  if (tl.slots.length <= 1 || !slotName || slotName === '1日') return dayPart
  return `${dayPart} ${slotName}`
}

/** 1区切り進めた新しいタイムラインを返す */
export function advanceTimeline(tl: Timeline): Timeline {
  const slotCount = Math.max(1, tl.slots.length)
  let slot = tl.currentSlot + 1
  let day = tl.currentDay
  if (slot >= slotCount) {
    slot = 0
    day += 1
  }
  return { ...tl, currentDay: day, currentSlot: slot }
}

/** プロンプト用：現在時刻と残り期間の説明文 */
export function timelinePromptInfo(tl: Timeline): string {
  if (!tl.enabled) return ''
  const parts = [`現在: ${timeLabelOf(tl)}`]
  if (tl.totalDays) {
    const remain = tl.totalDays - tl.currentDay
    parts.push(`全${tl.totalDays}日中（残り約${Math.max(0, remain)}日）`)
  }
  if (tl.spanLabel.trim()) parts.push(`期間: ${tl.spanLabel.trim()}`)
  return parts.join(' / ')
}

/** 終了が近い/超過しているか（クライマックス促し用） */
export function isNearEnd(tl: Timeline): boolean {
  if (!tl.enabled || !tl.totalDays) return false
  return tl.currentDay >= tl.totalDays * 0.85
}
