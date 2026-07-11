import { useEffect, useMemo, useRef, useState } from 'react'
import { currentScene, useStore, type View } from '../store'
import { useModalEscape } from '../lib/modalStack'
import type { DockTab } from '../types'
import { Icon, type IconName } from './icons'

interface Command {
  id: string
  label: string
  group: string
  icon: IconName
  run: () => void
}

interface Props {
  onClose: () => void
}

/** Ctrl+K で開くコマンドパレット（UI-7）。セッション・素材への移動＋固定コマンドの実行 */
export default function CommandPalette({ onClose }: Props) {
  const {
    sessions,
    activeId,
    characters,
    worlds,
    personas,
    ui,
    isStreaming,
    isReviewing,
    setActive,
    setView,
    setUiPrefs,
    continueStory,
    startStory,
    prepareSceneReview,
  } = useStore()

  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useModalEscape(onClose)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const activeSession = sessions.find((s) => s.id === activeId)
  const scene = activeSession ? currentScene(activeSession) : undefined

  const goto = (v: View) => () => setView(v)
  const openDock = (tab: DockTab) => () => {
    setView('sessions')
    setUiPrefs({ dockTab: tab })
  }

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = []

    for (const s of sessions) {
      list.push({
        id: `session:${s.id}`,
        label: s.title || '無題のセッション',
        group: 'セッション',
        icon: 'message-circle',
        run: () => setActive(s.id),
      })
    }
    for (const c of characters) {
      if (!c.name) continue
      list.push({ id: `char:${c.id}`, label: c.name, group: 'キャラクター', icon: 'users', run: goto('characters') })
    }
    for (const w of worlds) {
      if (!w.name) continue
      list.push({ id: `world:${w.id}`, label: w.name, group: '世界観', icon: 'globe', run: goto('worlds') })
    }
    for (const p of personas) {
      if (!p.name) continue
      list.push({ id: `persona:${p.id}`, label: p.name, group: 'ペルソナ', icon: 'smile', run: goto('personas') })
    }

    if (activeSession) {
      if (activeSession.mode === 'story' && !isStreaming) {
        const storyStarted = activeSession.messages.some((m) => m.sceneId === scene?.id)
        list.push({
          id: 'cmd:continue',
          label: storyStarted ? '続ける' : '物語をはじめる',
          group: 'コマンド',
          icon: storyStarted ? 'fast-forward' : 'play',
          run: () => void (storyStarted ? continueStory() : startStory()),
        })
      }
      if (scene && !isStreaming && !isReviewing) {
        list.push({
          id: 'cmd:end-scene',
          label: 'このシーンを終える',
          group: 'コマンド',
          icon: 'check',
          run: () => void prepareSceneReview(),
        })
      }
      list.push({ id: 'cmd:dock-status', label: '状態を開く', group: 'コマンド', icon: 'bar-chart-3', run: openDock('status') })
      list.push({
        id: 'cmd:dock-discovery',
        label: '発見ログを開く',
        group: 'コマンド',
        icon: 'book-open',
        run: openDock('discovery'),
      })
      list.push({ id: 'cmd:dock-gallery', label: 'ギャラリーを開く', group: 'コマンド', icon: 'image', run: openDock('gallery') })
      list.push({
        id: 'cmd:dock-branch',
        label: '分岐ツリーを開く',
        group: 'コマンド',
        icon: 'git-branch',
        run: openDock('branch'),
      })
      list.push({ id: 'cmd:dock-jobs', label: '画像生成ジョブを開く', group: 'コマンド', icon: 'hourglass', run: openDock('jobs') })
    }

    list.push({
      id: 'cmd:immersive',
      label: ui.immersive ? '没入モードを解除' : '没入モードにする',
      group: 'コマンド',
      icon: 'maximize',
      run: () => setUiPrefs({ immersive: !ui.immersive }),
    })
    list.push({ id: 'cmd:system', label: '設定・データ管理を開く', group: 'コマンド', icon: 'settings', run: goto('system') })

    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, characters, worlds, personas, activeSession, scene, isStreaming, isReviewing, ui.immersive])

  const q = query.trim().toLowerCase()
  const results = (
    q ? commands.filter((c) => (c.label + ' ' + c.group).toLowerCase().includes(q)) : commands
  ).slice(0, 40)

  useEffect(() => setIndex(0), [query])

  const exec = (c: Command) => {
    c.run()
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[index]) exec(results[index])
    }
  }

  return (
    <div className="cmdk-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cmdk-box">
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="セッション・キャラ・コマンドを検索…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="cmdk-list">
          {results.length === 0 && <div className="cmdk-empty">見つかりません。</div>}
          {results.map((c, i) => (
            <div
              key={c.id}
              className={'cmdk-item' + (i === index ? ' active' : '')}
              onMouseEnter={() => setIndex(i)}
              onClick={() => exec(c)}
            >
              <Icon name={c.icon} size={15} />
              <span className="cmdk-item-label">{c.label}</span>
              <span className="cmdk-group">{c.group}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
