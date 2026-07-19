export type Role = 'system' | 'user' | 'assistant'

export type SessionMode = 'roleplay' | 'story'

/** 感情の固定セット（V4）。id は英語（プロンプトのタグと対応）、label は UI 表示用 */
export const EMOTIONS = [
  { id: 'neutral', label: 'ふつう', tags: 'neutral expression' },
  { id: 'joy', label: '喜び', tags: 'smile, happy, cheerful expression' },
  { id: 'anger', label: '怒り', tags: 'angry, frowning, annoyed expression' },
  { id: 'sadness', label: '悲しみ', tags: 'sad, teary eyes, downcast expression' },
  { id: 'shy', label: '照れ', tags: 'blushing, embarrassed, shy expression' },
  { id: 'surprise', label: '驚き', tags: 'surprised, wide eyes, open mouth' },
] as const
export type EmotionId = (typeof EMOTIONS)[number]['id']

/** アバター表現（画像参照＋テーマ色）。絵文字は廃止 */
export interface Avatar {
  /** IndexedDB 画像ストアの id。未設定なら色＋名前イニシャルで表示 */
  imageId?: string
  /** テーマ色（フォールバック背景・話者ドット・カード枠に使用） */
  color: string
}

/** 物語の展開で判明・深化した設定（成長ログの1項目。個別にON/OFF可） */
export interface Development {
  id: string
  text: string
  enabled: boolean
}

/** 再利用可能なキャラクター素材 */
export interface Character {
  id: string
  name: string
  /** 人格・性格・価値観・背景 */
  persona: string
  /** 口調・話し方の特徴 */
  speechStyle: string
  /** 外見 */
  appearance: string
  /** セリフ例（few-shot。口調の再現精度が上がる） */
  exampleDialogues: string
  /** 会話開始時の最初のセリフ */
  greeting: string
  /** 物語の展開で判明・深化した設定（成長ログ。承認で追記される） */
  developments: Development[]
  avatar: Avatar
  /** 画像生成用の固定英語タグ（画風・髪色・LoRA トリガー等。挿絵/アバター生成時に自動結合） */
  imagePrompt?: string
  /** 表情つき立ち絵（V4。emotion ごとに1枚。ステージ表示・裏方感情判定と連動） */
  sprites?: { emotion: EmotionId; imageId: string }[]
  tags: string[]
  /**
   * このキャラ専用の本編モデル参照（ModelRef 形式）。
   * chat 群像で話者として確定した場合のみ有効。おまかせ・小説形式ではセッション本編モデルを使う。
   * 空（未設定）のときはセッション本編モデルにフォールバック。
   */
  model?: string
  createdAt: number
  updatedAt: number
}

/** ユーザーが演じる人物（再利用素材） */
export interface Persona {
  id: string
  name: string
  description: string
  avatar: Avatar
  /** 画像生成用の固定英語タグ（画風・髪色等） */
  imagePrompt?: string
  createdAt: number
  updatedAt: number
}

/** ロアブックの1項目（キーワード一致時に注入される設定） */
export interface LoreEntry {
  id: string
  /** 注入トリガーとなるキーワード群 */
  keys: string[]
  content: string
  /** キーワードに関係なく常に注入する */
  alwaysOn: boolean
  enabled: boolean
  /** 注入順・優先度（小さいほど先） */
  order: number
  /** 物語の展開中にレビューで追加された項目（元からの設定と区別） */
  addedInStory?: boolean
}

/** 特別イベント（世界設定で日付・時間帯・条件を指定。コードが自動判定して発火する） */
export interface ScheduledEvent {
  id: string
  /** タイムラインの何日目に発生するか（未指定＝日付条件なし。condition と併用可） */
  day?: number
  /** 発生する時間帯のラベル（未指定・セッションの区切りに不一致＝時間帯条件なし） */
  slot?: string
  name: string
  /** シーンの状況・方向性 */
  note: string
  /** 発火条件（数・フラグ・実績のしきい値。未指定なら day のみで判定） */
  condition?: Condition
}

/** prose 関係性の次元（ワールド固定。レビューはこの次元名でのみ記述を返す） */
export interface RelationAspectDef {
  id: string
  /** 次元名（例: 信頼 / 恋愛 / 警戒） */
  name: string
  /** レビューへの指示（例: 相手の言動の何を信じ何を疑うか） */
  guidance?: string
}

