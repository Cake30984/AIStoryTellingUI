import { describe, expect, it } from 'vitest'
import { splitLoreEntries } from '../lorebook'
import { makeLore, makeMessage, makeWorld } from './fixtures'

const msg = (content: string) => makeMessage({ content })

describe('splitLoreEntries', () => {
  it('alwaysOn は会話の内容によらず always 側へ入る', () => {
    const world = makeWorld({ entries: [makeLore({ id: 'a', alwaysOn: true, content: '常時' })] })
    const { always, matched } = splitLoreEntries(world, [])
    expect(always.map((e) => e.id)).toEqual(['a'])
    expect(matched).toEqual([])
  })

  it('キーワード一致は matched 側だけに入る（system を汚さない）', () => {
    const world = makeWorld({
      entries: [makeLore({ id: 'k', keys: ['旧校舎'], content: '旧校舎の設定' })],
    })
    const { always, matched } = splitLoreEntries(world, [msg('二人は旧校舎へ向かった。')])
    expect(always).toEqual([])
    expect(matched.map((e) => e.id)).toEqual(['k'])
  })

  it('キーワードの大小文字を無視する', () => {
    const world = makeWorld({ entries: [makeLore({ id: 'k', keys: ['Kraken'] })] })
    expect(splitLoreEntries(world, [msg('the kraken appeared')]).matched.map((e) => e.id)).toEqual(['k'])
  })

  it('直近6件より古いメッセージの語には当たらない', () => {
    const world = makeWorld({ entries: [makeLore({ id: 'k', keys: ['旧校舎'] })] })
    const messages = [msg('旧校舎の話'), ...Array.from({ length: 6 }, (_, i) => msg(`雑談${i}`))]
    expect(splitLoreEntries(world, messages).matched).toEqual([])
    // ちょうど6件目（窓の内側）なら当たる
    expect(splitLoreEntries(world, messages.slice(0, 6)).matched.map((e) => e.id)).toEqual(['k'])
  })

  it('enabled でない項目は alwaysOn でも出さない', () => {
    const world = makeWorld({
      entries: [
        makeLore({ id: 'a', alwaysOn: true, enabled: false }),
        makeLore({ id: 'k', keys: ['旧校舎'], enabled: false }),
      ],
    })
    const { always, matched } = splitLoreEntries(world, [msg('旧校舎へ')])
    expect(always).toEqual([])
    expect(matched).toEqual([])
  })

  it('空のキーワードでは一致しない（全文一致の暴発を防ぐ）', () => {
    const world = makeWorld({ entries: [makeLore({ id: 'k', keys: ['', '   '] })] })
    expect(splitLoreEntries(world, [msg('何か')]).matched).toEqual([])
  })

  it('order 昇順を両方で保つ', () => {
    const world = makeWorld({
      entries: [
        makeLore({ id: 'a2', alwaysOn: true, order: 2 }),
        makeLore({ id: 'k2', keys: ['鍵'], order: 3 }),
        makeLore({ id: 'a1', alwaysOn: true, order: 1 }),
        makeLore({ id: 'k1', keys: ['鍵'], order: 0 }),
      ],
    })
    const { always, matched } = splitLoreEntries(world, [msg('鍵を拾った')])
    expect(always.map((e) => e.id)).toEqual(['a1', 'a2'])
    expect(matched.map((e) => e.id)).toEqual(['k1', 'k2'])
  })

  it('世界が無ければ両方空', () => {
    expect(splitLoreEntries(undefined, [msg('何か')])).toEqual({ always: [], matched: [] })
  })
})
