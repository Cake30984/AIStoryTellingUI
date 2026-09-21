import { describe, expect, it } from 'vitest'
import { KICKOFF_SCHEMA } from '../jsonSchemas'
import { KICKOFF_TAG, normalizeKickoff } from '../kickoff'
import { matchCharacterByName } from '../names'

/**
 * 一行から始める（P4）の契約を守る網。
 * 見るのは**スキーマの形**と**起案結果の正規化**の2つだけ（文章の良し悪しは見ない）。
 */

/** 素直な起案結果（各欄が埋まっている状態） */
const good = {
  world: {
    name: '灯台守の冬',
    description: '北の岬にある小さな港町。灯台守が一人だけ残っている。',
    calendarFormat: '◯月◯日／朝・昼・夜',
    entries: [
      { keys: ['灯台', '光'], content: '灯台は町で最後の一基。', alwaysOn: true },
      { keys: ['港'], content: '港には船が三隻しか残っていない。', alwaysOn: false },
    ],
    relationAspects: [
      { name: '信頼', guidance: '相手の言葉のどこを信じているか。' },
      { name: '距離', guidance: '踏み込んでよいと思っている範囲。' },
    ],
    startPreset: {
      genre: '現代・港町／静かな再生',
      premise: '灯台が来年で消える町に、一人の若者が戻ってくる。',
      opening: '　港は凪いでいた。\n「……ただいま、って言う相手もいないな」\n　風が塩の匂いを運ぶ。',
      openingTitle: '十二月、最後の灯',
      openingSceneNote: '十二月三日の夕方。港の突堤。居るのは灯野みなとと磯貝ふゆ。',
      initialDirective: '再会の理由をまだ明かさない。灯台の光だけを見せる。',
      startNow: '12月3日 夕方',
    },
  },
  characters: [
    {
      name: '灯野 みなと',
      persona: '二十歳。町を出たまま帰れずにいた。',
      speechStyle: '一人称は「俺」。語尾を濁す。',
      appearance: '痩せ型で、色の褪せた紺のコートを着ている。',
      exampleDialogues: ['「別に、用があって帰ったわけじゃない」', '「……まだ点くんだな、あれ」'],
      greeting: '「灯野みなと。まあ、帰ってきた」',
      tags: ['帰郷', '無口'],
    },
    {
      name: '磯貝ふゆ',
      persona: '灯台守の孫。町に残った理由を人に話さない。',
      speechStyle: '一人称は「わたし」。言い切る。',
      appearance: '背が低く、厚手のニット帽をいつもかぶっている。',
      exampleDialogues: ['「遅い。十年も待たせて」'],
      greeting: '「磯貝ふゆ。灯台の鍵は、わたしが持ってる」',
      tags: ['灯台守'],
    },
  ],
}

/** strict の制約（全プロパティ required・additionalProperties:false）を再帰で確かめる */
function assertStrict(node: unknown): void {
  if (!node || typeof node !== 'object') return
  const n = node as Record<string, unknown>
  if (n.type === 'object') {
    expect(n.additionalProperties).toBe(false)
    const props = n.properties as Record<string, unknown>
    expect(Object.keys(props).length).toBeGreaterThan(0)
    expect(n.required).toEqual(Object.keys(props))
    for (const v of Object.values(props)) assertStrict(v)
  }
  if (n.type === 'array') assertStrict(n.items)
}

describe('KICKOFF_SCHEMA', () => {
  it('入れ子まで strict の形（全プロパティ required・additionalProperties:false）', () => {
    expect(KICKOFF_SCHEMA.name).toMatch(/^[a-z0-9_]+$/)
    assertStrict(KICKOFF_SCHEMA.schema)
  })

  it('startPreset の欄が World.startPreset と同じ名前で並ぶ（startPresetPatch がそのまま読める）', () => {
    const world = (KICKOFF_SCHEMA.schema as any).properties.world
    expect(Object.keys(world.properties)).toEqual([
      'name',
      'description',
      'calendarFormat',
      'entries',
      'relationAspects',
      'startPreset',
    ])
    expect(Object.keys(world.properties.startPreset.properties)).toEqual([
      'genre',
      'premise',
      'opening',
      'openingTitle',
      'openingSceneNote',
      'initialDirective',
      'startNow',
    ])
  })

  it('characters の欄が Character の記入欄と1対1（起案の後に手で足す欄を残さない）', () => {
    const chars = (KICKOFF_SCHEMA.schema as any).properties.characters
    expect(Object.keys(chars.items.properties)).toEqual([
      'name',
      'persona',
      'speechStyle',
      'appearance',
      'exampleDialogues',
      'greeting',
      'tags',
    ])
  })
})