/** 事実の数のスコープ。character=キャラ別1値（対主人公の好感度メーター含む） / global=主人公・世界で1値 */
export type StatScope = 'character' | 'global'

/** 事実の数の定義（好感度メーター・レベル・所持金・名声 等。ワールド固定） */
export interface StatDef {
  id: string
  name: string
  scope: StatScope
  default: number
  /** 数値型の下限・上限（任意。好感度メーターは 0〜100 など） */
  min?: number
  max?: number
  /**
   * レビュー1回あたりの変動幅（絶対値の下限・上限。任意。FB7-C）。
   * プロンプトの目安＋受領時クランプの両方に使う。deltaMin は「動かすなら最低これだけ動く」の意味で、
   * 変動しない（delta 0＝項目を出さない）ことは常に許される。
   */
  deltaMin?: number
  deltaMax?: number
  /** 本編プロンプトに現在値を注入するか（好感度メーターは通常 false＝LLM は prose を読む） */
  inject: boolean
}

/** 行動カウンターの定義（単調増加の累計回数。ワールド固定） */
export interface CounterDef {
  id: string
  /** 名称（例: デート回数 / 戦闘回数 / 来店回数） */
  name: string
  /** character=キャラ別累計 / global=全体累計 */
  scope: StatScope
  /** レビュー1回あたりの加算量の下限・上限（任意。既定 1..1000 の中でさらに絞る。FB7-C） */
  amountMin?: number
  amountMax?: number
  /** 本編プロンプトに現在値を注入するか */
  inject: boolean
}

/** 条件式の比較演算子 */
export type Op = '>=' | '>' | '<=' | '<' | '==' | '!='

/**
 * 条件の最小単位（節）。prose は読まない＝数・フラグ・実績のみで判定（再現性のため）。
 * World はセッション横断の再利用素材で特定キャラを固定できないため、
 * characterId/fromId 省略時は「セッション参加キャラのいずれかが満たす」で判定する。
 */
export type Clause =
  | { kind: 'stat'; defId: string; characterId?: string; op: Op; value: number }
  | { kind: 'counter'; defId: string; characterId?: string; op: Op; value: number }
  | { kind: 'relationFlag'; fromId?: string; toId?: string; flag: string; have: boolean }
  | { kind: 'achievement'; defId: string; have: boolean }

/** 条件式（all=すべて満たす / any=いずれか満たす）。節が空なら不成立扱い。 */
export type Condition = { all: Clause[] } | { any: Clause[] }

/** 実績の定義（ワールド固定）。condition を満たすとコードが自動で達成記録する。 */
export interface AchievementDef {
  id: string
  name: string
  description: string
  /** 達成条件（数・フラグ・実績のしきい値。コードが自動判定） */
  condition: Condition
  /** 未達成時に名前・内容を隠す */
  hidden?: boolean
}

/**
 * エンディングの定義（ワールド固定。到達判定はコードが自動で行う。docs/設計_エンディング.md）。
 * 実績の親戚＝条件成立で到達する「終わりの構造」。配列順が優先度（上が優先）。
 */
export interface EndingDef {
  id: string
  name: string
  /** UI 表示用の説明（一覧・到達時に見せる。条件そのものは晒さない） */
  description: string
  /** 到達条件。fallback=true の定義は持たない（UI で条件エディタを隠し、判定でも無視） */
  condition?: Condition
  /** エピローグ生成への指示（結末のトーン・締め方）。到達後にのみ注入＝プレイ中のリークなし */
  epilogueGuidance: string
  /** 条件成立で強制突入する（レビューでの「まだ続ける」を出さない。バッドエンド向け） */
  auto?: boolean
  /** 未到達時に名前・内容を ??? 表示（実績の hidden と同じ） */
  hidden?: boolean
  /** 期間満了時、条件成立エンディングが無い場合に採用するノーマル/バッドエンド */
  fallback?: boolean
}

/**
 * セッション開始テンプレート（World に付属する推奨初期設定。W1）。
 * セッション設定で世界を選んだ時に「コピー」で流し込む（参照ではない）。
 * 以後の編集はセッション側の値だけを変えるため、素材（World）側は不変に保たれる。
 * timeline は定義＋開始時点（startDay/startSlot）のみ（currentDay/currentSlot は持たない。
 * 反映時に開始時点を currentDay/currentSlot へ書き込む。FB2-B / クランプは FB4-A）。
 */
