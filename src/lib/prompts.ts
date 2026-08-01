import type { Character, Persona, RoleParty, Session, World } from '../types'
import type { ChatMessage } from './openrouter'
import { roleMembers } from './casting'
import { selectLoreEntries } from './lorebook'
import { SCENE_WIND_DOWN_TOKENS, SCENE_WRAP_UP_TOKENS, sceneTokensOf } from './tokens'

export interface ResolvedRefs {
  /** 現在のシーンに登場するキャラ */
  characters: Character[]
  /** セッション参加キャラ全員（配役の動的解決用。現在シーン外も含む） */
  allCharacters: Character[]
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
  /** 関係性 prose・気分・注入対象スタットの現在値（空なら無効） */
  stateInfo: string
  /** エピローグシーン滞在中のみ設定（到達した結末のトーン指示。docs/設計_エンディング.md） */
  ending?: { name: string; guidance: string; subjects?: RoleParty[] }
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

/** 配役済みロール（グループ）を毎ターン実名で注入する。@記法はモデルへ渡さない（A-2）。 */
function castingBlock(session: Session, refs: ResolvedRefs): string | undefined {
  const roles = (refs.world?.roles ?? []).filter((role) => role.id.trim() && role.name.trim())
  if (roles.length === 0) return undefined
  const members = roleMembers(roles, session.roleAssignments, refs.allCharacters)
  const safe = (text: string) => text.trim().replaceAll('@', '＠')
  const lines = roles.flatMap((role) => {
    const characters = members.get(role.id) ?? []
    if (characters.length === 0) return []
    const names = characters.map((character) => safe(character.name)).join('・')
    const description = safe(role.description)
    return [`- ${names} —「${safe(role.name)}」${description ? `: ${description}` : ''}`]
  })
  return lines.length ? `【配役】\nこの物語における各キャラクターの立ち位置:\n${lines.join('\n')}` : undefined
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

  const casting = castingBlock(session, refs)
  if (casting) parts.push(casting)

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
    // 時間帯の区切りがある場合、シーン内での時間帯ドリフト（昼のシーンが進行中に夜へ進む等）を防ぐ。
    // 時間帯を進めるのはシーンの切り替わり（レビュー確定）の役割。
    const tl = session.timeline
    const slotName = tl.slots[tl.currentSlot] ?? ''
    if (tl.enabled && tl.slots.length > 1 && slotName && slotName !== '1日') {
      t +=
        `\nこのシーンは「${slotName}」の時間帯の中の出来事です。シーン内で時間帯を先へ進めないでください` +
        `（例: 昼の場面が途中で夕方や夜になってはいけない）。大きな時間経過はシーンの切り替わりが担います。` +
        `場面の状況で別の時間経過が明示されている場合のみ、そちらを優先してください。`
    }
    if (refs.nearEnd) t += `\n物語は終盤です。クライマックスに向けて収束させてください。`
    parts.push(t)
  }

  // 1.8 エンディング（エピローグシーン滞在中のみ。nearEnd はこの間スキップ済み）
  if (refs.ending) {
    // 当事者つきエンディング（subject な group 節）は「誰との結末か」をロールごとに明示する
    const subjects = (refs.ending.subjects ?? []).filter((p) => p.members.length > 0)
    const subjectLines = subjects.map((p) => `${p.roleName}: ${p.members.map((m) => m.name).join('・')}`)
    const allNames = subjects.flatMap((p) => p.members.map((m) => m.name))
    const partnerLine = subjectLines.length
      ? `\n相手: ${subjectLines.join(' / ')}。この結末は ${allNames.join('・')} との関係の帰結として描いてください。`
      : ''
    parts.push(
      `【エンディング】\nこの物語は結末「${refs.ending.name}」のエピローグに入っています。` +
        (refs.ending.guidance.trim() ? `（${refs.ending.guidance.trim()}）` : '') +
        partnerLine +
        `\n新しい事件・伏線を起こさず、これまでの感情と関係の帰着を描いてください。` +
        `\n数ターンで余韻を残して物語を締めくくる方向で書きます。`,
    )
  }

