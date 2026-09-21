import { describe, expect, it } from 'vitest'
import {
  buildMessages,
  buildSystemPrompt,
  CONTINUE_PROMPT,
  DIRECTIVE_HEADER,
  isStoryText,
  selectRawScenes,
} from '../prompts'
import { RAW_WINDOW_BRIDGE_TOKENS } from '../tokens'
import { makeCharacter, makeLore, makeMessage, makeRefs, makeScene, makeSession, makeWorld } from './fixtures'

/** n トークン相当の日本語本文（CJK は 1 文字＝約 1 トークン） */
const body = (n: number) => 'あ'.repeat(n)

describe('buildSystemPrompt', () => {
  const world = makeWorld({
    name: '学園',
    description: '海辺の町の高校。',
    entries: [
      makeLore({ id: 'a', alwaysOn: true, content: '町には古い灯台がある。' }),
      makeLore({ id: 'k', keys: ['旧校舎'], content: '旧校舎は封鎖されている。' }),
    ],
  })
  const focus = makeCharacter({ id: 'c1', name: '美咲', persona: '物静か' })
  const session = makeSession({
    worldId: 'w1',
    characterIds: ['c1'],
    focusCharacterId: 'c1',
    authorNote: '雨の描写を多めに',
    messages: [makeMessage({ content: '二人は旧校舎へ向かった。' })],
  })
  const refs = makeRefs({
    characters: [focus],
    world,
    focus,
    priorSummaries: [{ title: '第1章', summary: '出会い' }],
    sceneNote: '放課後の教室',
    timelineInfo: '8月31日 朝',
    stateInfo: '美咲→主人公: 信頼している',
  })

  it('同一入力なら byte 一致する（プロンプトキャッシュの前提）', () => {
    expect(buildSystemPrompt(session, refs)).toBe(buildSystemPrompt(session, refs))
  })

  it('常時ロアは system に入る', () => {
    expect(buildSystemPrompt(session, refs)).toContain('町には古い灯台がある。')
  })

  it('キーワード一致ロアは system に入れない（1項目の出入りで system 全体が無効になるため）', () => {
    expect(buildSystemPrompt(session, refs)).not.toContain('旧校舎は封鎖されている。')
  })

  it('作者ノートは system に入れない（深さ3へ移した）', () => {
    expect(buildSystemPrompt(session, refs)).not.toContain('雨の描写を多めに')
  })

  it('あらすじ・現在の場面・時間・状態を見出し付きで載せる', () => {
    const out = buildSystemPrompt(session, refs)
    expect(out).toContain('【これまでのあらすじ】')
    expect(out).toContain('【現在の場面】\n放課後の教室')
    expect(out).toContain('【時間】')
    expect(out).toContain('【状態（現在）】')
  })

  it('直近の会話が変わっても system は変わらない（キャッシュを壊さない）', () => {
    const moved = { ...session, messages: [makeMessage({ id: 'm2', content: '二人は港へ向かった。' })] }
    expect(buildSystemPrompt(moved, refs)).toBe(buildSystemPrompt(session, refs))
  })

  it('新しい登場人物の方針は avoid/allow で文面が変わる', () => {
    const avoid = buildSystemPrompt({ ...session, newCharacterPolicy: 'avoid' }, refs)
    expect(avoid).toContain('新たに登場させないでください')
    expect(buildSystemPrompt(session, refs)).toContain('新しく登場させて構いません')
  })

  it('本文の形式は Web 小説の素の形（行頭の話者ラベルを求めない・@名前 の形式指示を含まない）', () => {
    const out = buildSystemPrompt(session, refs)
    expect(out).toContain('行頭に話者名や記号のラベルを付けないでください')
    expect(out).not.toContain('@名前')
    expect(out).not.toContain('セリフの出力形式')
  })
})