export interface WorldStartPreset {
  /** ジャンル・トーン（→ session.story.genre） */
  genre?: string
  /** あらすじ・前提（→ session.story.premise） */
  premise?: string
  /** 導入＝開始時に一度だけ掲載される最初の本文（→ session.story.opening。FB2-B） */
  opening?: string
  /** 導入シーンの見出し（→ session.story.openingTitle。FB2-B） */
  openingTitle?: string
  /** 最初の方向付け（→ session.story.initialDirective。最初のシーン滞在中のみ注入される非表示指示。FB7-A） */
  initialDirective?: string
  /** 固定メモ（→ session.authorNote） */
  authorNote?: string
  /**
   * タイムライン定義（→ session.timeline。反映時は enabled=true）。
   * startDay/startSlot があれば開始時点も指定できる（省略時は1日目・先頭スロット）。
   */
  timeline?: {
    slots: string[]
    totalDays: number | null
    spanLabel: string
    startDay?: number
    startSlot?: number
  }
}

/** 世界観が求める物語上の立ち位置（配役は Session 側で結ぶ） */
export interface WorldRole {
  /** リネームしても配役を維持するための安定 ID */
  id: string
  /** 導入文の @置換キー・配役 UI の表示名 */
  name: string
  /** 性格ではなく、世界における立場・物語上の機能 */
  description: string
  /** 未配役では開始できないロール */
  required?: boolean
}

/** 世界観（ロアブック＋ゲームシステム定義） */
export interface World {
  id: string
  name: string
  /** 常時注入される世界観の概要 */
  description: string
  entries: LoreEntry[]
  /** 日付指定の特別イベント */
  scheduledEvents: ScheduledEvent[]
  /** prose 関係性の次元（ワールド固定） */
  relationAspects: RelationAspectDef[]
  /** 事実の数の定義 */
  stats: StatDef[]
  /** 行動カウンターの定義 */
  counters: CounterDef[]
  /** 実績の定義（達成条件はコードが自動判定） */
  achievements: AchievementDef[]
  /**
   * レビュー指針（自由記述・任意。FB7-C）。シーン終了レビューの system に
   * 【世界のレビュー指針】として毎回そのまま注入する世界固定の状態変動方針
   * （例: 「体力は毎シーン必ず消耗させる。フラグ『呪い』が立っている間は10〜20、外れていれば1〜5」）。
   * LLM 判断なので厳密保証はない（deltaMin/deltaMax のクランプで暴走は抑制）。
   */
  reviewGuidance?: string
  /** 世界観が定義する配役。未設定の旧データは空配列として扱う */
  roles?: WorldRole[]
  /** セッション開始テンプレート（世界を選んだ時にセッションへコピーされる推奨初期設定。素材側は不変） */
  startPreset?: WorldStartPreset
  /** エンディング定義（未設定は空配列扱い。配列順=優先度＝上が優先）。docs/設計_エンディング.md */
  endings?: EndingDef[]
  createdAt: number
  updatedAt: number
}

/**
 * 物語モードの選択肢。
 * 事前 effects（P5 の選択肢連動加点）は FB7-C で廃止＝ポイントはシーン終了レビューが
 * 「実際に起きた結果」を評価して一本化（旧データの effects は読み捨て）。
 */
export interface Choice {
  text: string
}

export interface Message {
  id: string
  role: Role
  /** グループ会話で「誰の発言か」を示す（assistant のみ） */
  characterId?: string
  /** どのシーンに属する発言か */
  sceneId?: string
  content: string
  /** 物語モードの選択肢（assistant 応答に付随） */
  choices?: Choice[]
  /** 上限到達などで途中で切れた可能性（続き生成の案内に使う） */
  truncated?: boolean
  createdAt: number
  /** 生成中フラグ（UI判定用） */
  pending?: boolean
}

/** シーンに紐づく挿絵1枚（手動生成。G3） */
export interface SceneIllustration {
  id: string
  /** imageStore の画像 id */
  imageId: string
  /** 生成時のプロンプト（記録・再生成用） */
  prompt: string
  /** どのメッセージの直後に表示するか（メッセージ削除等で見つからない場合はシーン末尾） */
  messageId?: string
  createdAt: number
}

