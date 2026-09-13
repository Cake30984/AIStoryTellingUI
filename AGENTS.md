# AGENTS.md — デリスト（Delist / Delusion Story）

サークル **とかとかげ**（`tokatokage.com`）／製品名 **デリスト**（副題 Delusion Story）。Tauri の `productName` は `Delist`、識別子 **`com.tokatokage.delist`**（＝`%APPDATA%\<identifier>\` が保存先。公開後は変更不可）。
`cards.ts` の `extensions.aistorytelling` はカードのデータ形式キーなので改名しない。

好きな LLM（OpenRouter・OpenAI 互換・ローカル）で **AI が自動で書き進める物語を読む**／**キャラと会話する**、クライアント完結（BYOK）のアプリ。**Tauri 2 デスクトップ版が正式版**、Web 版（Vite）を併存。UI 文言・コメント・ユーザーとのやり取りは日本語。

> **このファイルは「現在の状態」だけを書く。** 経緯・却下案は [`docs/決定記録.md`](docs/決定記録.md)、進行中の計画は [`docs/計画_レビュー対応.md`](docs/計画_レビュー対応.md)、完了済みの設計書は `docs/archive/`（**リンクを辿るとき以外は読まない**）。
> **ファイル編集を伴うコミットで、ここに書かれた振る舞い・規約・データモデルが変わるなら同じコミットで更新する。** 履歴は書かない（git がある）。

## コマンドと検証

- Web 版: `npm run dev`（Vite・5173）／デスクトップ版: `npm run tauri:dev`（初回は Rust ビルドで数分。5173 を共有するので Web dev と同時起動不可）
- 型: `npx tsc --noEmit`／ビルド: `npm run build`（`tsc && vite build`）／配布: `npm run tauri:build`
- **変更後は必ず「`npx tsc --noEmit` → `npm run build`」を通す。**
- **見た目・UX の確認は AI が自分で行う**（dev サーバ → 該当画面 → スクリーンショット → 判断。console エラー0件も確認。完了報告には「何を確認したか」を書く。ユーザーは UI 確認をしない）
- 純関数・store のロジックは node で直叩きして確かめる。**テストランナー導入後は `npm test` を通す**（計画 P2）
- Tauri 固有部（`appFetch`/`saveBlob`/ファイルストレージ/資格情報/OAuth）を触ったときだけ手動チェック → [`docs/開発環境と配布.md`](docs/開発環境と配布.md) §4
- 初回準備（Rust・Build Tools・Defender の除外）と配布ビルドの検証手順も同文書

## Git

- リモート `https://github.com/Cake30984/AIStoryTellingUI.git`／ブランチ `main`
- **1つの変更ごとに `git commit` → `git push origin main`。** メッセージは日本語で端的に
- `samples/`・`_ambient_work/`・`run.bat` は ignore 済みのローカル作業物。指示が無い限り触らない

## 技術スタックと基本方針

React 18 + TypeScript(strict) + Vite / zustand（`persist`）/ Tauri 2（`plugin-http`・`plugin-fs`・`plugin-dialog`・`plugin-opener`・`keyring`）。追加ライブラリは最小限。

- **環境差（Web/Tauri）は `src/lib/platform.ts` に閉じる。** `isTauri()` 分岐をそこ（と `imageStore.ts`）の外に書かない。Tauri の JS パッケージは必ず動的 import
- **LLM は OpenAI 互換 Chat Completions の SSE 一本**（`lib/openrouter.ts`）。プロバイダ差は `Provider` オブジェクトとヘッダ／`response_format` の降格で吸収する
- **素材（Character/World）は不変の再利用資産。** 物語中の変化はセッション側（`state`／`overlay`）に積む
- **状態はすべて prose**（数値・条件・フラグは持たない。`決定記録.md` §1〜2）
- 製品の位置づけは「挿絵入りの本」。立ち絵・背景・VN 的画面は作らない

## ディレクトリ

