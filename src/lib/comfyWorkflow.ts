/**
 * ComfyUI の API Format ワークフローを解析して、プロンプト・サイズ・seed 等の注入先を
 * **決定的に**特定する（docs/設計_画像生成の簡易化.md §4.3）。
 *
 * ねらいは「ComfyUI からエクスポートした JSON をそのまま貼れば動く」こと。
 * `%PROMPT%` を手で埋める作業が、画像生成の設定で一番めんどうな部分だった。
 *
 * **これはヒューリスティックではない**。API Format ではノード間のリンクが
 * `"positive": ["6", 0]` のように書かれているので、sampler ノードの `positive` /
 * `negative` / `latent_image` を辿れば注入先が一意に決まる。
 * 決まらない構成（sampler が複数＝hires fix・refiner 等）は**黙って片方に入れず、
 * あきらめて理由を返す**。
 */

export interface ComfyNode {
  class_type?: string
  inputs?: Record<string, unknown>
}

export type ComfyGraph = Record<string, ComfyNode>

export interface ComfyPlan {
  /** プロンプトの注入先が決まったか（これが false なら自動注入は使えない） */
  ok: boolean
  /** 自動検出できなかった理由。UI にそのまま出す */
  problems: string[]
  samplerId?: string
  positiveId?: string
  negativeId?: string
  latentId?: string
  ckptId?: string
  loraId?: string
  /** 「どのノードに何を入れるか」の表示用サマリ */
  summary: string[]
}

/** 注入時にユーザーが明示的に選んだ値。**未指定ならワークフロー自身の値を尊重する** */
export interface ComfyOverrides {
  ckptName?: string
  samplerName?: string
  scheduler?: string
  steps?: number
  cfg?: number
  loraName?: string
  loraStrength?: number
}

const SAMPLER_RE = /KSampler|SamplerCustom/i
const SAVE_RE = /^(SaveImage|PreviewImage|SaveImageWebsocket)$/

/** `["6", 0]` 形式のリンクなら参照先ノード id を返す */
function linkTarget(v: unknown): string | null {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' ? v[0] : null
}

/** そのノードの inputs が持つリンク先ノード id をすべて返す */
function linksOf(node: ComfyNode | undefined): string[] {
  if (!node?.inputs) return []
  return Object.values(node.inputs)
    .map(linkTarget)
    .filter((x): x is string => x !== null)
}

/** 出力ノードから入力方向へ辿れるノード id の集合（到達不能な残骸ノードを無視するため） */
function reachableFrom(graph: ComfyGraph, starts: string[]): Set<string> {
  const seen = new Set<string>()
  const queue = [...starts]
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    for (const next of linksOf(graph[id])) if (!seen.has(next)) queue.push(next)
  }
  return seen
}

/**
 * `from` から入力方向へ辿り、条件を満たす最初のノード id を返す。
 * `positive` が ConditioningCombine 等を経由して CLIPTextEncode に届く構成に対応する。
 */
function findUpstream(
  graph: ComfyGraph,
  from: string | null,
  pred: (n: ComfyNode) => boolean,
): string | undefined {
  if (!from) return undefined
  const seen = new Set<string>()
  const queue = [from]
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    const node = graph[id]
    if (node && pred(node)) return id
    for (const next of linksOf(node)) if (!seen.has(next)) queue.push(next)
  }
  return undefined
}

const hasText = (n: ComfyNode) => typeof n.inputs?.text === 'string'
const hasSize = (n: ComfyNode) => typeof n.inputs?.width === 'number' && typeof n.inputs?.height === 'number'
const hasStr = (key: string) => (n: ComfyNode) => typeof n.inputs?.[key] === 'string'

/** `%PROMPT%` 等の手動プレースホルダを含むか。含むなら自動検出は**走らせない**（明示指定が勝つ） */
export function hasWorkflowPlaceholders(template: string): boolean {
  return /%PROMPT%|%NEGATIVE%|%SEED%|%WIDTH%|%HEIGHT%/.test(template)
}

