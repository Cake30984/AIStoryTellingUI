// 裏方 LLM 呼び出し（レビュー・選択肢・次シーン候補・画像プロンプト起案）の出力を
// JSON スキーマで固定するための定義（docs/詳細設計_プロンプト構造とキャッシュ.md §10）。
//
// **用語**: 本プロジェクトの「構造化出力」（`Session.structuredOutput`）は本文を
// `@名前「セリフ」` の行形式で書かせる機能で、別物。こちらは API の `response_format`
// （json_schema）で**裏方の JSON を機械的に強制する**もの＝本書では「JSON スキーマ」と呼ぶ。

import type { OpenRouterModel, PromptStyle } from '../types'
import type { ReviewPart } from './prompts'

/** `response_format: { type:'json_schema' }` へ渡す1件ぶん */
export interface JsonSchemaSpec {
  /** スキーマ名（英数字。プロバイダによっては識別子として扱われる） */
  name: string
  schema: Record<string, unknown>
}

/**
 * JSON 強制の段階。上から順に強い。
 * - `schema`: `response_format:{type:'json_schema'}`＝項目まで固定できる
 * - `object`: `response_format:{type:'json_object'}`＝**構文が壊れないことだけ**保証される
 *   （DeepSeek 直叩きのように json_schema は無いが JSON モードはある相手がここ。
 *   再試行の主因だった「生の改行・末尾カンマ」はこれだけでも消える）
 * - `none`: 何も付けない（従来どおりプロンプトだけで頼む）
 */
export type JsonMode = 'schema' | 'object' | 'none'

/** 1段階弱いモード */
export function weakerJsonMode(mode: JsonMode): JsonMode {
  return mode === 'schema' ? 'object' : 'none'
}

/**
 * strict モードの制約に合わせたオブジェクト定義を作る。
 * OpenAI 系の strict は **全プロパティを `required` に入れ、`additionalProperties: false` を要求**するため、
 * 「省略可」は null 許容（`['string','null']`）で表現する。
 */
function obj(properties: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  }
}

const str = { type: 'string' } as const
/** 省略可の文字列（strict では required から外せないので null 許容にする） */
const strOrNull = { type: ['string', 'null'] } as const
const arrayOf = (items: unknown) => ({ type: 'array', items })

/** レビュー A（何が起きたか）の項目 */
const REVIEW_A_PROPS = {
  summary: str,
  suggestions: arrayOf(obj({ title: str, note: str })),
  characterGrowth: arrayOf(obj({ name: str, addition: str })),
  worldGrowth: arrayOf(obj({ keys: arrayOf(str), content: str })),
  // 発見キャラ（FB7-E）。地の文だけで登場した未定義の人物を拾う
  newCharacters: arrayOf(obj({ name: str, note: str })),
}

/** レビュー B（状態がどう動いたか）の項目 */
const REVIEW_B_PROPS = {
  relationUpdates: arrayOf(
    obj({
      character: str,
      stance: str,
      aspects: arrayOf(obj({ name: str, note: str })),
      reason: str,
    }),
  ),
  moods: arrayOf(obj({ character: str, mood: str })),
  statChanges: arrayOf(
    obj({ name: str, character: strOrNull, delta: { type: 'integer' }, reason: str }),
  ),
  counterEvents: arrayOf(
    obj({ name: str, character: strOrNull, amount: { type: 'integer' }, reason: str }),
  ),
}

/** シーン終了レビューのスキーマ（`reviewSystem` の part と対になる） */
export function reviewSchema(part: ReviewPart): JsonSchemaSpec {
  const props =
    part === 'a'
      ? REVIEW_A_PROPS
      : part === 'b'
        ? REVIEW_B_PROPS
        : { ...REVIEW_A_PROPS, ...REVIEW_B_PROPS }
  return { name: `scene_review_${part}`, schema: obj(props) }
}

/**
 * 選択肢。**strict の root はオブジェクトでなければならない**ため、素の配列ではなく
 * `{ choices: [...] }` で包む（`coerceChoices` はオブジェクト内の配列も拾えるので受け側は無改修）。
 */
export const CHOICES_SCHEMA: JsonSchemaSpec = {
  name: 'story_choices',
  schema: obj({ choices: arrayOf(str) }),
}

/** 次シーン候補だけの再生成 */
export const NEXT_SCENE_SCHEMA: JsonSchemaSpec = {
  name: 'next_scene_suggestions',
  schema: obj({ suggestions: arrayOf(obj({ title: str, note: str })) }),
}

/** 画像プロンプトの起案 */
/**
 * 画像プロンプト起案。**自然文スタイルでは `negative` を契約から外す**
 * （Flux / gpt-image 系にネガティブは無く、書かせると余計な語が prompt に混ざる。
 * docs/設計_画像生成の簡易化.md §5.1）。
 */
export function imageDraftSchema(style: PromptStyle): JsonSchemaSpec {
  return {
    name: 'image_prompt_draft',
    schema: style === 'natural' ? obj({ prompt: str }) : obj({ prompt: str, negative: str }),
  }
}

/** 発見キャラのキャラクター JSON 起案（FB7-E。`characterDraftSystem` と対） */
export const CHARACTER_DRAFT_SCHEMA: JsonSchemaSpec = {
  name: 'character_draft',
  schema: obj({
    name: str,
    persona: str,
    speechStyle: str,
    appearance: str,
    greeting: str,
  }),
}

/**
 * モデル名から JSON スキーマ対応を推測するパターン。
 * **一覧が取れない時だけの当て推量**（直叩きの OpenAI 互換接続先・モデル一覧未読込）。
 * 外れても `streamChat` の実行時フォールバックがスキーマ無しで投げ直すので、強気に倒してよい。
 */
const LIKELY_SUPPORTED =
  /(^|\/)(gpt-|gpt5|o[1-9](-|$)|chatgpt|gemini|claude|deepseek|qwen|kimi|glm)/i

/**
 * このモデルに対して**最初に試すべき**強制モード。
 *
 * OpenRouter のモデル一覧が読み込まれていれば **その申告（`supported_parameters`）が最優先**
 * ——同じ系列でもモデルごとに対応が違うため、名前での一括判定はしない
 * （実測: `z-ai/glm` は 12件中 6件、`qwen/` は 48件中 40件しか `structured_outputs` を申告しない）。
 *
 * 申告が無い経路（OpenRouter 以外の直叩き・一覧未読込）はモデル名で当たりをつける。
 * **外れても `streamChat` が1段ずつ弱いモードへ落として投げ直す**ので、強気に倒してよい。
 * 例: DeepSeek 直叩きは `json_schema` 非対応・`json_object` のみ対応なので、
 * 1回目で弾かれた後 `object` に落ち着く（以後そのモデルには最初から `object` で送る）。
 */
export function jsonModeFor(model: string, models?: OpenRouterModel[]): JsonMode {
  const entry = models?.find((m) => m.id === model)
  if (entry?.supported_parameters?.length) {
    if (entry.supported_parameters.includes('structured_outputs')) return 'schema'
    // スキーマは無理でも JSON モードは通る相手（実測でこの層はそれなりに多い）
    if (entry.supported_parameters.includes('response_format')) return 'object'
    return 'none'
  }
  return LIKELY_SUPPORTED.test(model) ? 'schema' : 'none'
}
