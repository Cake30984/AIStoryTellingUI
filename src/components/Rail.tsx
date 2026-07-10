import { useEffect, useState } from 'react'
import { areaOf, useStore, type View } from '../store'
import { Icon } from './icons'

const LIBRARY_VIEWS: View[] = ['characters', 'worlds', 'personas', 'sceneTypes']

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
        <Icon name="message-circle" size={20} />
      </button>
      <button
        className={'rail-btn' + (area === 'library' ? ' on' : '')}
        title="ライブラリ（キャラ・世界観・ペルソナ・演出）"
        onClick={() => setView(lastLibrary)}
      >
        <Icon name="library-big" size={20} />
      </button>
      <button
        className={'rail-btn' + (area === 'system' ? ' on' : '')}
        title="設定・データ管理"
        onClick={() => setView('system')}
      >
        <Icon name="settings" size={20} />
      </button>
    </div>
  )
}