`src/types.ts` — 全データ型（**最初に読む**）／`src/store.ts` — zustand ストア（状態・全アクション・永続化・チェックポイント。4,300行の単一ファイル＝分割は計画 P2）／`src/App.tsx` — レール＋サイドバー＋メイン＋常駐モーダルの組み立て・起動時処理／`src/styles/` — `tokens`/`base`/`layout`/`chat`/`composer`/`panels`.css（`index.css` が順に import。色・z-index・spacing は `tokens.css`）／`src-tauri/` — Tauri シェル（`lib.rs`＝plugin 登録＋資格情報の save/load/delete、`oauth.rs`＝PKCE の 127.0.0.1 受け口、`capabilities/default.json`＝http は `http://*:*`/`https://*:*`・fs は `$APPDATA/**`、`installer-hooks.nsh`＝アンインストール時の資格情報削除）

### `src/lib/`
- `platform.ts` — `isTauri`／`appFetch`（Tauri は plugin-http で CORS-free。`omitOrigin` で Origin を外す＝ComfyUI 用）／`saveBlob`／`stateStorage`（Web: localStorage、Tauri: `data/state.json` をアトミック書込＋500ms デバウンス＋close 時 flush）／`blockStateWrites`／`CheckpointStore`（Web: IndexedDB、Tauri: `data/checkpoints/<sessionId>/<nodeId>.bin`）／資格情報（`hydrateProviderSecrets`・`stripApiKeyForPersist`）
- `openrouter.ts` — `streamChat`（SSE・`usage` 取得）／`fetchModels`／`withCacheControl`（Anthropic 系にだけ `cache_control` を2箇所）／`jsonSchema`+`jsonMode` を渡すと `response_format`（弾かれたら schema→object→なし と1段ずつ落として再送し、通った段をモデルごとにプロセス内で記憶）
- `providers.ts` — `Provider` 型・プリセット・`parseModelRef`/`makeModelRef`・**接続先が使えるかの判定**（`isLocalEndpoint`/`requiresApiKey`/`isProviderUsable`。ローカル宛はキー不要・OpenRouter 用ヘッダも送らない）
- `prompts.ts` — 本編の3層組み立て（`buildSystemPrompt`/`buildMessages`/`selectRawScenes`）と裏方プロンプト全部（選択肢・レビュー A/B/T・次シーン候補・結末提案・エピローグ・幕間・キャラ起案・画像起案）。進行マーカーは `MARKER_PROMPTS`/`isMarkerContent`、本文判定は `isStoryText`/`sceneCharsOf`
- `jsonSchemas.ts` — 裏方 LLM の JSON スキーマ（`reviewSchema(part)`/`CHOICES_SCHEMA`/`ENDING_PROPOSALS_SCHEMA`/`NEXT_SCENE_SCHEMA`/`IMAGE_DRAFT_SCHEMA`/`CHARACTER_DRAFT_SCHEMA`）と `jsonModeFor(model, models)`（OpenRouter の `supported_parameters` 優先・無ければ名前で推定）
- `json.ts` — `extractJson`（修復フォールバック付き）／`partialString`（ストリーミング途中の JSON から文字列値を読む）
- `structured.ts` — `@名前「セリフ」` 行タグのパーサ（純関数。失敗行は narration へ）／`matchCharacterByName`（名前解決の唯一の窓口）／`plainTextOf`
- `lorebook.ts` — ロアを `alwaysOn`（system）とキーワード一致（深さ3・直近6件窓）に分ける
- `tokens.ts` — 文字数（ユーザー向け）とトークン（コスト・窓）の単位。閾値 `SCENE_WIND_DOWN_CHARS`(3000)/`SCENE_WRAP_UP_CHARS`(4500)/`RAW_WINDOW_TOKENS`(12000)
- `casting.ts` — 導入文の置換タグ `@タグ`（`findIntroTagRefs`/`resolveIntroText`/`validateCasting`/`normalize*`）
- `schema.ts` — 版番（`APP_STATE_VERSION`=2／`SAVE_DATA_VERSION`=4／`CASSETTE_DATA_VERSION`=4）と移行連鎖
- `version.ts` — `APP_VERSION`（`vite.config.ts` が package.json から注入）・`compareVersions`
- `io.ts` — `downloadBundle`/`downloadBlob`（内部で `saveBlob`）／`parseBundle`（未知キーは捨てずに持ち回る）
- `cards.ts` — キャラカード（`chara_card_v2` 互換）／世界カード（`aist_world`）／カセット（`aist_cassette`）の書き出し・解釈。**読み込み検証は `validateCard` 1本**（`minRuntimeVersion`／`spec`／`spec_version`）。`freshSessionOf` で開始状態へ初期化
- `png.ts` — tEXt チャンク読み書き（数MB級は `push(...spread)` 禁止＝セグメント連結）
- `imageStore.ts` — 画像 blob ストア（Web: IndexedDB、Tauri: `data/images/`）。`putImage`/`getImage`/`gcImages`/`useImageUrl`。localStorage に画像を入れない
- `imageGen.ts` — 画像生成の抽象層。`generateImage` → `ImageGenResult{blob,costUsd?}`。種別 `openrouter-image`（`/images`）／`civitai`（orchestration `textToImage`・`whatif` 見積り）／`comfyui`（`/prompt`→`/history`→`/view`）／`modelslab`／`openai-image`。定型タグの結合は `combineWithDefaults` の1箇所
- `civitai.ts`／`comfyWorkflow.ts`（API Format ワークフローのリンク追跡による自動注入・純関数）／`promptTags.ts`／`imageSetup.ts`（初回案内を断ったかの非永続フラグ）／`cost.ts`（課金単位のまま表示）／`imageJobs.ts`（ジョブ型・AbortController の Map・`useBlobUrl`）／`avatarGen.ts`
- `storyExport.ts` — 物語の書き出し（plain/markdown/挿絵つき markdown・分岐時点も可・`isBackstage` で指示とマーカーを落とす）／`storyCard.ts` — 共有用の1枚画像（1080×1350）
- `ambientSounds.ts`（内蔵25音のカタログ。`src/assets/ambient/*.opus`・約12MB）／`ambientAudio.ts`（再生エンジン）／`ambient.ts`（ピンの位置解決と音量・`useAmbientScape`）
- `oauthPkce.ts` — OpenRouter OAuth（PKCE。`state` 無しなので nonce 入り一回きり受け口で代替）／`checkpoint.ts`（gzip）／`dialogs.ts`（`appConfirm`/`appPrompt`/`appChoices`）／`modalStack.ts`／`shortcuts.ts`（`Ctrl+K` パレット・`Ctrl+1/2/3`・`Ctrl+G` 続ける・`Ctrl+.` 没入）／`useCardDrop.ts`／`useMultiSelect.ts`

