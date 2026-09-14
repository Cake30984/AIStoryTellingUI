import { describe, expect, it } from 'vitest'
import { formatSessionUsage } from '../cost'

/** セッション累計の表示（P3）。**円換算しない・0 を額として出さない**の2点を守る網 */
describe('formatSessionUsage', () => {
  it('使っていなければ null（バッジごと出さない）', () => {
    expect(formatSessionUsage(undefined)).toBeNull()
    expect(formatSessionUsage({ promptTokens: 0, completionTokens: 0 })).toBeNull()
    expect(formatSessionUsage({ promptTokens: 0, completionTokens: 0, cost: 0 })).toBeNull()
  })

  it('入力と出力を足したトークン数を出す', () => {
    expect(formatSessionUsage({ promptTokens: 1200, completionTokens: 340 })).toBe('1,540 tokens')
  })

  it('コストが返らない接続先では額を出さない（0 と書かない）', () => {
    expect(formatSessionUsage({ promptTokens: 10, completionTokens: 0, cost: 0 })).toBe('10 tokens')
  })

  it('コストが返る接続先では USD のまま添える（円換算しない）', () => {
    const line = formatSessionUsage({ promptTokens: 1000, completionTokens: 500, cost: 0.0123 })
    // 桁の落とし方は画像コストと同じ formatUsd に合わせる（アプリ内で額の書き方を1つに保つ）
    expect(line).toBe('1,500 tokens・$0.012')
    expect(line).not.toMatch(/[¥円]/)
  })

  it('額が大きいときは桁を落として読みやすくする', () => {
    expect(formatSessionUsage({ promptTokens: 1, completionTokens: 0, cost: 1.234 })).toBe('1 tokens・$1.23')
  })
})
