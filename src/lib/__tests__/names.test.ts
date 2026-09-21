import { describe, expect, it } from 'vitest'
import { matchCharacterByName } from '../names'

const chars = [
  { id: 'c1', name: '美咲' },
  { id: 'c2', name: '田中一郎' },
]

describe('matchCharacterByName', () => {
  it('完全一致を返す', () => {
    expect(matchCharacterByName('美咲', chars)).toBe('c1')
  })

  it('完全一致を前方一致より優先する', () => {
    const list = [
      { id: 'long', name: '田中一郎' },
      { id: 'short', name: '田中' },
    ]
    expect(matchCharacterByName('田中', list)).toBe('short')
  })

  it('双方向の前方一致で拾う（モデルが姓だけ・フルネームで書く揺れ）', () => {
    expect(matchCharacterByName('田中', chars)).toBe('c2')
    expect(matchCharacterByName('田中一郎（教師）', chars)).toBe('c2')
  })

  it('一致しなければ undefined', () => {
    expect(matchCharacterByName('佐藤', chars)).toBeUndefined()
  })

  it('名前が空のキャラには前方一致しない', () => {
    expect(matchCharacterByName('誰か', [{ id: 'x', name: '' }])).toBeUndefined()
  })
})