describe('buildMessages', () => {
  const scene = makeScene({ id: 's1' })
  const hist = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      makeMessage({ id: `m${i}`, role: i % 2 === 0 ? 'user' : 'assistant', sceneId: 's1', content: `本文${i}` }),
    )
  const refs = makeRefs({ currentSceneId: 's1' })

  it('system が先頭・深さ0が末尾に来る', () => {
    const session = makeSession({ scenes: [scene], currentSceneId: 's1', messages: hist(2) })
    const out = buildMessages(session, refs)
    expect(out[0].role).toBe('system')
    expect(out[out.length - 1].role).toBe('user')
    expect(out[out.length - 1].content).toContain('（地の文とセリフ「」を織り交ぜて')
  })

  it('深さ3の1通は末尾から3件手前に入る', () => {
    const session = makeSession({
      scenes: [scene],
      currentSceneId: 's1',
      authorNote: '雨の描写を多めに',
      messages: hist(5),
    })
    const out = buildMessages(session, refs)
    // [system, 本文0, 本文1, 深さ3, 本文2, 本文3, 本文4, 深さ0]
    expect(out).toHaveLength(8)
    expect(out[3].content).toContain('【常に踏まえる重要事項】\n雨の描写を多めに')
    expect(out[4].content).toBe('本文2')
  })

  it('履歴が3件未満なら深さ3は system 直後へクランプされる', () => {
    const session = makeSession({
      scenes: [scene],
      currentSceneId: 's1',
      authorNote: '雨の描写を多めに',
      messages: hist(2),
    })
    const out = buildMessages(session, refs)
    expect(out[1].content).toContain('【常に踏まえる重要事項】')
    expect(out[2].content).toBe('本文0')
  })

  it('深さ3に入れるものが無ければ1通も差し込まない', () => {
    const session = makeSession({ scenes: [scene], currentSceneId: 's1', messages: hist(5) })
    expect(buildMessages(session, refs)).toHaveLength(7)
  })

  it('書き手への指示は固定枠を付けた user として送る', () => {
    const session = makeSession({
      scenes: [scene],
      currentSceneId: 's1',
      messages: [makeMessage({ role: 'user', kind: 'directive', sceneId: 's1', content: 'もっと暗く' })],
    })
    const out = buildMessages(session, refs)
    expect(out[1]).toEqual({ role: 'user', content: `${DIRECTIVE_HEADER}\nもっと暗く` })
  })

  it('空メッセージ（生成中の pending）は送らない', () => {
    const session = makeSession({
      scenes: [scene],
      currentSceneId: 's1',
      messages: [...hist(1), makeMessage({ id: 'p', sceneId: 's1', content: '', pending: true })],
    })
    expect(buildMessages(session, refs).map((m) => m.content)).not.toContain('')
  })

  it('窓が未確定なら現在シーンの発言だけを載せる', () => {
    const session = makeSession({
      scenes: [makeScene({ id: 's0' }), scene],
      currentSceneId: 's1',
      messages: [makeMessage({ id: 'old', sceneId: 's0', content: '前のシーン' }), ...hist(1)],
    })
    expect(buildMessages(session, refs).map((m) => m.content)).not.toContain('前のシーン')
  })

  it('窓が確定していれば過去シーンの原文も載せ、1つ手前のシーンは末尾だけ橋として足す', () => {
    const session = makeSession({
      scenes: [makeScene({ id: 's0' }), makeScene({ id: 's1' }), makeScene({ id: 's2' })],
      currentSceneId: 's2',
      rawWindowFromSceneId: 's1',
      messages: [
        makeMessage({ id: 'b', sceneId: 's0', content: '橋になる本文' }),
        makeMessage({ id: 'w', sceneId: 's1', content: '窓の中' }),
        makeMessage({ id: 'c', sceneId: 's2', content: '現在' }),
      ],
    })
    const contents = buildMessages(session, makeRefs({ currentSceneId: 's2' })).map((m) => m.content)
    expect(contents).toContain('橋になる本文')
    expect(contents.indexOf('橋になる本文')).toBeLessThan(contents.indexOf('窓の中'))
  })
})

