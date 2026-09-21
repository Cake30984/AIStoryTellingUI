import type { Character, Message, PromptStyle, Scene, Session, World } from '../types'
import type { ChatMessage } from './openrouter'
import { splitLoreEntries } from './lorebook'
import {
  estimateTokens,
  RAW_WINDOW_BRIDGE_TOKENS,
  RAW_WINDOW_KEEP_RATIO,
  countChars,
  SCENE_WIND_DOWN_CHARS,
  SCENE_WRAP_UP_CHARS,
} from './tokens'

/**
 * ふるまいの決まり方を述べる1文（深さ3の「拘束」側。`docs/詳細設計_プロンプト構造とキャッシュ.md` §4）。
 *
 * **PC-B の本実測（2026-08-06・740会話）で、この位置に置く迎合対策の文面は6案とも
 * 対照（この文）を上回らなかった**ため、切り替えハーネスごと畳んでこの1文に確定した。
 * 経緯と実測値は `docs/計測_迎合対策文面.md`。**「もっと強く縛る文面」を足す前にそこを読むこと**
 * ——強い禁止（旧 V1）は無理筋を減らさないまま妥当な求めを拒ませ、
 * 義務否定＋帰属の合成（旧 V2V5）はむしろ受容を増やした（どちらも有意ではないが改善もしていない）。
 *
 * 数値をセリフに出さない禁止はこの文と独立に常に要るので、ここには含めず system 側に置いてある
 * （`buildSystemPrompt` 1.9）。
 */
export const CONSEQUENCE_CLAUSE =
  '関係性の記述と矛盾しない態度・口調・距離感で各キャラを描写してください。'

export interface ResolvedRefs {
  /** セッションの参加キャラ全員（CS1 以降、シーン単位の絞り込みは無い） */
  characters: Character[]
  world?: World
  /**
   * 中心人物（`Session.focusCharacterId` の実体。`characters` にも含まれる）。
   * 物語モードでは視点人物、ロールプレイではユーザーが演じる人物（→ 設計_物語の簡素化.md §2.5）。
   */
  focus?: Character
  /** 過去シーンの引き継ぎ要約（これまでのあらすじ） */
  priorSummaries: { title: string; summary: string }[]
  /** 現在シーンの状況メモ */
  sceneNote: string
  /** 現在シーンの ID（履歴の絞り込みに使用） */
  currentSceneId: string | null
  /** 現在時刻（`SessionState.now`。空なら【時間】を出さない） */
  timelineInfo: string
  /**
   * 突き合わせ済みの一文（`SessionState` ではなく直近レビューの `tracker.foreground`）。
   * 空なら深さ0へ何も入れない（§2.4.1）
   */
  foreground: string
  /** 関係性 prose・気分（空なら無効） */
  stateInfo: string
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

  // 1.7 時間（§2.4.1）。`now` はシーン境界でしか変わらないので system 側に置く＝キャッシュを壊さない。
  // 突き合わせ済みの一文（foreground）は毎ターン側（深さ0）が持つ。
  if (refs.timelineInfo) {
    parts.push(
      `【時間】\n現在は「${refs.timelineInfo}」です。` +
        `\nこのシーンの中で時間を大きく先へ進めないでください（例: 昼の場面が途中で夜になってはいけない）。` +
        `大きな時間経過はシーンの切り替わりが担います。`,
    )
  }

  // 1.9 状態（関係性 prose・気分）
  // ふるまいの決まり方を述べる1文は深さ3へ移した（PC-B。近接させた方が効く＝作者ノートと同じ理屈）。
  // ここに残すのは**文面の候補によらず常に要る**数値の非露出だけ＝毎ターン byte 一致する（N3）
  if (refs.stateInfo.trim()) {
    parts.push(
      `【状態（現在）】\n${refs.stateInfo.trim()}\n` +
        `ここに書かれた記述は、セリフに出さないでください。`,
    )
  }

  const novel = session.narrativeStyle === 'novel'
  // 中心人物（F3）。ペルソナを廃したので、中心人物も他と同じ Character として定義に含める。
  // ロールプレイでは AI が演じるのは中心人物**以外**（中心人物はユーザーの分身）。
  const focusName = refs.focus?.name.trim() ?? ''
  const aiCharacters =
    session.mode === 'roleplay' && refs.focus
      ? refs.characters.filter((c) => c.id !== refs.focus!.id)
      : refs.characters

  // 2. キャラクター定義
  if (novel) {
    if (refs.characters.length) {
      const blocks = refs.characters
        .map((c) => characterBlock(c, c.id === refs.focus?.id ? '中心人物' : '登場人物'))
        .join('\n\n')
      parts.push(`【登場人物】\n${blocks}`)
    }
  } else if (session.mode === 'roleplay') {
    if (aiCharacters.length === 1) {
      const c = aiCharacters[0]
      parts.push(
        `あなたは次のキャラクターになりきってロールプレイを行います。一人称・口調・性格を一貫して保ってください。\n\n${characterBlock(c)}`,
      )
    } else if (aiCharacters.length > 1) {
      const blocks = aiCharacters.map((c) => characterBlock(c)).join('\n\n')
      parts.push(
        `あなたは以下の複数キャラクターが登場する群像劇を演じます。それぞれの人格・口調を厳密に演じ分けてください。\n\n${blocks}`,
      )
    }
    if (refs.focus) {
      parts.push(
        `【ユーザーが演じる人物】\n${characterBlock(refs.focus)}\n\nこの人物はユーザーが演じます。セリフ・行動を代わりに書かないでください。`,
      )
    }
  } else {
    // 物語モード: 登場人物として扱う
    if (refs.characters.length) {
      const blocks = refs.characters
        .map((c) => characterBlock(c, c.id === refs.focus?.id ? '中心人物' : '登場人物'))
        .join('\n\n')
      parts.push(`【主要登場人物】\n${blocks}`)
    }
  }

  // 2.5 新しい登場人物の登場ポリシー（発見キャラ・FB7-E）。
  // セッション設定なのでシーン境界どころか手動変更まで動かない＝system に置いてよい（PC1+PC4）。
  // allow は現行の暗黙の挙動を明文化するだけ（＝出さないと "出してよい" が伝わらないので出す）。
  parts.push(
    session.newCharacterPolicy === 'avoid'
      ? `【新しい登場人物】\n上に定義されていない名前付きの人物を新たに登場させないでください。` +
          `通行人・店員などの脇役が必要な場合も、名前を与えず役割だけ（「店員」「通りすがりの男」等）で描いてください。`
      : `【新しい登場人物】\n物語に必要であれば、上に定義されていない人物を新しく登場させて構いません。` +
          `その場合は名前・立場が読者に伝わるように描写し、以後は同じ名前で一貫して扱ってください。`,
  )

