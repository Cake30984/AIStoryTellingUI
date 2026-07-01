export type Role = 'system' | 'user' | 'assistant'

export type SessionMode = 'roleplay' | 'story'

/** アバター表現（絵文字＋背景色のシンプル方式） */
export interface Avatar {
  emoji: string
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

/** 特別イベント（世界設定で日付指定・条件指定。コードが自動判定して発火する） */
export interface ScheduledEvent {
  id: string
  /** タイムラインの何日目に発生するか（未指定＝日付条件なし。condition と併用可） */
  day?: number
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
  createdAt: number
  updatedAt: number
}

/** シーンの種類（グローバル素材。抽選で次シーンの方向が決まる） */
export interface SceneType {
  id: string
  name: string
  /** 演出ガイド（プロンプトに渡す指示） */
  guidance: string
  /** 抽選の重み（大きいほど出やすい） */
  weight: number
  /** クールダウン：前回使用からの最低シーン間隔（0=制限なし） */
  minGap: number
  color: string
  /** 既定タイプ */
  builtin?: boolean
}

/** 選択肢に紐づく小刻み加点（P5）。選んだ瞬間にコードが加算する事実（LLM は delta を提案するだけ） */
export interface ChoiceEffect {
  defId: string
  name: string
  /** scope=character のとき対象キャラ。global は undefined */
  characterId?: string
  charName?: string
  delta: number
}

/** 物語モードの選択肢（P5から effects を持てる） */
export interface Choice {
  text: string
  effects?: ChoiceEffect[]
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
  /** このシーンの種類（演出エンジンの抽選結果） */
  sceneTypeId?: string
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
}

/** 物語モードの選択肢進行の方式 */
export type ChoiceMode = 'off' | 'always' | 'auto'

/** 文体スタイル: novel=小説形式（地の文＋セリフ混在） / chat=会話劇（キャラ別） */
export type NarrativeStyle = 'novel' | 'chat'

/** 物語モード固有の設定 */
export interface StorySetup {
  premise: string
  genre: string
  protagonist: string
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
  /** シーン演出ディレクター設定 */
  director: { enabled: boolean; typeIds: string[] }
  /** 消化済みの特別イベント ID */
  usedEventIds: string[]
  /** 感情・関係値の状態（セッション固有） */
  state: SessionState
  /** 発見・深化した設定の上乗せ（セッション固有・素材は不変） */
  overlay: SessionOverlay
  messages: Message[]
  temperature: number
  maxTokens: number
  createdAt: number
  updatedAt: number
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
  /** ディレクターが選んだ次シーンの種類 */
  nextTypeId?: string
  nextTypeName?: string
  /** 発火する特別イベント */
  scheduledEventId?: string
  scheduledEventName?: string
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
  sceneTypes?: SceneType[]
  providers?: Provider[]
}