  // 1.9 状態（関係性 prose・気分・注入対象スタット）
  if (refs.stateInfo.trim()) {
    parts.push(
      `【状態（現在）】\n${refs.stateInfo.trim()}\n` +
        `関係性の記述と矛盾しない態度・口調・距離感で各キャラを描写してください（記述やステータスの数値はセリフに出さない）。`,
    )
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
    if (sParts.length) parts.push(`【物語設定】\n${sParts.join('\n')}`)

    // 4.5 最初の方向付け（FB5-②）: 最初のシーンに滞在している間だけ注入する非表示の指示。
    // チャットには出さない。@ 記法はモデルへ渡さない規約に合わせて無害化する（配役の実名は【配役】が伝える）。
    const directive = s.initialDirective?.trim()
    const isFirstScene = session.scenes.length > 0 && session.scenes[0].id === session.currentSceneId
    if (directive && isFirstScene) {
      parts.push(
        `【最初の方向付け】\n物語の立ち上がり（この最初のシーンのみ）では、次の方向性を踏まえて展開してください:\n${directive.replaceAll('@', '＠')}`,
      )
    }
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
        `${session.structuredOutput ? '' : '- 誰の発言か紛らわしい場合のみ、「名前「セリフ」」の形で話者を示してください（多用しすぎない）。\n'}` +
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

  // 6.5 シーンのペース制御（FB5-①）: 現在シーンが長くなってきたら収束へ向かわせる。
  // メッセージ履歴には積まず、毎回の組み立て時に推定トークンから判定する（状態を持たない）。
  // エピローグは【エンディング】に専用の締め指示があるため対象外。
  if (!refs.ending) {
    const sceneTokens = sceneTokensOf(session)
    if (sceneTokens >= SCENE_WRAP_UP_TOKENS) {
      parts.push(
        `【シーンの締め】\nこの場面は十分な長さに達しています。新しい話題・場所・事件を持ち込まず、` +
          `次の1〜2回の応答でこの場面を自然な一区切りへ着地させてください（続きが気になる引きは残してよい）。`,
      )
    } else if (sceneTokens >= SCENE_WIND_DOWN_TOKENS) {
      parts.push(
        `【シーンの収束】\nこの場面は後半に入っています。新しい展開を広げすぎず、` +
          `いま起きている流れをまとめる方向で書き進めてください。`,
      )
    }
  }

  // 7. グループ会話: 今回の話者を指定（会話劇のみ）
  if (!novel && session.mode === 'roleplay' && refs.characters.length > 1) {
    if (activeCharacter) {
      parts.push(`【今回の応答】\n「${activeCharacter.name}」として、その人物の発言・描写のみを返してください。`)
    } else {
      parts.push(
        `【今回の応答】\n` +
          `この場面で最も自然に発言するキャラクターを1人選び、その人物として応答してください。` +
          (session.structuredOutput
            ? `セリフはすべて @名前(感情) 行で書くため、応答の先頭に「キャラ名: 」は付けないでください。`
            : `応答は必ず「キャラ名: 」で始めてください。`),
      )
    }
  }

  // 8. セリフの出力形式（構造化出力）
  if (session.structuredOutput) {
    parts.push(
      `【セリフの出力形式（厳守）】\n` +
        `- 登場人物のセリフは、1発話につき1行で、行頭を「@名前(感情)」にしてから鉤括弧のセリフを続けてください。\n` +
        `  例: @美咲(joy)「ほんとに？　ありがとう！」\n` +
        `- 感情は neutral / joy / anger / sadness / shy / surprise の6語のみ（括弧内は英語小文字のまま）。\n` +
        `- 地の文（情景・心情・行動の描写）は行頭に @ を付けず、普通の文章として書いてください。\n` +
        `- セリフ行に地の文を混ぜない。地の文に鉤括弧のセリフを埋め込まない（発話は必ず @ 行に分ける）。\n` +
        `- 名前は【登場人物】の表記を正確に使ってください。名前の無い脇役は「@店員(neutral)「…」」のように役割名で構いません。`,
    )
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
  // 会話劇のグループ時のみ、誰の発言かをテキストに織り込む（構造化出力ONでは @ 行が話者を運ぶためスキップ）
  const multi = session.narrativeStyle !== 'novel' && refs.characters.length > 1 && !session.structuredOutput
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

/**
 * 「⤵ 続きを生成」（上限到達で途中で切れた出力の続き）専用の念押し。
 * 履歴には積まず、API 送信時だけ末尾に付加する（appendToId で同一メッセージへ追記するため、
 * 何も指示しないとモデルが書き出しからやり直したり同じ内容を繰り返したりすることがある）。
 */
export const CONTINUATION_NUDGE =
  '（直前のあなたの出力が途中で切れています。書き出しからやり直したり同じ内容を繰り返したりせず、' +
  '続きの文章だけを、直前の文末に自然につながる形でそのまま書き継いでください。）'

/**
 * 選択肢生成用の system プロンプト。
 * 選択肢は行動の提示のみ＝加点（旧 P5 の effects）は持たない（FB7-C。評価はシーン終了レビューが行う）。
 */
export function choicesSystem(mode: 'always' | 'auto'): string {
  const base = `あなたは物語の選択肢デザイナーです。直前の場面を踏まえ、主人公（ユーザー）が次に取りうる行動・展開の選択肢を考えます。\n`
  const format = `出力は JSON 配列のみ（前後に文章を付けない）。各要素は10〜30字程度の短い行動・選択の文字列。例: ["剣を抜いて立ち向かう","そっと後ずさる","話しかけてみる"]\n`
  if (mode === 'auto') {
    return (
      base +
      format +
      `ただし、選択を挟むのが不自然な場面（描写の途中など）では空配列 [] を返してください。挟むべき局面でのみ2〜4個。`
    )
  }
  return base + format + `2〜4個の選択肢を返してください。`
}

/**
 * 選択肢生成の直前に積む user メッセージ。
 * モデルは直近の user 指示に強く従うため、本編の続き（地の文）ではなく
 * JSON 配列を確実に出力させるための念押し。
 */
export function choicesUserNudge(mode: 'always' | 'auto'): string {
  const head =
    `↑の直前の場面を踏まえ、主人公（ユーザー）が次に取る行動の選択肢を、` +
    `指示どおりの JSON 配列だけで出力してください。物語の続き・地の文・説明は書かないこと。`
  return mode === 'auto'
    ? `${head}（選択を挟むのが不自然なら [] を返す）`
    : `${head} 上で指定した形式・個数を厳守すること。`
}

/** reviewSystem に渡すステータス定義の要点（変動幅は範囲付き列挙とクランプの両方に使う。FB7-C） */
export interface ReviewStatSpec {
  name: string
  deltaMin?: number
  deltaMax?: number
}

/** reviewSystem に渡すカウンター定義の要点（FB7-C） */
export interface ReviewCounterSpec {
  name: string
  /** どんな時に計上するかの作者メモ（FB9-C。そのままモデルへ渡す） */
  note?: string
  amountMin?: number
  amountMax?: number
}

/** 「±5〜15」「±5以上」「±〜15」等の変動幅ラベル（範囲未指定なら空文字） */
function rangeLabel(prefix: string, min?: number, max?: number): string {
  if (min != null && max != null) return `${prefix}${min}〜${max}`
  if (min != null) return `${prefix}${min}以上`
  if (max != null) return `${prefix}〜${max}`
  return ''
}

/**
 * シーン終了レビュー（要約＋次シーン提案＋成長＋関係性 prose＋スタット）生成用の system プロンプト。
 * 原則「事実は数、判断は言葉」：関係の機微は relationUpdates（prose）、数値の増減は statChanges。
 * ポイントの確定はこのレビューに一本化（選択肢の事前 effects は FB7-C で廃止）＝
 * 選択肢経由・自由入力の独自行動を問わず「実際に起きた結果」を評価して加点する。
 * @param aspectNames ワールド固定の関係次元名。空でなければその次元のみ使うよう拘束。
 * @param stats    ワールド定義のステータス（名前＋変動幅）。空なら statChanges は空配列。
 * @param counters ワールド定義の行動カウンター（名前＋計上条件メモ＋加算幅）。空なら counterEvents は空配列。
 * @param reviewGuidance 世界観のレビュー指針（自由記述）。あれば毎回そのまま注入する。
 */
export function reviewSystem(
  aspectNames: string[],
  stats: ReviewStatSpec[],
  counters: ReviewCounterSpec[] = [],
  reviewGuidance?: string,
): string {
  const aspectLine = aspectNames.length
    ? `relationUpdates.aspects の name は既存の【${aspectNames.join('・')}】のみを使う（新しい次元を作らない）。該当する変化が無い次元は省略してよい。`
    : `次元未定義のため relationUpdates.aspects は空配列にし、stance のみ更新する。`
  const statList = stats
    .map((d) => {
      const r = rangeLabel('±', d.deltaMin, d.deltaMax)
      return r ? `${d.name}（動かすなら${r}）` : d.name
    })
    .join('・')
  const statHasRange = stats.some((d) => d.deltaMin != null || d.deltaMax != null)
  const statLine = stats.length
    ? `statChanges.name は既存の【${statList}】のみを使う。該当が無ければ空配列。` +
      (statHasRange
        ? `括弧内の範囲は「そのシーンの出来事の大きさ」の物差し＝平凡なシーンは下限寄り、決定的な出来事では上限近くまで使ってよい（変動させない場合は項目を出さない）。`
        : '')
    : `ステータス未定義のため statChanges は空配列。`
  // note（計上条件）と加算幅を1つの括弧にまとめる＝括弧が二重にならないようにする（FB9-C）
  const counterList = counters
    .map((d) => {
      const parts = [d.note?.trim(), rangeLabel('加算するなら', d.amountMin, d.amountMax)].filter(
        Boolean,
      )
      return parts.length ? `${d.name}（${parts.join('。')}）` : d.name
    })
    .join('・')
  const counterLine = counters.length
    ? `counterEvents.name は既存の【${counterList}】のみを使う。括弧内はそのカウンターを計上する条件＝**そこに書かれた出来事が今シーンで実際に起きた時だけ**計上する（amount は通常1）。一度きりで十分な種類の出来事（告白した・秘密を知った等）は、既に計上済みなら重ねて出さない。無ければ空配列。`
    : `カウンター未定義のため counterEvents は空配列。`
  const guidanceBlock = reviewGuidance?.trim()
    ? `\n【世界のレビュー指針】\n${reviewGuidance.trim()}\n`
    : ''
  return (
    `あなたは物語編集アシスタントです。直前のシーンの会話を分析し、次の JSON のみを出力してください（前後に文章・コードフェンスを付けない）。\n` +
    `{\n` +
    `  "summary": "このシーンの引き継ぎ要約（日本語の文字列。改行は \\\\n で表現。重要な出来事・関係や心情の変化・約束や未解決事項・終了時の状況を含む）",\n` +
    `  "suggestions": [ {"title":"次シーンの短い見出し","note":"次シーンの状況・方向性の説明（2〜3文）"} ],\n` +
    `  "characterGrowth": [ {"name":"キャラ名","addition":"今回の展開で新たに判明/深化した性格・背景を一文で"} ],\n` +
    `  "worldGrowth": [ {"keys":["トリガー語"],"content":"新たに判明した世界設定"} ],\n` +
    `  "relationUpdates": [ {"character":"キャラ名","stance":"そのキャラの主人公への関係の現在地を1〜2文で","aspects":[{"name":"次元名","note":"その次元の現在の機微（肯定・否定の両面を具体的に）"}],"reason":"変化の根拠（一文）"} ],\n` +
    `  "moods": [ {"character":"キャラ名","mood":"終了時点の気分（一語〜短句）"} ],\n` +
    `  "statChanges": [ {"name":"ステータス名","character":"キャラ名（省略可＝主人公/全体）","delta":3,"reason":"変化の理由（一文）"} ],\n` +
    `  "counterEvents": [ {"name":"カウンター名","character":"キャラ名（省略可＝全体）","amount":1,"reason":"該当する行動（一文）"} ]\n` +
    `}\n` +
    `指針:\n` +
    `- summary は必ず JSON 文字列（string）で返す。配列や改行そのままは不可。\n` +
    `- suggestions は2〜3個。**各案はこのシーン終了直後の「同一の起点」から分岐する、相互に排他な"次シーンの候補"**。案どうしは時系列でつながってはならない。【次シーンの時間】があればその時刻にふさわしい状況で書く（直前の続きをそのまま続けない）。\n` +
    `- characterGrowth / worldGrowth は、既存設定に無い"新しく分かったこと"のみ。無ければ空配列。\n` +
    `- **relationUpdates**：各キャラが主人公（ユーザー）に抱く関係を、与えられた【現在の関係性】を踏まえて**書き直す**（差分でなく現時点の全文）。今シーンで変化していない機微（好悪・約束）は失わず維持して書く。変化が無いキャラは省略可。${aspectLine}\n` +
    `- moods は各キャラの終了時点の気分。変化が無いキャラは省略可。\n` +
    `- **statChanges**：行動・出来事に対応する数値の増減のみ（delta は相対値。例: デートした→好感度+3）。感情の"査定"ではなく、起きた事実に対応する固定的な変化として出す。${statLine}\n` +
    `- **counterEvents**：今シーンで実際に起きた行動の累計回数の計上（例: デートした→デート回数 amount:1）。起きていない行動は計上しない。${counterLine}\n` +
    `- 主人公の行動は、提示された選択肢を選んだ場合も自由入力の独自行動も同様に、実際に起きた結果に基づいて statChanges / counterEvents に反映し、reason にその行動と結果を書く。\n` +
    `- 推測の捏造はせず、会話に根拠があるものだけ。\n` +
    guidanceBlock +
    `${guidanceBlock ? '上の【世界のレビュー指針】は状態変動の方針として毎回従うこと（条件つきの方針は、与えられた現在のステータス・カウンター・日付・本文の描写から判断する）。' : ''}`
  )
}

/**
 * 次シーン候補（suggestions）だけを作り直すための system プロンプト。
 * イベント/シーン種類を引き直した際に、新しい方向性で候補を再生成する。
 */
export function nextSceneSystem(): string {
  return (
    `あなたは物語編集アシスタントです。直前までのあらすじと「次シーンの方向性」を踏まえ、次シーンの候補のみを JSON で出力してください（前後に文章・コードフェンスを付けない）。\n` +
    `{ "suggestions": [ {"title":"次シーンの短い見出し","note":"次シーンの状況・方向性の説明（2〜3文）"} ] }\n` +
    `指針:\n` +
    `- suggestions は2〜3個。**各案はこのシーン終了直後の「同一の起点」から分岐する、相互に排他な候補**。案どうしは時系列でつながってはならない（案2が案1の続き・結果になってはいけない）。\n` +
    `- 与えられた【次シーンの方向性】に必ず沿う。【次シーンの時間】があれば、その時刻にふさわしい（時間が経過した後の）場面として書く。`
  )
}

/** 画像プロンプト起案用の system プロンプト（挿絵・アバター共通） */
export function illustrationPromptSystem(): string {
  return (
    `あなたはイラスト生成用プロンプトの起案アシスタントです。与えられた文脈から、その場面（または人物）を1枚の絵にするための英語プロンプトを作ってください。\n` +
    `出力は次の JSON のみ（説明・前置き・コードフェンス禁止）:\n` +
    `{"prompt": "英語のカンマ区切りタグまたは簡潔な英語描写", "negative": "避けたい要素の英語タグ"}\n` +
    `指針:\n` +
    `- キャラクターに【画像生成タグ】が与えられている場合は、その文字列を改変せずそのまま prompt に含める（LoRA トリガー等のため）。\n` +
    `- 人数・外見・構図・背景・光・雰囲気を具体的なタグにする。\n` +
    `- masterpiece 等の品質タグ、anime style / photorealistic 等の画風タグは入れない（接続先のデフォルトタグとして自動で付加される）。\n` +
    `- 本文が長い場合は最後の場面（本文の末尾）を描く。シーン全体のダイジェストにしない。`
  )
}

/** 画像プロンプト起案の user 文脈（挿絵用）。呼び出し側が素材を集めて渡す */
export function illustrationContextUser(args: {
  sceneTitle?: string
  sceneNote?: string
  timeLabel?: string
  characters: { name: string; appearance?: string; imagePrompt?: string }[]
  recentMessages: string[]
}): string {
  const parts: string[] = ['この場面の挿絵プロンプトを作成してください。']
  if (args.sceneTitle) parts.push(`【シーン】${args.sceneTitle}`)
  if (args.sceneNote) parts.push(`【状況】${args.sceneNote}`)
  if (args.timeLabel) parts.push(`【時間】${args.timeLabel}`)
  for (const c of args.characters) {
    const lines = [`【登場キャラ】${c.name}`]
    if (c.appearance) lines.push(`外見: ${c.appearance}`)
    if (c.imagePrompt) lines.push(`画像生成タグ: ${c.imagePrompt}`)
    parts.push(lines.join('\n'))
  }
  if (args.recentMessages.length > 0) {
    parts.push(`【このシーンの本文】\n${args.recentMessages.join('\n---\n')}`)
  }
  return parts.join('\n\n')
}

/** 画像プロンプト起案の user 文脈（アバター用） */
export function avatarContextUser(args: { name: string; appearance?: string; imagePrompt?: string }): string {
  const parts = [`このキャラクター1人のポートレート（バストアップ・正面）のプロンプトを作成してください。`, `【名前】${args.name}`]
  if (args.appearance) parts.push(`【外見】${args.appearance}`)
  if (args.imagePrompt) parts.push(`【画像生成タグ】${args.imagePrompt}`)
  return parts.join('\n')
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
