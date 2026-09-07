export type Role = 'system' | 'user' | 'assistant'

export type SessionMode = 'roleplay' | 'story'

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
  tags: string[]
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
  /** タイムラインの何日目に発生するか（未指定＝日付条件なし） */
  day?: number
  /** 発生する時間帯のラベル（未指定・セッションの区切りに不一致＝時間帯条件なし） */
  slot?: string
  name: string
  /** シーンの状況・方向性 */
  note: string
}

/** prose 関係性の次元（ワールド固定。レビューはこの次元名でのみ記述を返す） */
export interface RelationAspectDef {
  id: string
  /** 次元名（例: 信頼 / 恋愛 / 警戒） */
  name: string
  /** レビューへの指示（例: 相手の言動の何を信じ何を疑うか） */
  guidance?: string
}

/** 当事者1人（id＋現在の実名）。`RoleParty.members` の要素、`bindRoleNames` の置換名に使う。 */
export interface Partner {
  characterId: string
  name: string
}

/**
 * 当事者組（名前つき）。特別イベントの `@相手` 置換に使う（F1-e で全廃予定）。
 */
export interface RoleParty {
  roleId: string
  roleName: string
  members: Partner[]
}

/**
 * 未定義の人物（＝素材ライブラリにいない名前付きキャラ）を AI が登場させてよいか（発見キャラ・FB7-E）。
 * `allow`（既定＝undefined も同じ）は自由に登場させてよい／`avoid` は名前付きの新キャラを出させない
 * （モブは無名のまま描かせる）。判定は system プロンプトへの注入だけで、コードは登場を止めない。
 */
export type NewCharacterPolicy = 'allow' | 'avoid'

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
  /** 新しい登場人物の登場ポリシー（→ session.newCharacterPolicy。FB7-E） */
  newCharacterPolicy?: NewCharacterPolicy
  /** 固定メモ（→ session.authorNote） */
  authorNote?: string
  /**
   * 開始シーンの状況メモ（→ 1シーン目の `Scene.note`。CS2）。
   * 2シーン目以降はシーン終了レビューが自動で書くが、1シーン目だけは書き手が居ない。
   * 「誰がこの場に居るか」を作者が指定できる唯一の場所。空なら何もしない。
   */
  openingSceneNote?: string
  /**
   * 置換タグの定義（→ session.story.introTags。A-1）。世界選択時に他項目と同じ規則でセッションへ
   * コピーされ、以後はセッション側で自由に追加・削除できる（素材＝再利用資源のため実名は焼き込まない）。
   */
  introTags?: IntroTag[]
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

/**
 * 導入文専用の置換タグ（A-1）。世界の開始テンプレートで定義する自由な @文字列
 * （実名を含まない・世界選択時にセッションへコピーされる）。実キャラ/ペルソナへの対応付けは
 * セッション/カセット側の `Session.introBindings` が持つ（参照のみ・実名を焼き込まない）。
 */
export interface IntroTag {
  id: string
  /** @ を除いた表示名（例: ヒロイン）。導入文では @ヒロイン のように書く */
  tag: string
  note?: string
}

/** 置換タグ（`IntroTag.tag`）→ 実キャラ/ペルソナ の対応付け（セッション/カセット固有。A-1） */
export type IntroTagBinding =
  | { tag: string; kind: 'persona' }
  | { tag: string; kind: 'character'; characterId: string }

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
  /** セッション開始テンプレート（世界を選んだ時にセッションへコピーされる推奨初期設定。素材側は不変） */
  startPreset?: WorldStartPreset
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

/**
 * 通常の本文ではない特別な入力の種別（IN1）。
 * `'directive'`＝書き手 AI への指示（物語の方向づけ）。主人公の発言・行動としては扱わない。
 */
export type MessageKind = 'directive'

export interface Message {
  id: string
  role: Role
  /**
   * 通常の本文なら未設定（＝旧データもすべてこちら）。
   * `'directive'` のときだけ、プロンプトでは枠付きの指示として送られ、
   * 裏方 LLM の文脈・物語の書き出しからは落ちる（IN1・`docs/設計_入力の二分化とローカルLLM案内.md`）。
   */
  kind?: MessageKind
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
  /** 生成時のネガティブプロンプト（結合前のユーザー入力・記録用。FB7-A追修） */
  negative?: string
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
  /** 結合前のユーザープロンプト（ImageJob.prompt と同じ規約）。旧データなど不明な場合は空文字 */
  prompt: string
  /** 結合前のユーザーネガティブプロンプト（ImageJob.negative と同じ規約。FB7-A追修） */
  negative?: string
  sceneId?: string
  /** 分岐が消えても表示できるよう採用時点の値を非正規化して保存 */
  sceneTitle?: string
  timeLabel?: string
  messageId?: string
  createdAt: number
}