### `src/components/`
- 骨格: `Rail.tsx`（Play/Library/System）／`Sidebar.tsx`（セッション一覧・素材ナビ・D&D 取込）／`ChatPanel.tsx`（会話画面本体。トップバー・本文・コンポーザー・右ドック）／`ContextDock.tsx`（状態/発見/画像/分岐/ジョブ のタブ。`StatusView`/`DiscoveryView`/`GalleryModal.GalleryBody`/`BranchTreeModal.BranchTreeBody`/`ImageJobsPanel.ImageJobsBody`）／`LibraryBar.tsx`／`CommandPalette.tsx`／`FirstRunWizard.tsx`（接続先5経路＋接続テスト）／`SettingsModal.tsx`（`SettingsBody`＝System ページ: 接続先・既定モデル・データ入出力・GC・クレジット）／`ImageProviderSettings.tsx`
- 共通部品: `ModalShell`（全モーダル。`dirty` で破棄確認）／`DialogHost`／`MenuPopover`／`ZoomOverlay`（`document.body` へポータル）／`icons.tsx`（自前 SVG。絵文字・文字記号は使わない）／`EntityAvatar`／`NumberInput`／`CsvInput`／`HelpDetails`／`ActivityIndicator`／`IntroTagDefEditor`・`IntroTagFields`
- Play: `StructuredMessage.tsx`（構造化本文の描画。未解決話者に ？バッジ）／`SceneReviewModal.tsx`（確定前は呼び出し単位の進行表示）／`SceneEditor`／`StoryLogModal`（あらすじ一覧）／`StatusPanel`・`DiscoveryPanel`（編集）／`EndingModal`（結末の提案）／`InterludePanel`（幕間）／`CharacterDraftModal`（発見キャラの起案→`CharacterEditor` draft）／`ImageGenModal`／`StoryExportModal`／`ReaderSettings`／`AmbientPinLayer`・`AmbientPinModal`・`AmbientRadiusField`
- Library: `library/CharacterLibrary`・`CharacterEditor`・`WorldLibrary`・`WorldEditor`（フルページ。基本／ロア／関係性の次元／開始テンプレート）・`CassetteLibrary`・`AvatarField`・`LibraryMultiSelect`／`CassetteEditor.tsx`／`SessionEditor.tsx`（基本／物語／進行／AIと出力 の4タブ）