/**
 * 生成画像の永続記録（FB6-A）。分岐・シーンの生死と独立に「採用した画像」を残すアルバム。
 * AppState 直下の `sessionImageLogs`（sessionId キー）に積む。Session の中に入れない
 * （branchTrees と同じ理由: チェックポイントの深コピーに含めない・復元で巻き戻さない）。
 */
export interface SessionImageRecord {
  id: string
  /** imageStore の画像 id（GC はこの参照を使用中扱いにする） */
  imageId: string
  kind: 'illustration' | 'background'
  /** 結合前のユーザープロンプト（ImageJob.prompt と同じ規約）。バックフィルした背景など不明な場合は空文字 */
  prompt: string
  sceneId?: string
  /** 分岐が消えても表示できるよう採用時点の値を非正規化して保存 */
  sceneTitle?: string
  timeLabel?: string
  messageId?: string
  createdAt: number
}

/** 物語の一区切り（その場の登場キャラ・状況・終了時の要約を持つ） */
export interface Scene {
  id: string
  title: string
  /** このシーンに登場するキャラ（session.characterIds の部分集合） */
  activeCharacterIds: string[]
  /** 時・場所・状況メモ */
  note: string
  /** 終了時に生成される引き継ぎ要約 */
  summary: string
  /** タイムライン上の時刻ラベル（例: 3日目 夜） */
  timeLabel?: string
  /** 挿絵（手動生成のみ。任意＝旧データには無い） */
  illustrations?: SceneIllustration[]
  /** シーン背景画像（V4。手動生成・シーンごとに1枚） */
  backgroundImageId?: string
  /** 終了済みなら時刻 */
  endedAt?: number
  createdAt: number
}

/** 物語全体の時間設定（期間・区切り単位・現在位置） */
export interface Timeline {
  enabled: boolean
  /** 1日内の区切り（例: ['朝','昼','夜'] または ['1日']） */
  slots: string[]
  /** 総日数（null は期間無制限） */
  totalDays: number | null
  /** 期間の呼称（例: 1学年（入学〜卒業）） */
  spanLabel: string
  /** 現在の日（1始まり） */
  currentDay: number
  /** 現在のスロット番号（slots のインデックス） */
  currentSlot: number
  /**
   * 開始時点の日（1始まり・省略時は1。FB2-B）。物語を「前日の夜から」等、任意の時点から
   * 始められるようにするための初期値。カセット初期化（freshSessionOf）はここへ戻す。
   */
  startDay?: number
  /** 開始時点のスロット番号（省略時は0＝先頭スロット。FB2-B） */
  startSlot?: number
}

/** 物語モードの選択肢進行の方式 */
export type ChoiceMode = 'off' | 'always' | 'auto'

/** 文体スタイル: novel=小説形式（地の文＋セリフ混在） / chat=会話劇（キャラ別） */
export type NarrativeStyle = 'novel' | 'chat'

/** 物語モード固有の設定 */
export interface StorySetup {
  premise: string
  genre: string
  /**
   * 導入（開始時に一度だけ「そのまま掲載」される最初の本文。FB2-B）。
   * 非空なら startStory は AI 生成せず、この文章を最初の assistant メッセージとして表示する。
   * あらすじ・前提（premise）が毎回注入される背景情報なのに対し、これは開始時の1回きり。
   */
  opening: string
  /** 導入シーンの見出し（空なら従来のタイトル抽選にフォールバック） */
  openingTitle: string
  /**
   * 最初の方向付け（FB5-②）。最初のシーンに滞在している間だけ system に注入される非表示の指示。
   * チャットには一切表示しない。premise が全編の背景なのに対し、これは序盤の立ち上げ方専用で、
   * 2シーン目以降は自動的に効かなくなる。
   */
  initialDirective?: string
}

/**
 * 関係性の prose（言語記述）状態。キャラ→相手（主人公 or 別キャラ）の有向ペアごと。
 * 「判断は言葉」：感情の機微は数値化せず記述で持つ。条件判定には使わない（→ stats/flags が担う）。
 * セッション固有。シーン終了レビューが唯一の書き手（追記でなく全文書き直し）。
 */
