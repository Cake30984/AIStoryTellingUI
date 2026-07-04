export interface StylePreset {
  id: 'anime' | 'realistic'
  label: string
  positive: string
  negative: string
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'anime',
    label: 'アニメ系',
    positive: 'masterpiece, best quality, very aesthetic, absurdres',
    negative:
      'low quality, worst quality, bad anatomy, bad hands, extra fingers, missing fingers, extra digits, jpeg artifacts, signature, watermark, username',
  },
  {
    id: 'realistic',
    label: '実写系',
    positive: 'photorealistic, RAW photo, masterpiece, best quality, 8k uhd, film grain',
    negative:
      'low quality, worst quality, bad anatomy, bad hands, extra fingers, missing fingers, anime, cartoon, illustration, 3d render, painting, sketch, watermark',
  },
]

const PRESET_TOKENS = (() => {
  const set = new Set<string>()
  for (const preset of STYLE_PRESETS) {
    for (const field of [preset.positive, preset.negative]) {
      for (const tok of field.split(',')) {
        const t = tok.trim().toLowerCase()
        if (t) set.add(t)
      }
    }
  }
  return set
})()

function stripPresetTokens(value: string): string {
  return value
    .split(',')
    .map((tok) => tok.trim())
    .filter((tok) => tok && !PRESET_TOKENS.has(tok.toLowerCase()))
    .join(', ')
}

/**
 * prompt/negative の先頭にプリセットタグを適用する。
 * 冪等にするため「既知の全プリセットのタグを一旦除去 → 選択プリセットを先頭に付加」の順で行う。
 */
export function applyStylePreset(
  current: { prompt: string; negative: string },
  styleId: 'anime' | 'realistic' | '',
): { prompt: string; negative: string } {
  const restPrompt = stripPresetTokens(current.prompt)
  const restNegative = stripPresetTokens(current.negative)
  const preset = STYLE_PRESETS.find((p) => p.id === styleId)
  if (!preset) {
    return { prompt: restPrompt, negative: restNegative }
  }
  return {
    prompt: restPrompt ? `${preset.positive}, ${restPrompt}` : preset.positive,
    negative: restNegative ? `${preset.negative}, ${restNegative}` : preset.negative,
  }
}

/**
 * prompt に pins のタグ（カンマ区切り）が欠けていれば末尾に補う。
 * 比較はトークン単位の完全一致（trim・小文字）。起案（LLM）がプロンプトを全文置換した際に、
 * LoRA トリガー・表情タグ等の固定タグが消えるのを防ぐために使う。
 */
export function ensureTags(prompt: string, pins: string): string {
  const have = new Set(
    prompt.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
  )
  const missing = pins
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && !have.has(t.toLowerCase()))
  if (missing.length === 0) return prompt
  return prompt ? `${prompt}, ${missing.join(', ')}` : missing.join(', ')
}
