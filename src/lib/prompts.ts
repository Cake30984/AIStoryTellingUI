import type { Character, Message, Persona, RoleParty, Scene, Session, World } from '../types'
import type { ChatMessage } from './openrouter'
import { roleMembers } from './casting'
import { splitLoreEntries } from './lorebook'
import { plainTextOf } from './structured'
import {
  estimateTokens,
  RAW_WINDOW_BRIDGE_TOKENS,
  RAW_WINDOW_KEEP_RATIO,
  SCENE_WIND_DOWN_TOKENS,
  SCENE_WRAP_UP_TOKENS,
  sceneTokensOf,
} from './tokens'

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
 *
 * **この関数の出力はシーン境界でしか変わってはいけない**（PC1+PC4）。
 * プロンプトキャッシュの粒度はメッセージ単位で、system を1文字でも変えると system 全体が無効になるため
 * （実測: 可変ブロックを system のどこに置いてもヒット率 2%）。
 * 毎ターン変わる要素——キーワード一致のロア・会話劇の話者指定・ペース制御のナッジ——は
 * `buildMessages` が深さ3／深さ0のメッセージとして注入する。
 * 日付・トークン数・乱数のような動的な値をここへ足さないこと。
 * `docs/詳細設計_プロンプト構造とキャッシュ.md` §5
 */
