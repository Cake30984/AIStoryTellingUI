import { useState } from 'react'
import { useStore } from '../store'
import type { BranchNode, BranchTree, Session } from '../types'

interface Props {
  session: Session
  onClose: () => void
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

function childrenOf(tree: BranchTree, parentId: string): BranchNode[] {
  return tree.nodes.filter((n) => n.parentId === parentId).sort((a, b) => a.createdAt - b.createdAt)
}

/** 現在パス（ルート→currentId）のノード id 集合。削除保護・剪定の対象判定に使う */
function currentPathIds(tree: BranchTree): Set<string> {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]))
  const ids = new Set<string>()
  let id: string | null = tree.currentId
  while (id) {
    ids.add(id)
    id = byId.get(id)?.parentId ?? null
  }
  return ids
}

/** 指定ノード自身とその子孫すべて（削除confirmの件数・合計サイズ表示に使う） */
function subtreeNodes(tree: BranchTree, rootId: string): BranchNode[] {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]))
  const childIds = new Map<string, string[]>()
  for (const n of tree.nodes) {
    if (n.parentId) {
      const arr = childIds.get(n.parentId) ?? []
      arr.push(n.id)
      childIds.set(n.parentId, arr)
    }
  }
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

function NodeRow({
  node,
  depth,
  isCurrent,
  canDelete,
  busy,
  onRestore,
  onDeleteSubtree,
}: {
  node: BranchNode
  depth: number
  isCurrent: boolean
  canDelete: boolean
  busy: boolean
  onRestore: (nodeId: string) => void
  onDeleteSubtree: (node: BranchNode) => void
}) {
  const indent = depth * 16
  const deleteBtn = (
    <button
      className="icon-btn small"
      disabled={busy || !canDelete}
      title={canDelete ? 'この分岐を削除' : '現在の分岐上のため削除できません'}
      onClick={() => onDeleteSubtree(node)}
    >
      🗑
    </button>
  )
  if (node.kind === 'scene') {
    return (
      <div className="branch-row branch-scene" style={{ marginLeft: indent }}>
        <span className="log-title">
          📖 {node.label}
          {node.timeLabel ? `（${node.timeLabel}）` : ''}
        </span>
        {isCurrent && <span className="badge">▶ いまここ</span>}
        <span className="branch-size">{formatBytes(node.bytes)}</span>
        {node.parentId && (
          <button className="btn" disabled={busy} onClick={() => onRestore(node.parentId!)}>
            ↩ レビュー前に戻る
          </button>
        )}
        {deleteBtn}
      </div>
    )
  }
  return (
    <div className="branch-row branch-action" style={{ marginLeft: indent }}>
      <span className="branch-label">{node.label}</span>
      <span className="branch-time">{new Date(node.createdAt).toLocaleString()}</span>
      {isCurrent && <span className="badge">▶ いまここ</span>}
      <span className="branch-size">{formatBytes(node.bytes)}</span>
      {!isCurrent && (
        <button className="btn" disabled={busy} onClick={() => onRestore(node.id)}>
          ⏪ ここに戻る
        </button>
      )}
      {deleteBtn}
    </div>
  )
}

/**
 * ルートから辿れる「主系列」を1本描画する。分岐点（子が複数）では現在パス上の子だけ
 * そのまま続け、他の子は「⑂ 別の分岐」トグルの配下に再帰的に描画する（既定は折りたたみ）。
 */