export interface Relation {
  /** 誰が */
  fromId: string
  /** 誰に対して（'hero' = 主人公、または characterId） */
  toId: string
  /** 関係の現在地を1〜2文で。本編注入と表示の中心 */
  stance: string
  /** ワールド固定の次元（aspect）ごとの記述。band（数値ティア）は持たない */
  aspects: { aspectId: string; note: string }[]
  /** ゲート用に立った恒久事実（約束・秘密・不可逆な出来事）。例: ["命を救われた"] */
  flags: string[]
  updatedAt: number
}

/**
 * セッション内で発見・深化した設定の上乗せ（オーバーレイ）。
 * 元 Character/World は不変に保ち、レビュー承認による追記はここへ積む（素材を汚さないため）。
 * 本編プロンプトへは「素材＋オーバーレイ」を合成した実効ビューで注入する。
 */
export interface SessionOverlay {
  /** 発見追加されたロア（元 World.entries とは別に積む。addedInStory は true 固定） */
  lore: LoreEntry[]
  /** キャラごとの発見成長設定（元 Character.developments とは別に積む） */
  characterDevelopments: { characterId: string; developments: Development[] }[]
}

/** 事実の数の現在値（好感度メーター・レベル・所持金 等）。characterId 無し = global */
export interface StatValue {
  defId: string
  characterId?: string
  value: number
}

/** 行動カウンターの現在値（累計回数）。characterId 無し = global */
export interface CounterValue {
  defId: string
  characterId?: string
  value: number
}

/**
 * セッション固有の状態。「事実は数、判断は言葉」。
 * relations/moods = prose（LLM が読む）、stats = 数（プレイヤーとコードが読む）。
 */
export interface SessionState {
  /** prose 関係性（有向ペアごと） */
  relations: Relation[]
  /** キャラ自身の一時的な気分（prose・毎レビューで上書き） */
  moods: { characterId: string; mood: string }[]
  /** 事実の数（好感度ポイント・各種スタット） */
  stats: StatValue[]
  /** 行動カウンターの累計 */
  counters: CounterValue[]
  /** 達成済みの実績 */
  achievements: { defId: string; unlockedAt: number }[]
}

/** 世界観ロールと参加キャラクターの対応。1ロール1人、同じキャラの複数ロールは許可する */
export interface RoleAssignment {
  roleId: string
  characterId: string
}

export interface Session {
  id: string
  title: string
  mode: SessionMode
  model: string
  /** レビュー（シーン終了解析）用モデル。空なら本編モデルを使う */
  reviewModel: string
  /** 選択肢生成用モデル。空なら本編モデルを使う */
  choicesModel: string
  /** 参加キャラ（グループ会話のため複数） */
  characterIds: string[]
  worldId: string | null
  personaId: string | null
  /** 世界観ロールへの配役。無効な参照は保存したまま開始時には無視する */
  roleAssignments?: RoleAssignment[]
  /** 常に記憶させたい固定メモ（作者ノート） */
  authorNote: string
  story: StorySetup
  /** シーン（区切り）の連なり */
  scenes: Scene[]
  /** 現在進行中のシーン */
  currentSceneId: string | null
  /** タイムライン設定 */
  timeline: Timeline
  /** 選択肢進行の方式 */
  choiceMode: ChoiceMode
  /** 文体スタイル */
  narrativeStyle: NarrativeStyle
  /** 世界観の特別イベントを自動発火させるか（FB3-C。undefined=有効） */
  eventAutoFire?: boolean
  /** 消化済みの特別イベント ID */
  usedEventIds: string[]
  /** 感情・関係値の状態（セッション固有） */
  state: SessionState
  /** 発見・深化した設定の上乗せ（セッション固有・素材は不変） */
  overlay: SessionOverlay
  /** 立ち絵ステージ表示の ON/OFF（V4） */
  spritesEnabled?: boolean
  /** 各キャラの現在の表情判定結果（V4・裏方LLMが毎応答後に判定） */
  spriteEmotions?: { characterId: string; emotion: EmotionId }[]
  /** 構造化出力（本編を @名前(感情)「セリフ」の行形式で書かせる。undefined=OFF。設計は docs/設計_構造化出力.md） */
  structuredOutput?: boolean
  /** アーカイブ済み（セッション一覧から既定で除外。UI-5） */
  archived?: boolean
  /**
   * 到達したエンディング（セッション固有・チェックポイント対象＝分岐で戻れば未到達に戻る。
   * docs/設計_エンディング.md）。restoreCheckpoint の passthrough には入れない。
   * 「完結済み」は ending があり、かつ epilogueSceneId のシーンに endedAt が立つことから導出する。
   */
  ending?: {
    defId: string
    name: string
    reachedAt: number
    /** エピローグシーンの id。このシーンが currentScene の間だけエンディング指示を注入する */
    epilogueSceneId: string
  }
  messages: Message[]
  temperature: number
  maxTokens: number
  createdAt: number
  updatedAt: number
}

