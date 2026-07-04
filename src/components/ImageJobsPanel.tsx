import { useState } from 'react'
import { useStore } from '../store'
import { useBlobUrl } from '../lib/imageJobs'

/** 選択待ちの生成候補1枚（クリックで拡大・採用） */
function Candidate({ blob, busy, onUse }: { blob: Blob; busy: boolean; onUse: () => void }) {
  const url = useBlobUrl(blob)
  const [zoom, setZoom] = useState(false)
  if (!url) return null
  return (
    <div className="job-thumb">
      <img src={url} alt="生成候補" onClick={() => setZoom(true)} />
      <button className="btn primary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={onUse} disabled={busy}>
        ✔ 採用
      </button>
      {zoom && (
        <div className="overlay" onClick={() => setZoom(false)}>
          <img src={url} alt="" style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 'var(--radius)' }} />
        </div>
      )}
    </div>
  )
}

/** 進行中・選択待ちの画像生成ジョブ一覧（モーダルを閉じても継続するジョブをここから採用/破棄する） */
export default function ImageJobsPanel({ onClose }: { onClose: () => void }) {
  const { imageJobs, cancelImageJob, dismissImageJob, applyImageJobResult } = useStore()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const apply = async (jobId: string, idx: number) => {
    setBusyId(jobId)
    setError('')
    try {
      await applyImageJobResult(jobId, idx)
    } catch (e) {
      setError(`保存に失敗しました: ${(e as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>画像生成ジョブ</h3>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {imageJobs.length === 0 ? (
            <p className="desc">実行中のジョブはありません。</p>
          ) : (
            imageJobs.map((job) => (
              <div className="field" key={job.id}>
                <label>{job.label}</label>
                {job.status === 'running' && (
                  <div className="desc" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    生成中…（{job.results.length}/{job.count} 枚完了）
                    <button className="btn" onClick={() => cancelImageJob(job.id)}>
                      ✕ キャンセル
                    </button>
                  </div>
                )}
                {job.status === 'selecting' && (
                  <>
                    <div className="job-thumbs">
                      {job.results.map((blob, i) => (
                        <Candidate key={i} blob={blob} busy={busyId === job.id} onUse={() => apply(job.id, i)} />
                      ))}
                    </div>
                    {job.error && <div className="desc">一部の生成に失敗しました: {job.error}</div>}
                    <button className="btn" style={{ marginTop: 6 }} onClick={() => dismissImageJob(job.id)}>
                      🗑 破棄
                    </button>
                  </>
                )}
                {job.status === 'error' && (
                  <div className="desc" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    生成に失敗しました: {job.error}
                    <button className="btn" onClick={() => dismissImageJob(job.id)}>
                      🗑 閉じる
                    </button>
                  </div>
                )}
                {job.status === 'canceled' && (
                  <div className="desc" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    キャンセルされました。
                    <button className="btn" onClick={() => dismissImageJob(job.id)}>
                      🗑 閉じる
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
          {error && <p className="notice">{error}</p>}
        </div>
        <div className="modal-foot">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
