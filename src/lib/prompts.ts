import type { Character, Persona, Session, World } from '../types'
import type { ChatMessage } from './openrouter'
import { selectLoreEntries } from './lorebook'

export interface ResolvedRefs {
  /** 現在のシーンに登場するキャラ */
  characters: Character[]
  world?: World
  persona?: Persona
  /** 過去シーンの引き継ぎ要約（これまでのあらすじ） */
  priorSummaries: { title: string; summary: string }[]
  /** 現在シーンの状況メモ */
  sceneNote: string
  /** 現在シーンの ID（履歴の絞り込みに使用） */
  currentSceneId: string | null
  /** タイムラインの説明文（空なら無効） */
  timelineInfo: string
  /** 終盤が近いか（クライマックス促し） */
  nearEnd: boolean
  /** 現在シーンの種類ガイド（演出エンジン） */
  sceneTypeGuidance: string
}

/** キャラ1人の定義ブロックを作る */
function characterBlock(c: Character, label?: string): string {
  const head = label ? `${label}「${c.name || '名無し'}」` : `「${c.name || '名無し'}」`
  const lines: string[] = [`### ${head}`]
  if (c.persona.trim()) lines.push(`人格: ${c.persona.trim()}`)
  if (c.speechStyle.trim()) lines.push(`口調: ${c.speechStyle.trim()}`)
  if (c.appearance.trim()) lines.push(`外見: ${c.appearance.trim()}`)
  const devs = (c.developments ?? []).filter((d) => d.enabled).map((d) => d.text)
  if (devs.length > 0) lines.push(`これまでの展開で判明した設定:\n- ${devs.join('\n- ')}`)
  if (c.exampleDialogues.trim()) lines.push(`セリフ例:\n${c.exampleDialogues.trim()}`)
  return lines.join('\n')
}

/**
 * system プロンプトを組み立てる。
 * activeCharacter が指定された場合は「その人物として応答」を末尾に明示。
 */
