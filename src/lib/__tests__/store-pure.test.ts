// store.ts の純関数（状態適用・分岐木の判定）。store 本体の初期化には触れない
import { describe, expect, it } from 'vitest'
import {
  applyReviewToState,
  applyTrackerToState,
  deletableChainsBelow,
  lineTipOf,
  matchPendingDone,
  rewindScenesFor,
  subtreeHasProtection,
} from '../../store'
import type { RelationUpdate } from '../../types'
import { makeMessage, makeScene, makeSessionState, makeTree } from './fixtures'

const slip = (id: string, what: string) => ({ id, when: '', what, bornAt: 0 })
/** レビュー B が返す関係性の更新1件（名前・理由は適用ロジックに効かないので既定値で埋める） */
const rel = (over: Partial<RelationUpdate> = {}): RelationUpdate => ({
  fromId: 'c1',
  fromName: '美咲',
  toId: 'c0',
  toName: '主人公',
  stance: '',
  aspects: [],
  reason: '',
  ...over,
})

describe('matchPendingDone', () => {
  const pending = [slip('p1', '図書室で本を返す'), slip('p2', '放課後に部活へ行く')]

  it('正規化した部分一致で1件だけ当たれば消化とみなす', () => {
    expect([...matchPendingDone(pending, ['図書室で本を返す'])]).toEqual(['p1'])
  })

  it('句読点・記号・空白の揺れを無視する', () => {
    expect([...matchPendingDone(pending, ['図書室で、本を返す。'])]).toEqual(['p1'])
  })

  it('引用が予定を内包していても当たる（双方向の部分一致）', () => {
    expect([...matchPendingDone(pending, ['今日のうちに図書室で本を返すこと'])]).toEqual(['p1'])
  })

  it('候補が2件以上なら曖昧として残す（誤って消さない）', () => {
    const ambiguous = [slip('p1', '行く'), slip('p2', '行く')]
    expect([...matchPendingDone(ambiguous, ['行く'])]).toEqual([])
  })

  it('見つからない引用は無視する', () => {
    expect([...matchPendingDone(pending, ['海へ行く'])]).toEqual([])
  })

  it('引用が無い・空文字なら何も消えない', () => {
    expect([...matchPendingDone(pending, undefined)]).toEqual([])
    expect([...matchPendingDone(pending, ['', '　'])]).toEqual([])
  })

  it('同じ予定を2回引用しても二重には数えない', () => {
    expect([...matchPendingDone(pending, ['図書室で本を返す', '図書室で本を返す'])]).toEqual(['p1'])
  })
})

describe('applyTrackerToState', () => {
  const base = makeSessionState({
    now: '8月31日 朝',
    place: '教室',
    situation: '晴れ',
    presentIds: ['c1'],
    pending: [slip('p1', '図書室で本を返す')],
  })

  it('tracker が無ければ state をそのまま返す', () => {
    expect(applyTrackerToState(base, undefined, 0)).toBe(base)
  })

  it('空文字の項目は上書きせず現状を保つ', () => {
    const out = applyTrackerToState(
      base,
      { now: '', place: '', presentIds: ['c1', 'c2'], situation: '', foreground: '', pendingAdd: [], pendingDone: [] },
      1,
    )
    expect(out.now).toBe('8月31日 朝')
    expect(out.place).toBe('教室')
    expect(out.situation).toBe('晴れ')
    // presentIds は空配列も意味を持つので常に上書き
    expect(out.presentIds).toEqual(['c1', 'c2'])
  })

  it('消化した予定を落とし recentDone へ積む', () => {
    const out = applyTrackerToState(
      base,
      {
        now: '8月31日 昼',
        place: '図書室',
        presentIds: [],
        situation: '',
        foreground: '',
        pendingAdd: [],
        pendingDone: ['図書室で本を返す'],
      },
      1,
    )
    expect(out.pending).toEqual([])
    expect(out.recentDone.map((d) => d.what)).toEqual(['図書室で本を返す'])
    expect(out.now).toBe('8月31日 昼')
  })

  it('追加された予定に id と bornAt を付ける。what が空のものは捨てる', () => {
    const out = applyTrackerToState(
      base,
      {
        now: '',
        place: '',
        presentIds: [],
        situation: '',
        foreground: '',
        pendingAdd: [
          { when: '明日', what: '駅で待ち合わせ' },
          { when: '', what: '  ' },
        ],
        pendingDone: [],
      },
      3,
    )
    expect(out.pending).toHaveLength(2)
    const added = out.pending[1]
    expect(added).toMatchObject({ when: '明日', what: '駅で待ち合わせ', bornAt: 3 })
    expect(added.id).toBeTruthy()
  })

  it('recentDone は直近6件までしか残さない', () => {
    const prev = makeSessionState({
      pending: [slip('p1', '返却')],
      recentDone: Array.from({ length: 6 }, (_, i) => ({ what: `済${i}`, at: 0 })),
    })
    const out = applyTrackerToState(
      prev,
      { now: '', place: '', presentIds: [], situation: '', foreground: '', pendingAdd: [], pendingDone: ['返却'] },
      1,
    )
    expect(out.recentDone).toHaveLength(6)
    expect(out.recentDone[0].what).toBe('返却')
    expect(out.recentDone[5].what).toBe('済4')
  })
})

