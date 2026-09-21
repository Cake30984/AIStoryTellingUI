import { describe, expect, it } from 'vitest'
import { findIntroTagRefs, resolveIntroText, validateCasting } from '../casting'
import { makeCharacter, makeSession } from './fixtures'

const tags = [
  { id: 't1', tag: '主人公' },
  { id: 't2', tag: '主人公の友人' },
]
const characters = [
  makeCharacter({ id: 'c1', name: '美咲' }),
  makeCharacter({ id: 'c2', name: '田中' }),
]
const bindings = [
  { tag: '主人公', characterId: 'c1' },
  { tag: '主人公の友人', characterId: 'c2' },
]

describe('findIntroTagRefs', () => {
  it('定義済みのタグだけを拾う（未定義の @文字列は通常文として無視）', () => {
    expect(findIntroTagRefs('@主人公 は @謎の人物 を見た', tags).sort()).toEqual(['主人公'])
  })

  it('全角 ＠ も拾う', () => {
    expect(findIntroTagRefs('＠主人公 が立っている', tags)).toEqual(['主人公'])
  })

  it('タグ定義が無ければ空', () => {
    expect(findIntroTagRefs('@主人公', [])).toEqual([])
  })
})

describe('resolveIntroText', () => {
  it('束縛済みのタグを実名へ置き換える', () => {
    const out = resolveIntroText('@主人公 は歩き出した。', { tags, bindings, characters })
    expect(out).toEqual({ content: '美咲 は歩き出した。', issues: [] })
  })

  it('長い名前を先に当てる（前方一致事故を防ぐ）', () => {
    const out = resolveIntroText('@主人公の友人 が @主人公 を呼んだ。', { tags, bindings, characters })
    expect(out.content).toBe('田中 が 美咲 を呼んだ。')
  })

  it('束縛が無いタグは置換せず unbound-tag を返す', () => {
    const out = resolveIntroText('@主人公 は歩き出した。', { tags, bindings: [], characters })
    expect(out.content).toBe('@主人公 は歩き出した。')
    expect(out.issues).toEqual([{ kind: 'unbound-tag', tag: '主人公' }])
  })

  it('束縛先のキャラが居なければ unresolved-tag-binding を返す', () => {
    const out = resolveIntroText('@主人公 は歩き出した。', {
      tags,
      bindings: [{ tag: '主人公', characterId: 'missing' }],
      characters,
    })
    expect(out.issues).toEqual([{ kind: 'unresolved-tag-binding', tag: '主人公' }])
  })

  it('タグを1つも使っていない本文はそのまま返す', () => {
    const out = resolveIntroText('雨が降っていた。', { tags, bindings, characters })
    expect(out).toEqual({ content: '雨が降っていた。', issues: [] })
  })

  it('置換で生まれた実名を再処理しない（単一パス）', () => {
    const out = resolveIntroText('@主人公', {
      tags: [{ id: 't1', tag: '主人公' }, { id: 't2', tag: '美咲' }],
      bindings: [
        { tag: '主人公', characterId: 'c1' },
        { tag: '美咲', characterId: 'c2' },
      ],
      characters,
    })
    expect(out.content).toBe('美咲')
  })
})

describe('validateCasting', () => {
  const session = makeSession({
    characterIds: ['c1'],
    story: { premise: '', genre: '', opening: '@主人公 と @主人公の友人 が出会う。', openingTitle: '' , introTags: tags },
    introBindings: bindings,
  })

  it('参加していないキャラへの束縛は未解決として報告する', () => {
    // c2（田中）は characterIds に居ない＝開始できない
    expect(validateCasting(session, characters)).toEqual([
      { kind: 'unresolved-tag-binding', tag: '主人公の友人' },
    ])
  })

  it('参加キャラで全タグが埋まっていれば問題なし', () => {
    const ok = { ...session, characterIds: ['c1', 'c2'] }
    expect(validateCasting(ok, characters)).toEqual([])
  })

  it('束縛そのものが無ければ unbound-tag', () => {
    const none = { ...session, characterIds: ['c1', 'c2'], introBindings: [] }
    expect(validateCasting(none, characters).map((i) => i.kind)).toEqual(['unbound-tag', 'unbound-tag'])
  })
})