describe('isStoryText', () => {
  it('通常の本文は真', () => {
    expect(isStoryText({ role: 'assistant', content: '雨が降っていた。' })).toBe(true)
  })

  it('書き手への指示は偽（分量を水増ししない）', () => {
    expect(isStoryText({ role: 'user', kind: 'directive', content: 'もっと暗く' })).toBe(false)
  })

  it('進行マーカーは偽', () => {
    expect(isStoryText({ role: 'user', content: CONTINUE_PROMPT })).toBe(false)
  })

  it('system は偽', () => {
    expect(isStoryText({ role: 'system', content: '何か' })).toBe(false)
  })
})

describe('selectRawScenes', () => {
  const scenesOf = (ids: string[]) => ids.map((id) => makeScene({ id }))
  const msgsOf = (spec: [string, number][]) =>
    spec.map(([sceneId, tokens], i) => makeMessage({ id: `m${i}`, sceneId, content: body(tokens) }))

  it('前回の窓が無ければ予算いっぱいまで古い方へ広げる', () => {
    const out = selectRawScenes(
      scenesOf(['s1', 's2', 's3']),
      msgsOf([['s1', 100], ['s2', 100], ['s3', 100]]),
      's3',
      1000,
    )
    expect(out.fromSceneId).toBe('s1')
    expect(out.bridgeTail).toBeUndefined()
  })

  it('予算に収まらない古いシーンは含めず、直前シーンを橋にする', () => {
    const out = selectRawScenes(
      scenesOf(['s1', 's2', 's3']),
      msgsOf([['s1', 100], ['s2', 100], ['s3', 100]]),
      's3',
      250,
    )
    expect(out.fromSceneId).toBe('s2')
    expect(out.bridgeTail).toEqual({ sceneId: 's1', tokens: RAW_WINDOW_BRIDGE_TOKENS })
  })

  it('前回の窓があれば古い方へは戻さない（畳んだものを拾い直さない）', () => {
    const out = selectRawScenes(
      scenesOf(['s1', 's2', 's3']),
      msgsOf([['s1', 100], ['s2', 100], ['s3', 100]]),
      's3',
      1000,
      's3',
    )
    expect(out.fromSceneId).toBe('s3')
    expect(out.bridgeTail).toEqual({ sceneId: 's2', tokens: RAW_WINDOW_BRIDGE_TOKENS })
  })

  it('超過したら予算の 60% に収まるまでまとめて落とす（毎シーン1つずつ滑らせない）', () => {
    const out = selectRawScenes(
      scenesOf(['s1', 's2', 's3', 's4']),
      msgsOf([['s1', 100], ['s2', 100], ['s3', 100], ['s4', 100]]),
      's4',
      250,
      's1',
    )
    // 400 > 250 → room=150 になるまで古い方から落とす
    expect(out.fromSceneId).toBe('s4')
  })

  it('本文が無いシーンが直前でも橋にはしない', () => {
    const out = selectRawScenes(
      scenesOf(['s1', 's2']),
      msgsOf([['s2', 100]]),
      's2',
      50,
      's2',
    )
    expect(out.fromSceneId).toBe('s2')
    expect(out.bridgeTail).toBeUndefined()
  })

  it('現在シーンが見つからなければ最後のシーンを起点にする', () => {
    const out = selectRawScenes(scenesOf(['s1', 's2']), msgsOf([['s2', 10]]), 'missing', 1000)
    expect(out.fromSceneId).toBe('s1')
  })

  it('シーンが1つも無ければ現在シーン id をそのまま返す', () => {
    expect(selectRawScenes([], [], 'x', 1000)).toEqual({ fromSceneId: 'x' })
    expect(selectRawScenes([], [], null, 1000)).toEqual({ fromSceneId: '' })
  })
})
