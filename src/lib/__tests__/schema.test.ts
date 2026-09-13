import { describe, expect, it } from 'vitest'
import {
  APP_STATE_VERSION,
  CASSETTE_DATA_VERSION,
  migrateAppState,
  migrateSubSchemas,
  SAVE_DATA_VERSION,
  schemaErrorMessage,
} from '../schema'

/** 各版の特徴をすべて備えた最古のセーブデータ（v1 相当） */
function legacySave() {
  return {
    schemaVersions: { save: 1, cassette: 1 },
    sessions: [
      {
        id: 'sess1',
        personaId: 'hero',
        choiceMode: 'always',
        currentSceneId: 's2',
        introBindings: [
          { tag: '主人公', characterId: 'c1', kind: 'character' },
          { tag: '壊れ', characterId: null },
        ],
        timeline: { day: 3 },
        scenes: [
          { id: 's1', ambientPins: [{ id: 'p1' }] },
          { id: 's2', timeLabel: '8月31日 朝', ambientPins: [] },
        ],
        state: {
          relations: [
            { fromId: 'c1', toId: 'hero', stance: '旧' },
            { fromId: 'c1', toId: 'c2', stance: '残る' },
          ],
          moods: [{ characterId: 'c1', mood: '不安' }],
        },
      },
    ],
    cassettes: [
      {
        id: 'cas1',
        session: {
          personaId: 'hero',
          choiceMode: 'always',
          timeline: { day: 1 },
          introBindings: [{ tag: '主人公', characterId: 'c1', kind: 'character' }],
          scenes: [{ id: 's1', ambientPins: [{ id: 'p1' }] }],
          state: { relations: [{ fromId: 'c1', toId: 'hero', stance: '旧' }], moods: [] },
        },
      },
    ],
  }
}

describe('migrateSubSchemas', () => {
  const result = migrateSubSchemas(legacySave())
  const state = result.ok ? result.state : null

  it('最古の版から最新まで一気通貫で上がる', () => {
    expect(result.ok).toBe(true)
  })

  it('v1→v2: timeline を落とし SessionState を立てる（timeLabel だけ now へ写す）', () => {
    const sess = state.sessions[0]
    expect('timeline' in sess).toBe(false)
    expect(sess.state.now).toBe('8月31日 朝')
    expect(sess.state.place).toBe('')
    expect(sess.state.pending).toEqual([])
  })

  it('v2→v3: personaId を落とし focusCharacterId を未選択で足す', () => {
    const sess = state.sessions[0]
    expect('personaId' in sess).toBe(false)
    expect(sess.focusCharacterId).toBe('')
  })

  it('v2→v3: 宛先を失った関係性（toId=hero）だけ捨てる', () => {
    expect(state.sessions[0].state.relations).toEqual([{ fromId: 'c1', toId: 'c2', stance: '残る' }])
  })

  it('v2→v3: introBindings は kind を落とし、不正な行を読み捨てる', () => {
    expect(state.sessions[0].introBindings).toEqual([{ tag: '主人公', characterId: 'c1' }])
  })

  it('v3→v4: choiceMode を落とす', () => {
    expect('choiceMode' in state.sessions[0]).toBe(false)
  })

  it('v4→v5: 全シーンから ambientPins を落とす', () => {
    expect(state.sessions[0].scenes.every((sc: any) => !('ambientPins' in sc))).toBe(true)
  })

  it('カセットが内包するセッションにも同じ変換が掛かる', () => {
    const cas = state.cassettes[0].session
    expect('timeline' in cas).toBe(false)
    expect('personaId' in cas).toBe(false)
    expect('choiceMode' in cas).toBe(false)
    expect(cas.focusCharacterId).toBe('')
    expect(cas.state.relations).toEqual([])
    expect('ambientPins' in cas.scenes[0]).toBe(false)
  })

  it('版番が無いデータは現行版とみなして素通しする', () => {
    const out = migrateSubSchemas({ sessions: [{ id: 'a', personaId: 'hero' }] })
    expect(out.ok).toBe(true)
    // 移行が走っていない＝ personaId が残ったまま
    expect(out.ok && out.state.sessions[0].personaId).toBe('hero')
  })

  it('未来の版番は黙って読まずに失敗させる（既定値で潰さない）', () => {
    const out = migrateSubSchemas({ schemaVersions: { save: 99, cassette: CASSETTE_DATA_VERSION } })
    expect(out).toEqual({ ok: false, error: { scope: 'save', found: 99, supported: SAVE_DATA_VERSION } })
  })

  it('カセットだけ未来の版番でも失敗させる', () => {
    const out = migrateSubSchemas({ schemaVersions: { save: SAVE_DATA_VERSION, cassette: 99 } })
    expect(out).toEqual({
      ok: false,
      error: { scope: 'cassette', found: 99, supported: CASSETTE_DATA_VERSION },
    })
  })
})

describe('migrateAppState', () => {
  it('版番を持たない時代（0）から現行版まで上がる', () => {
    const out = migrateAppState({ ui: {}, personas: [{ id: 'p' }] }, 0)
    expect(out.ok).toBe(true)
    expect(out.ok && 'personas' in out.state).toBe(false)
  })

  it('v1→v2 で personas を落とす', () => {
    const out = migrateAppState({ personas: [{ id: 'p' }], providers: [] }, 1)
    expect(out.ok && out.state).toEqual({ providers: [] })
  })

  it('現行版なら何もしない', () => {
    const state = { providers: [] }
    const out = migrateAppState(state, APP_STATE_VERSION)
    expect(out.ok && out.state).toBe(state)
  })

  it('未来の版番は失敗', () => {
    expect(migrateAppState({}, 99)).toEqual({
      ok: false,
      error: { scope: 'app', found: 99, supported: APP_STATE_VERSION },
    })
  })
})

describe('schemaErrorMessage', () => {
  it('新しすぎるデータは「新しいバージョン」と説明する', () => {
    const msg = schemaErrorMessage({ scope: 'save', found: 9, supported: 5 })
    expect(msg).toContain('セーブデータ')
    expect(msg).toContain('新しいバージョン')
  })

  it('移行の欠落は「移行できませんでした」と説明する', () => {
    expect(schemaErrorMessage({ scope: 'cassette', found: 2, supported: 5 })).toContain('移行できませんでした')
  })
})
