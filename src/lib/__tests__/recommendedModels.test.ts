import { describe, expect, it } from 'vitest'
import { RECOMMENDED_MODELS, formatPerMillion, isRecommendedModel, joinWithLiveModels } from '../recommendedModels'

describe('推奨モデル（P7 A-1）', () => {
  it('id は重複せず、版を固定した形（「常に最新」別名や auto を含まない）', () => {
    const ids = RECOMMENDED_MODELS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id).not.toMatch(/^~/)
      expect(id).not.toMatch(/-latest$|\/auto$/)
      expect(id).toMatch(/^[\w.-]+\/[\w.-]+$/)
    }
    for (const m of RECOMMENDED_MODELS) {
      expect(m.name.trim().length).toBeGreaterThan(0)
      expect(m.desc.trim().length).toBeGreaterThan(0)
    }
  })

  it('推奨かどうかの判定', () => {
    expect(isRecommendedModel(RECOMMENDED_MODELS[0].id)).toBe(true)
    expect(isRecommendedModel('openrouter/auto')).toBe(false)
    expect(isRecommendedModel('')).toBe(false)
  })

  it('/models の結果と突き合わせ、無い id は落とし、価格を 100 万トークンあたりに直す', () => {
    const [first, second] = RECOMMENDED_MODELS
    const joined = joinWithLiveModels([
      { id: 'other/model', pricing: { prompt: '0.000001', completion: '0.000002' } },
      { id: second.id, pricing: { prompt: '0.000000578', completion: '0.000001734' } },
      { id: first.id, pricing: { prompt: '0.00000004', completion: '0.00000008' } },
    ])
    // 順序は推奨リストのまま、一覧に無い 3・4 件目は出ない
    expect(joined.map((m) => m.id)).toEqual([first.id, second.id])
    expect(joined[0].promptPerMillion).toBeCloseTo(0.04, 6)
    expect(joined[0].completionPerMillion).toBeCloseTo(0.08, 6)
    expect(joined[1].promptPerMillion).toBeCloseTo(0.578, 6)
  })

  it('価格が無い・壊れているときは null（表示は「—」）', () => {
    const [first] = RECOMMENDED_MODELS
    expect(joinWithLiveModels([{ id: first.id }])[0].promptPerMillion).toBeNull()
    expect(joinWithLiveModels([{ id: first.id, pricing: { prompt: 'abc' } }])[0].promptPerMillion).toBeNull()
    expect(joinWithLiveModels([{ id: first.id, pricing: { prompt: '-1' } }])[0].promptPerMillion).toBeNull()
    expect(joinWithLiveModels([])).toEqual([])
    expect(formatPerMillion(null)).toBe('—')
  })

  it('価格の表示は桁に応じて小数を切り詰める', () => {
    expect(formatPerMillion(0.04)).toBe('$0.04')
    expect(formatPerMillion(0.578)).toBe('$0.578')
    expect(formatPerMillion(1.734)).toBe('$1.73')
    expect(formatPerMillion(2)).toBe('$2')
    expect(formatPerMillion(12)).toBe('$12')
    expect(formatPerMillion(10)).toBe('$10')
    expect(formatPerMillion(100)).toBe('$100')
    expect(formatPerMillion(1.5)).toBe('$1.5')
    expect(formatPerMillion(0)).toBe('$0')
  })
})