## データモデル（要点）

型定義と各フィールドの意味は `src/types.ts` のコメントが正。ここは関係だけ。

- **Provider**（LLM 接続先）／**ImageProvider**（画像接続先）— どちらも persist のみ・**エクスポートに含めない**。Tauri では `apiKey` を資格情報ストアへ分離し `state.json` には空で書く
- **Character** — 人格・口調・外見・セリフ例・`developments`（成長ログ）・`avatar`・`imagePrompt?`・`tags`。中心人物も同じ型
- **World** — `description`（常時）＋`entries: LoreEntry[]`（`keys`/`alwaysOn`/`enabled`）＋`relationAspects`（関係性の次元）＋`calendarFormat?`＋`startPreset?: WorldStartPreset`（セッション作成時に**コピー**される推奨初期設定。素材側は不変）
- **Session** — `characterIds`／`worldId`／**`focusCharacterId`**（中心人物・必須。空文字＝未選択で開始不可）／`authorNote`／`story: StorySetup`（genre/premise/opening/openingTitle/initialDirective/introTags）／`introBindings`／`scenes`／`currentSceneId`／`narrativeStyle`／`structuredOutput?`／`reviewSplit?`／`rawWindowFromSceneId?`／`newCharacterPolicy?`／`state`／`overlay`／`endingGoal?`／`ending?`／`archived?`／`originCassetteId?`／`messages`／`model`・`reviewModel`・`choicesModel`／`temperature`／`maxTokens`
- **SessionState** — `relations: Relation[]`（キャラ→中心人物の有向 prose。`stance`＋次元ごとの `note`）／`moods`／`now`（自由文字列）／`place`／`presentIds`／`situation`／`pending: PendingSlip[]`（`when`/`what`）／`recentDone`
- **SessionOverlay** — `lore`（発見ロア）／`characterDevelopments`。素材を汚さないための上乗せ。本編には素材＋overlay の実効ビュー（`effectiveWorld`/`effectiveCharacter`）で注入。`promoteOverlay*` で素材へ **move**
- **Scene** — `title`/`note`（時・場所・居る人物）/`summary`/`timeLabel?`/`foreground?`（突き合わせ済みの一文）/`illustrations?`/`ambientPins?`/`interludes?`/`endedAt?`
- **Message** — `role`/`characterId?`/`sceneId?`/`content`/`choices?`/`truncated?`/`pending?`/`kind?: 'directive'`（書き手への指示。判定は `isDirective`）
- **AppState 直下（Session の外に置くもの）** — `branchTrees: Record<sessionId, BranchTree>`／`sessionImageLogs`／`cassettes: Cassette[]`／`ui: UiPrefs`／`defaultModelRef`／`favoriteModels`／`lastImageProviderId`／`lastDraftModel`。**`branchTrees`・`sessionImageLogs` を Session に入れない**（スナップショットに含まれて再帰肥大・復元で巻き戻る）
- **非永続（`partialize` 除外）** — `imageJobs`/`imageJobToasts`/`reviewProgress`/`sceneReview`/`endingProposals`/`interludeReflection`/`characterDraftQueue`/`scrollTarget`/`usageLog`/`schemaError`/`modelsByProvider`/各 `is*` フラグ
- **BranchNode/BranchTree** — `{id,parentId,kind:'action'|'scene',label,timeLabel?,createdAt,imageIds,bytes,ending?,star?,branchName?,anchorMessageId?}`／`{currentId,nodes}`。実体（gzip した Session）は `CheckpointStore`
- **Cassette** — `{id,title,description,coverImageId?,session(開始状態),createdAt}`。棚に置く配布単位。`playCassette` が新セッションへ複製し `originCassetteId` を刻む

## ModelRef