/**
 * ゲームカセット（棚に並ぶ配布物。FB2-E）。読み込んだ `aist_cassette` を素材化して保持する。
 * `session` は開始状態に初期化済み（`freshSessionOf`）で、参照素材は取り込み時にライブラリへマージ済み。
 * 「▶ 遊ぶ」で `session` を新しい id に複製してセッション化する（何度でも最初から遊べる）。
 */
export interface Cassette {
  id: string
  title: string
  description: string
  /** 表紙画像（画像ストア id。取り込んだカード PNG そのもの） */
  coverImageId?: string
  session: Session
  createdAt: number
}

export interface OpenRouterModel {
  id: string
  name: string
  context_length?: number
  pricing?: {
    prompt?: string
    completion?: string
  }
}

export type ProviderKind = 'openrouter' | 'openai'

/** API 接続先（プロバイダ）の設定 */
export interface Provider {
  id: string
  label: string
  kind: ProviderKind
  /** API の base URL（例: https://openrouter.ai/api/v1） */
  baseUrl: string
  /** API キー（ブラウザ内 localStorage にのみ保存） */
  apiKey: string
}

/** 画像生成の接続先種別 */
export type ImageProviderKind = 'comfyui' | 'openai-image'

/** 画像生成の接続先（LLM の Provider とは別系統）。localStorage のみ保存・エクスポート除外 */
export interface ImageProvider {
  id: string
  label: string
  kind: ImageProviderKind
  /** ComfyUI: http://127.0.0.1:8188 / OpenAI互換: https://api.openai.com/v1 等 */
  baseUrl: string
  /** openai-image のみ使用（comfyui は通常不要） */
  apiKey: string
  /** openai-image のみ: モデル名（dall-e-3 / grok-2-image 等） */
  model: string
  /** comfyui のみ: API Format の workflow JSON（%PROMPT% 等のプレースホルダ入り文字列） */
  workflowJson: string
  /** 生成時にプロンプト先頭へ自動結合される定型タグ（品質・画風・LoRA トリガー等。プロンプト欄には表示しない） */
  defaultPositive?: string
  /** 生成時にネガティブ先頭へ自動結合される定型タグ（comfyui のみ有効） */
  defaultNegative?: string
}

/** 次シーンの提案 */
export interface NextSceneSuggestion {
  title: string
  note: string
}

/** キャラクターの成長案 */
export interface CharacterGrowth {
  characterId: string
  name: string
  addition: string
}

/** 世界設定の追加案（新しいロア項目） */
export interface WorldGrowth {
  keys: string[]
  content: string
}

/** 関係性の更新案（レビューが返す。コードが session.state.relations を全文書き直し） */
export interface RelationUpdate {
  fromId: string
  fromName: string
  /** 'hero' = 主人公 */
  toId: string
  toName: string
  /** 関係の現在地（全文置換） */
  stance: string
  /** ワールド固定の次元ごとの記述（未知の次元名は解決時に除外済み） */
  aspects: { aspectId: string; name: string; note: string }[]
  /** 追加する恒久フラグ（和集合で追加） */
  flagsAdd: string[]
  reason: string
}

/** 事実の数の変化案（コードが clamp 加算する相対値） */
export interface StatChange {
  defId: string
  name: string
  /** scope=character のとき対象キャラ。global は undefined */
  characterId?: string
  charName?: string
  /** 相対変化量。コード側で min..max にクランプ加算 */
  delta: number
  reason: string
}

/** 行動カウンターの加算案（今シーンで起きた行動の回数。コードが加算） */
export interface CounterEvent {
  defId: string
  name: string
  characterId?: string
  charName?: string
  /** 加算する回数（通常 1 以上） */
  amount: number
  reason: string
}

