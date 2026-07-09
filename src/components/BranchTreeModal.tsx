import { useState } from 'react'
import { useStore } from '../store'
import type { BranchNode, BranchTree, Session } from '../types'
import { useImageUrl } from '../lib/imageStore'
import { appConfirm, appPrompt } from '../lib/dialogs'
import ModalShell from './ModalShell'

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

/** しおり付きノードを新しい順に並べる（C3。★しおりタブ用） */
function starredNodesOf(tree: BranchTree): BranchNode[] {
  return tree.nodes.filter((n) => !!n.star).sort((a, b) => b.createdAt - a.createdAt)
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

function StarButton({
  node,
  busy,
  onSetStar,
  onRemoveStar,
}: {
  node: BranchNode
  busy: boolean
  onSetStar: (node: BranchNode) => void
  onRemoveStar: (node: BranchNode) => void
}) {
  if (node.star) {
    return (
      <button
        className="icon-btn small"
        disabled={busy}
        title={`しおり: ${node.star.name}（クリックで外す）`}
        onClick={() => onRemoveStar(node)}
      >
        ★
      </button>
    )
  }
  return (
    <button className="icon-btn small" disabled={busy} title="しおりを付ける" onClick={() => onSetStar(node)}>
      ☆
    </button>
  )
}

function NodeRow({
  node,
  depth,
  isCurrent,
  canDelete,
  busy,
  onRestore,
  onDeleteSubtree,
  onSetStar,
  onRemoveStar,
}: {
  node: BranchNode
  depth: number
  isCurrent: boolean
  canDelete: boolean
  busy: boolean
  onRestore: (nodeId: string) => void
  onDeleteSubtree: (node: BranchNode) => void
  onSetStar: (node: BranchNode) => void
  onRemoveStar: (node: BranchNode) => void
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
  const starBtn = <StarButton node={node} busy={busy} onSetStar={onSetStar} onRemoveStar={onRemoveStar} />
  if (node.kind === 'scene') {
    return (
      <div className="branch-row branch-scene" style={{ marginLeft: indent }}>
        <span className="log-title">
          📖 {node.label}
          {node.timeLabel ? `（${node.timeLabel}）` : ''}
        </span>
        {node.star && <span className="badge">★ {node.star.name}</span>}
        {isCurrent && <span className="badge">▶ いまここ</span>}
        <span className="branch-size">{formatBytes(node.bytes)}</span>
        {node.parentId && (
          <button className="btn" disabled={busy} onClick={() => onRestore(node.parentId!)}>
            ↩ レビュー前に戻る
          </button>
        )}
        {starBtn}
        {deleteBtn}
      </div>
    )
  }
  return (
    <div className="branch-row branch-action" style={{ marginLeft: indent }}>
      <span className="branch-label">{node.label}</span>
      <span className="branch-time">{new Date(node.createdAt).toLocaleString()}</span>
      {node.star && <span className="badge">★ {node.star.name}</span>}
      {isCurrent && <span className="badge">▶ いまここ</span>}
      <span className="branch-size">{formatBytes(node.bytes)}</span>
      {!isCurrent && (
        <button className="btn" disabled={busy} onClick={() => onRestore(node.id)}>
          ⏪ ここに戻る
        </button>
      )}
      {starBtn}
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
  onSetStar,
  onRemoveStar,
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
  onSetStar: (node: BranchNode) => void
  onRemoveStar: (node: BranchNode) => void
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
        onSetStar={onSetStar}
        onRemoveStar={onRemoveStar}
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
                  onSetStar={onSetStar}
                  onRemoveStar={onRemoveStar}
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
    setBranchStar,
    removeBranchStar,
    isStreaming,
    isGeneratingChoices,
    isReviewing,
  } = useStore()
  const tree = branchTrees[session.id]
  const generating = isStreaming || isGeneratingChoices || isReviewing
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busyAction, setBusyAction] = useState(false)
  const [tab, setTab] = useState<'tree' | 'starred'>('tree')
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
      !(await appConfirm('この地点に戻りますか？\n現在の物語はそのまま残り、ここから新しい分岐が始まります。'))
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

  const root = tree?.nodes.find((n) => n.parentId === null)
  const totalBytes = tree ? tree.nodes.reduce((sum, n) => sum + n.bytes, 0) : 0
  const starred = tree ? starredNodesOf(tree) : []

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

  return (
    <ModalShell
      title="🕘 分岐ツリー"
      onClose={onClose}
      wide
      footer={
        <>
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
        </>
      }
    >
          {tree && (
            <div className="seg" style={{ marginBottom: 14 }}>
              <button className={tab === 'tree' ? 'on' : ''} onClick={() => setTab('tree')}>
                ツリー
              </button>
              <button className={tab === 'starred' ? 'on' : ''} onClick={() => setTab('starred')}>
                ★ しおり{starred.length > 0 ? `（${starred.length}）` : ''}
              </button>
            </div>
          )}
          {!tree || !root ? (
            <p className="desc">まだ記録がありません。物語を進めると、ここに時点が記録されていきます。</p>
          ) : tab === 'starred' ? (
            starred.length === 0 ? (
              <p className="desc">まだしおりがありません。各ノードの ☆ から名前を付けて登録できます。</p>
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
                    {tree.currentId === n.id && <span className="badge">▶ いまここ</span>}
                    <button
                      className="btn"
                      disabled={busy || tree.currentId === n.id}
                      onClick={() => doRestore(n.id)}
                    >
                      ⏪ ここに戻る
                    </button>
                    <button
                      className="icon-btn small"
                      disabled={busy}
                      title="しおりを外す"
                      onClick={() => doRemoveStar(n)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )
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
                onSetStar={doSetStar}
                onRemoveStar={doRemoveStar}
                depth={0}
              />
            </div>
          )}
    </ModalShell>
  )
}
