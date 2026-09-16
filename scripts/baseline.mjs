#!/usr/bin/env node
/**
 * 対照実験の「対照側」＝素のチャットの再現（計画 P6。手順は `docs/実験_対照読み比べ.md`）。
 *
 * 既定コンテンツ（`src/starter/`）の世界・登場人物の定義を **1枚の system プロンプト**にまとめ、
 * 同じモデルに「続けて」を N 回投げて markdown に落とす。
 * **シーン分割・あらすじ要約・レビュー（関係性・時間・予定の更新）・ロアのキーワード注入は無い。**
 * 定義を全部貼ってから「続けて」を連打する使い方、そのままである。
 *
 * デルシア側と揃えているもの: 素材（同じ TS 定数を import する＝写しを持たない）・導入文・
 * 「続けて」の文面・文体ルール・セリフの出力形式・温度。**違いは状態機械の有無だけ**にする。
 * 文体ルールと出力形式の文面は `src/lib/prompts.ts` の `buildSystemPrompt` を写している
 * （そちらを変えたら揃える。アプリ本体からは import しない＝この script は依存パッケージ無しで動く）。
 *
 * 使い方（Node 22.6 以降。`.ts` を型だけ剥がして直接 import する）:
 *   node scripts/baseline.mjs --model <モデル> [--key <APIキー>] [--n 30]
 *                             [--base-url https://openrouter.ai/api/v1] [--out scripts/out/xxx.md]
 *                             [--temperature 0.9] [--max-tokens 4096] [--dry-run]
 *   キーは --key か環境変数 OPENROUTER_API_KEY（無ければ LLM_API_KEY）。ローカル（Ollama 等）は不要。
 *   --dry-run は system プロンプトを表示して終わる（API は呼ばない）。
 *
 * 出力: `<out>`（読者に渡す本文。見出し・出典行なし）と `<out>.meta.json`（モデル・使用量・所要時間・
 * system プロンプト全文＝再現用）。`scripts/out/` は ignore 済み。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// 引数
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    model: '',
    key: process.env.OPENROUTER_API_KEY || process.env.LLM_API_KEY || '',
    n: 30,
    baseUrl: 'https://openrouter.ai/api/v1',
    out: '',
    temperature: 0.9,
    maxTokens: 4096,
    timeoutSec: 180,
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) fail(`${a} には値が要ります`)
      return v
    }
    switch (a) {
      case '--model': opts.model = next(); break
      case '--key': opts.key = next(); break
      case '--n': opts.n = Number(next()); break
      case '--base-url': opts.baseUrl = next().replace(/\/+$/, ''); break
      case '--out': opts.out = next(); break
      case '--temperature': opts.temperature = Number(next()); break
      case '--max-tokens': opts.maxTokens = Number(next()); break
      case '--timeout': opts.timeoutSec = Number(next()); break
      case '--dry-run': opts.dryRun = true; break
      case '-h': case '--help': usage(); process.exit(0)
      default: fail(`不明な引数: ${a}`)
    }
  }
  if (!opts.dryRun && !opts.model) fail('--model を指定してください（例: --model anthropic/claude-sonnet-4）')
  if (!Number.isInteger(opts.n) || opts.n < 1) fail('--n は 1 以上の整数')
  return opts
}

function usage() {
  console.log(
    'node scripts/baseline.mjs --model <モデル> [--key <APIキー>] [--n 30] [--base-url <URL>] [--out <path>]\n' +
      '                          [--temperature 0.9] [--max-tokens 4096] [--timeout 180] [--dry-run]',
  )
}

function fail(msg) {
  console.error(`エラー: ${msg}`)
  usage()
  process.exit(1)
}

// ---------------------------------------------------------------------------
// system プロンプト（1枚）
// ---------------------------------------------------------------------------

/** `prompts.ts` の `characterBlock` と同じ並び */
function characterBlock(c, label) {
  const lines = [`### ${label}「${c.name || '名無し'}」`]
  if (c.persona.trim()) lines.push(`人格: ${c.persona.trim()}`)
  if (c.speechStyle.trim()) lines.push(`口調: ${c.speechStyle.trim()}`)
  if (c.appearance.trim()) lines.push(`外見: ${c.appearance.trim()}`)
  if (c.exampleDialogues.trim()) lines.push(`セリフ例:\n${c.exampleDialogues.trim()}`)
  return lines.join('\n')
}

/**
 * 定義を全部まとめる。デルシアが**ターンごと・シーンごとに出し入れしているもの**を、ここでは
 * 静的な定義としてぜんぶ最初から置く（ロアは全件常時・開始時の場面と予定も定義として書く）。
 * 状態機械が作るもの（あらすじ・関係性 prose・気分・時間の更新・突き合わせの一文）は**無い**。
 */
