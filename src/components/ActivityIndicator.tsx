import { useState } from 'react'
import { useStore } from '../store'
import MenuPopover from './MenuPopover'

/** 本編/選択肢/レビュー/画像生成/表情判定の進行状態を一元表示し、中止できるチップ */
export default function ActivityIndicator() {
  const {
    isStreaming,
    isGeneratingChoices,
    isReviewing,
    isClassifyingEmotions,
    imageJobs,
    stop,
    stopChoices,
    stopReview,
    cancelImageJob,
  } = useStore()
  const [open, setOpen] = useState(false)

  const runningJobs = imageJobs.filter((j) => j.status === 'running')
  const items: { key: string; label: string; onStop?: () => void }[] = []
  if (isStreaming) items.push({ key: 'main', label: '本編を生成中', onStop: stop })
  if (isReviewing) items.push({ key: 'review', label: 'レビュー作成中', onStop: stopReview })
  if (isGeneratingChoices) items.push({ key: 'choices', label: '選択肢を考え中', onStop: stopChoices })
  for (const j of runningJobs) {
    items.push({
      key: j.id,
      label: `画像を生成中 (${j.results.length}/${j.count})`,
      onStop: () => cancelImageJob(j.id),
    })
  }
  if (isClassifyingEmotions) items.push({ key: 'emotion', label: '表情を判定中' })

  if (items.length === 0) return null
  const main = items[0]

  return (
    <div className="menu-anchor">
      <button className="activity" onClick={() => setOpen((v) => !v)}>
        <span className="activity-dot" />
        {main.label}
        {items.length > 1 && <span className="activity-more">+{items.length - 1}</span>}
      </button>
      {open && (
        <MenuPopover onClose={() => setOpen(false)}>
          {items.map((it) => (
            <div className="activity-row" key={it.key}>
              <span>{it.label}</span>
              {it.onStop && (
                <button className="link" onClick={it.onStop}>
                  中止
                </button>
              )}
            </div>
          ))}
        </MenuPopover>
      )}
    </div>
  )
}
