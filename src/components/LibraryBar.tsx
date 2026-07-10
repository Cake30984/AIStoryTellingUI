import { useState } from 'react'
import { useStore } from '../store'
import { Icon } from './icons'
import ActivityIndicator from './ActivityIndicator'
import ModalShell from './ModalShell'
import { ImageJobsBody } from './ImageJobsPanel'

/**
 * Library（作る）画面用の細いトップバー。進行状態（ActivityIndicator）と画像生成ジョブを
 * Play 画面に行かなくても確認・採用できるようにする。ジョブ一覧はドックが無いためモーダルで開く。
 */
export default function LibraryBar() {
  const { imageJobs } = useStore()
  const [showJobs, setShowJobs] = useState(false)
  const selecting = imageJobs.some((j) => j.status === 'selecting')

  return (
    <div className="topbar library-topbar">
      <ActivityIndicator />
      <div style={{ flex: 1 }} />
      <button
        className={'icon-btn' + (selecting ? ' on' : '')}
        onClick={() => setShowJobs(true)}
        title="画像生成ジョブ（進行中・選択待ち）"
      >
        <Icon name="hourglass" />
        {imageJobs.length > 0 && <span className="icon-badge">{imageJobs.length}</span>}
      </button>
      {showJobs && (
        <ModalShell title="画像生成ジョブ" onClose={() => setShowJobs(false)}>
          <ImageJobsBody />
        </ModalShell>
      )}
    </div>
  )
}