describe('applyReviewToState', () => {
  it('新しい関係性を追加する', () => {
    const out = applyReviewToState(undefined, {
      relationUpdates: [
        rel({ stance: '信じ始めている', aspects: [{ aspectId: 'a1', name: '信頼', note: '好意的' }] }),
      ],
      moodChanges: [],
    })
    expect(out.relations).toHaveLength(1)
    expect(out.relations[0]).toMatchObject({ fromId: 'c1', toId: 'c0', stance: '信じ始めている' })
  })

  it('既存の関係性は stance を全文置換する', () => {
    const base = makeSessionState({
      relations: [{ fromId: 'c1', toId: 'c0', stance: '旧', aspects: [], updatedAt: 0 }],
    })
    const out = applyReviewToState(base, {
      relationUpdates: [rel({ stance: '新' })],
      moodChanges: [],
    })
    expect(out.relations).toHaveLength(1)
    expect(out.relations[0].stance).toBe('新')
  })

  it('stance が空なら既存の記述を消さない', () => {
    const base = makeSessionState({
      relations: [{ fromId: 'c1', toId: 'c0', stance: '旧', aspects: [], updatedAt: 0 }],
    })
    const out = applyReviewToState(base, {
      relationUpdates: [rel({ stance: '' })],
      moodChanges: [],
    })
    expect(out.relations[0].stance).toBe('旧')
  })

  it('aspects は次元ごとにマージする（省略された次元は保持）', () => {
    const base = makeSessionState({
      relations: [
        {
          fromId: 'c1',
          toId: 'c0',
          stance: '',
          aspects: [
            { aspectId: 'trust', note: '信頼あり' },
            { aspectId: 'love', note: '未分化' },
          ],
          updatedAt: 0,
        },
      ],
    })
    const out = applyReviewToState(base, {
      relationUpdates: [
        rel({ aspects: [{ aspectId: 'trust', name: '信頼', note: '揺らいだ' }] }),
      ],
      moodChanges: [],
    })
    expect(out.relations[0].aspects).toEqual([
      { aspectId: 'trust', note: '揺らいだ' },
      { aspectId: 'love', note: '未分化' },
    ])
  })

  it('未知の次元は末尾に足す', () => {
    const base = makeSessionState({
      relations: [{ fromId: 'c1', toId: 'c0', stance: '', aspects: [{ aspectId: 'trust', note: 'a' }], updatedAt: 0 }],
    })
    const out = applyReviewToState(base, {
      relationUpdates: [rel({ aspects: [{ aspectId: 'fear', name: '恐れ', note: 'b' }] })],
      moodChanges: [],
    })
    expect(out.relations[0].aspects.map((a) => a.aspectId)).toEqual(['trust', 'fear'])
  })

  it('気分は characterId 単位で upsert する', () => {
    const base = makeSessionState({ moods: [{ characterId: 'c1', mood: '不安' }] })
    const out = applyReviewToState(base, {
      relationUpdates: [],
      moodChanges: [
        { characterId: 'c1', name: '美咲', mood: '安堵' },
        { characterId: 'c2', name: '田中', mood: '苛立ち' },
      ],
    })
    expect(out.moods).toEqual([
      { characterId: 'c1', mood: '安堵' },
      { characterId: 'c2', mood: '苛立ち' },
    ])
  })

  it('元の state を書き換えない', () => {
    const base = makeSessionState({ moods: [{ characterId: 'c1', mood: '不安' }] })
    applyReviewToState(base, { relationUpdates: [], moodChanges: [{ characterId: 'c1', name: '美咲', mood: '安堵' }] })
    expect(base.moods[0].mood).toBe('不安')
  })
})

describe('lineTipOf', () => {
  it('最初の子を辿り続けて葉に着く', () => {
    const tree = makeTree([
      { id: 'a' },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
      { id: 'b2', parentId: 'a' },
    ])
    expect(lineTipOf(tree, 'a')).toBe('c')
  })

  it('葉そのものを渡せばそれ自身', () => {
    const tree = makeTree([{ id: 'a' }, { id: 'b', parentId: 'a' }])
    expect(lineTipOf(tree, 'b')).toBe('b')
  })

  it('「最初の子」は nodes 配列の順（表示レーンと一致させる）', () => {
    const tree = makeTree([
      { id: 'a' },
      { id: 'later', parentId: 'a', createdAt: 100 },
      { id: 'earlier', parentId: 'a', createdAt: 1 },
    ])
    expect(lineTipOf(tree, 'a')).toBe('later')
  })

  it('循環した壊れデータでも止まる', () => {
    const tree = makeTree([
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ])
    expect(typeof lineTipOf(tree, 'a')).toBe('string')
  })
})

