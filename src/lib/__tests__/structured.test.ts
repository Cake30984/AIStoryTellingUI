import { describe, expect, it } from 'vitest'
import { matchCharacterByName, parseStructured, plainTextOf } from '../structured'

const chars = [
  { id: 'c1', name: '美咲' },
  { id: 'c2', name: '田中一郎' },
]

describe('parseStructured', () => {
  it('@名前「セリフ」を dialogue として読み、参加キャラに解決する', () => {
    const [line] = parseStructured('@美咲「やった」', chars)
    expect(line).toEqual({
      kind: 'dialogue',
      name: '美咲',
      characterId: 'c1',
      text: '「やった」',
      raw: '@美咲「やった」',
    })
  })

  it('未解決の話者（モブ）は名前を保持したまま characterId なしで返す', () => {
    const [line] = parseStructured('@店員「いらっしゃいませ」', chars)
    expect(line).toMatchObject({ kind: 'dialogue', name: '店員', text: '「いらっしゃいませ」' })
    expect(line.kind === 'dialogue' && line.characterId).toBeUndefined()
  })

  it('@ で始まらない行は地の文', () => {
    expect(parseStructured('窓の外は雨だった。', chars)).toEqual([
      { kind: 'narration', text: '窓の外は雨だった。' },
    ])
  })

  it('@地の文 ラベルはラベルを剥がした地の文に落とす（fromTag）', () => {
    expect(parseStructured('@地の文「鐘が鳴った」', chars)).toEqual([
      { kind: 'narration', text: '「鐘が鳴った」', fromTag: true },
    ])
  })

  it('narration 予約語は大小文字を無視する', () => {
    expect(parseStructured('@Narrator「the bell rang」', chars)).toEqual([
      { kind: 'narration', text: '「the bell rang」', fromTag: true },
    ])
  })

  it('「 が無い行は名前が長くても地の文へ降格する', () => {
    const line = '@美咲は窓を開けた。風が入ってくる。'
    expect(parseStructured(line, chars)).toEqual([{ kind: 'narration', text: line }])
  })

  it('セリフ本文が無い @名前 だけの行は元の行のまま地の文へ降格する', () => {
    expect(parseStructured('@美咲', chars)).toEqual([{ kind: 'narration', text: '@美咲' }])
  })

  it('@ だけの行も地の文へ降格する', () => {
    expect(parseStructured('@', chars)).toEqual([{ kind: 'narration', text: '@' }])
  })

  it('空行は text 空の地の文として残す（段落区切りをレンダラが使う）', () => {
    const lines = parseStructured('一行目\n\n@美咲「二行目」', chars)
    expect(lines.map((l) => l.kind)).toEqual(['narration', 'narration', 'dialogue'])
    expect(lines[1]).toEqual({ kind: 'narration', text: '' })
  })
})

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

describe('plainTextOf', () => {
  it('@名前「セリフ」から @ を落とす', () => {
    expect(plainTextOf('@美咲「やった」')).toBe('美咲「やった」')
  })

  it('@地の文 ラベルは本文だけ残す', () => {
    expect(plainTextOf('@地の文「鐘が鳴った」')).toBe('「鐘が鳴った」')
  })

  it('通常の地の文は変わらない', () => {
    const text = '窓の外は雨だった。\n\n遠くで鐘が鳴る。'
    expect(plainTextOf(text)).toBe(text)
  })
})