describe('normalizeKickoff', () => {
  it('素直な起案結果を素材へ詰める（先頭が中心人物・「起案」タグが付く）', () => {
    const d = normalizeKickoff(good, '灯台が消える町に若者が帰る')!
    expect(d).not.toBeNull()
    expect(d.world.name).toBe('灯台守の冬')
    expect(d.title).toBe('灯台守の冬')
    expect(d.world.entries).toHaveLength(2)
    expect(d.world.entries[0].alwaysOn).toBe(true)
    expect(d.world.entries.every((e) => e.enabled)).toBe(true)
    expect(d.world.entries.map((e) => e.order)).toEqual([0, 1])
    expect(d.world.relationAspects.map((a) => a.name)).toEqual(['信頼', '距離'])
    expect(d.characters).toHaveLength(2)
    expect(d.characters[0].name).toBe('灯野みなと')
    expect(d.characters.every((c) => c.tags.includes(KICKOFF_TAG))).toBe(true)
    // 1行1セリフの1文字列（編集画面の textarea と同じ形）
    expect(d.characters[0].exampleDialogues.split('\n')).toHaveLength(2)
    expect(d.world.startPreset?.genre).toBe('現代・港町／静かな再生')
    expect(d.world.startPreset?.startNow).toBe('12月3日 夕方')
  })

  it('名前の空白を落とし、本文中の呼び名から素材へ解決できる。導入本文は触らない', () => {
    const d = normalizeKickoff(good, '一行')!
    expect(d.world.startPreset!.opening).toBe(good.world.startPreset.opening.trim())
    expect(matchCharacterByName('灯野みなと', d.characters)).toBe(d.characters[0].id)
  })

  it('多すぎる起案は詰める（ロア5件・次元2つ・登場人物4人）', () => {
    const many = {
      world: {
        ...good.world,
        entries: Array.from({ length: 8 }, (_, i) => ({ keys: [`k${i}`], content: `内容${i}`, alwaysOn: false })),
        relationAspects: [{ name: '信頼' }, { name: '距離' }, { name: '負い目' }],
      },
      characters: Array.from({ length: 6 }, (_, i) => ({ ...good.characters[0], name: `人物${i}` })),
    }
    const d = normalizeKickoff(many, '一行')!
    expect(d.world.entries).toHaveLength(5)
    expect(d.world.relationAspects).toHaveLength(2)
    expect(d.characters).toHaveLength(4)
    expect(d.characters[0].name).toBe('人物0')
  })

  it('関係性の次元が空なら既定を1つ入れる（レビューが stance だけに落ちない）', () => {
    const d = normalizeKickoff({ ...good, world: { ...good.world, relationAspects: [] } }, '一行')!
    expect(d.world.relationAspects).toHaveLength(1)
    expect(d.world.relationAspects[0].name).toBe('信頼')
  })

  it('配列で来るはずの欄が文字列でも拾う（スキーマを無視する接続先）', () => {
    const d = normalizeKickoff(
      {
        ...good,
        characters: [{ ...good.characters[0], exampleDialogues: '「一つ目」\n「二つ目」', tags: '帰郷\n無口' }],
      },
      '一行',
    )!
    expect(d.characters[0].exampleDialogues).toBe('「一つ目」\n「二つ目」')
    expect(d.characters[0].tags).toEqual([KICKOFF_TAG, '帰郷', '無口'])
  })

  it('同名の人物は落とす（前方一致の名前解決が別人を拾うため）', () => {
    const d = normalizeKickoff(
      { ...good, characters: [good.characters[0], good.characters[0], good.characters[1]] },
      '一行',
    )!
    expect(d.characters.map((c) => c.name)).toEqual(['灯野みなと', '磯貝ふゆ'])
  })

  it('欠けた欄は利用者の一行で埋める（空の世界を作らない）', () => {
    const d = normalizeKickoff(
      { world: { startPreset: {} }, characters: [{ name: '名無し' }] },
      '廃校寸前の高校の写真部',
    )!
    expect(d.world.name).toBe('廃校寸前の高校の写真部')
    expect(d.world.description).toBe('廃校寸前の高校の写真部')
    expect(d.world.startPreset?.premise).toBe('廃校寸前の高校の写真部')
    expect(d.world.entries).toEqual([])
  })

  it('人物が1人も取れない・そもそもオブジェクトでないなら null（空の下書きへ倒す）', () => {
    expect(normalizeKickoff({ ...good, characters: [] }, '一行')).toBeNull()
    expect(normalizeKickoff({ ...good, characters: [{ name: '  ' }] }, '一行')).toBeNull()
    expect(normalizeKickoff('（説明文だけ返ってきた）', '一行')).toBeNull()
    expect(normalizeKickoff(null, '一行')).toBeNull()
  })
})
