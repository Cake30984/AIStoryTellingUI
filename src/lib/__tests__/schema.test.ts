import { describe, expect, it } from 'vitest'
import {
  APP_STATE_VERSION,
  CASSETTE_DATA_VERSION,
  flattenSpeakerTags,
  migrateAppState,
  migrateSession,
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
        structuredOutput: true,
        story: {
          opening: '　鐘が鳴った。\n@主人公「……ただいま」\n@店主「いらっしゃい」',
          introTags: [{ tag: '主人公' }],
        },
        messages: [
          { id: 'm1', role: 'assistant', content: '　風が吹く。\n@美咲「やった」\n@地の文「遠くで鐘が鳴る」' },
          { id: 'm2', role: 'user', content: '続けて' },
        ],
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
          structuredOutput: true,
          story: { opening: '@主人公「ただいま」\n@マスター「いらっしゃい」', introTags: [{ tag: '主人公' }] },
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

  it('v5→v6: structuredOutput を落とし、本文の @名前「」を剥がす（置換タグの @ は残す）', () => {
    const sess = state.sessions[0]
    expect('structuredOutput' in sess).toBe(false)
    expect(sess.messages[0].content).toBe('　風が吹く。\n美咲「やった」\n「遠くで鐘が鳴る」')
    expect(sess.messages[1].content).toBe('続けて')
    expect(sess.story.opening).toBe('　鐘が鳴った。\n@主人公「……ただいま」\n店主「いらっしゃい」')
  })

  it('カセットが内包するセッションにも同じ変換が掛かる', () => {
    const cas = state.cassettes[0].session
    expect('timeline' in cas).toBe(false)
    expect('personaId' in cas).toBe(false)
    expect('choiceMode' in cas).toBe(false)
    expect(cas.focusCharacterId).toBe('')
    expect(cas.state.relations).toEqual([])
    expect('ambientPins' in cas.scenes[0]).toBe(false)
    expect('structuredOutput' in cas).toBe(false)
    expect(cas.story.opening).toBe('@主人公「ただいま」\nマスター「いらっしゃい」')
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

describe('migrateSession（P2c: SessionStore の1レコード＝1版番）', () => {
  it('セッション1件が最古の版から最新まで上がる', () => {
    const out = migrateSession(legacySave().sessions[0], 1)
    expect(out.ok).toBe(true)
    const sess = out.ok ? out.state : null
    expect('timeline' in sess).toBe(false)
    expect('personaId' in sess).toBe(false)
    expect('choiceMode' in sess).toBe(false)
    expect(sess.focusCharacterId).toBe('')
    expect(sess.state.now).toBe('8月31日 朝')
    expect(sess.scenes.every((sc: any) => !('ambientPins' in sc))).toBe(true)
  })

  it('1件ずつ上げた結果は、全体（migrateSubSchemas）経由と同じになる', () => {
    const viaState = migrateSubSchemas(legacySave())
    const viaRecord = migrateSession(legacySave().sessions[0], 1)
    expect(viaRecord.ok && viaState.ok && viaRecord.state).toEqual(viaState.ok && viaState.state.sessions[0])
  })

  it('どの版から上げても、全体（migrateSubSchemas）の段と1対1で対応する', () => {
    // saveDataMigrations は sessionMigrations から導出している。段の書き写し忘れをここで止める
    for (let from = 1; from < SAVE_DATA_VERSION; from++) {
      const whole = migrateSubSchemas({
        schemaVersions: { save: from, cassette: CASSETTE_DATA_VERSION },
        sessions: [legacySave().sessions[0]],
        cassettes: [],
      })
      const one = migrateSession(legacySave().sessions[0], from)
      expect(one.ok, `v${from} の段が欠けている`).toBe(true)
      expect(one.ok && one.state).toEqual(whole.ok && whole.state.sessions[0])
    }
  })

  it('現行版のレコードは素通し（同一参照）＝二重適用しない', () => {
    const sess = { id: 'a', scenes: [] }
    const out = migrateSession(sess, SAVE_DATA_VERSION)
    expect(out.ok && out.state).toBe(sess)
  })

  it('未来の版番のレコードは黙って読まずに失敗させる', () => {
    expect(migrateSession({ id: 'a' }, 99)).toEqual({
      ok: false,
      error: { scope: 'save', found: 99, supported: SAVE_DATA_VERSION },
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

  it('v3→v4 で世界観の開始設定の導入文から @名前「」を剥がす（置換タグは残す・opening が無い世界は触らない）', () => {
    const out = migrateAppState(
      {
        worlds: [
          { id: 'w1', startPreset: { opening: '@主人公「ただいま」\n@店主「いらっしゃい」', introTags: [{ tag: '主人公' }] } },
          { id: 'w2' },
        ],
      },
      3,
    )
    expect(out.ok && out.state.worlds[0].startPreset.opening).toBe('@主人公「ただいま」\n店主「いらっしゃい」')
    expect(out.ok && out.state.worlds[1]).toEqual({ id: 'w2' })
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

describe('flattenSpeakerTags（構造化出力の撤去）', () => {
  it('@名前「セリフ」から @ を落とす', () => {
    expect(flattenSpeakerTags('@美咲「やった」')).toBe('美咲「やった」')
  })

  it('@地の文 ラベルは本文だけ残す（大小文字を無視）', () => {
    expect(flattenSpeakerTags('@地の文「鐘が鳴った」')).toBe('「鐘が鳴った」')
    expect(flattenSpeakerTags('@Narrator「the bell rang」')).toBe('「the bell rang」')
  })

  it('通常の地の文・「 の無い @ 行・@ だけの行は変わらない', () => {
    const text = '窓の外は雨だった。\n\n遠くで鐘が鳴る。\n@美咲は窓を開けた。\n@'
    expect(flattenSpeakerTags(text)).toBe(text)
  })

  it('keepTags にある名前（置換タグ）の行は残す', () => {
    expect(flattenSpeakerTags('@主人公「ただいま」\n@美咲「おかえり」', new Set(['主人公']))).toBe(
      '@主人公「ただいま」\n美咲「おかえり」',
    )
  })
})