/** 気分の更新案 */
export interface MoodChange {
  characterId: string
  name: string
  mood: string
}

/** シーン終了レビューの生成結果（runtime） */
export interface SceneReview {
  sceneId: string
  summary: string
  suggestions: NextSceneSuggestion[]
  characterGrowth: CharacterGrowth[]
  worldGrowth: WorldGrowth[]
  /** 関係性 prose の更新案（コードが全文書き直し） */
  relationUpdates: RelationUpdate[]
  /** 事実の数の変化案（コードが clamp 加算） */
  statChanges: StatChange[]
  /** 行動カウンターの加算案（コードが加算） */
  counterEvents: CounterEvent[]
  /** 各キャラの気分の更新案 */
  moodChanges: MoodChange[]
  /** 発火する特別イベント */
  scheduledEventId?: string
  scheduledEventName?: string
}

/** 分岐ツリーの1ノード（C1）。チェックポイント実体は CheckpointStore に nodeId で保存する */
export interface BranchNode {
  id: string
  /** null = ルート（このセッションで最初に記録された時点） */
  parentId: string | null
  /** action = 小ポイント（物語操作1回） / scene = 大ポイント（レビュー確定） */
  kind: 'action' | 'scene'
  /** 作成時に確定するラベル（選択肢テキスト・入力冒頭・シーンタイトル等） */
  label: string
  /** シーン見出し用（大ポイントのみ: timeLabel） */
  timeLabel?: string
  createdAt: number
  /** スナップショットが参照する画像 id（GC 用。チェックポイントを展開せず集計するため保存時に抽出） */
  imageIds: string[]
  /** 圧縮後バイト数（剪定 UI のサイズ表示用） */
  bytes: number
  /**
   * スナップショット末尾のメッセージ id（FB3-B1）。巻き戻し操作（やり直し・編集・削除）時に
   * 「切り詰め後も残る地点」の祖先ノードへ currentId を戻して兄弟分岐にするための錨。
   * 旧データ（未設定）は従来どおり直列に積む。
   */
  anchorMessageId?: string
  /** エンディング突入・完結ノードに立つ結末名（E3。ツリーで 🏁 表示） */
  ending?: string
  /** しおり（C3） */
  star?: { name: string; thumbImageId?: string }
  /**
   * ⑂ 明示分岐の名前（FB6-C）。「⑂ ここから分岐」で置き去りになる線の先端に付く
   * （git のブランチ ref 相当）。これ・しおり・ending のいずれかをサブツリーに含む枝は
   * 上書きガード（ensureLineTip）の削除対象外＝保護される。
   */
  branchName?: string
}

/** セッションごとの分岐ツリー（軽量メタデータのみ。zustand persist 対象。実体は CheckpointStore） */
export interface BranchTree {
  /** 現在地。次のチェックポイントはこのノードの子として積まれる */
  currentId: string | null
  nodes: BranchNode[]
}

export type DockTab = 'status' | 'discovery' | 'gallery' | 'branch' | 'jobs'

/** 右コンテキストドック・リーダー設定・没入モード等の永続 UI 状態（UI-3・UI-4） */
export interface UiPrefs {
  /** null = ドック閉 */
  dockTab: DockTab | null
  /** 右コンテキストドックの幅（px。300〜560でクランプ。F1） */
  dockWidth: number
  /** 本文の文字サイズ（px。--font-size-prose と連動。既定 15.5。F2で数値化） */
  fontSize: number
  /** 本文の行間（--line-height-prose と連動。既定 1.9。F2で数値化） */
  lineHeight: number
  /** 本文の幅（px。--content-width と連動。既定 760。F2で数値化） */
  contentWidth: number
  /** セリフ（「」）を色分け表示するか（false なら本文と同色） */
  dialogueTint: boolean
  /** ステージ背景の濃さ（0〜0.6。--stage-bg-opacity と連動） */
  stageBgOpacity: number
  /** ステージ立ち絵の濃さ（0〜0.9。--stage-sprite-opacity と連動） */
  stageSpriteOpacity: number
  /** 没入モード（サイドバー・ドックを隠し topbar をホバー表示に） */
  immersive: boolean
}

