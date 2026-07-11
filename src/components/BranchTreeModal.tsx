import { Fragment, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import type { BranchNode, BranchTree, Session } from '../types'
import { useImageUrl } from '../lib/imageStore'
import { appConfirm, appPrompt } from '../lib/dialogs'
import { Icon } from './icons'
import MenuPopover from './MenuPopover'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

function childrenOf(tree: BranchTree, parentId: string): BranchNode[] {
  return tree.nodes.filter((n) => n.parentId === parentId).sort((a, b) => a.createdAt - b.createdAt)
}

/** 現在パス（ルート→currentId）のノードを ルート順に並べる。主線描画・削除保護・剪定に使う */
function mainPath(tree: BranchTree): BranchNode[] {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]))
  const out: BranchNode[] = []
  let id: string | null = tree.currentId
  while (id) {
    const n = byId.get(id)
    if (!n) break
    out.unshift(n)
    id = n.parentId
  }
  return out
}

function currentPathIds(tree: BranchTree): Set<string> {
  return new Set(mainPath(tree).map((n) => n.id))
}

/** しおり付きノードを新しい順に並べる（C3。★しおりタブ用） */
function starredNodesOf(tree: BranchTree): BranchNode[] {
  return tree.nodes.filter((n) => !!n.star).sort((a, b) => b.createdAt - a.createdAt)
}

/** 指定ノード自身とその子孫すべて（削除confirmの件数・合計サイズ表示に使う） */
function subtreeNodes(tree: BranchTree, rootId: string): BranchNode[] {
  const childIds = new Map<string, string[]>()
  for (const n of tree.nodes) {
    if (n.parentId) {
      const arr = childIds.get(n.parentId) ?? []
      arr.push(n.id)
      childIds.set(n.parentId, arr)
    }
  }
  const byId = new Map(tree.nodes.map((n) => [n.id, n]))
  const out: BranchNode[] = []
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop()!
    const n = byId.get(id)
    if (n) out.push(n)
    for (const c of childIds.get(id) ?? []) stack.push(c)
  }
  return out
}

/** 主線を scene ノード（とルート）で章に区切る。各章 = 見出しノード＋続く action ノード列 */
function chaptersOf(path: BranchNode[]): { head: BranchNode; rows: BranchNode[] }[] {
  const chapters: { head: BranchNode; rows: BranchNode[] }[] = []
  let cur: { head: BranchNode; rows: BranchNode[] } | null = null
  for (const n of path) {
    if (cur === null || n.kind === 'scene') {
      cur = { head: n, rows: [] }
      chapters.push(cur)
    } else {
      cur.rows.push(n)
    }
  }
  return chapters
}

/** しおりのサムネイル（背景/挿絵があれば表示、無ければプレースホルダ） */
function StarThumb({ imageId, size = 28 }: { imageId?: string; size?: number }) {
  const url = useImageUrl(imageId)
  const style = { width: size, height: size }
  if (imageId && url) {
    return <img className="star-thumb" style={style} src={url} alt="" />
  }
  return (
    <div className="star-thumb star-thumb-placeholder" style={style}>
      ★
    </div>
  )
}

/**
 * 分岐ツリー本体（C2→F1で刷新）。git ログ風に「主線＝ルート→いまここ」を縦に描き、
 * scene ノードで章に折りたたむ。主線上の分岐点は「⑂ 別の分岐」、現在ノードの子は「▷ この先」を
 * 展開式で見せる。行アクション（しおり・削除・シーン開始前へ戻る）は ⋯ メニューに集約。
 */