/**
 * 内蔵環境音カタログの1件（AM1）。**アプリの一部であって世界観データではない**ので、
 * blob ストア・GC・カセット同梱・エクスポートのいずれとも無関係。実体は同梱の静的アセット。
 */
export interface AmbientSoundDef {
  /** 安定・可読キー（例 'rain-soft'）。`uid()` にしない＝カタログは作り込み資産 */
  id: string
  label: string
  /** カタログの並び・グループ表示に使う分類名 */
  category: string
  /** Vite が解決した同梱アセットの URL */
  url: string
  /** 出所（ライセンス根拠を後から辿るための記録。表示義務のためではない） */
  credit: string
}

/**
 * 本文フロー上の一点に留めた環境音（AM1・実験機能）。
 * 挿絵（`SceneIllustration`）と違い「ブロックとして描かれる実体」を持たないメタデータで、
 * スクロール中心との距離で音量が決まる。Scene の中に置くことでチェックポイント（分岐）に
 * そのまま乗る＝過去へ戻ればその地点のピンが鳴る。
 * 詳細は `docs/設計_環境音ピン.md`。
 */
export interface AmbientPin {
  id: string
  /** 内蔵カタログ（`ambientSounds.ts`）の安定キー。カタログに無ければ黙ってスキップする */
  soundId: string
  /** アンカー先メッセージ。消失時はシーン末尾のメッセージへ実行時フォールバック（永続データは書き換えない） */
  messageId: string
  /**
   * アンカー先メッセージ本文の `content.split('\n')` 上の行番号。
   * ⚠ レンダリング上の折り返し行ではない（折り返しは幅・フォントで変わり永続化できない）。
   * 本文が短くなって範囲外になったら表示時に最終行へクランプする。
   */
  lineIndex: number
  /** 到達半径＝チャット表示領域の高さの倍数（省略時 AMBIENT_DEFAULT_RADIUS） */
  radius?: number
  /**
   * このピンの音量上限（0〜1・省略時 1）。ピーク（＝ピン位置）に来た時にどこまで出すか。
   * 素材ごとの相性（同じ -23 LUFS でも蝉は主張が強く、風は埋もれる）を1本ずつ抑えるための調整子。
   */
  maxGain?: number
  createdAt: number
}

/** 物語の一区切り（その場の登場キャラ・状況・終了時の要約を持つ） */
export interface Scene {
  id: string
  title: string
  /**
   * 時・場所・状況メモ。**その場に居る人物もここに書く**（CS1/CS2）。
   * 【現在の場面】として注入され、シーン終了レビューが次シーンぶんを自動で埋める。
   */
  note: string
  /** 終了時に生成される引き継ぎ要約 */
  summary: string
  /** タイムライン上の時刻ラベル（例: 3日目 夜） */
  timeLabel?: string
  /** 挿絵（手動生成のみ。任意＝旧データには無い） */
  illustrations?: SceneIllustration[]
  /** 環境音ピン（AM1。任意＝旧データには無い。読む側は `ambientPins ?? []`） */
  ambientPins?: AmbientPin[]
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
  /**
   * 置換タグの定義（A-1）。世界選択時に `WorldStartPreset.introTags` からコピーされ、
   * 以後はセッション側で自由に編集できる（World 素材は不変）。導入文の `@タグ` はここで定義した
   * タグのみを対象に解決する。
   */
  introTags?: IntroTag[]
}

