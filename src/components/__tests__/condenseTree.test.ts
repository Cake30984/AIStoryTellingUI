import { describe, expect, it } from 'vitest'
import { condenseTree } from '../BranchTreeModal'
import { makeTree } from '../../lib/__tests__/fixtures'

/** 📖sc1 の章に action の一本鎖（a1→a2→a3→a4）がぶら下がった木 */
const chain = (currentId = 'a4') =>
  makeTree(
    [
      { id: 'sc1', kind: 'scene' },
      { id: 'a1', parentId: 'sc1' },
      { id: 'a2', parentId: 'a1' },
      { id: 'a3', parentId: 'a2' },
      { id: 'a4', parentId: 'a3' },
    ],
    currentId,
  )

describe('condenseTree', () => {
  it('畳んだ章の鎖の内部（親あり・子1）を隠し、可視の子を最寄りの可視祖先へ付け替える', () => {
    const { tree, hiddenBySceneId } = condenseTree(chain(), new Set())
    expect(tree.nodes.map((n) => n.id)).toEqual(['sc1', 'a4'])
    expect(tree.nodes.find((n) => n.id === 'a4')?.parentId).toBe('sc1')
    expect(hiddenBySceneId.get('sc1')).toBe(3)
  })

  it('展開中の章は何も隠さない（同一参照で返す）', () => {
    const tree = chain()
    const out = condenseTree(tree, new Set(['sc1']))
    expect(out.tree).toBe(tree)
    expect(out.hiddenBySceneId.size).toBe(0)
  })

  it('いまここ（currentId）は畳んでも残す', () => {
    const { tree } = condenseTree(chain('a2'), new Set())
    expect(tree.nodes.map((n) => n.id)).toEqual(['sc1', 'a2', 'a4'])
    expect(tree.nodes.find((n) => n.id === 'a2')?.parentId).toBe('sc1')
    expect(tree.nodes.find((n) => n.id === 'a4')?.parentId).toBe('a2')
  })

  it('★しおり・⑂名前・🏁エンディングは残す', () => {
    const tree = makeTree(
      [
        { id: 'sc1', kind: 'scene' },
        { id: 'a1', parentId: 'sc1', star: { name: 'ここ' } },
        { id: 'a2', parentId: 'a1', branchName: '別ルート' },
        { id: 'a3', parentId: 'a2', ending: '静かな結末' },
        { id: 'a4', parentId: 'a3' },
      ],
      'a4',
    )
    expect(condenseTree(tree, new Set()).tree.nodes).toHaveLength(5)
  })

  it('分岐点（子2つ以上）と葉は残す', () => {
    const tree = makeTree(
      [
        { id: 'sc1', kind: 'scene' },
        { id: 'a1', parentId: 'sc1' },
        { id: 'a2', parentId: 'a1' },
        { id: 'b1', parentId: 'a1' },
      ],
      'a2',
    )
    const { tree: out } = condenseTree(tree, new Set())
    // a1 は子2＝分岐点なので残る
    expect(out.nodes.map((n) => n.id)).toEqual(['sc1', 'a1', 'a2', 'b1'])
  })

  it('scene ノード自身は畳まない', () => {
    const tree = makeTree(
      [
        { id: 'sc1', kind: 'scene' },
        { id: 'sc2', kind: 'scene', parentId: 'sc1' },
        { id: 'a1', parentId: 'sc2' },
      ],
      'a1',
    )
    expect(condenseTree(tree, new Set()).tree.nodes.map((n) => n.id)).toEqual(['sc1', 'sc2', 'a1'])
  })

  it('章（scene）に属さないノード（ルート直下）は畳まない', () => {
    const tree = makeTree(
      [
        { id: 'r' },
        { id: 'a1', parentId: 'r' },
        { id: 'a2', parentId: 'a1' },
      ],
      'a2',
    )
    const out = condenseTree(tree, new Set())
    expect(out.tree).toBe(tree)
  })

  it('隠した件数を章ごとに数える', () => {
    const tree = makeTree(
      [
        { id: 'sc1', kind: 'scene' },
        { id: 'a1', parentId: 'sc1' },
        { id: 'sc2', kind: 'scene', parentId: 'a1' },
        { id: 'b1', parentId: 'sc2' },
        { id: 'b2', parentId: 'b1' },
        { id: 'b3', parentId: 'b2' },
      ],
      'b3',
    )
    const { hiddenBySceneId } = condenseTree(tree, new Set())
    expect(hiddenBySceneId.get('sc1')).toBe(1)
    expect(hiddenBySceneId.get('sc2')).toBe(2)
  })
})