function buildFlatSystemPrompt({ world, characters, session }) {
  const focus = characters.find((c) => c.id === session.focusCharacterId)
  const focusName = focus?.name ?? ''
  const preset = world.startPreset ?? {}
  const parts = []

  // 世界観: 概要＋ロア全件（キーワード一致の仕組みが無いので、素のチャットでは全部貼るしかない）
  const lore = (world.entries ?? []).filter((e) => e.enabled !== false && e.content.trim()).map((e) => e.content.trim())
  parts.push(`【世界観: ${world.name}】\n${[world.description.trim(), ...lore].filter(Boolean).join('\n\n')}`)

  // 開始時の場面・時間・控えている出来事（素材側の開始テンプレートに書いてある静的な情報）
  const startLines = []
  if (preset.openingSceneNote?.trim()) startLines.push(preset.openingSceneNote.trim())
  if (preset.startNow?.trim()) startLines.push(`物語が始まる時点は「${preset.startNow.trim()}」です。`)
  if (startLines.length) parts.push(`【物語の始まり】\n${startLines.join('\n')}`)
  const pending = (preset.initialPending ?? []).filter((p) => p.what?.trim())
  if (pending.length) {
    parts.push(`【控えている出来事】\n${pending.map((p) => `- ${p.when ? `${p.when}: ` : ''}${p.what}`).join('\n')}`)
  }

  // 登場人物（中心人物ラベル付き。`buildSystemPrompt` 2 と同じ）
  parts.push(
    `【登場人物】\n${characters
      .map((c) => characterBlock(c, c.id === session.focusCharacterId ? '中心人物' : '登場人物'))
      .join('\n\n')}`,
  )

  // 新しい登場人物（サンプルは allow。`buildSystemPrompt` 2.5 と同文）
  parts.push(
    `【新しい登場人物】\n物語に必要であれば、上に定義されていない人物を新しく登場させて構いません。` +
      `その場合は名前・立場が読者に伝わるように描写し、以後は同じ名前で一貫して扱ってください。`,
  )

  // 中心人物（`buildSystemPrompt` 3 と同文）
  if (focusName) {
    parts.push(
      `【中心人物】\n物語は「${focusName}」を中心に描かれます。` +
        `情景と心情は${focusName}が見聞きし感じ取れる範囲で書いてください。`,
    )
  }

  // 物語設定（`buildSystemPrompt` 4 と同文）
  const s = session.story
  const sParts = []
  if (s.genre.trim()) sParts.push(`ジャンル・トーン: ${s.genre.trim()}`)
  if (s.premise.trim()) sParts.push(`あらすじ・前提: ${s.premise.trim()}`)
  if (sParts.length) parts.push(`【物語設定】\n${sParts.join('\n')}`)

  // 最初の方向付け。デルシアでは最初のシーンに居る間だけ注入されるが、シーンが無いのでずっと置く
  const directive = s.initialDirective?.trim()
  if (directive) {
    parts.push(
      `【最初の方向付け】\n物語の立ち上がりでは、次の方向性を踏まえて展開してください:\n${directive.replaceAll('@', '＠')}`,
    )
  }

  // 文体ルール（`buildSystemPrompt` 6・novel・構造化出力あり と同文）
  const heroName = focusName || '主人公'
  parts.push(
    `あなたは熟練の小説家です。情景・心情・行動を描く「地の文」と、登場人物のセリフ「…」を自然に織り交ぜた小説形式で執筆します。\n` +
      `【執筆ルール】\n` +
      `- 地の文と会話を混在させ、一篇の小説のように書いてください。セリフは鉤括弧「」で示します。\n` +
      `- 1回の応答で1〜3段落。情景→会話→展開、と流れを作り、物語を前へ進めてください。\n` +
      `- 場面の終わりに、続きが気になる引きや${heroName}が行動したくなる余白を残してください。\n` +
      `- ${heroName}（ユーザー）の心情や決断を勝手に断定しすぎず、選択の余地を残してください。\n` +
      `- ユーザー入力は物語への介入・行動として自然に地の文へ取り込んでください。メタ発言は避けてください。`,
  )

  // セリフの出力形式（`buildSystemPrompt` 8 と同文）。サンプルは構造化出力 ON なので対照側も同じ形で書かせ、
  // 書き出し時に同じ規則で剥がす（出力の見た目の差で出所が分からないように）
  parts.push(
    `【セリフの出力形式（厳守）】\n` +
      `- 登場人物のセリフは、1発話につき1行で、行頭を「@名前」にしてから鉤括弧のセリフを続けてください。\n` +
      `  例: @美咲「ほんとに？　ありがとう！」\n` +
      `- 地の文（情景・心情・行動の描写）は行頭に @ を付けず、普通の文章として書いてください。\n` +
      `- セリフ行に地の文を混ぜない。地の文に鉤括弧のセリフを埋め込まない（発話は必ず @ 行に分ける）。\n` +
      `- 名前は【登場人物】の表記を正確に使ってください。名前の無い脇役は「@店員「…」」のように役割名で構いません。`,
  )

  return parts.join('\n\n')
}