/** API Format の workflow を解析し、注入先を決める。ネットワークに触れない純関数 */
export function analyzeComfyWorkflow(parsed: unknown): ComfyPlan {
  const problems: string[] = []
  const summary: string[] = []
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, problems: ['ワークフローが JSON オブジェクトではありません。'], summary }
  }
  const graph = parsed as ComfyGraph
  const ids = Object.keys(graph).filter((id) => typeof graph[id]?.class_type === 'string')
  if (ids.length === 0) {
    return { ok: false, problems: ['ノードが見つかりません。API Format で書き出してください（UI 形式は非対応）。'], summary }
  }

  const outputs = ids.filter((id) => SAVE_RE.test(graph[id].class_type!))
  if (outputs.length === 0) {
    return { ok: false, problems: ['出力ノード（SaveImage）が見つかりません。'], summary }
  }

  const reachable = reachableFrom(graph, outputs)
  const samplers = [...reachable].filter((id) => SAMPLER_RE.test(graph[id]?.class_type ?? ''))
  if (samplers.length === 0) {
    return { ok: false, problems: ['サンプラーノード（KSampler 等）が見つかりません。'], summary }
  }
  if (samplers.length > 1) {
    // hires fix・refiner 構成。どちらに入れるべきかは決まらないので黙って推測しない
    return {
      ok: false,
      problems: [
        `サンプラーノードが ${samplers.length} 個あります（hires fix / refiner 構成）。` +
          'どこに入れるかを自動では決められません。',
      ],
      summary,
    }
  }

  const samplerId = samplers[0]
  const sampler = graph[samplerId]
  const positiveId = findUpstream(graph, linkTarget(sampler.inputs?.positive), hasText)
  const negativeId = findUpstream(graph, linkTarget(sampler.inputs?.negative), hasText)
  const latentId = findUpstream(graph, linkTarget(sampler.inputs?.latent_image), hasSize)
  const ckptId = [...reachable].find((id) => hasStr('ckpt_name')(graph[id] ?? {}))
  const loraId = [...reachable].find((id) => hasStr('lora_name')(graph[id] ?? {}))

  if (!positiveId) {
    problems.push('プロンプトの注入先（テキスト入力ノード）が特定できませんでした。')
  }
  if (positiveId && positiveId === negativeId) {
    problems.push('プロンプトとネガティブが同じノードを指しています。')
  }

  const label = (id: string) => `${graph[id]?.class_type}(${id})`
  if (positiveId) summary.push(`プロンプト → ${label(positiveId)}`)
  if (negativeId && negativeId !== positiveId) summary.push(`ネガティブ → ${label(negativeId)}`)
  if (latentId) summary.push(`サイズ → ${label(latentId)}`)
  summary.push(`シード・サンプラー → ${label(samplerId)}`)
  if (ckptId) summary.push(`モデル → ${label(ckptId)}`)
  if (loraId) summary.push(`LoRA → ${label(loraId)}`)

  return {
    ok: problems.length === 0,
    problems,
    samplerId,
    positiveId,
    negativeId: negativeId === positiveId ? undefined : negativeId,
    latentId,
    ckptId,
    loraId,
    summary,
  }
}

/** そのノードの入力に key があるときだけ書き込む（存在しない入力を勝手に生やさない） */
function setIfPresent(node: ComfyNode | undefined, key: string, value: unknown): void {
  if (node?.inputs && key in node.inputs) node.inputs[key] = value
}

/**
 * plan にしたがって値を注入した**新しい**グラフを返す（引数は変更しない）。
 * `overrides` は未指定なら触らない＝ワークフロー自身の値をそのまま使う。
 */
export function injectComfyWorkflow(
  parsed: ComfyGraph,
  plan: ComfyPlan,
  req: { prompt: string; negative?: string; width?: number; height?: number },
  overrides: ComfyOverrides = {},
): ComfyGraph {
  const graph: ComfyGraph = JSON.parse(JSON.stringify(parsed))

  if (plan.positiveId) setIfPresent(graph[plan.positiveId], 'text', req.prompt)
  if (plan.negativeId) setIfPresent(graph[plan.negativeId], 'text', req.negative ?? '')

  if (plan.latentId) {
    setIfPresent(graph[plan.latentId], 'width', req.width ?? 1024)
    setIfPresent(graph[plan.latentId], 'height', req.height ?? 1024)
  }

  if (plan.samplerId) {
    const sampler = graph[plan.samplerId]
    const seed = Math.floor(Math.random() * 0xffffffff)
    // KSampler は seed、KSamplerAdvanced / SamplerCustom は noise_seed
    setIfPresent(sampler, 'seed', seed)
    setIfPresent(sampler, 'noise_seed', seed)
    if (overrides.samplerName) setIfPresent(sampler, 'sampler_name', overrides.samplerName)
    if (overrides.scheduler) setIfPresent(sampler, 'scheduler', overrides.scheduler)
    if (overrides.steps != null) setIfPresent(sampler, 'steps', overrides.steps)
    if (overrides.cfg != null) setIfPresent(sampler, 'cfg', overrides.cfg)
  }

  if (plan.ckptId && overrides.ckptName) setIfPresent(graph[plan.ckptId], 'ckpt_name', overrides.ckptName)

  if (plan.loraId) {
    if (overrides.loraName) setIfPresent(graph[plan.loraId], 'lora_name', overrides.loraName)
    if (overrides.loraStrength != null) {
      setIfPresent(graph[plan.loraId], 'strength_model', overrides.loraStrength)
      setIfPresent(graph[plan.loraId], 'strength_clip', overrides.loraStrength)
    }
  }

  return graph
}