export function buildSystemPrompt(session: Session, refs: ResolvedRefs): string {
  const parts: string[] = []

  // 1. 世界観（概要 + 常時ロア）
  // キーワード一致のロア（matched）は毎ターン入れ替わるので system には入れない（深さ3へ）
  if (refs.world) {
    const wParts: string[] = []
    if (refs.world.description.trim()) wParts.push(refs.world.description.trim())
    const { always } = splitLoreEntries(refs.world, session.messages)
    for (const e of always) {
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

  // 5. 固定メモ（作者ノート）は深さ3へ移した（PC1+PC4。近接させた方が効く）

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

  // 6.5 シーンのペース制御（FB5-①）と 7. 今回の話者指定は深さ0へ移した（PC1+PC4）。
  // どちらも毎ターン変わりうるので system に置くとキャッシュが全損する。

  // 8. セリフの出力形式（構造化出力）
  if (session.structuredOutput) {
    parts.push(
      `【セリフの出力形式（厳守）】\n` +
        `- 登場人物のセリフは、1発話につき1行で、行頭を「@名前」にしてから鉤括弧のセリフを続けてください。\n` +
        `  例: @美咲「ほんとに？　ありがとう！」\n` +
        `- 地の文（情景・心情・行動の描写）は行頭に @ を付けず、普通の文章として書いてください。\n` +
        `- セリフ行に地の文を混ぜない。地の文に鉤括弧のセリフを埋め込まない（発話は必ず @ 行に分ける）。\n` +
        `- 名前は【登場人物】の表記を正確に使ってください。名前の無い脇役は「@店員「…」」のように役割名で構いません。`,
    )
  }

  return parts.join('\n\n')
}

/**
 * 可変ブロックを差し込む深さ（末尾から何件手前か）。
 * 実測ヒット率は深さ0で95%・深さ3で87%＝直近3件ぶんしか失わない。
 * `docs/詳細設計_プロンプト構造とキャッシュ.md` §0.1 F4
 */
const INJECT_DEPTH = 3

/** 末尾から depth 件手前へ差し込む。履歴が足りなければ system 直後へクランプする */
function insertAtDepth(history: ChatMessage[], depth: number, content: string): ChatMessage[] {
  const at = Math.max(0, history.length - depth)
  return [...history.slice(0, at), { role: 'user' as const, content }, ...history.slice(at)]
}

/**
 * 深さ3に差し込む1通（PC1+PC4）。「素材 → 拘束」の順。
 * ここに置くのは「毎ターン変わりうるが、いま直ちに効かせる必要はない」もの。
 * 空文字なら差し込まない。
 */
function depthThreeContent(session: Session, refs: ResolvedRefs): string {
  const parts: string[] = []
  // 素材: 直近の会話にキーワードが当たったロア（system から追い出した主犯）
  const { matched } = splitLoreEntries(refs.world, session.messages)
  const lore = matched.map((e) => e.content.trim()).filter((t) => t.length > 0)
  if (lore.length) parts.push(`【今回の場面に関わる設定】\n${lore.join('\n\n')}`)
  // TODO(PC-B): 【状態→帰結の拘束文】（迎合対策の文面）はここへ入る。文面は実測で決まるため未実装
  // 拘束: 作者ノート（system から近接位置へ移した）
  if (session.authorNote.trim()) parts.push(`【常に踏まえる重要事項】\n${session.authorNote.trim()}`)
  return parts.join('\n\n')
}

/**
 * 末尾（深さ0）に積む1通（PC1+PC4）。「いま直ちに効かせたい」ものだけ。
 * **毎ターン非キャッシュなので短さが命**＝形式の再掲は1行に留める。
 */
function depthZeroContent(
  session: Session,
  refs: ResolvedRefs,
  activeCharacter?: Character,
): string {
  const parts: string[] = []
  const novel = session.narrativeStyle === 'novel'

  // グループ会話: 今回の話者を指定（会話劇のみ）
  if (!novel && session.mode === 'roleplay' && refs.characters.length > 1) {
    if (activeCharacter) {
      parts.push(`【今回の応答】\n「${activeCharacter.name}」として、その人物の発言・描写のみを返してください。`)
    } else {
      parts.push(
        `【今回の応答】\n` +
          `この場面で最も自然に発言するキャラクターを1人選び、その人物として応答してください。` +
          (session.structuredOutput
            ? `セリフはすべて @名前 行で書くため、応答の先頭に「キャラ名: 」は付けないでください。`
            : `応答は必ず「キャラ名: 」で始めてください。`),
      )
    }
  }

  // シーンのペース制御（FB5-①）: 現在シーンが長くなってきたら収束へ向かわせる。
  // メッセージ履歴には積まず、毎回の組み立て時に推定トークンから判定する（状態を持たない）。
  // 「今すぐ畳め」という指示なので深さ0＝最も近い位置に置く。
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

  // 形式の再掲（system の詳細な指示から遠ざかった分の押さえ。短く）
  parts.push(
    session.structuredOutput
      ? `（セリフは行頭 @名前 の1行、地の文は @ を付けない。1〜3段落で書く。）`
      : `（地の文とセリフを織り交ぜて1〜3段落。）`,
  )

  return parts.join('\n\n')
}

/** シーンごとの原文トークン量（概算）。空メッセージ・シーン未所属のメッセージは数えない */
function sceneTokenMap(messages: Message[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const m of messages) {
    if (!m.sceneId || !m.content.trim()) continue
    map.set(m.sceneId, (map.get(m.sceneId) ?? 0) + estimateTokens(m.content))
  }
  return map
}

/**
 * 原文（要約ではなく本文）で送るシーンの範囲を決める（PC3）。純関数。
 *
 * **シーン開始時（`beginScene`）に1回だけ呼び、結果を `Session.rawWindowFromSceneId` に保存する**
 * ——毎ターン計算すると履歴が伸びるだけでシーンの途中で窓が動いてしまい、
 * 「シーン途中で畳む」という最悪の切り方になるため（畳み方4原則③）。
 *
 * 4原則のうちここが担うのは ①階段状に畳む（`RAW_WINDOW_KEEP_RATIO`）と ②橋を残す。
 * ③はこの関数を呼ぶ場所（シーン境界のみ）が、④は落ちたシーンの `summary` を
 * 【これまでのあらすじ】へ載せる既存の `priorSummaries` が担う（追加実装なし）。
 *
 * @param budget 原文で送るトークン予算（`RAW_WINDOW_TOKENS`）
 * @param previousFromSceneId 前回確定した窓の起点（`Session.rawWindowFromSceneId`）。
 *   **①のヒステリシスに必要**——「前回どこまで畳んだか」が無いと、予算を超えるたびに毎回
 *   その場で切り直す＝窓が1シーンずつ滑る形にしかならない（詳細設計の引数表には無い追加）。
 * @returns `fromSceneId`＝原文で送る最古のシーン id。
 *   `bridgeTail`＝窓から落ちた直前シーンから末尾だけ残す指定（無ければ undefined）
 * `docs/詳細設計_プロンプト構造とキャッシュ.md` §7.2
 */
export function selectRawScenes(
  scenes: Scene[],
  messages: Message[],
  currentSceneId: string | null,
  budget: number,
  previousFromSceneId?: string,
): { fromSceneId: string; bridgeTail?: { sceneId: string; tokens: number } } {
  const found = currentSceneId ? scenes.findIndex((sc) => sc.id === currentSceneId) : -1
  const at = found >= 0 ? found : scenes.length - 1
  if (at < 0) return { fromSceneId: currentSceneId ?? '' }

  const tokens = sceneTokenMap(messages)
  const tokensOf = (id: string) => tokens.get(id) ?? 0

  // 起点は前回の窓を引き継ぐ（無効・未設定なら現在シーンから）
  const prev = previousFromSceneId ? scenes.findIndex((sc) => sc.id === previousFromSceneId) : -1
  const hasPrev = prev >= 0 && prev <= at
  let from = hasPrev ? prev : at
  let total = 0
  for (let i = from; i <= at; i++) total += tokensOf(scenes[i].id)

  // 古い方へ広げるのは**前回の窓が無いとき（初回・復旧）だけ**。
  // 前回の窓があるなら、それより古いシーンは既に「落とした」もの＝戻さない。
  // 戻すと、畳んだ直後に余った予算ぶん再拡張 → 次のシーンでまた畳む、の振動になる。
  if (!hasPrev) {
    for (let i = from - 1; i >= 0; i--) {
      const t = tokensOf(scenes[i].id)
      if (total + t > budget) break
      total += t
      from = i
    }
  }

  // 超過したときだけ、予算の 60% に収まるまで古い方から**まとめて**落とす（原則①）。
  // 「超えたぶんだけ」落とすと次のシーンでまた1つ落ちる＝毎シーン滑るので、一度に余地を作る。
  if (total > budget) {
    const room = budget * RAW_WINDOW_KEEP_RATIO
    while (total > room && from < at) {
      total -= tokensOf(scenes[from].id)
      from++
    }
  }

  const droppedIndex = from - 1
  const dropped = droppedIndex >= 0 ? scenes[droppedIndex] : undefined
  return {
    fromSceneId: scenes[from].id,
    ...(dropped && tokensOf(dropped.id) > 0
      ? { bridgeTail: { sceneId: dropped.id, tokens: RAW_WINDOW_BRIDGE_TOKENS } }
      : {}),
  }
}

/**
 * 原文で送るシーン範囲を `session.rawWindowFromSceneId` から復元する（PC3）。
 * **ここで予算計算はしない**（窓を動かしてよいのはシーン開始時だけ）。
 * 参照が使えない場合——未設定（旧データ・最初のシーン）／分岐の巻き戻しでシーンごと消えた／
 * 現在シーンより後ろを指している——は null を返し、呼び出し側は「現在シーンのみ」＝PC3 以前へ落とす。
 *
 * 窓が現在シーンまで畳まれている（`from === currentSceneId`）場合も null にはしない——
 * その状態こそ橋（②）が要る場面で、直前シーンの原文末尾が唯一の接続になるため。
 */
function rawWindowOf(
  session: Session,
  currentSceneId: string | null,
): { ids: Set<string>; bridgeSceneId?: string } | null {
  const from = session.rawWindowFromSceneId
  if (!currentSceneId || !from) return null
  const curIndex = session.scenes.findIndex((sc) => sc.id === currentSceneId)
  const fromIndex = session.scenes.findIndex((sc) => sc.id === from)
  if (curIndex < 0 || fromIndex < 0 || fromIndex > curIndex) return null
  return {
    ids: new Set(session.scenes.slice(fromIndex, curIndex + 1).map((sc) => sc.id)),
    // 橋は「窓の1つ手前のシーン」＝`selectRawScenes` が返す bridgeTail と同じ位置（保存不要な導出値）
    ...(fromIndex > 0 ? { bridgeSceneId: session.scenes[fromIndex - 1].id } : {}),
  }
}

/** 末尾から budget トークンぶんのメッセージを返す。橋の意味が消えるので最低1件は必ず残す */
function tailByTokens(messages: Message[], budget: number): Message[] {
  const out: Message[] = []
  let total = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = estimateTokens(messages[i].content)
    if (out.length > 0 && total + t > budget) break
    out.unshift(messages[i])
    total += t
  }
  return out
}

/**
 * API に送る messages 配列を作る。
 *
 * 組み立て順（PC1+PC4）: system（シーン境界でしか変わらない） → 橋 → 履歴 →
 * 深さ3の1通（可変ロア・作者ノート） → 深さ0の1通（話者指定・締めのナッジ・形式の再掲）。
 * 呼び出し側の追加念押し（`CONTINUATION_NUDGE` 等）はさらにその後ろに積まれる。
 *
 * 履歴に載せる範囲は `session.rawWindowFromSceneId` が決める（PC3。現在シーンだけとは限らない）。
 * ここでは予算計算をしない＝窓を動かしてよいのはシーン開始時（`beginScene`）だけ。
 *
 * 選択肢生成はこの関数を使わない（PC2'。`choicesMessages` が専用の圧縮した文脈を組み立てる）。
 */
export function buildMessages(
  session: Session,
  refs: ResolvedRefs,
  activeCharacter?: Character,
): ChatMessage[] {
  const system: ChatMessage = {
    role: 'system',
    content: buildSystemPrompt(session, refs),
  }
  // 会話劇のグループ時のみ、誰の発言かをテキストに織り込む（構造化出力ONでは @ 行が話者を運ぶためスキップ）
  const multi = session.narrativeStyle !== 'novel' && refs.characters.length > 1 && !session.structuredOutput
  const nameOf = (id?: string) => refs.characters.find((c) => c.id === id)?.name
  const toChat = (m: Message): ChatMessage => {
    if (m.role === 'assistant' && multi) {
      const nm = nameOf(m.characterId)
      return { role: 'assistant' as const, content: nm ? `${nm}: ${m.content}` : m.content }
    }
    return { role: m.role, content: m.content }
  }

  const filled = session.messages.filter((m) => m.content.trim().length > 0)
  // 原文で送る範囲（PC3）。窓が未確定なら従来どおり現在シーンのみ（過去シーンは要約で引き継ぐ）
  const win = rawWindowOf(session, refs.currentSceneId)
  const history: ChatMessage[] = filled
    .filter((m) =>
      win
        ? !m.sceneId || win.ids.has(m.sceneId)
        : !refs.currentSceneId || !m.sceneId || m.sceneId === refs.currentSceneId,
    )
    .map(toChat)
  // 橋（PC3 の畳み方4原則②）: 窓から落ちた直前シーンの原文末尾だけ残す。
  // あらすじは system の【これまでのあらすじ】が持つが、固有名詞・約束・言い回しは要約で落ちるため。
  const bridge: ChatMessage[] = win?.bridgeSceneId
    ? tailByTokens(
        filled.filter((m) => m.sceneId === win.bridgeSceneId),
        RAW_WINDOW_BRIDGE_TOKENS,
      ).map(toChat)
    : []

  const depth3 = depthThreeContent(session, refs)
  const withBridge = bridge.length ? [...bridge, ...history] : history
  const body = depth3 ? insertAtDepth(withBridge, INJECT_DEPTH, depth3) : withBridge
  const depth0 = depthZeroContent(session, refs, activeCharacter)
  return depth0 ? [system, ...body, { role: 'user', content: depth0 }] : [system, ...body]
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
export function choicesSystem(mode: 'always' | 'auto', jsonSchema = false): string {
  const base = `あなたは物語の選択肢デザイナーです。直前の場面を踏まえ、主人公（ユーザー）が次に取りうる行動・展開の選択肢を考えます。\n`
  // JSON スキーマで固定する場合は root がオブジェクトである必要があるため、包んだ形を指示する
  // （`jsonSchemas.ts` の CHOICES_SCHEMA と対。指示とスキーマが食い違わないようにする）
  const format = jsonSchema
    ? `出力は {"choices": [...]} の JSON のみ（前後に文章を付けない）。各要素は10〜30字程度の短い行動・選択の文字列。例: {"choices":["剣を抜いて立ち向かう","そっと後ずさる","話しかけてみる"]}\n`
    : `出力は JSON 配列のみ（前後に文章を付けない）。各要素は10〜30字程度の短い行動・選択の文字列。例: ["剣を抜いて立ち向かう","そっと後ずさる","話しかけてみる"]\n`
  if (mode === 'auto') {
    return (
      base +
      format +
      `ただし、選択を挟むのが不自然な場面（描写の途中など）では${jsonSchema ? '空の配列（choices: []）' : '空配列 []'}を返してください。挟むべき局面でのみ2〜4個。`
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

function headOf(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** 【登場人物】に載せる1キャラぶんの一行（PC2'）。フルの `characterBlock` は載せない＝短さが命 */
function choicesCharacterLine(c: Character): string {
  const bits = [c.persona, c.speechStyle].map((s) => s.trim()).filter((s) => s.length > 0)
  const desc = bits.length ? headOf(bits.join('・'), 40) : ''
  return desc ? `${c.name}: ${desc}` : c.name
}

/** 末尾 count 件の本文を自然表記（`plainTextOf`）の行にする。話者名の織り込みは `buildMessages` と同じ規則 */
function recentPlainLines(session: Session, refs: ResolvedRefs, count: number): string[] {
  const multi = session.narrativeStyle !== 'novel' && refs.characters.length > 1 && !session.structuredOutput
  const nameOf = (id?: string) => refs.characters.find((c) => c.id === id)?.name
  const history = session.messages
    .filter((m) => m.content.trim().length > 0)
    .filter((m) => !refs.currentSceneId || !m.sceneId || m.sceneId === refs.currentSceneId)
  return history.slice(-count).map((m) => {
    const text = plainTextOf(m.content)
    if (m.role === 'assistant' && multi) {
      const nm = nameOf(m.characterId)
      return nm ? `${nm}: ${text}` : text
    }
    return text
  })
}

/** 選択肢生成へ渡す直近本文の件数（PC2'）。全履歴は渡さない */
const CHOICES_RECENT_MESSAGES = 4

/**
 * 選択肢生成用の messages を組み立てる（PC2'）。
 *
 * 本編の system・履歴全文は使わず、選択肢の質に効く要素だけを user 1通へ圧縮する:
 * 【登場人物】（名前＋一言）／【状態（現在）】（`refs.stateInfo`）／
 * 【直前のあらすじ】（`priorSummaries` の末尾1件のみ）／【直近の本文】（末尾数件・`plainTextOf` 適用）。
 * 続く user 1通は従来どおり `choicesUserNudge`。
 *
 * 上位設計 PC2（R1 との system 接頭辞共有）は却下し、この「文脈を削る」対案を採る——
 * R2 は既に system 固定により自系列でヒットしており（実測平均46%）、接頭辞共有は送信量を約1.6倍にして
 * ヒット時ほぼ相殺・ミス時は明確に悪化するため（キャッシュヒットは確率的。F5・F7。
 * `docs/詳細設計_プロンプト構造とキャッシュ.md` §6）。
 *
 * `choicesSystem` はここでは jsonSchema なしの版を積む。JSON スキーマ対応モデル向けの差し替えは
 * 呼び出し側（`genChoices`）が返り値の先頭（system）を上書きして行う。
 */
export function choicesMessages(
  session: Session,
  refs: ResolvedRefs,
  mode: 'always' | 'auto',
): ChatMessage[] {
  const parts: string[] = []
  if (refs.characters.length) {
    parts.push(`【登場人物】\n${refs.characters.map(choicesCharacterLine).join('\n')}`)
  }
  if (refs.stateInfo.trim()) {
    parts.push(`【状態（現在）】\n${refs.stateInfo.trim()}`)
  }
  const lastSummary = refs.priorSummaries[refs.priorSummaries.length - 1]
  if (lastSummary) {
    parts.push(`【直前のあらすじ】\n■ ${lastSummary.title}\n${lastSummary.summary}`)
  }
  const recent = recentPlainLines(session, refs, CHOICES_RECENT_MESSAGES)
  if (recent.length) parts.push(`【直近の本文】\n${recent.join('\n')}`)
  return [
    { role: 'system', content: choicesSystem(mode) },
    { role: 'user', content: parts.join('\n\n') },
    { role: 'user', content: choicesUserNudge(mode) },
  ]
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
 * レビューの分割単位（PC-A A-2）。`a`＝何が起きたか／`b`＝状態がどう動いたか／`all`＝従来の一本。
 * docs/詳細設計_プロンプト構造とキャッシュ.md §3.2
 */
export type ReviewPart = 'all' | 'a' | 'b'

/**
 * シーン終了レビュー（要約＋次シーン提案＋成長＋関係性 prose＋スタット）生成用の system プロンプト。
 * 原則「事実は数、判断は言葉」：関係の機微は relationUpdates（prose）、数値の増減は statChanges。
 * ポイントの確定はこのレビューに一本化（選択肢の事前 effects は FB7-C で廃止）＝
 * 選択肢経由・自由入力の独自行動を問わず「実際に起きた結果」を評価して加点する。
 *
 * `part` で出力させる項目を絞れる（PC-A A-2。2本を並列に投げて待ち時間を半減させる）。
 * 状態変動の拘束（次元・ステータス・カウンター・世界のレビュー指針）は B のみに入れる＝
 * A の suggestions が状態変動の方針で歪まないようにするため。
 * @param part 出力させる項目の範囲（`a`/`b`/`all`）
 * @param aspectNames ワールド固定の関係次元名。空でなければその次元のみ使うよう拘束。
 * @param stats    ワールド定義のステータス（名前＋変動幅）。空なら statChanges は空配列。
 * @param counters ワールド定義の行動カウンター（名前＋計上条件メモ＋加算幅）。空なら counterEvents は空配列。
 * @param reviewGuidance 世界観のレビュー指針（自由記述）。あれば毎回そのまま注入する。
 */
export function reviewSystem(
  part: ReviewPart,
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
  // 【世界のレビュー指針】は状態変動の方針なので B（と all）にだけ入れる（A の suggestions を歪めない）
  const wantsGuidance = part !== 'a'
  const guidanceBlock =
    wantsGuidance && reviewGuidance?.trim() ? `\n【世界のレビュー指針】\n${reviewGuidance.trim()}\n` : ''
  const a = part !== 'b' // A の項目を出すか
  const b = part !== 'a' // B の項目を出すか

  const schema = [
    a &&
      `  "summary": "このシーンの引き継ぎ要約（日本語の文字列。改行は \\\\n で表現。重要な出来事・関係や心情の変化・約束や未解決事項・終了時の状況を含む）",`,
    a && `  "suggestions": [ {"title":"次シーンの短い見出し","note":"次シーンの状況・方向性の説明（2〜3文）"} ],`,
    a && `  "characterGrowth": [ {"name":"キャラ名","addition":"今回の展開で新たに判明/深化した性格・背景を一文で"} ],`,
    a && `  "worldGrowth": [ {"keys":["トリガー語"],"content":"新たに判明した世界設定"} ],`,
    b &&
      `  "relationUpdates": [ {"character":"キャラ名","stance":"そのキャラの主人公への関係の現在地を1〜2文で","aspects":[{"name":"次元名","note":"その次元の現在の機微（肯定・否定の両面を具体的に）"}],"reason":"変化の根拠（一文）"} ],`,
    b && `  "moods": [ {"character":"キャラ名","mood":"終了時点の気分（一語〜短句）"} ],`,
    b && `  "statChanges": [ {"name":"ステータス名","character":"キャラ名（省略可＝主人公/全体）","delta":3,"reason":"変化の理由（一文）"} ],`,
    b && `  "counterEvents": [ {"name":"カウンター名","character":"キャラ名（省略可＝全体）","amount":1,"reason":"該当する行動（一文）"} ]`,
  ].filter((x): x is string => !!x)
  // 分割時に末尾の行だけ余分なカンマが残らないようにする
  const schemaBody = schema.map((line, i) => (i === schema.length - 1 ? line.replace(/,$/, '') : line))

  const rules = [
    a && `- summary は必ず JSON 文字列（string）で返す。配列や改行そのままは不可。`,
    a &&
      `- suggestions は2〜3個。**各案はこのシーン終了直後の「同一の起点」から分岐する、相互に排他な"次シーンの候補"**。案どうしは時系列でつながってはならない。【次シーンの時間】があればその時刻にふさわしい状況で書く（直前の続きをそのまま続けない）。`,
    a && `- characterGrowth / worldGrowth は、既存設定に無い"新しく分かったこと"のみ。無ければ空配列。`,
    b &&
      `- **relationUpdates**：各キャラが主人公（ユーザー）に抱く関係を、与えられた【現在の関係性】を踏まえて**書き直す**（差分でなく現時点の全文）。今シーンで変化していない機微（好悪・約束）は失わず維持して書く。変化が無いキャラは省略可。${aspectLine}`,
    b && `- moods は各キャラの終了時点の気分。変化が無いキャラは省略可。`,
    b &&
      `- **statChanges**：行動・出来事に対応する数値の増減のみ（delta は相対値。例: デートした→好感度+3）。感情の"査定"ではなく、起きた事実に対応する固定的な変化として出す。${statLine}`,
    b &&
      `- **counterEvents**：今シーンで実際に起きた行動の累計回数の計上（例: デートした→デート回数 amount:1）。起きていない行動は計上しない。${counterLine}`,
    b &&
      `- 主人公の行動は、提示された選択肢を選んだ場合も自由入力の独自行動も同様に、実際に起きた結果に基づいて statChanges / counterEvents に反映し、reason にその行動と結果を書く。`,
    `- 推測の捏造はせず、会話に根拠があるものだけ。`,
  ].filter((x): x is string => !!x)

  return (
    `あなたは物語編集アシスタントです。直前のシーンの会話を分析し、次の JSON のみを出力してください（前後に文章・コードフェンスを付けない）。\n` +
    `{\n` +
    schemaBody.join('\n') +
    `\n}\n` +
    `指針:\n` +
    rules.join('\n') +
    `\n` +
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