describe('subtreeHasProtection', () => {
  it('自身が保護（しおり）なら真', () => {
    const tree = makeTree([{ id: 'a' }, { id: 'b', parentId: 'a', star: { name: 'ここ' } }])
    expect(subtreeHasProtection(tree, 'b')).toBe(true)
  })

  it('子孫の保護（⑂名前・エンディング）も拾う', () => {
    const named = makeTree([
      { id: 'a' },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b', branchName: '別ルート' },
    ])
    expect(subtreeHasProtection(named, 'a')).toBe(true)
    const ended = makeTree([
      { id: 'a' },
      { id: 'b', parentId: 'a', ending: '終わりの名前' },
    ])
    expect(subtreeHasProtection(ended, 'a')).toBe(true)
  })

  it('保護が無ければ偽', () => {
    const tree = makeTree([{ id: 'a' }, { id: 'b', parentId: 'a' }])
    expect(subtreeHasProtection(tree, 'a')).toBe(false)
  })
})

describe('deletableChainsBelow', () => {
  const tree = makeTree([
    { id: 'root' },
    { id: 'x1', parentId: 'root' },
    { id: 'x2', parentId: 'x1', kind: 'scene' },
    { id: 'y1', parentId: 'root', star: { name: 'しおり' } },
    { id: 'z1', parentId: 'root' },
  ])

  it('保護を含む枝は丸ごと温存する', () => {
    const { chains } = deletableChainsBelow(tree, 'root')
    expect(chains.map((c) => c.topId)).toEqual(['x1', 'z1'])
  })

  it('残す枝（keepChildId）は対象から外す', () => {
    const { chains } = deletableChainsBelow(tree, 'root', 'x1')
    expect(chains.map((c) => c.topId)).toEqual(['z1'])
  })

  it('scene ノードを含むなら crossesScene を立てる（3択に分岐する条件）', () => {
    expect(deletableChainsBelow(tree, 'root').crossesScene).toBe(true)
    expect(deletableChainsBelow(tree, 'root', 'x1').crossesScene).toBe(false)
  })

  it('枝ごと子孫の id をすべて列挙する', () => {
    const { chains } = deletableChainsBelow(tree, 'root', 'z1')
    expect(chains.find((c) => c.topId === 'x1')?.nodeIds.sort()).toEqual(['x1', 'x2'])
  })

  it('子が無ければ空', () => {
    expect(deletableChainsBelow(tree, 'z1')).toEqual({ chains: [], crossesScene: false })
  })
})

describe('rewindScenesFor', () => {
  const scenes = [makeScene({ id: 's1' }), makeScene({ id: 's2' }), makeScene({ id: 's3' })]

  it('シーン境界をまたいだ巻き戻しで置き去りのシーンを落とす', () => {
    const out = rewindScenesFor({ scenes, currentSceneId: 's3' }, [makeMessage({ sceneId: 's1' })])
    expect(out.scenes.map((s) => s.id)).toEqual(['s1'])
    expect(out.currentSceneId).toBe('s1')
  })

  it('現在シーン内の巻き戻しは何も動かさない', () => {
    const out = rewindScenesFor({ scenes, currentSceneId: 's3' }, [makeMessage({ sceneId: 's3' })])
    expect(out.scenes).toBe(scenes)
    expect(out.currentSceneId).toBe('s3')
  })

  it('sceneId を持たない旧データではシーンを動かさない', () => {
    const out = rewindScenesFor({ scenes, currentSceneId: 's3' }, [makeMessage({})])
    expect(out.scenes).toBe(scenes)
    expect(out.currentSceneId).toBe('s3')
  })

  it('kept が空でもシーンを動かさない', () => {
    const out = rewindScenesFor({ scenes, currentSceneId: 's2' }, [])
    expect(out.currentSceneId).toBe('s2')
  })

  it('消えたシーンを指していたら動かさない（保守側へ倒す）', () => {
    const out = rewindScenesFor({ scenes, currentSceneId: 's3' }, [makeMessage({ sceneId: 'gone' })])
    expect(out.scenes).toBe(scenes)
    expect(out.currentSceneId).toBe('s3')
  })

  it('末尾の sceneId を見る（途中に古いシーンの発言が混ざっても）', () => {
    const out = rewindScenesFor({ scenes, currentSceneId: 's3' }, [
      makeMessage({ id: 'm1', sceneId: 's1' }),
      makeMessage({ id: 'm2', sceneId: 's2' }),
    ])
    expect(out.scenes.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(out.currentSceneId).toBe('s2')
  })
})
