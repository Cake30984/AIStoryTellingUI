import { useEffect, useMemo, useRef, useState } from 'react'
import { storeActions, useStore } from '../store'
import type { BranchNode, BranchTree, Session } from '../types'
import { useImageUrl } from '../lib/imageStore'
import { appConfirm, appPrompt } from '../lib/dialogs'
import { Icon } from './icons'
import MenuPopover from './MenuPopover'
import StoryExportModal from './StoryExportModal'

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

/* ---------- レビュー単位の折りたたみ（FB6-D） ---------- */

/** 各ノードの属する章（最も近い祖先の 📖 scene ノード id。scene ノード自身は自分）を計算する */
function chapterOf(nodes: BranchNode[]): Map<string, string | null> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const memo = new Map<string, string | null>()
  const resolve = (id: string): string | null => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    const n = byId.get(id)
    const out = !n ? null : n.kind === 'scene' ? n.id : n.parentId ? resolve(n.parentId) : null
    memo.set(id, out)
    return out
  }
  for (const n of nodes) resolve(n.id)
  return memo
}

/**
 * 折りたたまれた章（expandedSceneIds に無い scene 章）内の「鎖の内部 action ノード」を非表示にし、
 * 可視ノードだけの合成ツリーを作る（FB6-D。export はロジック検証用）。
 * 分岐点（子2+）・葉・いまここ・★しおり・⑂名前・🏁・scene ノード自身は畳んでも常に表示＝
 * 非表示になるのは必ず「親あり・子1」の鎖内部なので、可視の子の parentId を最寄りの
 * 可視祖先へ付け替える辺縮約が一意に決まる。グラフ描画本体（buildGraph）は無改修で使える。
 */
export function condenseTree(
  tree: BranchTree,
  expandedSceneIds: Set<string>,
): { tree: BranchTree; hiddenBySceneId: Map<string, number> } {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]))
  const childCount = new Map<string, number>()
  for (const n of tree.nodes) {
    if (n.parentId) childCount.set(n.parentId, (childCount.get(n.parentId) ?? 0) + 1)
  }
  const chapters = chapterOf(tree.nodes)
  const hidden = new Set<string>()
  const hiddenBySceneId = new Map<string, number>()
  for (const n of tree.nodes) {
    if (n.kind !== 'action') continue
    const chapter = chapters.get(n.id)
    if (!chapter || expandedSceneIds.has(chapter)) continue
    if (n.id === tree.currentId) continue
    if (n.star || n.branchName || n.ending) continue
    if ((childCount.get(n.id) ?? 0) !== 1) continue
    hidden.add(n.id)
    hiddenBySceneId.set(chapter, (hiddenBySceneId.get(chapter) ?? 0) + 1)
  }
  if (hidden.size === 0) return { tree, hiddenBySceneId }
  const visibleAncestorOf = (id: string | null): string | null => {
    let cur = id
    while (cur && hidden.has(cur)) cur = byId.get(cur)?.parentId ?? null
    return cur
  }
  const nodes = tree.nodes
    .filter((n) => !hidden.has(n.id))
    .map((n) =>
      n.parentId && hidden.has(n.parentId) ? { ...n, parentId: visibleAncestorOf(n.parentId) } : n,
    )
  return { tree: { currentId: tree.currentId, nodes }, hiddenBySceneId }
}

/* ---------- コミットグラフのレイアウト（FB3-B2） ---------- */
const LANE_W = 18
const ROW_H = 36
const DOT_R = 4.5
const LANE_COLORS = 6

const laneX = (lane: number) => lane * LANE_W + LANE_W / 2
const laneColor = (lane: number) => `var(--graph-lane-${lane % LANE_COLORS})`

interface GraphSegment {
  lane: number
  /** 現在パスの辺ならレーン色より優先して紫で描く */
  onCurrentPath: boolean
  key: string
}

interface GraphBranch {
  from: number
  to: number
  /** 現在パスの辺ならレーン色より優先して紫で描く */
  onCurrentPath: boolean
  key: string
}

/** 1行分の描画情報（縦線・分岐カーブ・ドット位置） */
interface GraphRow {
  node: BranchNode
  lane: number
  topSegments: GraphSegment[]
  bottomSegments: GraphSegment[]
  branches: GraphBranch[]
}

/**
 * 木を SourceTree 風のコミットグラフにレイアウトする。
 * 行は BranchTree.nodes の配列順（= 実際に生成された順）をそのまま使い、現在パスによる並べ替えはしない。
 * 最初に生成された子は親レーンを継ぎ、同じ親の2番目以降の子だけが新レーンへ分岐する。merge は無い。
 */