/**
 * 関係性の prose（言語記述）状態。キャラ→相手（主人公 or 別キャラ）の有向ペアごと。
 * 「判断は言葉」：感情の機微は数値化せず記述で持つ。条件判定には使わない（→ stats/counters が担う）。
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
  updatedAt: number
}

/**
 * セッション内で発見・深化した設定の上乗せ（オーバーレイ）。
 * 元 Character/World は不変に保ち、レビュー承認による追記はここへ積む（素材を汚さないため）。
 * 本編プロンプトへは「素材＋オーバーレイ」を合成した実効ビューで注入する。
 *
 * **キャラそのものは持たない（R7 = 案 a・2026-08-15 決定）。** 発見キャラ（FB7-E）は
 * `addDiscoveredCharacter` → `upsertCharacter` で素材（`characters`）に入る。無料版はここを
 * 閲覧のみにするため発見キャラのキャラ化を出さない、という線引きを採った。ここに
 * `characters: Character[]` を足す案（b）は、素材とオーバーレイの合成ビュー・カード書き出し・
 * 状態エンジンの全経路に「素材でないキャラ」を持ち込むため見送っている
 * （＝**思いつきで足さない**。docs/設計_公開前実装.md R7）。
 */
export interface SessionOverlay {
  /** 発見追加されたロア（元 World.entries とは別に積む。addedInStory は true 固定） */
  lore: LoreEntry[]
  /** キャラごとの発見成長設定（元 Character.developments とは別に積む） */
  characterDevelopments: { characterId: string; developments: Development[] }[]
}