モデル系フィールドは `"providerId::modelId"`。区切り無しは `providers[0]` へフォールバック、空文字は上位へ継承。解決: 本編 `session.model`／レビュー `reviewModel → model`／選択肢 `choicesModel → model`（`mainModelOf`/`reviewModelOf`/`choicesModelOf`）。新規セッションとカセット開始は `defaultModelRef`（未設定なら `DEFAULT_MODEL`）を刻む。カセット下書きはモデル参照を持たない。

## 永続化とスキーマ版番

- zustand `persist`（`name: PERSIST_KEY`・`createJSONStorage(() => stateStorage)`）。**`set()` のたびに全状態を `JSON.stringify` する構造**＝既知の性能問題（計画 P2 で分割）
- 版番は3系統: `APP_STATE_VERSION`（入れ物＝zustand の `migrate`）／`SAVE_DATA_VERSION`／`CASSETTE_DATA_VERSION`（後2つは `partialize` が `schemaVersions` として書き、`merge` で毎回判定）。移行は `migrations[from]` を1段ずつ。**段を飛ばす一発変換を書かない**
- 読めなかったら `blockStateWrites()` で書き込みを封印し `schemaError` → App.tsx が案内画面（バックアップの場所を提示）。「無視して続ける」は作らない
- **スキーマ変更の手順**: 型 → 初期値/factory → `exportBundle`/`importBundle` → `partialize` → 破壊的なら該当版番 +1 と移行関数1本。persist キーは変えない
- チェックポイント: 3契機で自動記録（本編生成の正常完了＝action／編集・削除直後＝action／シーン終了確定＝scene）。`stableSessionJson` 一致なら積まない。書込は sessionId ごとに直列化

## プロンプトの構造

本編は **system／深さ3／深さ0 の3層**（`prompts.ts`）。理由はプロンプトキャッシュの粒度がメッセージ単位だから（system が1文字変わると全体が無効）。

| 層 | 変わる頻度 | 中身 |
|---|---|---|
| system（`buildSystemPrompt`） | **シーン境界でのみ** | 世界観概要＋常時ロア／これまでのあらすじ／【現在の場面】＝`scene.note`／【時間】＝`state.now`／【状態】＝関係性 prose・気分／登場人物定義（中心人物ラベル付き）／新しい登場人物の方針／【中心人物】／【目指す結末】／物語設定（ジャンル・前提・最初のシーンだけ初期方向付け）／文体ルール／構造化出力の形式 |
| 深さ3（履歴末尾から3件手前。足りなければ system 直後） | 毎ターン | 【今回の場面に関わる設定】＝キーワード一致ロア／【常に踏まえる重要事項】＝`authorNote`＋`CONSEQUENCE_CLAUSE` |
| 深さ0（末尾） | 毎ターン | 【今回の応答】話者指定（会話劇）／【いまの状況】＝`scene.foreground`／【シーンの収束】/【締め】ナッジ（文字数閾値超過時）／形式の短い再掲 |

- 履歴に載せるシーン範囲は `session.rawWindowFromSceneId`（`selectRawScenes`・`beginScene` だけが決める。**シーン途中で動かさない・古い方へ戻さない**）。窓の1つ手前のシーンは末尾だけ「橋」として足す
- `kind:'directive'` の入力は `DIRECTIVE_HEADER` の固定枠で user として送る。裏方の文脈・書き出しからは落とす
- `withCacheControl` は Anthropic 系にだけ system 末尾と深さ3の手前にマーカーを付ける

**裏方の呼び出し**（すべて `reviewModelOf`/`choicesModelOf` のモデル・対応モデルなら JSON スキーマ固定）:

| 呼び出し | いつ | 入力 |
|---|---|---|
| レビュー A（要約・次シーン候補・成長・ロア追加・新キャラ） | シーン終了 | 本文 transcript＋素材 |
| レビュー B（関係性 prose 全文書き直し・気分） | シーン終了（A と並列。`reviewSplit===false` なら A/B を1本） | 同上 |
| トラッカー T（`now`/`place`/`presentIds`/`situation`/`pending` の add・done／`foreground`） | シーン終了（A/B と並列） | 本文＋現在＋予定＋名前だけ |
| 選択肢 | 〈展開を選ぶ〉を押したとき | `choicesMessages`（専用に圧縮） |
| 結末の提案／エピローグ | 「終わり方を考える」／確定時 | 本文＋状態 |
| 幕間／幕間の反映 | 終了シーンで生成／「関係性へ反映」 | そのシーン本文＋関係 prose |
| キャラ起案／画像起案 | ？バッジ・レビュー承認／挿絵・アバター生成 | 本文＋定義 |

