import { describe, expect, it } from 'vitest'
import { extractJson, partialString } from '../json'

describe('extractJson', () => {
  it('素の JSON を読む', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('コードフェンスの中身を優先して読む', () => {
    expect(extractJson('はい。\n```json\n{"a":1}\n```\nどうぞ。')).toEqual({ a: 1 })
  })

  it('前後に地の文があっても最初のオブジェクトを抜き出す', () => {
    expect(extractJson('了解しました。{"title":"夕暮れ"} 以上です。')).toEqual({ title: '夕暮れ' })
  })

  it('配列も読む', () => {
    expect(extractJson('["a","b"]')).toEqual(['a', 'b'])
  })

  it('文字列中の生の改行を修復する（モデル頻出の崩れ）', () => {
    expect(extractJson('{"summary":"一行目\n二行目"}')).toEqual({ summary: '一行目\n二行目' })
  })

  it('末尾カンマを取り除く', () => {
    expect(extractJson('{"a":1,"b":[1,2,],}')).toEqual({ a: 1, b: [1, 2] })
  })

  it('文字列の中の } に釣られない', () => {
    expect(extractJson('{"a":"閉じ括弧 } を含む","b":2}')).toEqual({ a: '閉じ括弧 } を含む', b: 2 })
  })

  it('途中で切れた JSON は誤魔化さず null', () => {
    expect(extractJson('{"a":1,"b":')).toBeNull()
  })

  it('空文字は null', () => {
    expect(extractJson('')).toBeNull()
  })
})

describe('partialString', () => {
  it('ストリーミング途中（閉じ引用符が未到達）でも読めるところまで返す', () => {
    expect(partialString('{"text":"こんにち', 'text')).toBe('こんにち')
  })

  it('閉じた文字列はそのまま返す', () => {
    expect(partialString('{"text":"完了"}', 'text')).toBe('完了')
  })

  it('エスケープを解く', () => {
    expect(partialString('{"text":"一行目\\n二行目\\"引用\\""}', 'text')).toBe('一行目\n二行目"引用"')
  })

  it('\\uXXXX を解く', () => {
    expect(partialString('{"text":"\\u3042"}', 'text')).toBe('あ')
  })

  it('キーが未到達なら undefined', () => {
    expect(partialString('{"other":1', 'text')).toBeUndefined()
  })

  it('値がまだ来ていなければ undefined', () => {
    expect(partialString('{"text":', 'text')).toBeUndefined()
  })

  it('文字列以外の値は対象外', () => {
    expect(partialString('{"text":[1,2]}', 'text')).toBeUndefined()
  })

  it('エスケープの途中でバッファが尽きたらそこまでを返す', () => {
    expect(partialString('{"text":"あ\\', 'text')).toBe('あ')
  })
})