function buildGraph(tree: BranchTree, pathIds: Set<string>): { rows: GraphRow[]; laneCount: number } {
  if (tree.nodes.length === 0) return { rows: [], laneCount: 0 }

  const indexById = new Map(tree.nodes.map((node, index) => [node.id, index]))
  const laneById = new Map<string, number>()
  const childCountByParent = new Map<string, number>()
  let nextLane = 0

  // 配列順でレーンを決める。同一 createdAt でも順序が変わらないよう createdAt は参照しない。
  tree.nodes.forEach((node, index) => {
    const parentId = node.parentId
    const parentIndex = parentId ? indexById.get(parentId) : undefined
    const parentLane = parentId ? laneById.get(parentId) : undefined
    if (parentId === null && laneById.size === 0) {
      laneById.set(node.id, 0)
      return
    }
    if (!parentId || parentIndex === undefined || parentIndex >= index || parentLane === undefined) {
      laneById.set(node.id, ++nextLane)
      return
    }
    const childCount = childCountByParent.get(parentId) ?? 0
    childCountByParent.set(parentId, childCount + 1)
    laneById.set(node.id, childCount === 0 ? parentLane : ++nextLane)
  })

  const rows: GraphRow[] = tree.nodes.map((node) => ({
    node,
    lane: laneById.get(node.id) ?? 0,
    topSegments: [],
    bottomSegments: [],
    branches: [],
  }))
  const maxLane = Math.max(...rows.map((row) => row.lane), 0)

  // 親行から子行までの辺を、途中行も含めて描画情報へ展開する。
  tree.nodes.forEach((child, childIndex) => {
    if (!child.parentId) return
    const parentIndex = indexById.get(child.parentId)
    if (parentIndex === undefined || parentIndex >= childIndex) return // 破損データは独立ノード扱い
    const parent = tree.nodes[parentIndex]
    const parentLane = laneById.get(parent.id)
    const childLane = laneById.get(child.id)
    if (parentLane === undefined || childLane === undefined) return
    const onCurrentPath = pathIds.has(parent.id) && pathIds.has(child.id)
    const key = `${parent.id}-${child.id}`

    for (let index = parentIndex + 1; index <= childIndex; index++) {
      rows[index].topSegments.push({ lane: childLane, onCurrentPath, key })
    }
    for (let index = parentIndex; index < childIndex; index++) {
      if (index === parentIndex && parentLane !== childLane) {
        rows[index].branches.push({ from: parentLane, to: childLane, onCurrentPath, key })
      } else {
        rows[index].bottomSegments.push({ lane: childLane, onCurrentPath, key })
      }
    }
  })

  return { rows, laneCount: maxLane + 1 }
}

/** しおりのサムネイル（挿絵があれば表示、無ければプレースホルダ） */
function StarThumb({ imageId, size = 28 }: { imageId?: string; size?: number }) {
  const url = useImageUrl(imageId)
  const style = { width: size, height: size }
  if (imageId && url) {
    return <img className="star-thumb" style={style} src={url} alt="" />
  }
  return (
    <div className="star-thumb star-thumb-placeholder" style={style}>
      <Icon name="star" size={14} filled />
    </div>
  )
}

/** 旧データのノードラベルに残る記号接頭辞（📖/🏁/🗑/⑂ 等）を表示時に剥がす（FB8-E2） */
const stripLegacyMark = (s: string) => s.replace(/^(?:📖|🏁|🗑|⑂|★)\s*/u, '')

/**
 * 分岐ツリー本体（C2→F1→FB3-B2 で SourceTree 風コミットグラフに再設計）。
 * 全ノードを1列に縦積みし、レーン縦線＋分岐カーブ＋色分けドットで木構造を描く。
 * 行アクション（しおり・削除・シーン開始前へ戻る）は ⋯ メニューに集約。
 */