→ **シーン終了1回＝3呼び出し、1ターン＝1呼び出し。** 無料枠（OpenRouter 未課金 50 req/日）では短編1本/日が上限になる。

## 主要な振る舞い

- **開始**: `startStory()`。`focusCharacterId` 未選択・置換タグ未束縛なら拒否。導入文（`story.opening`）があれば AI 生成せずそのまま最初の assistant メッセージに載せる
- **物語モード（読者モデル）**: 入力はすべて `kind:'directive'`。主操作は「続ける」（`continueStory(pace)`。`PACE_PROMPTS` のマーカーを user に積む）／〈もっと詳しく〉〈先へ飛ばす〉／「やり直す」（`regenerate`＝現在シーン末尾の assistant を捨てて再生成）／〈展開を選ぶ〉（`pickDirection`）。ロールプレイだけ「演じて書く／書き手に指示」のチップが残る
- **生成** `runCompletion`: `isProviderUsable` 判定 → 空の pending メッセージを積む → `streamChat` → 一時エラーは最大3回リトライ（何も受信していない時のみ）→ `finish_reason==='length'` なら `truncated`（「続きを生成」`continueLast` は同一メッセージへ追記）→ チェックポイント記録。中断は用途別の `mainController`/`choicesController`/`reviewController`
- **シーン終了**: `prepareSceneReview` が A/B/T を並列に投げ、`reviewProgress` で進行を見せる（呼び出し1本＝1行）→ `SceneReviewModal` で編集・承認 → `confirmSceneReview`（overlay 追記・`applyReviewToState`・`applyTrackerToState`・新シーン作成・チェックポイント scene）→ `beginScene`（窓を確定し導入マーカーを積んで生成）
- **上書きガード** `ensureLineTip(sessionId, parent)`: 物語操作の冒頭で、現在地より先にある**保護なし**の子サブツリーを削除する（保護＝`branchName`/`star`/`ending` を含む）。scene ノードを含む削除だけ3択（残す→命名／上書き／中止）。分岐を作る操作（`branchFromMessage`/`branchFromNode`）は先端に名前を付けて保護してから巻き戻す。シーン境界をまたぐ巻き戻しは `rewindScenesFor` で置き去りシーンを落とす
- **復元と移動**: `restoreCheckpoint` はスナップショットで全置換（`title/model/reviewModel/choicesModel/temperature/maxTokens/archived` だけ現在値維持）。`navigateToNode` はパス外なら線の先端を復元して該当メッセージへスクロール（`scrollTarget`）。復元自体は何も消さない
- **結末**: `proposeEndings` → `setEndingGoal`（system の【目指す結末】）または `concludeStory`（エピローグシーンを書いて `ending` 確定 → 進行系を隠し「やり直す」だけ残す）。分岐で戻れば未確定
- **幕間**: 終了シーンの末尾に `generateInterlude(sceneId, characterId)`（中心人物以外）。`reflectInterlude` で関係 prose の差分を出し `confirmInterludeReflection` で反映
- **発見キャラ**: 構造化本文の未解決話者の ？バッジ／レビューの `newCharacters` 承認 → `queueCharacterDrafts`（既知の名前・`NARRATION_NAMES`・待機中同名は弾く）→ `CharacterDraftModal` が起案 → `addDiscoveredCharacter`（ライブラリの通常キャラ＋`characterIds` へ追加）
- **画像**: `startImageJob` → 直列生成 → `selecting`（自動採用しない）→ `applyImageJobResult`（挿絵は `Scene.illustrations`＋`sessionImageLogs`、アバターは `avatar.imageId`。旧画像は参照を外すだけ）。回収は `gcUnusedImages`（使用中集合＝`collectUsedImageIds`）
- **環境音ピン**（実験機能）: 本文の一点に `AmbientPin` を置き、スクロール中心との距離で音量。`Scene` の中なので分岐に乗る
- **書き出し**: `StoryExportModal`（plain/markdown/挿絵つき/共有カード画像・分岐時点指定可）。キャラ・世界・カセットは PNG カード、全データは JSON バンドル（画像同梱可）。取り込みは `importAnyFile` に一本化
- **初回**: `FirstRunWizard`（かんたん接続=OAuth／無料枠=Gemini／品質重視／緩いモデル／PC で動かす）→ 接続テスト → `defaultModelRef` 設定。閉じても `Provider` 未設定なら生成時に案内
- **起動時**: hydration 後に `hydrateProviderSecrets`・`cleanupOrphanCheckpoints`・`backfillImageLogs`