export function buildSystemPrompt(
  session: Session,
  refs: ResolvedRefs,
  activeCharacter?: Character,
): string {
  const parts: string[] = []

  // 1. 世界観（概要 + ロアブック）
  if (refs.world) {
    const wParts: string[] = []
    if (refs.world.description.trim()) wParts.push(refs.world.description.trim())
    const lore = selectLoreEntries(refs.world, session.messages)
    for (const e of lore) {
      if (e.content.trim()) wParts.push(e.content.trim())
    }
    if (wParts.length) {
      parts.push(`【世界観: ${refs.world.name}】\n${wParts.join('\n\n')}`)
    }
  }

  // 1.5 これまでのあらすじ（過去シーンの引き継ぎ要約）
  if (refs.priorSummaries.length) {
    const recap = refs.priorSummaries
      .map((s) => `■ ${s.title}\n${s.summary}`)
      .join('\n\n')
    parts.push(`【これまでのあらすじ】\n${recap}`)
  }

  // 1.6 現在シーンの状況
  if (refs.sceneNote.trim()) {
    parts.push(`【現在の場面】\n${refs.sceneNote.trim()}`)
  }

  // 1.7 時間・期間
  if (refs.timelineInfo) {
    let t = `【時間】\n${refs.timelineInfo}`
    if (refs.nearEnd) t += `\n物語は終盤です。クライマックスに向けて収束させてください。`
    parts.push(t)
  }

  // 1.8 今回のシーンの方向性（演出エンジン）
  if (refs.sceneTypeGuidance.trim()) {
    parts.push(`【今回のシーンの方向性】\n${refs.sceneTypeGuidance.trim()}`)
  }

  const novel = session.narrativeStyle === 'novel'

  // 2. キャラクター定義
  if (novel) {
    if (refs.characters.length) {
      const blocks = refs.characters.map((c) => characterBlock(c, '登場人物')).join('\n\n')
      parts.push(`【登場人物】\n${blocks}`)
    }
  } else if (session.mode === 'roleplay') {
    if (refs.characters.length === 1) {
      const c = refs.characters[0]
      parts.push(
        `あなたは次のキャラクターになりきってロールプレイを行います。一人称・口調・性格を一貫して保ってください。\n\n${characterBlock(c)}`,
      )
    } else if (refs.characters.length > 1) {
      const blocks = refs.characters.map((c) => characterBlock(c)).join('\n\n')
      parts.push(
        `あなたは以下の複数キャラクターが登場する群像劇を演じます。それぞれの人格・口調を厳密に演じ分けてください。\n\n${blocks}`,
      )
    }
  } else {
    // 物語モード: 登場人物として扱う
    if (refs.characters.length) {
      const blocks = refs.characters.map((c) => characterBlock(c, '登場人物')).join('\n\n')
      parts.push(`【主要登場人物】\n${blocks}`)
    }
  }

  // 3. ユーザーペルソナ
  if (refs.persona && (refs.persona.name.trim() || refs.persona.description.trim())) {
    parts.push(
      `【ユーザーが演じる人物】\n${refs.persona.name.trim()}${
        refs.persona.description.trim() ? `: ${refs.persona.description.trim()}` : ''
      }`,
    )
  }

  // 4. 物語モードの前提
  if (session.mode === 'story') {
    const s = session.story
    const sParts: string[] = []
    if (s.genre.trim()) sParts.push(`ジャンル・トーン: ${s.genre.trim()}`)
    if (s.premise.trim()) sParts.push(`あらすじ・前提: ${s.premise.trim()}`)
    if (s.protagonist.trim()) sParts.push(`主人公: ${s.protagonist.trim()}`)
    if (sParts.length) parts.push(`【物語設定】\n${sParts.join('\n')}`)
  }

  // 5. 固定メモ（作者ノート）
  if (session.authorNote.trim()) {
    parts.push(`【常に踏まえる重要事項】\n${session.authorNote.trim()}`)
  }

  // 6. 文体・ルール
  if (novel) {
    const heroName = refs.persona?.name?.trim() || '主人公'
    parts.push(
      `あなたは熟練の小説家です。情景・心情・行動を描く「地の文」と、登場人物のセリフ「…」を自然に織り交ぜた小説形式で執筆します。\n` +
        `【執筆ルール】\n` +
        `- 地の文と会話を混在させ、一篇の小説のように書いてください。セリフは鉤括弧「」で示します。\n` +
        `- 誰の発言か紛らわしい場合のみ、「名前「セリフ」」の形で話者を示してください（多用しすぎない）。\n` +
        `- 1回の応答で1〜3段落。情景→会話→展開、と流れを作り、物語を前へ進めてください。\n` +
        `- 場面の終わりに、続きが気になる引きや${heroName}が行動したくなる余白を残してください。\n` +
        `- ${heroName}（ユーザー）の心情や決断を勝手に断定しすぎず、選択の余地を残してください。\n` +
        `- ユーザー入力は物語への介入・行動として自然に地の文へ取り込んでください。メタ発言は避けてください。`,
    )
  } else if (session.mode === 'roleplay') {
    parts.push(
      `【ルール】\n` +
        `- 地の文（情景・心情描写）とセリフを自然に織り交ぜてください。\n` +
        `- ユーザーの行動・セリフを勝手に決めず、キャラクター側の言動のみ描写してください。\n` +
        `- メタ発言（AIである旨など）は避け、世界観を壊さないでください。`,
    )
  } else {
    parts.push(
      `あなたは熟練の小説家・ゲームマスターです。\n` +
        `【執筆ルール】\n` +
        `- 1回の応答で1〜3段落の場面を描写し、物語を確実に前へ進めてください。\n` +
        `- 場面の終わりに、続きが気になる引きやユーザーが介入したくなる余白を残してください。\n` +
        `- ユーザー入力は物語への介入・方向づけとして自然に取り込んでください。\n` +
        `- 「続けて」と促された場合は、あなたの裁量で展開してください。`,
    )
  }

  // 7. グループ会話: 今回の話者を指定（会話劇のみ）
  if (!novel && session.mode === 'roleplay' && refs.characters.length > 1) {
    if (activeCharacter) {
      parts.push(`【今回の応答】\n「${activeCharacter.name}」として、その人物の発言・描写のみを返してください。`)
    } else {
      parts.push(
        `【今回の応答】\n` +
          `この場面で最も自然に発言するキャラクターを1人選び、その人物として応答してください。` +
          `応答は必ず「キャラ名: 」で始めてください。`,
      )
    }
  }

  return parts.join('\n\n')
}

