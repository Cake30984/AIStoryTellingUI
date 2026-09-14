import { useState } from 'react'
import { storeActions, useStore } from '../store'
import { useBlobUrl } from '../lib/imageJobs'
import ZoomOverlay from './ZoomOverlay'
import { Icon } from './icons'

/** 選択待ちの生成候補1枚（クリックで拡大・採用） */
function Candidate({ blob, busy, onUse }: { blob: Blob; busy: boolean; onUse: () => void }) {
  const url = useBlobUrl(blob)
  const [zoom, setZoom] = useState(false)
  if (!url) return null
  return (
    <div className="job-thumb">
      <img src={url} alt="生成候補" onClick={() => setZoom(true)} />
      <button className="btn primary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={onUse} disabled={busy}>
        <Icon name="check" size={12} /> 採用
      </button>
      {zoom && <ZoomOverlay url={url} onClose={() => setZoom(false)} />}
    </div>
  )
}

/** 進行中・選択待ちの画像生成ジョブ一覧本体（ドックを閉じても継続するジョブをここから採用/破棄する。UI-3でドックへ移設・モーダル版廃止） */
export function ImageJobsBody() {
  const imageJobs = useStore((st) => st.imageJobs)
  const { cancelImageJob, dismissImageJob, applyImageJobResult } = storeActions()
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
    <>
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
                  <Icon name="x" size={12} /> キャンセル
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
                  <Icon name="trash-2" size={12} /> 破棄
                </button>
              </>
            )}
            {job.status === 'error' && (
              <div className="desc" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                生成に失敗しました: {job.error}
                <button className="btn" onClick={() => dismissImageJob(job.id)}>
                  <Icon name="trash-2" size={12} /> 閉じる
                </button>
              </div>
            )}
            {job.status === 'canceled' && (
              <div className="desc" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                キャンセルされました。
                <button className="btn" onClick={() => dismissImageJob(job.id)}>
                  <Icon name="trash-2" size={12} /> 閉じる
                </button>
              </div>
            )}
          </div>
        ))
      )}
      {error && <p className="notice">{error}</p>}
    </>
  )
}