/** セッション固有の状態（すべて prose）。 */
export interface SessionState {
  /** prose 関係性（有向ペアごと） */
  relations: Relation[]
  /** キャラ自身の一時的な気分（prose・毎レビューで上書き） */
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
  /** 置換タグ（`story.introTags`）→ 実キャラ/ペルソナ の対応付け（A-1） */
  introBindings?: IntroTagBinding[]
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
  /**
   * 未定義の新キャラを登場させてよいか（発見キャラ・FB7-E。undefined=allow＝従来どおり）。
   * `buildSystemPrompt` が【新しい登場人物】として注入するだけで、検出・キャラ化とは独立している。
   */
  newCharacterPolicy?: NewCharacterPolicy
  /** 消化済みの特別イベント ID */
  usedEventIds: string[]
  /** 感情・関係値の状態（セッション固有） */
  state: SessionState
  /** 発見・深化した設定の上乗せ（セッション固有・素材は不変） */
  overlay: SessionOverlay
  /** 構造化出力（本編を @名前「セリフ」の行形式で書かせる。undefined=OFF。設計は docs/設計_構造化出力.md） */
  structuredOutput?: boolean
  /**
   * レビューを2本（A=何が起きたか / B=状態がどう動いたか）に分けて並列実行する（PC-A A-2。
   * undefined=true＝既定ON）。docs/詳細設計_プロンプト構造とキャッシュ.md §3.2
   */
  reviewSplit?: boolean
  /**
   * 原文で送る最古のシーン id（PC3）。`beginScene` が `selectRawScenes` で確定し、
   * **シーン途中では動かさない**（毎ターン予算計算をすると履歴が伸びるだけで窓が動き、
   * 「シーン途中で畳む」＝最悪の切り方になるため状態として持つ）。
   * undefined（旧データ・最初のシーン）は「現在シーンのみ」＝PC3 以前と同じ挙動。
   * docs/詳細設計_プロンプト構造とキャッシュ.md §7.2
   */
  rawWindowFromSceneId?: string
  /** アーカイブ済み（セッション一覧から既定で除外。UI-5） */
  archived?: boolean
  /**
   * 出自カセット（FB9-B）。`playCassette` が刻む。到達エンディングをカセット単位で集計するためだけの
   * 参照で、プレイには影響しない。カセット下書きの種にする時は `freshSessionOf` が落とす。
   */
  originCassetteId?: string
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
  /**
   * OpenRouter が申告するそのモデルの対応パラメータ（`structured_outputs`/`response_format`/`tools` 等）。
   * JSON スキーマ強制の可否判定に使う（`jsonSchemas.ts`）。**同じ系列でもモデルごとに違う**ので
   * モデル名からの推測ではなくこちらを優先する。
   */
  supported_parameters?: string[]
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

export type LlmRequestKind =
  | 'main'
  | 'choices'
  | 'review'
  | 'nextScene'
  | 'imageDraft'
  | 'characterDraft'

/** LLM 呼び出し1回ぶんの実測記録（PC0。docs/詳細設計_プロンプト構造とキャッシュ.md §2） */
export interface UsageRecord {
  id: string
  at: number
  kind: LlmRequestKind
  /** "providerId::modelId" */
  modelRef: string
  upstream?: string
  promptTokens: number
  cachedTokens: number
  completionTokens: number
  cost?: number
  /** 呼び出し開始から完了までのミリ秒 */
  ms: number
  sessionId?: string
}

/** 画像生成の接続先種別 */
export type ImageProviderKind = 'comfyui' | 'openai-image' | 'modelslab' | 'openrouter-image' | 'civitai'

/** 生成品質。API の値をそのまま持ち、UI では日本語ラベル（標準/高品質/最高品質）に翻訳して見せる */
export type ImageQuality = 'low' | 'medium' | 'high'

/**
 * プロンプトの作法。モデル世代で二分される（docs/設計_画像生成の簡易化.md §5）。
 * - `tags`   … SD1.5 / SDXL / Illustrious / Pony 系。カンマ区切りタグ。品質タグ・ネガティブが効く
 * - `natural`… Flux / SD3 / DALL·E / gpt-image / nano banana 系。自然文。品質タグ・ネガティブは不要
 *
 * **これは欄を増やす設定ではなく欄を消す設定**: `natural` を選ぶとネガティブ欄・
 * デフォルトタグ欄が UI から消え、結合もされなくなる。
 */
export type PromptStyle = 'tags' | 'natural'

/** 画風。`custom` のときだけ `artStyleCustom` の英語文字列をそのまま使う */
export type ArtStyle = 'anime' | 'realistic' | 'custom'

/** 画像生成の接続先（LLM の Provider とは別系統）。localStorage のみ保存・エクスポート除外 */
export interface ImageProvider {
  id: string
  label: string
  kind: ImageProviderKind
  /** ComfyUI: http://127.0.0.1:8188 / OpenAI互換: https://api.openai.com/v1 等 */
  baseUrl: string
  /** openai-image / modelslab / openrouter-image で使用（comfyui は通常不要）。openrouter-image は空なら文章側の OpenRouter キーを流用する */
  apiKey: string
  /** openai-image: モデル名（dall-e-3 等） / modelslab: model_id / openrouter-image: モデルスラッグ（openai/gpt-5-image-mini 等） */
  model: string
  /** comfyui のみ: API Format の workflow JSON（%PROMPT% 等のプレースホルダ入り文字列） */
  workflowJson: string
  /** 生成時にプロンプト先頭へ自動結合される定型タグ（品質・画風・LoRA トリガー等。プロンプト欄には表示しない） */
  defaultPositive?: string
  /** 生成時にネガティブ先頭へ自動結合される定型タグ（comfyui / modelslab で有効。openai-image は API 非対応） */
  defaultNegative?: string
  /** openrouter-image / civitai: 既定の生成品質（生成モーダルの選択が書き戻る） */
  quality?: ImageQuality
  /** プロンプトの作法。未設定なら kind から既定を決める（`promptStyleOf`）。必ず上書き可 */
  promptStyle?: PromptStyle
  /** 画風。生成モーダルの選択がそのまま書き戻る＝「最後に選んだ画風」 */
  artStyle?: ArtStyle
  /** `artStyle === 'custom'` のときの英語文字列 */
  artStyleCustom?: string
  /** アダプタ固有の値の袋。接続先の種類を増やしても型が破綻しないよう最初から分けておく（docs/設計_画像生成の簡易化.md §3） */
  params?: Record<string, unknown>
}

/**
 * 同一条件（モデル・品質・サイズ）での直近1回の実測コスト。
 * 「前回の実績」としてのみ表示する＝推測値を確定値のように見せないため（同 §6.2）。
 */
export interface ImageCostSample {
  /** `${model}|${quality}|${width}x${height}` */
  key: string
  usd: number
  at: number
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
  reason: string
}

/** 気分の更新案 */
export interface MoodChange {
  characterId: string
  name: string
  mood: string
}

/**
 * レビューが見つけた「まだ素材ライブラリにいない登場人物」（発見キャラ・FB7-E）。
 * 地の文だけで登場した人物（＝構造化出力の話者チップに出ない人物）を拾うための経路。
 */
export interface DiscoveredCharacter {
  name: string
  /** その人物について本文から分かること（キャラ起案の手がかり） */
  note: string
}

/** シーン終了レビューの生成結果（runtime） */
export interface SceneReview {
  /** このレビューが属するセッション id（FB8-B #14: 該当セッションを Play で開いている時だけモーダルを出す） */
  sessionId: string
  sceneId: string
  summary: string
  suggestions: NextSceneSuggestion[]
  characterGrowth: CharacterGrowth[]
  worldGrowth: WorldGrowth[]
  /** 関係性 prose の更新案（コードが全文書き直し） */
  relationUpdates: RelationUpdate[]
  /** 各キャラの気分の更新案 */
  moodChanges: MoodChange[]
  /** 新しく登場した未定義の人物（発見キャラ・FB7-E。承認するとキャラ化モーダルへ流す） */
  newCharacters: DiscoveredCharacter[]
  /** 発火する特別イベント */
  scheduledEventId?: string
  scheduledEventName?: string
  /** 消化キー（`eventId` or `eventId@charId1[+charId2]`。確定時の消化記録に使う） */
  scheduledEventKey?: string
  /** 特別イベントの当事者組（ロール別。note/name の `@ロール名`/`@相手` 置換に使う） */
  scheduledEventSubjects?: RoleParty[]
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
  /**
   * セリフに付く話者アイコンの大きさ（px。`--speaker-icon-size` と連動。既定 22）。
   * 小説形式の行頭アイコン（`.st-speaker`）と会話劇の吹き出しアイコン（`.avatar`）の両方に効く。
   * 文字サイズを上げるとアイコンだけ相対的に小さく見えるため、同じ場所で調整できるようにしてある。
   */
  speakerIconSize: number
  /** セリフ（「」）を色分け表示するか（false なら本文と同色） */
  dialogueTint: boolean
  /** 環境音ピンを鳴らすか（AM1。OFF で全ピンを停止＝ピン自体は消えない） */
  ambientEnabled: boolean
  /** 環境音のマスター音量（0〜1。UI では % 表示。AM1） */
  ambientVolume: number
  /** 没入モード（サイドバー・ドックを隠し topbar をホバー表示に） */
  immersive: boolean
}

export const DEFAULT_UI: UiPrefs = {
  // 初期値は「状態」タブを開いた状態（CG3）。目標＝エンディング・実績・残り日数はここにしか
  // 出ておらず、既定が null だと**初めて遊ぶ人はパネルの存在にすら気付けない**。
  // 既に設定を持っている人は `normalizeUiPrefs` が保存値を通すので影響を受けない
  dockTab: 'status',
  dockWidth: 360,
  fontSize: 15.5,
  lineHeight: 1.9,
  contentWidth: 760,
  speakerIconSize: 22,
  dialogueTint: true,
  ambientEnabled: true,
  ambientVolume: 0.6,
  immersive: false,
}

/** リーダー設定の可変範囲（ReaderSettings のスライダー・数値入力と共有。F2） */
export const UI_LIMITS = {
  fontSize: { min: 12, max: 22, step: 0.5 },
  lineHeight: { min: 1.4, max: 2.4, step: 0.05 },
  contentWidth: { min: 560, max: 1200, step: 20 },
  speakerIconSize: { min: 16, max: 48, step: 1 },
  ambientVolume: { min: 0, max: 1, step: 0.05 },
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
  // 旧データにはキーが無いので既定 22 で補われる（clamp が非数値を既定値へ落とす）
  const speakerIconSize = clamp(r.speakerIconSize, 16, 48, 22)
  const validTabs: DockTab[] = ['status', 'discovery', 'gallery', 'branch', 'jobs']
  return {
    dockTab: validTabs.includes(r.dockTab as DockTab) ? (r.dockTab as DockTab) : null,
    dockWidth: clamp(r.dockWidth, 300, 560, 360),
    fontSize,
    lineHeight,
    contentWidth,
    speakerIconSize,
    dialogueTint: r.dialogueTint !== false,
    ambientEnabled: r.ambientEnabled !== false,
    ambientVolume: clamp(r.ambientVolume, 0, 1, 0.6),
    immersive: r.immersive === true,
  }
}

/**
 * 全データの書き出し／取り込み単位（JSON バックアップ）。
 * 読み込み（`io.ts` の `parseBundle`）は未知のトップレベルキーをそのまま持ち回るため、
 * 新しいバージョンで作られたバンドルは**ここに宣言されていない項目を実体として持ちうる**（R2）。
 */
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
  /** セッションごとの生成画像の永続記録（FB6-A。record id でセッション単位に dedupe マージ） */
  sessionImageLogs?: Record<string, SessionImageRecord[]>
  providers?: Provider[]
  /** 画像込みエクスポート時のみ同梱（アバター・挿絵・カセット表紙の実体。T0/FB2-E） */
  images?: { id: string; mime: string; dataBase64: string }[]
}