/** API に送る messages 配列を作る */
export function buildMessages(
  session: Session,
  refs: ResolvedRefs,
  activeCharacter?: Character,
): ChatMessage[] {
  const system: ChatMessage = {
    role: 'system',
    content: buildSystemPrompt(session, refs, activeCharacter),
  }
  // 会話劇のグループ時のみ、誰の発言かをテキストに織り込む
  const multi = session.narrativeStyle !== 'novel' && refs.characters.length > 1
  const nameOf = (id?: string) => refs.characters.find((c) => c.id === id)?.name
  // 履歴は現在シーンの発言のみ（過去シーンは要約で引き継ぐ）
  const history: ChatMessage[] = session.messages
    .filter((m) => m.content.trim().length > 0)
    .filter((m) => !refs.currentSceneId || !m.sceneId || m.sceneId === refs.currentSceneId)
    .map((m) => {
      if (m.role === 'assistant' && multi) {
        const nm = nameOf(m.characterId)
        return { role: 'assistant' as const, content: nm ? `${nm}: ${m.content}` : m.content }
      }
      return { role: m.role, content: m.content }
    })
  return [system, ...history]
}

export const CONTINUE_PROMPT = '（続けて。物語をさらに展開させてください。）'

/** 新しいシーンの導入を書かせるための擬似ユーザー入力 */
export const SCENE_START_PROMPT = '（新しい場面が始まります。情景の導入から自然に書き始めてください。）'

/** 選択肢生成用の system プロンプト */
export function choicesSystem(mode: 'always' | 'auto'): string {
  const base =
    `あなたは物語の選択肢デザイナーです。直前の場面を踏まえ、主人公（ユーザー）が次に取りうる行動・展開の選択肢を考えます。\n` +
    `出力は JSON 配列のみ（前後に文章を付けない）。各要素は10〜30字程度の短い行動・選択。例: ["剣を抜いて立ち向かう","そっと後ずさる","話しかけてみる"]\n`
  if (mode === 'auto') {
    return (
      base +
      `ただし、選択を挟むのが不自然な場面（描写の途中など）では空配列 [] を返してください。挟むべき局面でのみ2〜4個。`
    )
  }
  return base + `2〜4個の選択肢を返してください。`
}

/** シーン終了レビュー（要約＋次シーン提案＋成長）生成用の system プロンプト */
export function reviewSystem(): string {
  return (
    `あなたは物語編集アシスタントです。直前のシーンの会話を分析し、次の JSON のみを出力してください（前後に文章・コードフェンスを付けない）。\n` +
    `{\n` +
    `  "summary": "このシーンの引き継ぎ要約（日本語の文字列。改行は \\\\n で表現。重要な出来事・関係や心情の変化・約束や未解決事項・終了時の状況を含む）",\n` +
    `  "suggestions": [ {"title":"次シーンの短い見出し","note":"次シーンの状況・方向性の説明（2〜3文）"} ],\n` +
    `  "characterGrowth": [ {"name":"キャラ名","addition":"今回の展開で新たに判明/深化した性格・背景を一文で"} ],\n` +
    `  "worldGrowth": [ {"keys":["トリガー語"],"content":"新たに判明した世界設定"} ]\n` +
    `}\n` +
    `指針:\n` +
    `- summary は必ず JSON 文字列（string）で返す。配列や改行そのままは不可。\n` +
    `- suggestions は必ず2〜3個。方向性を変える（「このシーンの続き」「一段落して別のイベント」など）。\n` +
    `- characterGrowth / worldGrowth は、既存設定に無い"新しく分かったこと"のみ。無ければ空配列。\n` +
    `- 推測の捏造はせず、会話に根拠があるものだけ。`
  )
}

/** シーン要約（引き継ぎメモ）生成用の system プロンプト */
export const SUMMARY_SYSTEM =
  `あなたは物語の記録係です。次のシーンの会話を、後で物語を再開するための「引き継ぎメモ」として要約してください。\n` +
  `次の観点を簡潔な日本語の箇条書きでまとめてください（冗長な描写は省く）：\n` +
  `- 起きた重要な出来事\n` +
  `- 人物の関係・心情の変化\n` +
  `- 交わした約束や未解決の事柄\n` +
  `- シーン終了時点の状況（場所・時間・誰がどこにいるか）\n` +
  `見出しや前置きは不要です。箇条書きのみを出力してください。`