## 規約・落とし穴

**プロンプト**
- `buildSystemPrompt` に毎ターン変わる値を足さない。ターンごとに変えたいものは深さ3（素材・拘束）か深さ0（今すぐ効かせる短い指示）へ
- `selectRawScenes` を呼んでよいのは `beginScene` だけ
- `pending`（予定）を本編プロンプトに渡さない。`now` は system、突き合わせ済みの一文は深さ0
- `buildMessages` の履歴からマークアップを剥がさない。`plainTextOf` は裏方文脈・ラベルだけ（レビュー transcript／チェックポイントラベル／挿絵起案／選択肢の直近本文）
- 新しく「本文を読む処理」を足したら、`kind:'directive'` とマーカーを落とすか判断する（迷ったら落とす。例外は文字数カウント）
- 迎合対策の文面を強くしない（実測で効かなかった。`決定記録.md` §3）

**データ**
- 画像 id を持つフィールドを増やしたら `sessionImageIds`／`collectUsedImageIds`／`collectCardImages` に追加する（入れ忘れ＝GC で使用中画像が消える）
- 画像の即時 `deleteImage` を書かない（参照除去＋GC）
- `restoreCheckpoint` の passthrough を増やすときは「本文・進行と結合しているか」で判定。迷ったらスナップショット側
- 分岐の自動削除は `subtreeHasProtection` を通す。`recordCheckpoint` 内では剪定しない
- store 直管理のフィールド（`avatar.imageId` 等）を draft 全置換の保存で上書きしない
- 環境音ピンは画像 id を持たない。GC・エクスポート・カセット同梱と無関係

**UI**
- モーダルは `ModalShell`。ネイティブ `confirm`/`prompt` 禁止（`appConfirm`/`appPrompt`/`appChoices`）
- カンマ区切り入力は `CsvInput`、必須の数値欄は `NumberInput`
- アイコンは `icons.tsx` の SVG。絵文字・文字記号（★⑂✕）を UI に使わない（ユーザーが「安っぽい・意味不明」と明言）。アイコン単独は ×/⋯/✎ 等の普遍記号＋tooltip のみ
- 用語: 素材は「キャラクター」（「キャラ」不可）・セッション内は「登場キャラクター」・作成ボタンは「＋ 〜を作る」の動詞形・内部 ID（`openrouter/auto` 等）を UI に出さない
- 長い説明文は `HelpDetails`（要点1文＋折りたたみ）。見出し直下に段落を並べない
- シーン見出しは「本文か要約があるとき」だけ出す
- レビューモーダルは `sceneReview.sessionId === activeId` かつ Play 表示中だけ出す
- `ZoomOverlay` はポータル描画を維持。サムネイルの img ルールは直下セレクタで書く
- 環境音のアンカー差し込みは3レンダラ（非構造化 novel／`StructuredNovelBody`／会話形式）全部に入れる
- **`useStore()` をセレクタ無しで丸ごと購読しない（新規コード）。** 既存35箇所は計画 P2 で直す

**プラットフォーム**
- `<a download>` は Tauri で動かない。ファイル DL は `io.ts` 経由
- `capabilities/default.json` の http スコープはポート成分 `:*` を省略しない
- 画像生成の定型タグ・画風の結合は `generateImage` の1箇所。`promptStyle==='natural'` では結合しない
- 画像コストは円換算しない。Civitai を成人向け枠として説明しない
- ComfyUI のワークフローは「プレースホルダがあれば手動置換・無ければ自動検出」の排他

## 既知の問題（2026-09-13 のレビューで確定。対処は計画書）