export const DEFAULT_UI: UiPrefs = {
  dockTab: null,
  dockWidth: 360,
  fontSize: 15.5,
  lineHeight: 1.9,
  contentWidth: 760,
  dialogueTint: true,
  stageBgOpacity: 0.25,
  stageSpriteOpacity: 0.5,
  immersive: false,
}

/** リーダー設定の可変範囲（ReaderSettings のスライダー・数値入力と共有。F2） */
export const UI_LIMITS = {
  fontSize: { min: 12, max: 22, step: 0.5 },
  lineHeight: { min: 1.4, max: 2.4, step: 0.05 },
  contentWidth: { min: 560, max: 1200, step: 20 },
  stageBgOpacity: { min: 0, max: 0.6, step: 0.05 },
  stageSpriteOpacity: { min: 0, max: 0.9, step: 0.05 },
  dockWidth: { min: 300, max: 560 },
} as const

/**
 * 永続化された UiPrefs を現行スキーマへ正規化する（F2）。旧・段階式の文字列値
 * （fontScale='m'・lineHeight='normal'・contentWidth='narrow' 等）を数値へ引き継ぎ、
 * 範囲外をクランプ・欠落キーを既定値で補う。純関数（persist の merge から呼ぶ）。
 */
export function normalizeUiPrefs(raw: unknown): UiPrefs {
  const r = (raw ?? {}) as Record<string, unknown>
  const clamp = (v: unknown, min: number, max: number, def: number): number => {
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(n)) return def
    return Math.min(max, Math.max(min, n))
  }
  const fontFromScale: Record<string, number> = { s: 14, m: 15.5, l: 17, xl: 18.5 }
  const lineFromScale: Record<string, number> = { compact: 1.7, normal: 1.9, wide: 2.1 }
  const widthFromScale: Record<string, number> = { narrow: 660, normal: 760, wide: 900 }
  const fontSize =
    typeof r.fontSize === 'number'
      ? clamp(r.fontSize, 12, 22, 15.5)
      : (fontFromScale[String(r.fontScale)] ?? 15.5)
  const lineHeight =
    typeof r.lineHeight === 'number'
      ? clamp(r.lineHeight, 1.4, 2.4, 1.9)
      : (lineFromScale[String(r.lineHeight)] ?? 1.9)
  const contentWidth =
    typeof r.contentWidth === 'number'
      ? clamp(r.contentWidth, 560, 1200, 760)
      : (widthFromScale[String(r.contentWidth)] ?? 760)
  const validTabs: DockTab[] = ['status', 'discovery', 'gallery', 'branch', 'jobs']
  return {
    dockTab: validTabs.includes(r.dockTab as DockTab) ? (r.dockTab as DockTab) : null,
    dockWidth: clamp(r.dockWidth, 300, 560, 360),
    fontSize,
    lineHeight,
    contentWidth,
    dialogueTint: r.dialogueTint !== false,
    stageBgOpacity: clamp(r.stageBgOpacity, 0, 0.6, 0.25),
    stageSpriteOpacity: clamp(r.stageSpriteOpacity, 0, 0.9, 0.5),
    immersive: r.immersive === true,
  }
}

/**
 * エンディング到達の周回横断記録（E3・AppState 直下）。エピローグ突入時に追記する。
 * セッションの外に置く＝セッション削除・複製・分岐巻き戻しでも「見た」事実は残す。
 */
export interface EndingRecord {
  worldId: string
  endingDefId: string
  sessionId: string
  reachedAt: number
}

/** エクスポート/インポート用のデータ束 */
export interface ExportBundle {
  type: 'ai-storytelling-studio'
  version: number
  exportedAt: number
  characters: Character[]
  worlds: World[]
  personas: Persona[]
  sessions: Session[]
  /** ゲームカセット棚（FB2-E） */
  cassettes?: Cassette[]
  /** エンディング到達の周回横断記録（E3。同値 dedupe でマージ） */
  endingRecords?: EndingRecord[]
  /** セッションごとの生成画像の永続記録（FB6-A。record id でセッション単位に dedupe マージ） */
  sessionImageLogs?: Record<string, SessionImageRecord[]>
  providers?: Provider[]
  /** 画像込みエクスポート時のみ同梱（アバター・立ち絵・挿絵・背景・カセット表紙の実体。T0/FB2-E） */
  images?: { id: string; mime: string; dataBase64: string }[]
}
