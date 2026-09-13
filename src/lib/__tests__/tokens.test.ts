import { describe, expect, it } from 'vitest'
import {
  countChars,
  lengthLevel,
  SCENE_WIND_DOWN_CHARS,
  SCENE_WRAP_UP_CHARS,
} from '../tokens'

describe('countChars', () => {
  it('空白（改行を含む）を数えない', () => {
    expect(countChars('あ い\nう\t え')).toBe(4)
  })

  it('空文字は 0', () => {
    expect(countChars('')).toBe(0)
  })

  it('サロゲートペアを1文字と数える（コードポイント基準）', () => {
    expect(countChars('𠮷野家')).toBe(3)
  })

  it('英数字も1文字ずつ数える', () => {
    expect(countChars('abc123')).toBe(6)
  })
})

describe('lengthLevel', () => {
  it('収束閾値の手前は low', () => {
    expect(lengthLevel(0)).toBe('low')
    expect(lengthLevel(SCENE_WIND_DOWN_CHARS - 1)).toBe('low')
  })

  it('収束閾値ちょうどで mid', () => {
    expect(lengthLevel(SCENE_WIND_DOWN_CHARS)).toBe('mid')
    expect(lengthLevel(SCENE_WRAP_UP_CHARS - 1)).toBe('mid')
  })

  it('締め閾値ちょうどで high', () => {
    expect(lengthLevel(SCENE_WRAP_UP_CHARS)).toBe('high')
    expect(lengthLevel(99999)).toBe('high')
  })
})
