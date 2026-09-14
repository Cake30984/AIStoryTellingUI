import { useRef, useState } from 'react'
import { storeActions, useStore } from '../store'
import { Icon } from './icons'
import ActivityIndicator from './ActivityIndicator'
import ModalShell from './ModalShell'
import { ImageJobsBody } from './ImageJobsPanel'

/**
 * Library（作る）画面用の細いトップバー。進行状態（ActivityIndicator）と画像生成ジョブを
 * Play 画面に行かなくても確認・採用できるようにする。ジョブ一覧はドックが無いためモーダルで開く。
 * インポート（PNG カード / JSON バンドル）も System に行かずここから取り込める。
 */
export default function LibraryBar() {
  const imageJobs = useStore((st) => st.imageJobs)
  const { importAnyFile, setInfoNotice } = storeActions()
  const [showJobs, setShowJobs] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const selecting = imageJobs.some((j) => j.status === 'selecting')

  const onImport = async (file: File) => {
    try {
      setInfoNotice(await importAnyFile(file))
    } catch (e) {
      setInfoNotice(`インポート失敗：${(e as Error).message}`)
    }
  }

  return (
    <div className="topbar library-topbar">
      <ActivityIndicator />
      <div style={{ flex: 1 }} />
      <button
        className="btn"
        style={{ fontSize: 12, padding: '5px 12px' }}
        onClick={() => fileRef.current?.click()}
        title="インポート（PNG カード / JSON バックアップ）"
      >
        <Icon name="upload" size={13} /> インポート
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json,image/png,.png"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onImport(f)
          e.target.value = ''
        }}
      />
      <button
        className={'btn' + (selecting ? ' primary' : '')}
        style={{ fontSize: 12, padding: '5px 12px', position: 'relative' }}
        onClick={() => setShowJobs(true)}
        title="画像生成ジョブ（進行中・選択待ち）"
      >
        <Icon name="hourglass" size={13} /> ジョブ
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