export function BranchTreeBody({ session }: { session: Session }) {
  const {
    branchTrees,
    restoreCheckpoint,
    deleteBranchSubtree,
    pruneToCurrentPath,
    setBranchStar,
    removeBranchStar,
    isStreaming,
    isGeneratingChoices,
    isReviewing,
  } = useStore()
  const tree = branchTrees[session.id]
  const generating = isStreaming || isGeneratingChoices || isReviewing
  const [busyAction, setBusyAction] = useState(false)
  const [tab, setTab] = useState<'tree' | 'starred'>('tree')
  const [chapterState, setChapterState] = useState<Map<string, boolean>>(new Map())
  const [openBranch, setOpenBranch] = useState<Set<string>>(new Set())
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const busy = generating || busyAction
  const currentRef = useRef<HTMLDivElement>(null)

  // タブを開いた時／現在地が変わった時に「いまここ」を画面中央へ
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' })
  }, [tree?.currentId, tab])

  const toggleChapter = (headId: string, cur: boolean) =>
    setChapterState((prev) => {
      const next = new Map(prev)
      next.set(headId, !cur)
      return next
    })
  const toggleBranch = (id: string) =>
    setOpenBranch((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const doRestore = async (nodeId: string) => {
    if (busy) return
    if (
      !(await appConfirm('この地点に戻りますか？\n現在の物語はそのまま残り、ここから新しい分岐が始まります。'))
    )
      return
    setBusyAction(true)
    try {
      await restoreCheckpoint(session.id, nodeId)
    } catch (e) {
      useStore.setState({ error: (e as Error).message })
    } finally {
      setBusyAction(false)
    }
  }

  const doDeleteSubtree = async (node: BranchNode) => {
    if (busy || !tree) return
    const nodes = subtreeNodes(tree, node.id)
    const totalBytes = nodes.reduce((sum, n) => sum + n.bytes, 0)
    if (
      !(await appConfirm({
        message: `この分岐（${nodes.length}件・${formatBytes(totalBytes)}）を削除しますか？\n元に戻せません。`,
        danger: true,
      }))
    )
      return
    setBusyAction(true)
    try {
      await deleteBranchSubtree(session.id, node.id)
    } catch (e) {
      useStore.setState({ error: (e as Error).message })
    } finally {
      setBusyAction(false)
    }
  }

  const pathIds = tree ? currentPathIds(tree) : new Set<string>()
  const pruneCount = tree ? tree.nodes.length - pathIds.size : 0

  const doPrune = async () => {
    if (busy || !tree || pruneCount <= 0) return
    if (
      !(await appConfirm({
        message: `現在の分岐（${pathIds.size}件）以外の${pruneCount}件を削除します。\n元に戻せません。よろしいですか？`,
        danger: true,
      }))
    )
      return
    setBusyAction(true)
    try {
      await pruneToCurrentPath(session.id)
    } finally {
      setBusyAction(false)
    }
  }

  const doSetStar = async (node: BranchNode) => {
    if (busy) return
    const name = await appPrompt({
      message: 'しおりの名前を入力してください',
      initial: node.star?.name ?? node.label,
    })
    if (name === null) return
    const trimmed = name.trim()
    if (!trimmed) return
    await setBranchStar(session.id, node.id, trimmed)
  }

  const doRemoveStar = (node: BranchNode) => {
    if (busy || !node.star) return
    removeBranchStar(session.id, node.id)
  }

  const root = tree?.nodes.find((n) => n.parentId === null)
  const totalBytes = tree ? tree.nodes.reduce((sum, n) => sum + n.bytes, 0) : 0
  const starred = tree ? starredNodesOf(tree) : []

  // ---- 1ノードの行 ----
  const renderRow = (
    node: BranchNode,
    opts: { head?: boolean; caret?: 'open' | 'closed' | null; onCaret?: () => void; hint?: string } = {},
  ) => {
    if (!tree) return null
    const isCurrent = node.id === tree.currentId
    const onPath = pathIds.has(node.id)
    const isScene = node.kind === 'scene'
    const subCount = subtreeNodes(tree, node.id).length
    return (
      <div
        className={'bt-row' + (isCurrent ? ' current' : '') + (opts.head ? ' head' : '')}
        key={node.id}
        ref={isCurrent ? currentRef : undefined}
      >
        {opts.caret !== undefined ? (
          <button
            className="bt-caret"
            onClick={opts.onCaret}
            title={opts.caret === 'open' ? '折りたたむ' : '展開'}
          >
            {opts.caret === null ? '' : opts.caret === 'open' ? '▾' : '▸'}
          </button>
        ) : (
          <span className="bt-caret" />
        )}
        <span className="bt-guide">
          <span className={'bt-dot' + (isCurrent ? ' current' : node.star ? ' star' : '')} />
        </span>
        <span className="bt-label">
          {isScene ? `📖 ${node.label}` : node.label}
          {node.timeLabel ? `（${node.timeLabel}）` : ''}
          {opts.hint && <span className="bt-hint">{opts.hint}</span>}
          {node.star && <span className="badge">★ {node.star.name}</span>}
          {isCurrent && <span className="badge accent">▶ いまここ</span>}
        </span>
        <span className="bt-meta">{formatBytes(node.bytes)}</span>
        {!isCurrent && (
          <button className="bt-back" disabled={busy} onClick={() => doRestore(node.id)} title="この地点に戻る">
            <Icon name="rotate-ccw" size={13} />
          </button>
        )}
        <div className="menu-anchor">
          <button
            className="icon-btn small"
            onClick={() => setMenuFor(menuFor === node.id ? null : node.id)}
            title="操作"
          >
            <Icon name="more-horizontal" size={14} />
          </button>
          {menuFor === node.id && (
            <MenuPopover onClose={() => setMenuFor(null)}>
              <button
                className="menu-item"
                disabled={busy}
                onClick={() => {
                  setMenuFor(null)
                  node.star ? doRemoveStar(node) : doSetStar(node)
                }}
              >
                <Icon name="star" size={14} filled={!!node.star} />{' '}
                {node.star ? 'しおりを外す' : 'しおりを付ける'}
              </button>
              {isScene && node.parentId && (
                <button
                  className="menu-item"
                  disabled={busy}
                  onClick={() => {
                    setMenuFor(null)
                    doRestore(node.parentId!)
                  }}
                >
                  <Icon name="corner-up-left" size={14} /> このシーンの開始前に戻る
                </button>
              )}
              <button
                className="menu-item danger"
                disabled={busy || onPath}
                title={onPath ? '現在の分岐上のため削除できません' : ''}
                onClick={() => {
                  setMenuFor(null)
                  doDeleteSubtree(node)
                }}
              >
                <Icon name="trash-2" size={14} /> この分岐を削除（{subCount}件）
              </button>
            </MenuPopover>
          )}
        </div>
      </div>
    )
  }

  // ---- 主線外のサブツリー（枝）。単独子は同じ深さで続け、分岐点で子ごとに入れ子にする ----
  const renderSubtree = (startId: string): JSX.Element[] => {
    if (!tree) return []
    const rows: JSX.Element[] = []
    let id: string | null = startId
    while (id) {
      const node: BranchNode | undefined = tree.nodes.find((n) => n.id === id)
      if (!node) break
      rows.push(<Fragment key={node.id}>{renderRow(node)}</Fragment>)
      const children = childrenOf(tree, node.id)
      if (children.length === 0) {
        id = null
      } else if (children.length === 1) {
        id = children[0].id
      } else {
        for (const c of children) {
          rows.push(
            <div className="bt-alt" key={`alt-${c.id}`}>
              {renderSubtree(c.id)}
            </div>,
          )
        }
        id = null
      }
    }
    return rows
  }

  // ---- 主線上の1ノード＋その分岐トグル ----
  const renderMainNode = (node: BranchNode, headOpts?: Parameters<typeof renderRow>[1]): JSX.Element => {
    if (!tree) return <Fragment key={node.id} />
    const offChildren = childrenOf(tree, node.id).filter((c) => !pathIds.has(c.id))
    const isCurrent = node.id === tree.currentId
    const open = openBranch.has(node.id)
    return (
      <Fragment key={node.id}>
        {renderRow(node, headOpts ?? {})}
        {offChildren.length > 0 && (
          <>
            <button className="bt-toggle" onClick={() => toggleBranch(node.id)}>
              {open ? '▾' : isCurrent ? '▷' : '⑂'} {isCurrent ? 'この先' : '別の分岐'} (
              {offChildren.length})
            </button>
            {/* 枝ごとに独立した囲みで描画する（1つの囲みに連結すると複数の枝が1本に見える） */}
            {open &&
              offChildren.map((c) => (
                <div className="bt-alt" key={c.id}>
                  {renderSubtree(c.id)}
                </div>
              ))}
          </>
        )}
      </Fragment>
    )
  }

  const path = tree ? mainPath(tree) : []
  const chapters = chaptersOf(path)
  const currentChapterId = chapters.length > 0 ? chapters[chapters.length - 1].head.id : null
  const isChapterOpen = (headId: string) =>
    chapterState.has(headId) ? chapterState.get(headId)! : headId === currentChapterId

  return (
    <>
      {tree && (
        <div className="dock-toolbar">
          <div className="seg">
            <button className={tab === 'tree' ? 'on' : ''} onClick={() => setTab('tree')}>
              ツリー
            </button>
            <button className={tab === 'starred' ? 'on' : ''} onClick={() => setTab('starred')}>
              <Icon name="star" size={13} filled={tab === 'starred'} /> しおり
              {starred.length > 0 ? `（${starred.length}）` : ''}
            </button>
          </div>
          <span className="desc">
            合計 {tree.nodes.length} 件・{formatBytes(totalBytes)}
          </span>
        </div>
      )}

      {tree && tab === 'tree' && (
        <div className="bt-legend">
          <span>
            <span className="bt-dot current" style={{ display: 'inline-block', verticalAlign: 'middle' }} />{' '}
            いまここ
          </span>
          <span>⑂ 別の分岐</span>
          <span>▷ この先</span>
        </div>
      )}

      {tree && pruneCount > 0 && tab === 'tree' && (
        <button className="btn danger" style={{ marginBottom: 10 }} disabled={busy} onClick={doPrune}>
          <Icon name="scissors" size={13} /> 現在の分岐だけ残す（他 {pruneCount} 件を削除）
        </button>
      )}

      {!tree || !root ? (
        <p className="desc">まだ記録がありません。物語を進めると、ここに時点が記録されていきます。</p>
      ) : tab === 'starred' ? (
        starred.length === 0 ? (
          <p className="desc">まだしおりがありません。各ノードの ⋯ から名前を付けて登録できます。</p>
        ) : (
          <div className="star-list">
            {starred.map((n) => (
              <div className="star-row" key={n.id}>
                <StarThumb imageId={n.star?.thumbImageId} size={56} />
                <div className="star-row-info">
                  <div className="star-row-name">★ {n.star?.name}</div>
                  <div className="desc">
                    {n.kind === 'scene' ? `📖 ${n.label}` : n.label}
                    {n.timeLabel ? `（${n.timeLabel}）` : ''}
                  </div>
                  <div className="branch-time">{new Date(n.createdAt).toLocaleString()}</div>
                </div>
                {tree.currentId === n.id && <span className="badge accent">▶ いまここ</span>}
                <button
                  className="btn"
                  disabled={busy || tree.currentId === n.id}
                  onClick={() => doRestore(n.id)}
                >
                  <Icon name="rotate-ccw" size={13} /> ここに戻る
                </button>
                <button
                  className="icon-btn small"
                  disabled={busy}
                  title="しおりを外す"
                  onClick={() => doRemoveStar(n)}
                >
                  <Icon name="x" size={13} />
                </button>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="bt-list">
          {chapters.map((ch) => {
            const open = isChapterOpen(ch.head.id)
            const multi = chapters.length > 1
            return (
              <div className="bt-main" key={ch.head.id}>
                {renderMainNode(
                  ch.head,
                  multi
                    ? {
                        head: true,
                        caret: open ? 'open' : 'closed',
                        onCaret: () => toggleChapter(ch.head.id, open),
                        hint: !open && ch.rows.length > 0 ? `（${ch.rows.length}手）` : undefined,
                      }
                    : { head: true },
                )}
                {open && ch.rows.map((n) => renderMainNode(n))}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