  // 3. 中心人物が何を意味するか（人物の定義そのものは 2 に含まれている。
  // ロールプレイでは 2 の【ユーザーが演じる人物】が同じ役目を果たすのでここでは出さない）
  if (focusName && session.mode !== 'roleplay') {
    parts.push(
      `【中心人物】\n物語は「${focusName}」を中心に描かれます。` +
        `情景と心情は${focusName}が見聞きし感じ取れる範囲で書いてください。`,
    )
  }

  // 3.5 目指す結末（F4・設計 §2.7）。**ゆるい方向付けであって到達判定ではない**
  // ＝コードは何も判定せず、ユーザーが「これで終える」を押すまで物語は続く。
  // セッション設定なのでシーン境界でも動かない＝system に置いてよい（PC1+PC4）。
  const goal = session.endingGoal
  if (goal && !session.ending && (goal.title.trim() || goal.outline.trim())) {
    parts.push(
      `【目指す結末】\n${goal.title.trim()}: ${goal.outline.trim()}\n` +
        `この結末へ**急がずに**近づけてください。まだ終わらせず、今の場面でできることだけを書きます。`,
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
    // チャットには出さない。@ 記法はモデルへ渡さない規約に合わせて無害化する。
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
    const heroName = focusName || '主人公'
    parts.push(
      `あなたは熟練の小説家です。情景・心情・行動を描く「地の文」と、登場人物のセリフ「…」を自然に織り交ぜた小説形式で執筆します。\n` +
        `【執筆ルール】\n` +
        `- 地の文と会話を混在させ、Web 小説のように書いてください。セリフは鉤括弧「」で示し、1発話を1行にします。\n` +
        `- 誰のセリフかは前後の地の文（動作・表情・呼びかけ）で分かるように書き、行頭に話者名や記号のラベルを付けないでください。\n` +
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
  // （旧 8.「セリフの出力形式」＝構造化出力は 2026-09-21 に撤去。行頭ラベルの有無がモデルごとに揺れ、
  //   表示が安定しなかった。本文は Web 小説の素の形に寄せる）

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
  // 拘束: 状態→帰結。状態が空なら「現在の関係性」が指す先が無いので出さない。
  // 見出しに「拘束」等の仕組みを匂わす語は使わない（leak を誘発しないため。実測では leak 0/740）
  if (refs.stateInfo.trim()) {
    parts.push(`【ふるまいの決まり方】\n${CONSEQUENCE_CLAUSE}`)
  }
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

  // 前景（§2.4）。現在時刻と予定を突き合わせた一文だけを渡す。
  // **予定リストそのものは渡さない**——実測でリストを入れると 28/30 で無関係な先の予定を
  // 列挙した（計測_時間と予定.md §4.1）。突き合わせは第3の呼び出しが済ませている。
  if (refs.foreground) parts.push(`【いまの状況】\n${refs.foreground}`)

  // グループ会話: 今回の話者を指定（会話劇のみ）
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

  // シーンのペース制御（FB5-①）: 現在シーンが長くなってきたら収束へ向かわせる。
  // メッセージ履歴には積まず、毎回の組み立て時に**本文の文字数**から判定する（状態を持たない。F5）。
  // 「今すぐ畳め」という指示なので深さ0＝最も近い位置に置く。
  {
    const sceneChars = sceneCharsOf(session)
    if (sceneChars >= SCENE_WRAP_UP_CHARS) {
      parts.push(
        `【シーンの締め】\nこの場面は十分な長さに達しています。新しい話題・場所・事件を持ち込まず、` +
          `次の1〜2回の応答でこの場面を自然な一区切りへ着地させてください（続きが気になる引きは残してよい）。`,
      )
    } else if (sceneChars >= SCENE_WIND_DOWN_CHARS) {
      parts.push(
        `【シーンの収束】\nこの場面は後半に入っています。新しい展開を広げすぎず、` +
          `いま起きている流れをまとめる方向で書き進めてください。`,
      )
    }
  }

  // 形式の再掲（system の詳細な指示から遠ざかった分の押さえ。短く）
  parts.push(`（地の文とセリフ「」を織り交ぜて1〜3段落。行頭に話者名のラベルは付けない。）`)

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
  // 会話劇のグループ時のみ、誰の発言かをテキストに織り込む
  const multi = session.narrativeStyle !== 'novel' && refs.characters.length > 1
  const nameOf = (id?: string) => refs.characters.find((c) => c.id === id)?.name
  const toChat = (m: Message): ChatMessage => {
    if (m.role === 'assistant' && multi) {
      const nm = nameOf(m.characterId)
      return { role: 'assistant' as const, content: nm ? `${nm}: ${m.content}` : m.content }
    }
    return { role: m.role, content: m.content }
  }

  const filled = session.messages
    .filter((m) => m.content.trim().length > 0)
    // 書き手への指示は枠付きの user メッセージとして送る（IN1）。枠は常に同じ文面＝履歴が byte 安定に保たれる
    .map((m) => (isDirective(m) ? { ...m, content: directivePromptText(m.content) } : m))
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

/**
 * 「書き手への指示」（IN1）を本編プロンプトへ載せるときの枠。
 *
 * **文面は常に固定**にする。「最新の指示だけ丁寧な枠・古いものは短縮形」にすると、新しい指示を送るたびに
 * 過去メッセージの中身が変わってプロンプトキャッシュが切れる（キャッシュ粒度はメッセージ単位＝
 * `docs/詳細設計_プロンプト構造とキャッシュ.md` §2）。枠が固定なら履歴は byte 安定のまま伸びる。
 *
 * system には何も足さない＝指示を1度も使わないセッションが説明文を毎ターン払わずに済む（PC1+PC4）。
 */
export const DIRECTIVE_HEADER =
  '【書き手への指示】これは登場人物の発言ではなく、書き手であるあなたへの指示です。' +
  '主人公が言った・行ったこととして扱わず、この指示文そのものを本文に書かずに、続きの描写へ反映してください。'

/** そのメッセージが「書き手への指示」か（判定はここに一本化する） */
export function isDirective(m: Pick<Message, 'kind'>): boolean {
  return m.kind === 'directive'
}

/**
 * そのメッセージが**物語の本文**か（F5）。読者が実際に読むものだけを真とする＝
 * system・進行マーカー（続ける／尺の指示／シーン開始）・書き手への指示は本文ではない。
 * 読者モデルでは物語モードのユーザー入力がすべて指示になるので、この区別が無いと
 * 「分量」が指示文で水増しされる。
 */
export function isStoryText(m: Pick<Message, 'role' | 'kind' | 'content'>): boolean {
  return m.role !== 'system' && !isDirective(m) && !isMarkerContent(m.content)
}

/**
 * 現在シーンの**本文の文字数**（F5・設計 §2.8）。バッジ表示とペース制御ナッジの共通判定。
 * ユーザーに見せる長さはトークンではなく文字数で数える（→ `tokens.ts` 冒頭の表）。
 */
export function sceneCharsOf(session: Session): number {
  const sceneId = session.currentSceneId ?? session.scenes[session.scenes.length - 1]?.id
  if (!sceneId) return 0
  return session.messages
    .filter((m) => m.sceneId === sceneId && isStoryText(m))
    .reduce((sum, m) => sum + countChars(m.content), 0)
}

/** 指示の本文を、API へ送る枠付きテキストへ変換する */
export function directivePromptText(content: string): string {
  return `${DIRECTIVE_HEADER}\n${content}`
}

export const CONTINUE_PROMPT = '（続けて。物語をさらに展開させてください。）'

/** 新しいシーンの導入を書かせるための擬似ユーザー入力 */
export const SCENE_START_PROMPT = '（新しい場面が始まります。情景の導入から自然に書き始めてください。）'

/**
 * 尺の指示（F4・設計_物語の簡素化.md §3.2）。
 *
 * 読者モデルではすべての入力が書き手への指示なので、**ペース配分の指示が一級市民になる**
 * （ロールプレイ入力ではメタ発言＝世界観を壊す異物だった）。F2 で捨てたスロット単位の
 * ペース配分——「ここはじっくり／ここはざっくり」——をここで取り戻す（§1.6）。
 *
 * 本文ではない進行マーカーなので `MARKER_PROMPTS` に載せ、表示・書き出し・ツリーのラベルから外す。
 */
export const PACE_DETAIL_PROMPT =
  '（続けて。ただし急がず、この場面をじっくり描いてください。時間を大きく進めず、情景・所作・間・心情を細やかに書きます。）'
export const PACE_SKIP_PROMPT =
  '（続けて。ただしこの場面は手早くまとめ、次の出来事まで話を進めてください。細部は省いて構いません。）'

/** 「続ける」のペース指定（F4・設計 §3.2）。`normal` が従来の「続ける」 */
export type StoryPace = 'normal' | 'detail' | 'skip'

/** ペース指定 → 実際に積む擬似ユーザー入力 */
export const PACE_PROMPTS: Record<StoryPace, string> = {
  normal: CONTINUE_PROMPT,
  detail: PACE_DETAIL_PROMPT,
  skip: PACE_SKIP_PROMPT,
}

/**
 * 本文ではない進行マーカーの本文一覧。**表示（ChatPanel）・書き出し（storyExport）・
 * 分岐ツリーのラベル（store）はこの1つの集合を見る**＝マーカーを増やしたときに
 * 片方だけ更新される事故を防ぐ。
 */
export const MARKER_PROMPTS: ReadonlySet<string> = new Set([
  CONTINUE_PROMPT,
  SCENE_START_PROMPT,
  PACE_DETAIL_PROMPT,
  PACE_SKIP_PROMPT,
])

/** その本文が進行マーカーか（判定はここに一本化する） */
export function isMarkerContent(content: string): boolean {
  return MARKER_PROMPTS.has(content.trim())
}

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
 *
 * **F4 で `ChoiceMode` を廃止した**（設計 §3.4）。生成はユーザーが〈展開を選ぶ〉を押した時だけなので、
 * 旧 `auto`（挟むのが不自然なら空配列）の分岐は要らない——**押された時点で「今ほしい」が確定している**。
 */
export function choicesSystem(jsonSchema = false): string {
  const base = `あなたは物語の書き手を助ける相談役です。直前の場面を踏まえ、**次にどう展開させるか**の候補を読者へ示します。\n`
  // JSON スキーマで固定する場合は root がオブジェクトである必要があるため、包んだ形を指示する
  // （`jsonSchemas.ts` の CHOICES_SCHEMA と対。指示とスキーマが食い違わないようにする）
  const format = jsonSchema
    ? `出力は {"choices": [...]} の JSON のみ（前後に文章を付けない）。各要素は10〜30字程度の短い行動・選択の文字列。例: {"choices":["剣を抜いて立ち向かう","そっと後ずさる","話しかけてみる"]}\n`
    : `出力は JSON 配列のみ（前後に文章を付けない）。各要素は10〜30字程度の短い行動・選択の文字列。例: ["剣を抜いて立ち向かう","そっと後ずさる","話しかけてみる"]\n`
  return base + format + `互いに異なる方向の候補を3〜4個返してください。`
}

/**
 * 選択肢生成の直前に積む user メッセージ。
 * モデルは直近の user 指示に強く従うため、本編の続き（地の文）ではなく
 * JSON 配列を確実に出力させるための念押し。
 */
export function choicesUserNudge(): string {
  return (
    `↑の直前の場面を踏まえ、この続きの展開の候補を、` +
    `指示どおりの JSON 配列だけで出力してください。物語の続き・地の文・説明は書かないこと。` +
    ` 上で指定した形式・個数を厳守すること。`
  )
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

/** 末尾 count 件の本文を行にする。話者名の織り込みは `buildMessages` と同じ規則 */
function recentPlainLines(session: Session, refs: ResolvedRefs, count: number): string[] {
  const multi = session.narrativeStyle !== 'novel' && refs.characters.length > 1
  const nameOf = (id?: string) => refs.characters.find((c) => c.id === id)?.name
  const history = session.messages
    .filter((m) => m.content.trim().length > 0)
    // 書き手への指示は物語の本文ではない＝主人公の次の行動案の材料にしない（IN1）
    .filter((m) => !isDirective(m))
    .filter((m) => !refs.currentSceneId || !m.sceneId || m.sceneId === refs.currentSceneId)
  return history.slice(-count).map((m) => {
    const text = m.content
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
 * 【直前のあらすじ】（`priorSummaries` の末尾1件のみ）／【直近の本文】（末尾数件）。
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
export function choicesMessages(session: Session, refs: ResolvedRefs): ChatMessage[] {
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
    { role: 'system', content: choicesSystem() },
    { role: 'user', content: parts.join('\n\n') },
    { role: 'user', content: choicesUserNudge() },
  ]
}

/**
 * レビューの分割単位（PC-A A-2）。`a`＝何が起きたか／`b`＝状態がどう動いたか／`all`＝A+B の一本／
 * `t`＝時間と予定（第3の呼び出し。入力が本文＋現在＋予定だけで済むので常に独立して投げる。
 * docs/設計_物語の簡素化.md §2.4.2）。
 * docs/詳細設計_プロンプト構造とキャッシュ.md §3.2
 */
export type ReviewPart = 'all' | 'a' | 'b' | 't'

/**
 * 時間と予定の呼び出し（第3の呼び出し・§2.4）の system プロンプト。
 *
 * **本編プロンプトへ渡るのはここで作る `foreground` の一文だけ**＝予定リストそのものは渡さない
 * （実測: リストを本編へ入れると 28/30 で無関係な先の予定を列挙した。計測_時間と予定.md §4.1）。
 * 消化した予定は **id ではなく本文の引用**で返させる（id の書き写しは 450回中50回落ちた。同 §4.3）。
 *
 * @param calendarFormat 世界の暦の書式見本（`World.calendarFormat`）。体裁を揃えるためだけで粒度は縛らない。
 */
export function trackerSystem(calendarFormat?: string): string {
  const fmt = calendarFormat?.trim()
  return (
    `あなたは進行中の物語の記録係です。直前のシーンの本文を読み、次の JSON のみを出力してください（前後に文章・コードフェンスを付けない）。` + `\n` +
    `{` + `\n` +
    `  "now": "このシーンが終わった時点の日時（自由な書き方でよい）",` + `\n` +
    `  "place": "いま居る場所",` + `\n` +
    `  "present": ["その場に居合わせている人物の名前"],` + `\n` +
    `  "situation": "天候・季節・その場の空気を1〜2文で",` + `\n` +
    `  "foreground": "現在の日時と『これから起きること』を突き合わせた一文（該当が無ければ空文字）",` + `\n` +
    `  "pendingAdd": [ {"when":"いつ","what":"なに"} ],` + `\n` +
    `  "pendingDone": ["消化された項目の『なに』をそのまま引用"]` + `\n` +
    `}` + `\n` +
    `指針:` + `\n` +
    `- now は本文の描写から素直に決める。時間が動いていなければ与えられた現在をそのまま返す。` +
    `**粒度は場面に合わせてよい**（「8月31日 朝」でも「6月半ば」でも「翌年の春」でもよい）。` +
    (fmt ? `この世界の日時はこう書く: ${fmt}` : '') + `\n` +
    `- present はその場に実際に居る人物だけ。与えられた登場人物の名前をそのまま使い、居ない人は挙げない。` + `\n` +
    `- **foreground**: 現在の日時が『これから起きること』のどれかに当たる、または直前に迫っているなら、` +
    `突き合わせた結果を一文で書く（例:「今日は8月31日、夏休みの最終日。今日中に東京へ帰らなければならない。」）。` +
    `条件つきの項目は、その条件が本文で実際に満たされたときだけ。該当が無ければ空文字にする。` +
    `**該当しない項目を無理に持ち出さない。**` + `\n` +
    `- pendingAdd は本文で新しく生まれた約束・締切・予兆だけ。` +
    `**「来週水曜」「三日後」のような相対表現は使わず、現在の日時から換算した書き方にする**` +
    `（換算できないなら条件で書く。例:「雨がやんだとき」）。無ければ空配列。` + `\n` +
    `- pendingDone は、本文でその出来事が実際に起きた項目の「なに」を**そのまま引用**する。` +
    `起きていない項目は挙げない。無ければ空配列。` + `\n` +
    `- 推測の捏造はせず、本文に根拠があるものだけ。`
  )
}

/**
 * シーン終了レビュー（要約＋次シーン提案＋成長＋関係性 prose）生成用の system プロンプト。
 * 状態はすべて prose（F1-b で数の状態を廃止）。
 *
 * `part` で出力させる項目を絞れる（PC-A A-2。2本を並列に投げて待ち時間を半減させる）。
 * 状態変動の拘束（関係次元）は B のみに入れる＝A の suggestions が歪まないようにするため。
 * @param part 出力させる項目の範囲（`a`/`b`/`all`）
 * @param aspectNames ワールド固定の関係次元名。空でなければその次元のみ使うよう拘束。
 * @param focusName 中心人物の名前（F3。関係性 prose の宛先。空なら「主人公」と呼ぶ）
 */
export function reviewSystem(part: ReviewPart, aspectNames: string[], focusName = ''): string {
  const hero = focusName.trim() || '主人公'
  const aspectLine = aspectNames.length
    ? `relationUpdates.aspects の name は既存の【${aspectNames.join('・')}】のみを使う（新しい次元を作らない）。該当する変化が無い次元は省略してよい。`
    : `次元未定義のため relationUpdates.aspects は空配列にし、stance のみ更新する。`
  const a = part !== 'b' // A の項目を出すか
  const b = part !== 'a' // B の項目を出すか

  const schema = [
    a &&
      `  "summary": "このシーンの引き継ぎ要約（日本語の文字列。改行は \\\\n で表現。重要な出来事・関係や心情の変化・約束や未解決事項・終了時の状況を含む）",`,
    a &&
      `  "suggestions": [ {"title":"次シーンの短い見出し","note":"次シーンの状況・方向性の説明（2〜3文）。時・場所と、その場に居合わせる人物を必ず含める"} ],`,
    a && `  "characterGrowth": [ {"name":"キャラ名","addition":"今回の展開で新たに判明/深化した性格・背景を一文で"} ],`,
    a && `  "worldGrowth": [ {"keys":["トリガー語"],"content":"新たに判明した世界設定"} ],`,
    a &&
      `  "newCharacters": [ {"name":"新しく登場した人物の名前","note":"その人物について本文から分かること（立場・見た目・口調・${hero}との関わりを2〜3文）"} ],`,
    b &&
      `  "relationUpdates": [ {"character":"キャラ名","stance":"そのキャラの${hero}への関係の現在地を1〜2文で","aspects":[{"name":"次元名","note":"その次元の現在の機微（肯定・否定の両面を具体的に）"}],"reason":"変化の根拠（一文）"} ],`,
    b && `  "moods": [ {"character":"キャラ名","mood":"終了時点の気分（一語〜短句）"} ],`,
  ].filter((x): x is string => !!x)
  // 分割時に末尾の行だけ余分なカンマが残らないようにする
  const schemaBody = schema.map((line, i) => (i === schema.length - 1 ? line.replace(/,$/, '') : line))

  const rules = [
    a && `- summary は必ず JSON 文字列（string）で返す。配列や改行そのままは不可。`,
    a &&
      `- suggestions は2〜3個。**各案はこのシーン終了直後の「同一の起点」から分岐する、相互に排他な"次シーンの候補"**。案どうしは時系列でつながってはならない。【次シーンの時間】があればその時刻にふさわしい状況で書く（直前の続きをそのまま続けない）。`,
    a &&
      `- 各案の note には、その場面に居合わせる人物を明記する。登場人物として定義されていても、その場に居ないことはある（全員が同席する必然性が無ければ一部でよい）。`,
    a && `- characterGrowth / worldGrowth は、既存設定に無い"新しく分かったこと"のみ。無ければ空配列。`,
    a &&
      `- **newCharacters**：このシーンで初めて登場した人物のうち、【登場人物の現行設定】にも載っていない**名前を持つ人物**だけを挙げる（名前の無い通行人・店員などのモブは挙げない）。既に挙がっている人物・既存キャラの別名は挙げない。無ければ空配列。`,
    b &&
      `- **relationUpdates**：各キャラが${hero}に抱く関係を、与えられた【現在の関係性】を踏まえて**書き直す**（差分でなく現時点の全文）。今シーンで変化していない機微（好悪・約束）は失わず維持して書く。変化が無いキャラは省略可。${aspectLine}`,
    b && `- moods は各キャラの終了時点の気分。変化が無いキャラは省略可。`,
    `- 推測の捏造はせず、会話に根拠があるものだけ。`,
  ].filter((x): x is string => !!x)

  return (
    `あなたは物語編集アシスタントです。直前のシーンの会話を分析し、次の JSON のみを出力してください（前後に文章・コードフェンスを付けない）。\n` +
    `{\n` +
    schemaBody.join('\n') +
    `\n}\n` +
    `指針:\n` +
    rules.join('\n')
  )
}

/**
 * 「終わり方の提案」の system プロンプト（F4・設計 §2.7）。
 *
 * **世界側にエンディング定義を持たない**のがこの設計の要点で、条件も id も無い＝
 * いつでも「今の状況から、どう終わりうるか」を AI に考えさせる。**提案の主体は AI、
 * 選ぶ主体はプレイヤー**なので、ここでは選ばせず候補を並べるだけにする。
 */
export function endingProposalSystem(jsonSchema = false): string {
  const format = jsonSchema
    ? `出力は {"endings": [...]} の JSON のみ（前後に文章・コードフェンスを付けない）。`
    : `出力は JSON 配列のみ（前後に文章・コードフェンスを付けない）。`
  return (
    `あなたは物語の書き手を助ける相談役です。ここまでの物語を読み、**この先どのような終わり方があり得るか**を考えます。\n\n` +
    format +
    `\n各要素は {"title": "短い題（15字以内）", "outline": "どう終わるかを2〜3文で"} の形にしてください。\n\n` +
    `指針:\n` +
    `- **3〜5個**。互いにはっきり違う結末にする（同じ結末の言い換えを並べない）。\n` +
    `- ここまでに積み上がった関係性・未解決の事柄を踏まえる。今から新しい設定を持ち出さない。\n` +
    `- 幸福な結末だけに寄せない。取り返しのつかない結末・静かな結末も含めてよい。\n` +
    `- outline には「誰がどうなるか」を具体的に書く。抽象的な余韻だけで終わらせない。\n` +
    `- **まだ結末を書かない。** ここで書くのはあらすじであって本文ではない。`
  )
}

/** 提案の直前に積む user メッセージ（JSON 以外を書かせないための念押し） */
export function endingProposalNudge(): string {
  return (
    `↑のここまでの物語を踏まえ、あり得る終わり方の候補を、指示どおりの JSON だけで出力してください。` +
    `物語の続き・地の文・説明は書かないこと。`
  )
}

/**
 * エピローグ（結末の本文）を書かせる擬似ユーザー入力（F4）。
 * 進行マーカーではない＝**ユーザーが選んだ結末そのもの**なので履歴に残し、書き出しにも出す。
 */
export function epiloguePrompt(ending: { title: string; outline: string }): string {
  return (
    `（この物語をここで完結させます。次の結末へ向けて、エピローグを書いてください。\n` +
    `結末: ${ending.title}\n` +
    `筋書き: ${ending.outline}\n` +
    `筋書きをそのまま書き写さず、これまでの描写と地続きの本文として書き切ってください。` +
    `途中で切らず、読み終えた感触が残る形で締めます。）`
  )
}
/**
 * 別視点の幕間（F6・設計_物語の簡素化.md §2.9・実測 `計測_別視点の幕間.md`）の system プロンプト。
 *
 * **実測で分かっていること**——
 * 1. 「同じ出来事の言い換えに潰れる」という心配は起きなかった。素材が勘違い系の構造
 *    （中心人物が淡々と有能なことをして本人は何とも思っていない）を持てば、視点を移すだけで
 *    受け止めの食い違いが生まれる。最弱条件でも読んだ4件すべてに出た
 * 2. 差分要求の指示は決め手ではないが**害も無い**ので入れる。関係 prose の濃さは
 *    「ギャップの有無」ではなく**具体性**に効く
 * 3. 捏造は稀（3〜7%）。読み専用なので実害はさらに小さい
 * 4. **見出しの混入が 13%**。ここで禁じたうえで `stripInterludeHeadings` でも削る（二重に守る）
 */
export function interludeSystem(): string {
  return (
    `あなたは小説の書き手です。すでに書かれた場面を、別の登場人物の視点から書き直します。\n` +
    `出来事の流れは変えず、その人物の内面と解釈で語り直してください。\n\n` +
    `指針:\n` +
    `- **その人物が見聞きできた範囲だけ**を書く。中心人物の内心は分からない前提で、外から見た様子として書く。\n` +
    `- **中心人物自身の受け止め方とは食い違う点を、必ず1つ以上含める**（中心人物が何とも思っていないことを、この人物は重く受け取る、など）。\n` +
    `- **中心人物が見ていなかったもの**をこの人物が見ていた、という描写は加えてよい（幕間の面白さはここにある）。\n` +
    `- ただし**元の場面に無い出来事・別の日の場面・新しい世界設定は足さない**。解釈と観察だけを加える。\n` +
    `- **見出し・タイトル・区切り線を書かない**（「# ◯◯の視点」のような行を付けない）。本文だけを書く。\n` +
    `- 前置き・後書き・要約もしない。いきなり本文から始める。`
  )
}

/**
 * 幕間の生成に渡す文脈（§2.9.2 の「入力」）。
 * **本編の system も履歴全文も使わない**——一発生成・読み専用なので、必要なのは
 * その場面の本文・その人物の定義・`relation[その人物 → 中心]`・時と場所だけ。
 */
export function interludeMessages(args: {
  /** 視点になる人物 */
  viewer: Character
  /** 中心人物（居なければ「主人公」と呼ぶ） */
  focus?: Character
  /** その場面の本文（マーカー・指示を除いたもの） */
  sceneText: string
  /** viewer → focus の関係 prose（空なら渡さない） */
  relationProse: string
  /** 時と場所（空なら渡さない） */
  timePlace: string
}): ChatMessage[] {
  const hero = args.focus?.name.trim() || `主人公`
  const parts: string[] = [characterBlock(args.viewer, `視点になる人物`)]
  if (args.relationProse.trim()) {
    parts.push(`【${args.viewer.name} から見た ${hero}】\n${args.relationProse.trim()}`)
  }
  if (args.timePlace.trim()) parts.push(`【時と場所】${args.timePlace.trim()}`)
  parts.push(`【元の場面（${hero}を中心に書かれたもの）】\n${args.sceneText}`)
  parts.push(
    `【指示】この場面を、${args.viewer.name} の視点から書き直してください。` +
      `${args.viewer.name} が ${hero} の言動をどう受け取ったかを書き、${hero} 自身の受け止め方とは食い違う点を必ず1つ以上含めてください。`
  )
  return [
    { role: `system`, content: interludeSystem() },
    { role: `user`, content: parts.join(`\n\n`) },
  ]
}

/**
 * 幕間の後処理（F6）。**冒頭の見出し行を削る**——実測で 120件中 16件（13%）に
 * 「# 千夏の視点」のような見出しが混入した。プロンプトでも禁じているが、
 * 出力の後始末はコードで確実に行う（禁止文だけに頼らない）。
 *
 * 削るのは**先頭の連続する見出し・区切り・強調だけの行**に限る＝本文中の `#` は触らない。
 */
export function stripInterludeHeadings(text: string): string {
  const lines = text.replace(/\r\n?/g, `\n`).split(`\n`)
  let i = 0
  while (i < lines.length) {
    const t = lines[i].trim()
    if (!t) { i++; continue }
    // 見出し（# …）／区切り（--- ***）／**◯◯の視点** だけの行
    const isHeading = /^#{1,6}\s/.test(t) || /^(-{3,}|_{3,}|\*{3,})$/.test(t)
    const isBoldOnly = /^\*\*[^*]{1,30}\*\*$/.test(t)
    const isBracketOnly = /^[「『【(（][^」』】)）]{1,30}の視点[」』】)）]$/.test(t)
    if (isHeading || isBoldOnly || isBracketOnly) { i++; continue }
    break
  }
  return lines.slice(i).join(`\n`).trim()
}
/**
 * 幕間の解釈を `relation[その人物 → 中心]` へ反映する案を作らせる（F6・§2.9.4）。
 *
 * 幕間そのものは**非正典**なので、これは「気に入った解釈だけをユーザーが取り込む」ための
 * 一段。返す形はレビューの `relationUpdates` と同じ（stance の全文＋次元ごとの記述）＝
 * 適用経路も `applyReviewToState` を再利用でき、新しい書き込み口を増やさない。
 */
export function interludeReflectMessages(args: {
  viewerName: string
  focusName: string
  interludeText: string
  currentStance: string
  aspectNames: string[]
}): ChatMessage[] {
  const aspectLine = args.aspectNames.length
    ? `aspects の name は既存の【${args.aspectNames.join('・')}】のみを使う（新しい次元を作らない）。該当する変化が無い次元は省略してよい。`
    : `次元が未定義なので aspects は空配列にし、stance だけを書く。`
  const system =
    `あなたは物語編集アシスタントです。ある人物の視点で書かれた文章を読み、` +
    `その人物が中心人物へ抱く関係の記述を書き直します。次の JSON のみを出力してください（前後に文章・コードフェンスを付けない）。\n` +
    `{\n` +
    `  "stance": "${args.viewerName} が ${args.focusName} に抱く関係の現在地を1〜2文で（差分でなく全文）",\n` +
    `  "aspects": [ {"name":"次元名","note":"その次元の現在の機微"} ]\n` +
    `}\n` +
    `指針:\n` +
    `- **文章に書かれている受け止め方だけ**を根拠にする。書かれていない感情を足さない。\n` +
    `- 【現在の関係】があるなら、それを踏まえて**書き直す**（今回読み取れなかった機微は失わず維持する）。\n` +
    `- ${aspectLine}`
  const parts = [`【${args.viewerName} の視点で書かれた文章】\n${args.interludeText.trim()}`]
  if (args.currentStance.trim()) {
    parts.push(`【現在の関係（${args.viewerName} → ${args.focusName}）】\n${args.currentStance.trim()}`)
  }
  return [
    { role: 'system', content: system },
    { role: 'user', content: parts.join('\n\n') },
  ]
}

/**
 * 次シーン候補（suggestions）だけを作り直すための system プロンプト。
 * イベント/シーン種類を引き直した際に、新しい方向性で候補を再生成する。
 */
export function nextSceneSystem(): string {
  return (
    `あなたは物語編集アシスタントです。直前までのあらすじと「次シーンの方向性」を踏まえ、次シーンの候補のみを JSON で出力してください（前後に文章・コードフェンスを付けない）。\n` +
    `{ "suggestions": [ {"title":"次シーンの短い見出し","note":"次シーンの状況・方向性の説明（2〜3文）。時・場所と、その場に居合わせる人物を必ず含める"} ] }\n` +
    `指針:\n` +
    `- suggestions は2〜3個。**各案はこのシーン終了直後の「同一の起点」から分岐する、相互に排他な候補**。案どうしは時系列でつながってはならない（案2が案1の続き・結果になってはいけない）。\n` +
    `- 与えられた【次シーンの方向性】に必ず沿う。【次シーンの時間】があれば、その時刻にふさわしい（時間が経過した後の）場面として書く。`
  )
}

/**
 * 発見キャラのキャラクター JSON 起案用の system プロンプト（FB7-E）。
 * ここまでの本文だけを根拠に、CharacterEditor がそのまま受け取れる形の下書きを作らせる。
 * 画像生成タグ（`imagePrompt`）は英語タグの管理がユーザー主権なので起案させない（空のまま渡す）。
 */
export function characterDraftSystem(): string {
  return (
    `あなたはキャラクター設定の起案アシスタントです。物語の本文に登場した人物1名について、` +
    `再利用できるキャラクター設定の下書きを作ってください。\n` +
    `出力は次の JSON のみ（説明・前置き・コードフェンス禁止）:\n` +
    `{"name":"名前","persona":"人格・性格・背景","speechStyle":"口調・話し方",` +
    `"appearance":"外見の描写文","exampleDialogues":["セリフ例", "…"],"greeting":"最初のセリフ","tags":["タグ", "…"]}\n` +
    `指針:\n` +
    `- **本文に書かれていることを根拠にする**。書かれていない設定を足す場合も、本文の描写と矛盾しない範囲に留める。\n` +
    // 「一通り埋める」＝空欄を返させない。本文に手がかりが無い項目は、矛盾しない範囲で補って埋めきる
    `- **すべての項目を必ず埋める。空文字・空配列にしない。** 本文に手がかりが乏しい項目は、` +
    `本文の描写と矛盾しない範囲で自然に補って書く。\n` +
    // 単体で持ち出せる素材にする（他の素材へ依存させない）
    `- **この人物単体で完結させる。** persona・speechStyle・appearance に、` +
    `**他の登場人物名・中心人物名・特定の作品名や固有の地名を書かない**` +
    `（「〜との関係」ではなく「初対面の相手にどう接するか」のように、人物単体の性質として書く）。` +
    `このキャラクターは別の物語へ持ち出して再利用されるため、他の素材に依存すると意味が通らなくなる。\n` +
    `- persona は価値観・生い立ち・動機・行動原理を4〜6文で。speechStyle は一人称・二人称・語尾・敬語の有無・` +
    `口調の癖を具体的に。\n` +
    // 画像生成側の作法（タグ列 / 自然文）は接続先ごとに違い、生成時に変換される。ここでは変換しない
    `- appearance は**自然な日本語の描写文**で書く（2〜4文）。髪・目・体格・服装・雰囲気を続けて描写する。` +
    `**カンマ区切りの英語タグにしない**——画像生成のプロンプトは生成時に接続先の作法へ変換されるため、` +
    `ここではタグ化せず読める文章のままにしておく。\n` +
    `- exampleDialogues は**5個以上**。1要素＝1セリフで、鉤括弧「」で囲む。` +
    `平常時・感情が動いた時・問われた時など**場面の異なるもの**を混ぜ、口調の癖が現れるようにする。` +
    `**セリフの中に他の登場人物名を入れない。**\n` +
    `- greeting はその人物が初対面で発する短いセリフ1つ（鉤括弧つき）。\n` +
    `- tags は検索用の短い語を3〜6個（例: 寡黙, 老練, 喫茶店）。人物の属性・役どころを表す語にする。\n` +
    `- name は本文で呼ばれている表記をそのまま使う（敬称・役職は付けない。翻訳・言い換えをしない）。`
  )
}

/** 発見キャラの起案の user 文脈（FB7-E）。呼び出し側が本文を集めて渡す */
export function characterDraftContextUser(args: {
  name: string
  /** レビュー経路で渡ってくる「その人物について分かること」（構造化話者経路では無い） */
  note?: string
  worldName?: string
  worldDescription?: string
  sceneTitle?: string
  /** 既存の登場人物名（同名・混同を避けるための参考） */
  knownNames: string[]
  /** ここまでの本文（自然表記へ整流済み） */
  recentMessages: string[]
}): string {
  const parts: string[] = [`次の人物のキャラクター設定を起案してください。\n【対象】${args.name}`]
  if (args.note?.trim()) parts.push(`【この人物について分かっていること】\n${args.note.trim()}`)
  if (args.worldName || args.worldDescription) {
    parts.push(`【世界観】${args.worldName ?? ''}${args.worldDescription ? `: ${args.worldDescription}` : ''}`)
  }
  if (args.sceneTitle) parts.push(`【シーン】${args.sceneTitle}`)
  if (args.knownNames.length > 0) {
    // 別人だと分からせるために名前は渡すが、**設定文へ書き写させない**
    // （他の素材に依存した設定になると、このキャラを別の物語へ持ち出せなくなる）
    parts.push(
      `【既存の登場人物】${args.knownNames.join('・')}\n` +
        `（この人たちとは別人です。区別のための情報なので、**これらの名前を設定文の中に書かないこと**）`,
    )
  }
  if (args.recentMessages.length > 0) {
    parts.push(`【本文】\n${args.recentMessages.join('\n')}`)
  }
  return parts.join('\n\n')
}

/**
 * 一行の前提から世界・登場人物・導入を起案する system プロンプト（P4）。
 *
 * **1呼び出しで全部返させる**（`KICKOFF_SCHEMA` と対）。起案結果はそのまま遊ばせるのではなく、
 * `SessionEditor` を開いた状態で見せて人が直す前提なので、ここでは「直せる下書き」を狙う
 * ——空欄を返さないこと・素材として単体で成立することを優先し、完成度は求めない。
 */
export function storyKickoffSystem(): string {
  return (
    `あなたは物語の初期設定を起案するアシスタントです。利用者が書いた一行の前提から、` +
    `世界観1つ・登場人物2〜4人・物語の導入を作ってください。出力は JSON のみ（説明・前置き・コードフェンス禁止）。\n` +
    `全体の指針:\n` +
    // 起案の後に人手で全部書き足すなら起案の意味がない（characterDraftSystem と同じ契約）
    `- **すべての項目を必ず埋める。空文字・空配列にしない。** 前提に書かれていないことは、` +
    `前提と矛盾しない範囲で自然に補って決める。\n` +
    `- 文章はすべて日本語。**全年齢**の内容にする。\n` +
    `- **実在の人物・学校・企業・作品を指さない。**地名・組織名は架空のものを作る。\n` +
    `- 事件の解決や結末を先に書かない。ここで作るのは「始まりの一場面」まで。\n` +
    `\n【world】\n` +
    `- name は世界観の名前（短い固有名詞句）。description はこの世界の常時設定を3〜5文で` +
    `（舞台・時代・空気・何が起きている話なのか）。\n` +
    `- entries は**5件以内**の設定項目。keys はその設定を呼び出す日本語のキーワードを2〜5語。` +
    `content は2〜4文。物語の骨組み（締切・掟・失われかけているもの）にあたる1件だけ alwaysOn を true にし、` +
    `残りは false にする。\n` +
    `- relationAspects は**ちょうど2つ**。中心人物と他の登場人物の関係を書き留める観点` +
    `（例: 信頼／距離／負い目）。name は2〜4文字、guidance は「何を見て書くか」を1〜2文で。\n` +
    `- calendarFormat は作中の日付の書き方の見本を1行（例:「◯月◯日／朝・昼・放課後・夜」）。\n` +
    `\n【world.startPreset】\n` +
    `- genre はジャンルとトーンを短く（例:「現代・学園／静かな青春」）。premise は前提を2〜4文にふくらませたあらすじ。\n` +
    `- opening は**物語の最初の本文そのもの**（そのまま画面に載る。8〜16行）。` +
    `Web 小説の書き方で、セリフは鉤括弧「」で1発話1行、誰のセリフかは前後の地の文で分かるようにする。` +
    `行頭に「@名前」「名前：」のような話者ラベルを付けない。\n` +
    `- **opening で人物を呼ぶときは、characters で作った名前をそのまま使う**（別名・愛称・敬称を付けない）。\n` +
    `- opening は中心人物の視点で始め、**最後の行を次の一手が要る場所で止める**（問いかけ・誘い・差し出された手）。\n` +
    `- openingTitle は導入の見出し（10文字前後）。openingSceneNote は最初の場面の状況メモ` +
    `（いつ・どこ・**その場に居る人物の名前**を1〜2文で。居ない登場人物はここに書かない）。\n` +
    `- initialDirective は最初のシーンの書き手への指示（1〜3文）。` +
    `「このシーンで何を見せ、何をまだ見せないか」を書く。結末や答えは書かない。\n` +
    `- startNow は開始時点の日時を calendarFormat の書き方で1行（例:「5月13日 放課後」）。\n` +
    `\n【characters】\n` +
    `- **2〜4人。先頭が中心人物（読者が寄り添う視点人物）**。残りはその人物と関わる相手。\n` +
    // P3 の罠: 前方一致の名前解決は空白込みの名前を解決できない
    `- name は**空白を入れない**表記（「七海 すず」ではなく「七海すず」）。敬称・役職を付けない。\n` +
    // 素材は別の物語へ持ち出して再利用される（characterDraftSystem と同じ理由）
    `- **persona・speechStyle・appearance に他の登場人物の名前を書かない。** ` +
    `関係ではなく、その人物単体の性質として書く（「初対面の相手にどう接するか」のように）。\n` +
    `- persona は価値観・生い立ち・動機・行動原理を4〜6文で。speechStyle は一人称・二人称・語尾・` +
    `敬語の有無・口調の癖を具体的に。\n` +
    `- appearance は**自然な日本語の描写文**で2〜4文（髪・目・体格・服装・雰囲気）。` +
    `カンマ区切りの英語タグにしない。\n` +
    `- exampleDialogues は**5個以上**。1要素＝1セリフで鉤括弧「」で囲み、場面の異なるものを混ぜる。` +
    `**セリフの中に他の登場人物名を入れない。**\n` +
    `- greeting は初対面で発する短いセリフ1つ（鉤括弧つき）。tags は短い語を3〜6個` +
    `（人物の属性・役どころ。例: 寡黙, 転校生, 部長）。`
  )
}

/** 一行の前提からの起案の user（P4）。利用者が書いた前提をそのまま渡す */
export function storyKickoffUser(premise: string): string {
  return `次の前提から物語の初期設定を起案してください。\n\n【前提】\n${premise.trim()}`
}

/** 画像プロンプト起案用の system プロンプト（挿絵・アバター共通） */
/**
 * 画像プロンプト起案の system。**接続先のプロンプトスタイルで作法を断言させる**。
 * 以前は「カンマ区切りタグ**または**簡潔な英語描写」とどっちつかずで、出力形式が
 * 起案モデルごとに揺れていた（docs/設計_画像生成の簡易化.md §5.2）。
 */
export function illustrationPromptSystem(style: PromptStyle): string {
  const common =
    `あなたはイラスト生成用プロンプトの起案アシスタントです。与えられた文脈から、その場面（または人物）を1枚の絵にするための英語プロンプトを作ってください。\n`
  const guide =
    `- キャラクターに【画像生成タグ】が与えられている場合は、その文字列を改変せずそのまま prompt に含める（LoRA トリガー等のため）。\n` +
    // 【外見】は素材側に自然な日本語の描写文で入っている（characterDraftSystem）。
    // タグ化するのはこの起案の仕事＝素材側に接続先の作法を持ち込ませない
    `- 【外見】は日本語の描写文で与えられる。**この出力形式に合わせて英語へ書き直す**` +
    `（描写された髪・目・体格・服装・雰囲気を落とさずに反映する）。\n` +
    `- masterpiece 等の品質タグ、anime style / photorealistic 等の画風タグは入れない（接続先の設定として自動で付加される）。\n` +
    `- 本文が長い場合は最後の場面（本文の末尾）を描く。シーン全体のダイジェストにしない。`
  if (style === 'natural') {
    // Flux / gpt-image / nano banana 系。ネガティブは API に無いので契約から外す
    return (
      common +
      `出力は次の JSON のみ（説明・前置き・コードフェンス禁止）:\n` +
      `{"prompt": "英語の自然な描写文（1〜3文）"}\n` +
      `指針:\n` +
      `- **タグの羅列にしない。**主語のある英文で、人物・構図・背景・光・雰囲気を続けて描写する。\n` +
      guide
    )
  }
  return (
    common +
    `出力は次の JSON のみ（説明・前置き・コードフェンス禁止）:\n` +
    `{"prompt": "英語のカンマ区切りタグ", "negative": "避けたい要素の英語タグ"}\n` +
    `指針:\n` +
    `- **文にしない。**danbooru 風の英語タグをカンマ区切りで並べる。\n` +
    `- 人数・外見・構図・背景・光・雰囲気をそれぞれ具体的なタグにする。\n` +
    guide
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