export function BranchTreeBody({ session }: { session: Session }) {
  const branchTrees = useStore((st) => st.branchTrees)
  const isStreaming = useStore((st) => st.isStreaming)
  const isGeneratingChoices = useStore((st) => st.isGeneratingChoices)
  const isReviewing = useStore((st) => st.isReviewing)
  const {
    restoreCheckpoint,
    navigateToNode,
    branchFromNode,
    deleteBranchSubtree,
    pruneToCurrentPath,
    setBranchStar,
    removeBranchStar,
  } = storeActions()
  const tree = branchTrees[session.id]
  const generating = isStreaming || isGeneratingChoices || isReviewing
  const [busyAction, setBusyAction] = useState(false)
  const [tab, setTab] = useState<'tree' | 'starred'>('tree')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [exportNodeId, setExportNodeId] = useState<string | null>(null)
  // 「現在の分岐だけ表示」（非破壊のビュー絞り込み。FB8-D #8）
  const [onlyCurrentPath, setOnlyCurrentPath] = useState(false)
  const busy = generating || busyAction
  const currentRef = useRef<HTMLDivElement>(null)

  // レビュー単位の折りたたみ（FB6-D）。既定＝現在いる章だけ展開
  const chapters = useMemo(() => (tree ? chapterOf(tree.nodes) : new Map<string, string | null>()), [tree])
  const currentChapter = tree?.currentId ? (chapters.get(tree.currentId) ?? null) : null
  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(() =>
    currentChapter ? new Set([currentChapter]) : new Set(),
  )
  // 現在地が別の章へ移ったら（復元・レビュー確定）その章を自動展開する
  useEffect(() => {
    if (!currentChapter) return
    setExpandedScenes((prev) => (prev.has(currentChapter) ? prev : new Set([...prev, currentChapter])))
  }, [currentChapter])
  const toggleChapter = (sceneId: string) =>
    setExpandedScenes((prev) => {
      const next = new Set(prev)
      if (next.has(sceneId)) next.delete(sceneId)
      else next.add(sceneId)
      return next
    })

  // タブを開いた時／現在地が変わった時に「いまここ」を画面中央へ
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' })
  }, [tree?.currentId, tab])

  // 行クリック＝その地点を本文で開く（FB7-B。何も消さない・確認なし）。
  // パス上スクロールは生成中も常時可なので busyAction のみで多重実行を防ぐ
  // （パス外＝復元を伴う移動は navigateToNode 内の restoreCheckpoint が生成中に例外を投げる）
  const doOpen = async (nodeId: string) => {
    if (busyAction) return
    setBusyAction(true)
    try {
      await navigateToNode(session.id, nodeId)
    } catch (e) {
      useStore.setState({ error: (e as Error).message })
    } finally {
      setBusyAction(false)
    }
  }

  const doRestore = async (nodeId: string) => {
    if (busy) return
    if (
      !(await appConfirm(
        'この地点に戻りますか？\nここから物語を進めると、この先の記録は上書きされて消えます（シーンをまたぐ大きな上書きになる場合は、その時に分岐として残すか確認します）。',
      ))
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

  // ⑂ ここから分岐して再開（FB6-C）: いまの線の先端に名前を付けて保護してから復元する
  const doBranchFrom = async (nodeId: string) => {
    if (busy) return
    setBusyAction(true)
    try {
      await branchFromNode(session.id, nodeId)
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
        message: `現在の分岐（${pathIds.size}件）以外の${pruneCount}件を削除します。\n名前付き分岐・しおり付きの記録も含めてすべて消え、元に戻せません。よろしいですか？`,
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
  // 「現在の分岐だけ表示」は off-path ノードを描画から外すだけ（非破壊・いつでも戻せる。FB8-D #8）
  const viewTree =
    onlyCurrentPath && tree
      ? { currentId: tree.currentId, nodes: tree.nodes.filter((n) => pathIds.has(n.id)) }
      : tree
  // 折りたたみ適用後の合成ツリーをグラフ化する（FB6-D。buildGraph 本体は無改修）
  const condensed = viewTree ? condenseTree(viewTree, expandedScenes) : null
  const graph = condensed ? buildGraph(condensed.tree, pathIds) : { rows: [], laneCount: 0 }
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
            {row.topSegments.map((segment) => (
              <line
                key={'t' + segment.key}
                x1={laneX(segment.lane)}
                y1={0}
                x2={laneX(segment.lane)}
                y2={cy}
                stroke={segment.onCurrentPath ? 'var(--accent)' : laneColor(segment.lane)}
                strokeWidth={2}
              />
            ))}
            {row.bottomSegments.map((segment) => (
              <line
                key={'b' + segment.key}
                x1={laneX(segment.lane)}
                y1={cy}
                x2={laneX(segment.lane)}
                y2={ROW_H}
                stroke={segment.onCurrentPath ? 'var(--accent)' : laneColor(segment.lane)}
                strokeWidth={2}
              />
            ))}
            {row.branches.map((br) => (
              <path
                key={'c' + br.key}
                d={`M ${laneX(br.from)} ${cy} C ${laneX(br.from)} ${(cy + ROW_H) / 2} ${laneX(br.to)} ${(cy + ROW_H) / 2} ${laneX(br.to)} ${ROW_H}`}
                fill="none"
                stroke={br.onCurrentPath ? 'var(--accent)' : laneColor(br.to)}
                strokeWidth={2}
              />
            ))}
            <circle
              cx={laneX(lane)}
              cy={cy}
              r={isCurrent ? DOT_R + 1.5 : DOT_R}
              fill={onPath ? 'var(--accent)' : node.star ? 'var(--star)' : laneColor(lane)}
              stroke={isCurrent ? 'var(--accent)' : 'transparent'}
              strokeWidth={isCurrent ? 2.5 : 0}
            />
          </svg>
        </div>

        <div
          className="bg-body"
          onClick={(e) => {
            // ボタン類（折りたたみ・⋯・メニュー項目）のクリックは行ナビゲーションにしない
            if ((e.target as HTMLElement).closest('button')) return
            void doOpen(node.id)
          }}
        >
          {isScene && (
            <button
              className="icon-btn small bg-fold"
              title={expandedScenes.has(node.id) ? 'この章を畳む' : 'この章を展開する'}
              onClick={() => toggleChapter(node.id)}
            >
              <Icon name={expandedScenes.has(node.id) ? 'chevron-down' : 'chevron-right'} size={13} />
            </button>
          )}
          <span className={'bg-label' + (isScene ? ' scene' : '')}>
            {node.ending && <Icon name="flag" size={12} className="bg-label-icon" />}
            {isScene && !node.ending && <Icon name="book-open" size={12} className="bg-label-icon" />}
            {stripLegacyMark(node.label)}
            {node.timeLabel ? `（${node.timeLabel}）` : ''}
          </span>
          {isScene &&
            !expandedScenes.has(node.id) &&
            (condensed?.hiddenBySceneId.get(node.id) ?? 0) > 0 && (
              <span className="bg-fold-count">（{condensed!.hiddenBySceneId.get(node.id)}件）</span>
            )}
          {node.branchName && (
            <span className="badge bg-branch-badge">
              <Icon name="git-branch" size={11} /> {node.branchName}
            </span>
          )}
          {node.star && (
            <span className="badge bg-star-badge">
              <Icon name="star" size={11} filled /> {node.star.name}
            </span>
          )}
          {isCurrent && <span className="badge accent bg-current-badge">いまここ</span>}
          <span className="bg-bytes">{formatBytes(node.bytes)}</span>
          <span className="bg-open" title="この地点を本文で開く（何も消えません）">
            開く
          </span>
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
                {!isCurrent && (
                  <button
                    className="menu-item"
                    disabled={busy}
                    title="この時点より先を読み込まない状態に戻します（ここから進めると先の記録は上書き）"
                    onClick={() => {
                      setMenuFor(null)
                      void doRestore(node.id)
                    }}
                  >
                    <Icon name="rotate-ccw" size={14} /> この時点に戻す
                  </button>
                )}
                {!isCurrent && (
                  <button
                    className="menu-item"
                    disabled={busy}
                    title="いま進めている続きに名前を付けて残してから、この地点に戻ります"
                    onClick={() => {
                      setMenuFor(null)
                      void doBranchFrom(node.id)
                    }}
                  >
                    <Icon name="git-branch" size={14} /> ここから分岐して再開
                  </button>
                )}
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
                  className="menu-item"
                  disabled={busy}
                  title="この時点までの進行を書き出します（プレーンテキスト・Markdown・画像カード）"
                  onClick={() => {
                    setMenuFor(null)
                    setExportNodeId(node.id)
                  }}
                >
                  <Icon name="download" size={14} /> ここまでを書き出す
                </button>
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
        <label className="chk" style={{ marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={onlyCurrentPath}
            onChange={(e) => setOnlyCurrentPath(e.target.checked)}
          />
          現在の分岐だけ表示（他 {pruneCount} 件を隠す・消さない）
        </label>
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
          <p className="desc">まだしおりがありません。各行のメニューから名前を付けて登録できます。</p>
        ) : (
          <div className="star-list">
            {starred.map((n) => (
              <div className="star-row" key={n.id}>
                <StarThumb imageId={n.star?.thumbImageId} size={56} />
                <div className="star-row-info">
                  <div className="star-row-name">
                    <Icon name="star" size={12} filled /> {n.star?.name}
                  </div>
                  <div className="desc">
                    {n.ending && <Icon name="flag" size={11} className="bg-label-icon" />}
                    {n.kind === 'scene' && !n.ending && (
                      <Icon name="book-open" size={11} className="bg-label-icon" />
                    )}
                    {stripLegacyMark(n.label)}
                    {n.timeLabel ? `（${n.timeLabel}）` : ''}
                  </div>
                  <div className="branch-time">{new Date(n.createdAt).toLocaleString()}</div>
                </div>
                {tree.currentId === n.id && <span className="badge accent bg-current-badge">いまここ</span>}
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

      {exportNodeId && (
        <StoryExportModal sessionId={session.id} nodeId={exportNodeId} onClose={() => setExportNodeId(null)} />
      )}
    </>
  )
}