/** デルシアの `CONTINUE_PROMPT` と同文 */
const CONTINUE_PROMPT = '（続けて。物語をさらに展開させてください。）'

/** 導入文の `@タグ` を実名へ（`resolveIntroText` と同じ結果） */
function resolveIntro(opening, bindings, characters) {
  let text = opening
  for (const b of bindings ?? []) {
    const name = characters.find((c) => c.id === b.characterId)?.name
    if (name) text = text.replaceAll(`@${b.tag}`, `@${name}`)
  }
  return text
}

/**
 * `@名前「セリフ」` → `名前「セリフ」`（`structured.ts` の `plainTextOf` と同じ規則）。
 * デルシア側の書き出しはこの形になるので、対照側も同じ見た目に落とす。
 */
const NARRATION_NAMES = new Set(['地の文', '地文', 'ナレーション', 'ナレーター', 'narration', 'narrator'])
function plainTextOf(content) {
  return content
    .split('\n')
    .map((line) => {
      if (!line.startsWith('@')) return line
      const body = line.slice(1)
      const m = body.match(/^([^「]{1,24})/)
      const name = m?.[1]?.trim() ?? ''
      if (!name) return line
      const rest = body.slice((m?.[0] ?? '').length).trim()
      if (NARRATION_NAMES.has(name.toLowerCase())) return rest
      if (!rest) return line
      return `${name}${rest}`
    })
    .join('\n')
}