function Chain({
  tree,
  startId,
  pathIds,
  currentId,
  expanded,
  toggle,
  busy,
  onRestore,
  onDeleteSubtree,
  depth,
}: {
  tree: BranchTree
  startId: string
  pathIds: Set<string>
  currentId: string | null
  expanded: Set<string>
  toggle: (id: string) => void
  busy: boolean
  onRestore: (nodeId: string) => void
  onDeleteSubtree: (node: BranchNode) => void
  depth: number
}) {
  const rows: JSX.Element[] = []
  const byId = new Map(tree.nodes.map((n) => [n.id, n]))
  let id: string | null = startId
  while (id) {
    const node = byId.get(id)
    if (!node) break
    const isCurrent = node.id === currentId
    const canDelete = !pathIds.has(node.id)
    rows.push(
      <NodeRow
        key={node.id}
        node={node}
        depth={depth}
        isCurrent={isCurrent}
        canDelete={canDelete}
        busy={busy}
        onRestore={onRestore}
        onDeleteSubtree={onDeleteSubtree}
      />,
    )
    const children = childrenOf(tree, node.id)
    if (children.length === 0) {
      id = null
    } else if (children.length === 1) {
      id = children[0].id
    } else {
      const mainChild = children.find((c) => pathIds.has(c.id))
      const others = children.filter((c) => c.id !== mainChild?.id)
      if (others.length > 0) {
        const isOpen = expanded.has(node.id)
        rows.push(
          <div className="branch-toggle-row" key={`${node.id}-toggle`} style={{ marginLeft: (depth + 1) * 16 }}>
            <button className="btn" onClick={() => toggle(node.id)}>
              {isOpen ? '▾' : '⑂'} 別の分岐 ({others.length})
            </button>
          </div>,
        )
        if (isOpen) {
          rows.push(
            <div className="branch-alt-group" key={`${node.id}-alt`} style={{ marginLeft: (depth + 1) * 16 }}>
              {others.map((o) => (
                <Chain
                  key={o.id}
                  tree={tree}
                  startId={o.id}
                  pathIds={pathIds}
                  currentId={currentId}
                  expanded={expanded}
                  toggle={toggle}
                  busy={busy}
                  onRestore={onRestore}
                  onDeleteSubtree={onDeleteSubtree}
                  depth={depth + 1}
                />
              ))}
            </div>,
          )
        }
      }
      id = mainChild ? mainChild.id : null
    }
  }
  return <>{rows}</>
}

/** 分岐ツリーモーダル（C2）。シーン見出し＋action行の縦リスト・分岐展開・復元・剪定 */
export default function BranchTreeModal({ session, onClose }: Props) {
  const {
    branchTrees,
    restoreCheckpoint,
    deleteBranchSubtree,
    pruneToCurrentPath,
    isStreaming,
    isGeneratingChoices,
    isReviewing,
  } = useStore()
  const tree = branchTrees[session.id]
  const generating = isStreaming || isGeneratingChoices || isReviewing
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busyAction, setBusyAction] = useState(false)
  const busy = generating || busyAction

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const doRestore = async (nodeId: string) => {
    if (busy) return
    if (
      !confirm('この地点に戻りますか？\n現在の物語はそのまま残り、ここから新しい分岐が始まります。')
    )
      return
    setBusyAction(true)
    try {
      await restoreCheckpoint(session.id, nodeId)
      onClose()
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
    if (!confirm(`この分岐（${nodes.length}件・${formatBytes(totalBytes)}）を削除しますか？\n元に戻せません。`))
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
    if (!confirm(`現在の分岐（${pathIds.size}件）以外の${pruneCount}件を削除します。\n元に戻せません。よろしいですか？`))
      return
    setBusyAction(true)
    try {
      await pruneToCurrentPath(session.id)
    } finally {
      setBusyAction(false)
    }
  }

  const root = tree?.nodes.find((n) => n.parentId === null)
  const totalBytes = tree ? tree.nodes.reduce((sum, n) => sum + n.bytes, 0) : 0

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>🕘 分岐ツリー</h3>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {!tree || !root ? (
            <p className="desc">まだ記録がありません。物語を進めると、ここに時点が記録されていきます。</p>
          ) : (
            <div className="branch-list">
              <Chain
                tree={tree}
                startId={root.id}
                pathIds={pathIds}
                currentId={tree.currentId}
                expanded={expanded}
                toggle={toggle}
                busy={busy}
                onRestore={doRestore}
                onDeleteSubtree={doDeleteSubtree}
                depth={0}
              />
            </div>
          )}
        </div>
        <div className="modal-foot">
          {tree && (
            <span className="desc">
              合計 {tree.nodes.length} 件・{formatBytes(totalBytes)}
            </span>
          )}
          <div style={{ flex: 1 }} />
          {tree && pruneCount > 0 && (
            <button className="btn danger" disabled={busy} onClick={doPrune}>
              ✂ この分岐だけ残す
            </button>
          )}
          <button className="btn primary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
