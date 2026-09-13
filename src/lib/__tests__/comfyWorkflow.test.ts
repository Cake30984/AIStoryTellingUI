import { describe, expect, it } from 'vitest'
import {
  analyzeComfyWorkflow,
  hasWorkflowPlaceholders,
  injectComfyWorkflow,
  type ComfyGraph,
} from '../comfyWorkflow'

/** 最小の API Format ワークフロー（ckpt → CLIP×2 → KSampler → VAEDecode → SaveImage） */
function baseGraph(): ComfyGraph {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model.safetensors' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: 'positive', clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: 'negative', clip: ['1', 1] } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    '5': {
      class_type: 'KSampler',
      inputs: {
        seed: 1,
        steps: 20,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
      },
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { images: ['6', 0] } },
  }
}

describe('hasWorkflowPlaceholders', () => {
  it('手動プレースホルダを検出する（明示指定が自動検出より優先される）', () => {
    expect(hasWorkflowPlaceholders('{"text":"%PROMPT%"}')).toBe(true)
    expect(hasWorkflowPlaceholders('{"text":"a girl"}')).toBe(false)
  })
})

describe('analyzeComfyWorkflow', () => {
  it('リンクを辿って注入先を一意に決める', () => {
    const plan = analyzeComfyWorkflow(baseGraph())
    expect(plan.ok).toBe(true)
    expect(plan).toMatchObject({
      samplerId: '5',
      positiveId: '2',
      negativeId: '3',
      latentId: '4',
      ckptId: '1',
    })
    expect(plan.problems).toEqual([])
  })

  it('サンプラーが複数なら諦めて理由を返す（片方に黙って入れない）', () => {
    const g = baseGraph()
    g['8'] = { class_type: 'KSampler', inputs: { ...g['5'].inputs, latent_image: ['5', 0] } }
    g['6'].inputs!.samples = ['8', 0]
    const plan = analyzeComfyWorkflow(g)
    expect(plan.ok).toBe(false)
    expect(plan.problems[0]).toContain('サンプラーノードが 2 個')
    expect(plan.positiveId).toBeUndefined()
  })

  it('出力ノードが無ければ失敗', () => {
    const g = baseGraph()
    delete g['7']
    expect(analyzeComfyWorkflow(g)).toMatchObject({ ok: false })
    expect(analyzeComfyWorkflow(g).problems[0]).toContain('出力ノード')
  })

  it('サンプラーが無ければ失敗', () => {
    const g = baseGraph()
    delete g['5']
    expect(analyzeComfyWorkflow(g).problems[0]).toContain('サンプラーノード')
  })

  it('JSON オブジェクトでなければ失敗', () => {
    expect(analyzeComfyWorkflow(null).ok).toBe(false)
    expect(analyzeComfyWorkflow([1, 2]).ok).toBe(false)
    expect(analyzeComfyWorkflow({}).problems[0]).toContain('ノードが見つかりません')
  })

  it('positive と negative が同じノードなら問題として返す', () => {
    const g = baseGraph()
    g['5'].inputs!.negative = ['2', 0]
    const plan = analyzeComfyWorkflow(g)
    expect(plan.ok).toBe(false)
    expect(plan.problems.join()).toContain('同じノード')
  })

  it('出力に繋がっていないサンプラーは無視する', () => {
    const g = baseGraph()
    g['9'] = { class_type: 'KSampler', inputs: { seed: 0 } }
    expect(analyzeComfyWorkflow(g).ok).toBe(true)
  })
})

describe('injectComfyWorkflow', () => {
  const plan = analyzeComfyWorkflow(baseGraph())

  it('プロンプト・ネガティブ・サイズを注入する', () => {
    const out = injectComfyWorkflow(baseGraph(), plan, {
      prompt: '1girl',
      negative: 'bad hands',
      width: 768,
      height: 1024,
    })
    expect(out['2'].inputs!.text).toBe('1girl')
    expect(out['3'].inputs!.text).toBe('bad hands')
    expect(out['4'].inputs!).toMatchObject({ width: 768, height: 1024 })
  })

  it('引数のグラフを書き換えない', () => {
    const original = baseGraph()
    injectComfyWorkflow(original, plan, { prompt: '1girl' })
    expect(original['2'].inputs!.text).toBe('positive')
  })

  it('存在しない入力を生やさない（KSampler に noise_seed を作らない）', () => {
    const out = injectComfyWorkflow(baseGraph(), plan, { prompt: '1girl' })
    expect('noise_seed' in out['5'].inputs!).toBe(false)
    expect(typeof out['5'].inputs!.seed).toBe('number')
  })

  it('overrides が未指定ならワークフロー自身の値を尊重する', () => {
    const out = injectComfyWorkflow(baseGraph(), plan, { prompt: '1girl' })
    expect(out['5'].inputs!).toMatchObject({ steps: 20, cfg: 7, sampler_name: 'euler' })
    expect(out['1'].inputs!.ckpt_name).toBe('model.safetensors')
  })

  it('overrides を指定した項目だけ差し替える', () => {
    const out = injectComfyWorkflow(
      baseGraph(),
      plan,
      { prompt: '1girl' },
      { steps: 30, ckptName: 'other.safetensors' },
    )
    expect(out['5'].inputs!.steps).toBe(30)
    expect(out['5'].inputs!.cfg).toBe(7)
    expect(out['1'].inputs!.ckpt_name).toBe('other.safetensors')
  })

  it('サイズ未指定は 1024 を入れる', () => {
    const out = injectComfyWorkflow(baseGraph(), plan, { prompt: '1girl' })
    expect(out['4'].inputs!).toMatchObject({ width: 1024, height: 1024 })
  })
})