/** ローカルモデルが本文に混ぜる思考ブロックは本文ではないので落とす */
function stripThinking(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

// ---------------------------------------------------------------------------
// API（OpenAI 互換 Chat Completions・非ストリーミング）
// ---------------------------------------------------------------------------

function isOpenRouter(baseUrl) {
  try {
    return /(^|\.)openrouter\.ai$/i.test(new URL(baseUrl).hostname)
  } catch {
    return false
  }
}

async function chat(opts, messages) {
  const headers = { 'Content-Type': 'application/json' }
  if (opts.key) headers.Authorization = `Bearer ${opts.key}`
  const body = {
    model: opts.model,
    messages,
    temperature: opts.temperature,
    max_tokens: opts.maxTokens,
    stream: false,
    // OpenRouter だけコスト込みの usage を求める（他の互換サーバは未知フィールドで 400 を返すことがある）
    ...(isOpenRouter(opts.baseUrl) ? { usage: { include: true } } : {}),
  }
  const maxAttempts = 3
  for (let attempt = 1; ; attempt++) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), opts.timeoutSec * 1000)
    try {
      const res = await fetch(`${opts.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ac.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        const retryable = res.status === 429 || res.status >= 500
        if (retryable && attempt < maxAttempts) {
          console.warn(`  ${res.status}。${attempt * 5} 秒待って再試行（${attempt}/${maxAttempts}）`)
          await sleep(attempt * 5000)
          continue
        }
        throw new Error(`API エラー (${res.status}): ${text.slice(0, 300) || res.statusText}`)
      }
      const json = await res.json()
      const choice = json.choices?.[0]
      const content = stripThinking(String(choice?.message?.content ?? ''))
      return {
        content,
        finishReason: choice?.finish_reason ?? null,
        usage: json.usage
          ? {
              promptTokens: json.usage.prompt_tokens ?? 0,
              completionTokens: json.usage.completion_tokens ?? 0,
              cost: json.usage.cost,
            }
          : undefined,
        upstream: json.provider,
      }
    } catch (e) {
      const transient = e?.name === 'AbortError' || e?.name === 'TypeError' || e?.code === 'ECONNRESET'
      if (transient && attempt < maxAttempts) {
        console.warn(`  通信エラー（${e?.message ?? e}）。${attempt * 5} 秒待って再試行（${attempt}/${maxAttempts}）`)
        await sleep(attempt * 5000)
        continue
      }
      throw e
    } finally {
      clearTimeout(timer)
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))

  // 素材はアプリと同じ定数を読む（写しを持たない）。Node の型剥がしで .ts を直接 import する
  const starter = await import(new URL('../src/starter/index.ts', import.meta.url))
  const world = starter.starterWorld()
  const characters = starter.starterCharacters()
  const session = starter.starterSessionSeed()

  const system = buildFlatSystemPrompt({ world, characters, session })
  const opening = resolveIntro(session.story.opening, session.introBindings, characters)

  if (opts.dryRun) {
    console.log('===== system =====')
    console.log(system)
    console.log('\n===== assistant（導入） =====')
    console.log(opening)
    console.log(`\n===== user × ${opts.n} =====\n${CONTINUE_PROMPT}`)
    return
  }

  const out = resolve(opts.out || resolve(here, 'out', `baseline-${opts.model.replace(/[^\w.-]+/g, '_')}-${stamp()}.md`))
  await mkdir(dirname(out), { recursive: true })

  const messages = [
    { role: 'system', content: system },
    { role: 'assistant', content: opening },
  ]
  const turns = []
  const bodyParts = [plainTextOf(opening).trim()]
  const startedAt = Date.now()
  let stoppedEarly = null

  console.log(`モデル ${opts.model} @ ${opts.baseUrl}／N=${opts.n}／temperature=${opts.temperature}`)
  for (let i = 1; i <= opts.n; i++) {
    const t0 = Date.now()
    messages.push({ role: 'user', content: CONTINUE_PROMPT })
    let reply
    try {
      reply = await chat(opts, messages)
      if (!reply.content) {
        // 空応答は1回だけ取り直す（温度 0.9 なら次は出ることが多い）
        console.warn('  空の応答。1回だけ取り直します')
        reply = await chat(opts, messages)
      }
    } catch (e) {
      stoppedEarly = `ターン ${i} で中断: ${e?.message ?? e}`
      console.error(`  ${stoppedEarly}`)
      messages.pop()
      break
    }
    if (!reply.content) {
      stoppedEarly = `ターン ${i} で中断: 空の応答が続いた`
      console.error(`  ${stoppedEarly}`)
      messages.pop()
      break
    }
    messages.push({ role: 'assistant', content: reply.content })
    bodyParts.push(plainTextOf(reply.content).trim())
    const sec = ((Date.now() - t0) / 1000).toFixed(1)
    turns.push({
      turn: i,
      chars: reply.content.length,
      finishReason: reply.finishReason,
      usage: reply.usage,
      upstream: reply.upstream,
      seconds: Number(sec),
    })
    const u = reply.usage
    console.log(
      `[${String(i).padStart(2)}/${opts.n}] ${reply.content.length} 字・${sec}s` +
        (u ? `・in ${u.promptTokens} / out ${u.completionTokens}${u.cost != null ? ` / $${u.cost.toFixed(4)}` : ''}` : '') +
        (reply.finishReason && reply.finishReason !== 'stop' ? `・finish=${reply.finishReason}` : ''),
    )
    // 途中で落ちても読めるものが残るように、毎ターン書き出す
    await writeFile(out, bodyParts.join('\n\n') + '\n', 'utf8')
  }

  const total = turns.reduce(
    (acc, t) => ({
      promptTokens: acc.promptTokens + (t.usage?.promptTokens ?? 0),
      completionTokens: acc.completionTokens + (t.usage?.completionTokens ?? 0),
      cost: t.usage?.cost != null ? (acc.cost ?? 0) + t.usage.cost : acc.cost,
    }),
    { promptTokens: 0, completionTokens: 0, cost: undefined },
  )
  const meta = {
    kind: 'baseline',
    createdAt: new Date().toISOString(),
    model: opts.model,
    baseUrl: opts.baseUrl,
    n: opts.n,
    completedTurns: turns.length,
    stoppedEarly,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
    bodyChars: bodyParts.join('\n\n').length,
    total,
    turns,
    systemPrompt: system,
    continuePrompt: CONTINUE_PROMPT,
  }
  await writeFile(out, bodyParts.join('\n\n') + '\n', 'utf8')
  await writeFile(`${out}.meta.json`, JSON.stringify(meta, null, 2) + '\n', 'utf8')

  console.log(
    `\n${turns.length}/${opts.n} ターン・本文 ${meta.bodyChars.toLocaleString()} 字・${meta.elapsedSeconds}s` +
      `・in ${total.promptTokens.toLocaleString()} / out ${total.completionTokens.toLocaleString()} tokens` +
      (total.cost != null ? ` / $${total.cost.toFixed(4)}` : ''),
  )
  console.log(`本文: ${out}\nメタ: ${out}.meta.json`)
  if (stoppedEarly) process.exitCode = 2
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
