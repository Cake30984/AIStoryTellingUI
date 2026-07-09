import { useStore } from '../store'
import type { Session } from '../types'
import ModalShell from './ModalShell'

interface Props {
  session: Session
  onClose: () => void
}

export default function StoryLogModal({ session, onClose }: Props) {
  const characters = useStore((s) => s.characters)

  const recap = session.scenes
    .filter((sc) => sc.summary.trim())
    .map((sc) => `■ ${sc.timeLabel ? `${sc.timeLabel}｜` : ''}${sc.title}\n${sc.summary.trim()}`)
    .join('\n\n')

  const copyAll = () => {
    navigator.clipboard?.writeText(recap)
  }

  return (
    <ModalShell
      title="📜 あらすじ一覧"
      onClose={onClose}
      wide
      footer={
        <>
          {recap && (
            <button className="btn" onClick={copyAll}>
              全文コピー
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn primary" onClick={onClose}>
            閉じる
          </button>
        </>
      }
    >
          {session.scenes.every((sc) => !sc.summary.trim()) ? (
            <p style={{ color: 'var(--text-dim)' }}>
              まだ要約がありません。シーンを「✓ このシーンを終える」で締めると、ここにあらすじが蓄積されます。
            </p>
          ) : (
            <div className="log-list">
              {session.scenes.map((sc) => {
                const cast = sc.activeCharacterIds
                  .map((id) => characters.find((c) => c.id === id)?.name)
                  .filter(Boolean)
                const isCurrent = sc.id === session.currentSceneId
                return (
                  <div key={sc.id} className="log-item">
                    <div className="log-head">
                      {sc.timeLabel && <span className="log-time">{sc.timeLabel}</span>}
                      <span className="log-title">{sc.title}</span>
                      {isCurrent && <span className="badge">進行中</span>}
                      {cast.length > 0 && <span className="log-cast">{cast.join('・')}</span>}
                    </div>
                    {sc.summary.trim() ? (
                      <div className="log-summary">{sc.summary}</div>
                    ) : (
                      <div className="log-summary empty">（要約なし{isCurrent ? '・進行中' : ''}）</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
    </ModalShell>
  )
}
