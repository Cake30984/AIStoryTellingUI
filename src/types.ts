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

/** タイムラインの特定日に発生する特別イベント（世界設定で日付指定） */
export interface ScheduledEvent {
  id: string
  /** タイムラインの何日目に発生するか */
  day: number
  name: string
  /** シーンの状況・方向性 */
  note: string
}

/** 世界観（ロアブック） */
export interface World {
  id: string
  name: string
  /** 常時注入される世界観の概要 */
  description: string
  entries: LoreEntry[]
  /** 日付指定の特別イベント */
  scheduledEvents: ScheduledEvent[]
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

export interface Message {
  id: string
  role: Role
  /** グループ会話で「誰の発言か」を示す（assistant のみ） */
  characterId?: string
  /** どのシーンに属する発言か */
  sceneId?: string
  content: string
  /** 物語モードの選択肢（assistant 応答に付随） */
  choices?: string[]
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
 * キャラが主人公（ユーザーのペルソナ）に対して抱く感情の1軸。
 * セッション固有（素材ライブラリではなくこの物語限定）。値は 0〜100、中立 50。
 */
export interface Relationship {
  characterId: string
  /** 軸名（ユーザー定義の自由軸。例: 好感 / 信頼 / 警戒）。レビューで初出時に登録される */
  axis: string
  value: number
}

/**
 * セッション固有の感情・関係の状態。
 * シーン終了レビューで差分加算され、本編プロンプトに現在値が注入される。
 */
export interface SessionState {
  /** キャラ→主人公の関係値（軸ごと） */
  relationships: Relationship[]
  /** シーン単位の気分（質的ラベル。毎レビューで上書き） */
  moods: { characterId: string; mood: string }[]
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

/** 関係値の変化案（コードが session.state に加算する相対値） */
export interface RelationshipDelta {
  characterId: string
  name: string
  axis: string
  /** 相対変化量（おおむね -10〜+10）。コード側で 0〜100 にクランプ加算 */
  delta: number
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
  /** 主人公への関係値の変化案（コードが加算） */
  relationshipDeltas: RelationshipDelta[]
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
