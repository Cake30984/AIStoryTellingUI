import { useStore } from '../store'
import type { Session } from '../types'
import ModalShell from './ModalShell'
import { Icon } from './icons'

interface Props {
  session: Session
  onClose: () => void
  /** 指定シーンへの挿絵の後付け生成（FB6-B。渡されるとシーン行にボタンを出す） */
  onGenIllustration?: (sceneId: string) => void
  /** 指定シーンの背景の生成・差し替え（FB6-B） */
  onGenBackground?: (sceneId: string) => void
}

export default function StoryLogModal({ session, onClose, onGenIllustration, onGenBackground }: Props) {
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
      title="あらすじ一覧"
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
                      <span style={{ flex: 1 }} />
                      {onGenIllustration && (
                        <button
                          className="icon-btn small"
                          title="このシーンに挿絵を生成（シーン末尾に表示）"
                          onClick={() => onGenIllustration(sc.id)}
                        >
                          <Icon name="palette" size={14} />
                        </button>
                      )}
                      {onGenBackground && (
                        <button
                          className="icon-btn small"
                          title={sc.backgroundImageId ? 'このシーンの背景を生成し直す' : 'このシーンの背景を生成'}
                          onClick={() => onGenBackground(sc.id)}
                        >
                          <Icon name="mountain" size={14} />
                        </button>
                      )}
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
