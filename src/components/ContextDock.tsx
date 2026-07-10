import type { DockTab, Session } from '../types'
import { useStore } from '../store'
import { Icon } from './icons'
import StatusView from './StatusView'
import DiscoveryView from './DiscoveryView'
import { GalleryBody } from './GalleryModal'
import { BranchTreeBody } from './BranchTreeModal'
import { ImageJobsBody } from './ImageJobsPanel'

interface Props {
  session: Session
  onEditStatus: () => void
  onEditDiscovery: () => void
}

const TITLES: Record<DockTab, string> = {
  status: '状態',
  discovery: '発見ログ',
  gallery: '画像ギャラリー',
  branch: '分岐ツリー',
  jobs: '画像生成ジョブ',
}

/** 右コンテキストドック（UI-3）。状態・発見・ギャラリー・分岐・ジョブを1タブぶん常駐表示する */
export default function ContextDock({ session, onEditStatus, onEditDiscovery }: Props) {
  const { ui, setUiPrefs } = useStore()
  const tab = ui.dockTab
  if (!tab) return null

  return (
    <div className="dock">
      <div className="dock-head">
        <span className="dock-head-title">{TITLES[tab]}</span>
        {tab === 'status' && (
          <button className="btn" onClick={onEditStatus}>
            <Icon name="pencil" size={13} /> 編集
          </button>
        )}
        {tab === 'discovery' && (
          <button className="btn" onClick={onEditDiscovery}>
            <Icon name="pencil" size={13} /> 編集
          </button>
        )}
        <button className="icon-btn" onClick={() => setUiPrefs({ dockTab: null })} title="閉じる">
          <Icon name="x" />
        </button>
      </div>
      <div className="dock-body">
        {tab === 'status' && <StatusView session={session} />}
        {tab === 'discovery' && <DiscoveryView session={session} />}
        {tab === 'gallery' && <GalleryBody session={session} />}
        {tab === 'branch' && <BranchTreeBody session={session} />}
        {tab === 'jobs' && <ImageJobsBody />}
      </div>
    </div>
  )
}
