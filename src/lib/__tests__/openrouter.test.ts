import { describe, expect, it } from 'vitest'
import { withCacheControl, type ChatMessage } from '../openrouter'
import { makeProvider } from './fixtures'

const openrouter = makeProvider()
const anthropicDirect = makeProvider({ id: 'p2', baseUrl: 'https://api.anthropic.com/v1' })

/** n トークン相当の本文 */
const body = (n: number) => 'あ'.repeat(n)

/** system（2000トークン）＋ 会話10件（各200トークン） */
function longConversation(): ChatMessage[] {
  return [
    { role: 'system', content: body(2000) },
    ...Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as ChatMessage['role'],
      content: body(200),
    })),
  ]
}

const markedIndexes = (out: ChatMessage[]) =>
  out.flatMap((m, i) => (typeof m.content === 'string' ? [] : [i]))

describe('withCacheControl', () => {
  it('Anthropic 以外は同一参照で返す（リクエストの形を1バイトも変えない）', () => {
    const messages = longConversation()
    expect(withCacheControl(messages, openrouter, 'openai/gpt-4o')).toBe(messages)
    expect(withCacheControl(messages, openrouter, 'google/gemini-2.5-pro')).toBe(messages)
  })

  it('OpenRouter 経由の anthropic/ モデルには付ける', () => {
    const out = withCacheControl(longConversation(), openrouter, 'anthropic/claude-sonnet-4')
    expect(markedIndexes(out).length).toBeGreaterThan(0)
  })

  it('Anthropic 直叩き（OpenAI 互換エンドポイント）にも付ける', () => {
    const out = withCacheControl(longConversation(), anthropicDirect, 'claude-sonnet-4')
    expect(markedIndexes(out).length).toBeGreaterThan(0)
  })

  it('ブレークポイントは2箇所だけ（system の末尾と、毎ターン変わる末尾の手前）', () => {
    const out = withCacheControl(longConversation(), openrouter, 'anthropic/claude-sonnet-4')
    // 11通 → 末尾6通を除いた最後の位置 = index 4
    expect(markedIndexes(out)).toEqual([0, 4])
  })

  it('マーカー位置は text ブロック1つ＋cache_control に変換される', () => {
    const out = withCacheControl(longConversation(), openrouter, 'anthropic/claude-sonnet-4')
    expect(out[0].content).toEqual([
      { type: 'text', text: body(2000), cache_control: { type: 'ephemeral' } },
    ])
    expect(out[0].role).toBe('system')
  })

  it('マーカーを付けない位置は元のオブジェクトのまま', () => {
    const messages = longConversation()
    const out = withCacheControl(messages, openrouter, 'anthropic/claude-sonnet-4')
    expect(out[1]).toBe(messages[1])
  })

  it('最小キャッシュ長に満たない短い会話には何も付けない（同一参照）', () => {
    const short: ChatMessage[] = [
      { role: 'system', content: '短い' },
      { role: 'user', content: 'こんにちは' },
    ]
    expect(withCacheControl(short, openrouter, 'anthropic/claude-sonnet-4')).toBe(short)
  })

  it('会話が短く②の位置が取れなければ system だけ', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: body(2000) },
      { role: 'user', content: body(100) },
    ]
    expect(markedIndexes(withCacheControl(messages, openrouter, 'anthropic/claude-sonnet-4'))).toEqual([0])
  })

  it('既にブロック配列を組んでいる呼び出しには触らない（二重付与の防止）', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: [{ type: 'text', text: body(2000) }] },
      ...longConversation().slice(1),
    ]
    expect(withCacheControl(messages, openrouter, 'anthropic/claude-sonnet-4')).toBe(messages)
  })

  it('baseUrl が URL として壊れていても落ちない', () => {
    const broken = makeProvider({ baseUrl: 'not a url' })
    const messages = longConversation()
    expect(withCacheControl(messages, broken, 'gpt-4o')).toBe(messages)
  })
})
