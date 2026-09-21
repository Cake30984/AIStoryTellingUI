import { describe, expect, it } from 'vitest'
import {
  STARTER_CHARACTER_IDS,
  STARTER_WORLD_ID,
  starterCharacters,
  starterSessionSeed,
  starterWorld,
} from '..'

/**
 * 既定コンテンツ（P3）の配線を守る網。**文章の良し悪しは見ない**——
 * 「素材とセッションの参照が食い違っていないか」「開始状態のままか」だけを見る
 * （`docs/カセット作成ガイド_AI用.md` §2・§6 のチェックリストに対応）。
 */
describe('starter content', () => {
  const world = starterWorld()
  const characters = starterCharacters()
  const session = starterSessionSeed()

  it('セッションが実在する素材だけを参照する', () => {
    expect(session.worldId).toBe(STARTER_WORLD_ID)
    expect(world.id).toBe(STARTER_WORLD_ID)
    const ids = characters.map((c) => c.id)
    expect(ids).toEqual([...new Set(ids)])
    for (const id of session.characterIds) expect(ids).toContain(id)
  })

  it('中心人物が参加キャラに含まれ、先頭のキャラと一致する', () => {
    expect(session.focusCharacterId).toBe(STARTER_CHARACTER_IDS.focus)
    expect(session.characterIds).toContain(session.focusCharacterId)
    expect(characters[0].id).toBe(session.focusCharacterId)
  })

  it('導入文は書かれたまま掲載される形＝@ の残りや行頭の話者ラベルが無い', () => {
    // 置換タグは撤去済み（2026-09-21）。@ が残っていればそのまま画面に出てしまう
    expect(session.story.opening).not.toContain('@')
    // Web 小説の素の形＝行頭に @名前 のラベルを持つ行が無い（構造化出力の撤去）
    expect(session.story.opening.split('\n').some((line: string) => line.startsWith('@'))).toBe(false)
    // 名前に空白を含まない＝本文中の呼び名からの前方一致解決が効く形であること
    for (const c of characters) expect(c.name).not.toMatch(/\s/)
  })

  it('開始状態のまま（未プレイ）', () => {
    expect(session.messages).toEqual([])
    expect(session.scenes).toHaveLength(1)
    expect(session.currentSceneId).toBe(session.scenes[0].id)
    expect(session.state.relations).toEqual([])
    expect(session.state.moods).toEqual([])
    expect(session.state.recentDone).toEqual([])
    expect(session.overlay).toEqual({ lore: [], characterDevelopments: [] })
    expect(session.ending).toBeUndefined()
    expect(session.endingGoal).toBeUndefined()
    expect(session.originCassetteId).toBeUndefined()
    // モデル参照は投入時に刻む（配布物と同じく素の状態で持つ）
    expect(session.model).toBe('')
  })

  it('開始テンプレートとセッションの内容が一致する', () => {
    const p = world.startPreset!
    expect(session.story.genre).toBe(p.genre)
    expect(session.story.premise).toBe(p.premise)
    expect(session.story.opening).toBe(p.opening)
    expect(session.story.openingTitle).toBe(p.openingTitle)
    expect(session.story.initialDirective).toBe(p.initialDirective)
    expect(session.authorNote).toBe(p.authorNote)
    expect(session.newCharacterPolicy).toBe(p.newCharacterPolicy)
    expect(session.scenes[0].note).toBe(p.openingSceneNote)
    expect(session.state.now).toBe(p.startNow)
    expect(session.state.pending.map(({ when, what }) => ({ when, what }))).toEqual(p.initialPending)
  })

  it('ロアは5件以内で、キーワード注入に乗らない死に項目が無い', () => {
    expect(world.entries.length).toBeLessThanOrEqual(5)
    for (const e of world.entries) {
      expect(e.enabled).toBe(true)
      expect(e.addedInStory).toBeUndefined()
      // alwaysOn でないならキーワードが1語以上要る（どちらにも乗らない項目は永久に注入されない）
      if (!e.alwaysOn) expect(e.keys.length).toBeGreaterThan(0)
    }
  })

  it('関係性の次元が2つあり、レビューを拘束できる', () => {
    expect(world.relationAspects).toHaveLength(2)
    for (const a of world.relationAspects) {
      expect(a.name.trim()).not.toBe('')
      expect(a.guidance?.trim()).not.toBe('')
    }
  })

  it('素材の欄が埋まっていて、他の登場人物の名前が混ざっていない', () => {
    expect(characters).toHaveLength(3)
    const names = characters.map((c) => c.name)
    for (const c of characters) {
      for (const field of [c.name, c.persona, c.speechStyle, c.appearance, c.greeting]) {
        expect(field.trim()).not.toBe('')
      }
      // セリフ例は few-shot。行数で数える
      expect(c.exampleDialogues.split('\n').filter((l) => l.trim()).length).toBeGreaterThanOrEqual(5)
      expect(c.developments).toEqual([])
      expect(c.avatar.imageId).toBeUndefined()
      for (const other of names.filter((n) => n !== c.name)) {
        expect(`${c.persona}${c.speechStyle}${c.appearance}`).not.toContain(other)
      }
    }
  })

  it('予定は2件以上あり、基準日のない相対表現を使っていない', () => {
    expect(session.state.pending.length).toBeGreaterThanOrEqual(2)
    for (const slip of session.state.pending) {
      expect(slip.when.trim()).not.toBe('')
      expect(slip.what.trim()).not.toBe('')
      expect(slip.bornAt).toBe(0)
      expect(slip.when).not.toMatch(/^(来週|来月|[0-9一二三四五六七八九十]+日後)/)
    }
  })
})
