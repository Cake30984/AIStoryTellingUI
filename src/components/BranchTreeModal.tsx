import { useEffect, useRef, useState } from 'react'
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

/** 現在パス（ルート→currentId）のノードを ルート順に並べる。削除保護・剪定に使う */
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

/* ---------- コミットグラフのレイアウト（FB3-B2） ---------- */
const LANE_W = 18
const ROW_H = 36
const DOT_R = 4.5
const LANE_COLORS = 6

const laneX = (lane: number) => lane * LANE_W + LANE_W / 2
const laneColor = (lane: number) => `var(--graph-lane-${lane % LANE_COLORS})`

/** 1行分の描画情報（縦線・分岐カーブ・ドット位置） */
interface GraphRow {
  node: BranchNode
  lane: number
  topLanes: number[] // 上半分に縦線を引くレーン
  bottomLanes: number[] // 下半分に縦線を引くレーン（分岐カーブ先は含めない）
  branches: { from: number; to: number }[] // 下半分に描く分岐カーブ
}

/**
 * 木を SourceTree 風のコミットグラフにレイアウトする。行は pre-order（現在パスの子を最優先）で並べ、
 * 最初の子は親と同じレーンを継ぎ、2番目以降の子は新しいレーンへ分岐させる。merge は無い（木なので
 * 入ってくる辺は常に同一レーンの直線・分岐カーブは親行の下半分にのみ描く）。
 */
function buildGraph(tree: BranchTree, pathIds: Set<string>): { rows: GraphRow[]; laneCount: number } {
  const root = tree.nodes.find((n) => n.parentId === null)
  if (!root) return { rows: [], laneCount: 0 }
  const childrenOf = (id: string) =>
    tree.nodes
      .filter((n) => n.parentId === id)
      .sort((a, b) => {
        // 現在パス上の子を先頭に（＝現在パスをレーン0の直線に保つ）→ 残りは作成順
        const ap = pathIds.has(a.id) ? 0 : 1
        const bp = pathIds.has(b.id) ? 0 : 1
        return ap !== bp ? ap - bp : a.createdAt - b.createdAt
      })

  const rows: GraphRow[] = []
  const active = new Map<number, string>() // レーン → そのレーンを流れ下る辺の子 id
  let maxLane = 0
  let nextLane = 0

  const visit = (node: BranchNode, lane: number) => {
    maxLane = Math.max(maxLane, lane)
    // 上半分: 現在アクティブな全レーンが通過（このノードの入り辺 active[lane] もここで終端）
    const topLanes = [...active.keys()]
    active.delete(lane)
    // 出る辺: 子ごとにレーンを決める
    const kids = childrenOf(node.id)
    const childLanes = kids.map((_, i) => (i === 0 ? lane : ++nextLane))
    kids.forEach((c, i) => active.set(childLanes[i], c.id))
    const branchLanes = new Set(childLanes.filter((_, i) => i > 0))
    const branches = childLanes.filter((_, i) => i > 0).map((to) => ({ from: lane, to }))
    // 下半分: アクティブレーンのうち分岐カーブ先でないものを縦線に
    const bottomLanes = [...active.keys()].filter((l) => !branchLanes.has(l))
    rows.push({ node, lane, topLanes, bottomLanes, branches })
    kids.forEach((c, i) => visit(c, childLanes[i]))
  }
  visit(root, 0)
  return { rows, laneCount: maxLane + 1 }
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
 * 分岐ツリー本体（C2→F1→FB3-B2 で SourceTree 風コミットグラフに再設計）。
 * 全ノードを1列に縦積みし、レーン縦線＋分岐カーブ＋色分けドットで木構造を描く。
 * 行アクション（しおり・削除・シーン開始前へ戻る）は ⋯ メニューに集約。
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
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const busy = generating || busyAction
  const currentRef = useRef<HTMLDivElement>(null)

  // タブを開いた時／現在地が変わった時に「いまここ」を画面中央へ
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' })
  }, [tree?.currentId, tab])

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

  const totalBytes = tree ? tree.nodes.reduce((sum, n) => sum + n.bytes, 0) : 0
  const starred = tree ? starredNodesOf(tree) : []
  const graph = tree ? buildGraph(tree, pathIds) : { rows: [], laneCount: 0 }
  const gutterW = Math.max(graph.laneCount, 1) * LANE_W
  const cy = ROW_H / 2

  // ---- 1行（グラフのセル＋本文＋アクション） ----
  const renderRow = (row: GraphRow): JSX.Element | null => {
    if (!tree) return null
    const { node, lane } = row
    const isCurrent = node.id === tree.currentId
    const onPath = pathIds.has(node.id)
    const isScene = node.kind === 'scene'
    const subCount = subtreeNodes(tree, node.id).length
    return (
      <div
        className={'bg-row' + (isCurrent ? ' current' : '')}
        key={node.id}
        ref={isCurrent ? currentRef : undefined}
      >
        <div className="bg-graph" style={{ width: gutterW, height: ROW_H }}>
          <svg width={gutterW} height={ROW_H} className="bg-svg">
            {row.topLanes.map((l) => (
              <line
                key={'t' + l}
                x1={laneX(l)}
                y1={0}
                x2={laneX(l)}
                y2={cy}
                stroke={laneColor(l)}
                strokeWidth={2}
              />
            ))}
            {row.bottomLanes.map((l) => (
              <line
                key={'b' + l}
                x1={laneX(l)}
                y1={cy}
                x2={laneX(l)}
                y2={ROW_H}
                stroke={laneColor(l)}
                strokeWidth={2}
              />
            ))}
            {row.branches.map((br) => (
              <path
                key={'c' + br.to}
                d={`M ${laneX(br.from)} ${cy} C ${laneX(br.from)} ${(cy + ROW_H) / 2} ${laneX(br.to)} ${(cy + ROW_H) / 2} ${laneX(br.to)} ${ROW_H}`}
                fill="none"
                stroke={laneColor(br.to)}
                strokeWidth={2}
              />
            ))}
            <circle
              cx={laneX(lane)}
              cy={cy}
              r={isCurrent ? DOT_R + 1.5 : DOT_R}
              fill={node.star ? 'var(--star)' : laneColor(lane)}
              stroke={isCurrent ? 'var(--accent)' : 'transparent'}
              strokeWidth={isCurrent ? 2.5 : 0}
            />
          </svg>
        </div>

        <div className="bg-body">
          <span className={'bg-label' + (isScene ? ' scene' : '')}>
            {isScene ? `📖 ${node.label}` : node.label}
            {node.timeLabel ? `（${node.timeLabel}）` : ''}
          </span>
          {node.star && <span className="badge">★ {node.star.name}</span>}
          {isCurrent && <span className="badge accent">▶ いまここ</span>}
          <span className="bg-bytes">{formatBytes(node.bytes)}</span>
          {!isCurrent && (
            <button
              className="bg-back"
              disabled={busy}
              onClick={() => doRestore(node.id)}
              title="この地点に戻る"
            >
              <Icon name="rotate-ccw" size={13} /> 戻る
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
      </div>
    )
  }

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

      {tree && pruneCount > 0 && tab === 'tree' && (
        <button className="btn danger" style={{ marginBottom: 10 }} disabled={busy} onClick={doPrune}>
          <Icon name="scissors" size={13} /> 現在の分岐だけ残す（他 {pruneCount} 件を削除）
        </button>
      )}

      {!tree || graph.rows.length === 0 ? (
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
        <div className="bg-list">{graph.rows.map(renderRow)}</div>
      )}
    </>
  )
}
