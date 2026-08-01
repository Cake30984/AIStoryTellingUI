import { useRef } from 'react'
import type { DockTab, Session } from '../types'
import { useStore } from '../store'
import { Icon } from './icons'
import StatusView from './StatusView'
import DiscoveryView from './DiscoveryView'
import type { DiscoveryScope } from './DiscoveryPanel'
import { GalleryBody } from './GalleryModal'
import { BranchTreeBody } from './BranchTreeModal'
import { ImageJobsBody } from './ImageJobsPanel'

interface Props {
  session: Session
  onEditStatus: () => void
  onEditDiscovery: (scope: DiscoveryScope) => void
  onRegenerateIllustration: (sceneId: string, messageId: string | undefined, prompt: string, negative?: string) => void
}

const TITLES: Record<DockTab, string> = {
  status: '状態',
  discovery: '発見ログ',
  gallery: '画像ギャラリー',
  branch: '分岐ツリー',
  jobs: '画像生成ジョブ',
}

/** ドック内の常設タブ（FB8-E4 A案。トップバーの5トグルをやめ、切替はここで行う） */
const DOCK_TABS: { key: DockTab; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { key: 'status', label: '状態', icon: 'bar-chart-3' },
  { key: 'discovery', label: '発見', icon: 'book-open' },
  { key: 'gallery', label: '画像', icon: 'image' },
  { key: 'branch', label: '分岐', icon: 'git-branch' },
  { key: 'jobs', label: 'ジョブ', icon: 'hourglass' },
]

const DOCK_MIN = 300
const DOCK_MAX = 560

/** 右コンテキストドック（UI-3）。状態・発見・ギャラリー・分岐・ジョブを1タブぶん常駐表示する */
export default function ContextDock({
  session,
  onEditStatus,
  onEditDiscovery,
  onRegenerateIllustration,
}: Props) {
  const { ui, setUiPrefs } = useStore()
  const tab = ui.dockTab
  const dockRef = useRef<HTMLDivElement>(null)

  // 左端ハンドルのドラッグで幅を変える（右に配置なのでポインタが左へ動くほど広がる。F1/A9）
  const onResizeDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = dockRef.current?.offsetWidth ?? ui.dockWidth
    document.body.style.userSelect = 'none'
    const onMove = (ev: MouseEvent) => {
      const w = Math.min(DOCK_MAX, Math.max(DOCK_MIN, startW + (startX - ev.clientX)))
      if (dockRef.current) dockRef.current.style.width = w + 'px'
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      const w = dockRef.current?.offsetWidth ?? ui.dockWidth
      setUiPrefs({ dockWidth: Math.min(DOCK_MAX, Math.max(DOCK_MIN, w)) })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  if (!tab) return null

  return (
    <div className="dock" ref={dockRef} style={{ width: ui.dockWidth }}>
      <div className="dock-resizer" onMouseDown={onResizeDown} title="ドラッグで幅を変更" />
      <div className="dock-head">
        <div className="dock-tabs" role="tablist">
          {DOCK_TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={'dock-tab' + (tab === t.key ? ' on' : '')}
              onClick={() => setUiPrefs({ dockTab: t.key })}
              title={TITLES[t.key]}
            >
              <Icon name={t.icon} size={15} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <button className="icon-btn" onClick={() => setUiPrefs({ dockTab: null })} title="パネルを閉じる">
          <Icon name="x" />
        </button>
      </div>
      <div className="dock-body">
        {tab === 'status' && (
          <>
            {/* 状態の編集はタブ直下の右寄せボタン（旧 head から移設。FB8-E4） */}
            <div className="dock-subactions">
              <button className="btn" onClick={onEditStatus}>
                <Icon name="pencil" size={13} /> 編集
              </button>
            </div>
            <StatusView session={session} />
          </>
        )}
        {tab === 'discovery' && <DiscoveryView session={session} onEdit={onEditDiscovery} />}
        {tab === 'gallery' && (
          <GalleryBody
            session={session}
            onRegenerateIllustration={onRegenerateIllustration}
          />
        )}
        {tab === 'branch' && <BranchTreeBody session={session} />}
        {tab === 'jobs' && <ImageJobsBody />}
      </div>
    </div>
  )
}
