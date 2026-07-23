import { useEffect, useState } from 'react'
import { areaOf, useStore, type View } from '../store'
import { Icon } from './icons'

const LIBRARY_VIEWS: View[] = ['characters', 'worlds', 'personas', 'cassettes']

/** 左端48pxの領域スイッチ（Play/Library/System。UI-5） */
export default function Rail() {
  const { view, setView } = useStore()
  const [lastLibrary, setLastLibrary] = useState<View>('characters')
  const area = areaOf(view)

  // Library 内のビュー切替を記憶しておき、レールから戻ってきた時に同じ場所へ
  useEffect(() => {
    if (LIBRARY_VIEWS.includes(view)) setLastLibrary(view)
  }, [view])

  return (
    <div className="rail">
      <button
        className={'rail-btn' + (area === 'play' ? ' on' : '')}
        title="プレイ（セッション）"
        onClick={() => setView('sessions')}
      >
        <Icon name="message-circle" size={18} />
        プレイ
      </button>
      <button
        className={'rail-btn' + (area === 'library' ? ' on' : '')}
        title="ライブラリ（キャラクター・世界観・ペルソナ・カセット）"
        onClick={() => setView(lastLibrary)}
      >
        <Icon name="library-big" size={18} />
        作る
      </button>
      {/* 設定は最下段の定位置に（空状態の案内「レール最下段 ⚙」と一致させる。F0/A4） */}
      <div style={{ flex: 1 }} />
      <button
        className={'rail-btn' + (area === 'system' ? ' on' : '')}
        title="設定・データ管理"
        onClick={() => setView('system')}
      >
        <Icon name="settings" size={18} />
        設定
      </button>
    </div>
  )
}