- `persist` が `set()` ごとに全状態を `JSON.stringify`（20セッション×150発言≒5.7MB で 11ms/チャンク）。ストリーミング中の全量シリアライズ＋全コンポーネント再描画で、使うほど重くなる → P2
- テスト0件・lint 無し・CI 無し → P2
- `send`/`continueStory` は `isStreaming` 判定の後に `await ensureLineTip` があり二重送信が通る。`mainController` 等がモジュール変数で、選択肢生成中に本編生成が始まると `null.signal` になる既知バグ → P2
- `"csp": null`（現状 LLM 出力は React が escape するので実害なし。Markdown 描画を入れる前に必ず CSP を入れる）→ P2
- 起動直後に素材が無く、キャラ作成 → 世界作成 → セッション設定 → 中心人物選択 を経ないと最初の生成に辿り着けない → P3
- Web 版は localStorage（約5MB）に全状態を置くため、実用にはならない → P5

## ドキュメント

| 文書 | 役割 |
|---|---|
| [`docs/計画_レビュー対応.md`](docs/計画_レビュー対応.md) | **進行中の計画。** 各フェーズを独立したセッションで進める前提の手順書 |
| [`docs/決定記録.md`](docs/決定記録.md) | 決めたこと・却下したことの一覧。新しい案の前に読む |
| [`docs/要件定義書.md`](docs/要件定義書.md) | 利用者視点の現行機能（実装非依存） |
| [`docs/開発環境と配布.md`](docs/開発環境と配布.md) | 初回準備・配布ビルド・インストーラ検証・Tauri 手動チェック |
| [`docs/設計_物語の簡素化.md`](docs/設計_物語の簡素化.md) | 現行の物語機構（読者モデル・時間と予定・幕間）の設計理由 |
| [`docs/設計_プロンプト構造とキャッシュ.md`](docs/設計_プロンプト構造とキャッシュ.md) | 3層構造とキャッシュの設計理由（実装済み。現状の正はこのファイル） |
| [`docs/設計_入力の二分化とローカルLLM案内.md`](docs/設計_入力の二分化とローカルLLM案内.md) | `kind:'directive'` の設計理由 |
| [`docs/計測_時間と予定.md`](docs/計測_時間と予定.md)／[`docs/計測_別視点の幕間.md`](docs/計測_別視点の幕間.md) | 現行設計を決めた実測 |
| [`docs/カセット作成ガイド_AI用.md`](docs/カセット作成ガイド_AI用.md) | カセット JSON を書くためのガイド（利用者・AI 向け） |
| [`docs/ガイド_ローカルLLMで動かす.md`](docs/ガイド_ローカルLLMで動かす.md) | Ollama / LM Studio 接続ガイド（利用者向け） |
| [`docs/環境音_音源調達リスト.md`](docs/環境音_音源調達リスト.md) | 同梱音源の出所とライセンス（消さない） |
| [`docs/環境_ローカルツール_AI用.md`](docs/環境_ローカルツール_AI用.md) | このマシンで使える CLI 一覧 |
| `docs/archive/` | 完了・撤去済みの設計書。**リンクを辿るとき以外は読まない** |

## コード中のコメントに残るタグ

コメントの `（FB7-E）` のような印は、その変更を入れた設計書の項目名。文書は archive か削除済みなので**辿らなくてよい**。意味だけ: `Fn`=物語の簡素化のフェーズ／`PC*`=プロンプト構造とキャッシュ／`IN1`=入力の二分化／`Rn`=公開前実装（R1 版番・R2 カード検証・R3 資格情報・R4 OAuth・R5 ウィザード・R10 書き出し）／`In`=画像生成の簡易化／`AMn`=環境音ピン／`Tn`=Tauri 化／`CSn`=登場制御／`FBn-X`=フィードバック反映 n／`Gn`・`CGn`・`En`・`Wn`・`Pn`・`Vn`・`Bn`・`Cn`・`Qn`・`STn`・`UI-n`=旧フェーズ名。

## ユーザーの進め方の好み

- 大きめの要望は「機能検討（設計提案＋選択式質問）→合意→実装→検証→要約報告」
- 1ターンで作りすぎない。大改修はフェーズ分割し、各フェーズを検証可能にする
- 実装に触れない要件定義書が欲しいことがある（`docs/要件定義書.md`）
- 見た目の確認は AI が行い、報告は「確認した」の形で
