# AGENTS.md — デルシア（Delusia）

サークル **とかとかげ**（`tokatokage.com`）／製品名 **デルシア**（英字 `Delusia`。delusion（妄想）＋ -ia（土地名の接尾辞）の造語。由来「Delusion Story」は README に一行書くだけで、副題・併記にはしない）。Tauri の `productName` は `Delusia`、識別子 **`com.tokatokage.delusia`**（＝`%APPDATA%\<identifier>\` が保存先。公開後は変更不可）。
`cards.ts` の `extensions.aistorytelling` はカードのデータ形式キーなので改名しない。

好きな LLM（OpenRouter・OpenAI 互換・ローカル）で **AI が自動で書き進める物語を読む**／**キャラと会話する**、クライアント完結（BYOK）のアプリ。**配布経路は2つ**——Tauri 2 デスクトップ版（Windows・未署名）と、静的ホスティングに置く Web 版（Vite・PWA。P5）。機能は同じで、違うのは保存先・通信の制約・ファイル入出力だけ。UI 文言・コメント・ユーザーとのやり取りは日本語。

> **このファイルは「現在の状態」だけを書く。** 経緯・却下案は [`docs/決定記録.md`](docs/決定記録.md)、進行中の計画は [`docs/計画_レビュー対応.md`](docs/計画_レビュー対応.md)、完了済みの設計書は `docs/archive/`（**リンクを辿るとき以外は読まない**）。
> **ファイル編集を伴うコミットで、ここに書かれた振る舞い・規約・データモデルが変わるなら同じコミットで更新する。** 履歴は書かない（git がある）。

## コマンドと検証

- Web 版: `npm run dev`（Vite・5173）／デスクトップ版: `npm run tauri:dev`（初回は Rust ビルドで数分。5173 を共有するので Web dev と同時起動不可）
- 型: `npx tsc --noEmit`／テスト: `npm test`（`vitest run`）／ビルド: `npm run build`（`tsc && vitest run && vite build`）／配布: `npm run tauri:build`
- **変更後は必ず「`npx tsc --noEmit` → `npm run build`」を通す。**（`build` がテストも走らせる）
- **見た目・UX の確認は AI が自分で行う**（dev サーバ → 該当画面 → スクリーンショット → 判断。console エラー0件も確認。完了報告には「何を確認したか」を書く。ユーザーは UI 確認をしない）
- 純関数・store のロジックは **vitest** で確かめる（`src/**/__tests__/**/*.test.ts`・node 環境・jsdom なし）。テストが要るのは純関数と store のロジックだけで、描画は対象にしない
  - store を丸ごと動かすテスト（`src/__tests__/storyTurn.test.ts`）は `lib/openrouter` の `streamChat` と `lib/platform` の `stateStorage`/`checkpointStore` を `vi.mock` で差し替える＝ネットワークと IndexedDB を踏まない
  - 共通のダミーデータは `src/lib/__tests__/fixtures.ts`（既定値は空・無効に寄せ、テスト側が必要な欄だけ上書きする）
- Tauri 固有部（`appFetch`/`saveBlob`/ファイルストレージ/資格情報/OAuth）を触ったときだけ手動チェック → [`docs/開発環境と配布.md`](docs/開発環境と配布.md) §4
- 初回準備（Rust・Build Tools・Defender の除外）と配布ビルドの検証手順も同文書

## Git

- リモート `https://github.com/Cake30984/AIStoryTellingUI.git`／ブランチ `main`
- **1つの変更ごとに `git commit` → `git push origin main`。** メッセージは日本語で端的に
- `samples/`・`_ambient_work/`（撤去済み環境音の作業残骸）・`run.bat` は ignore 済みのローカル作業物。指示が無い限り触らない
- **public リポジトリ。** 秘密・個人情報（API キー・実在のメールアドレス・Windows のユーザー名を含むパス等）をコミットしない。作業機の `git config user.email` は GitHub の noreply アドレスにする
- **履歴は 2026-09-21 に書き換え済み**（`git filter-repo` で撤去済み環境音と個人メールを全履歴から除去し force-push）。それ以前のクローンは使わずに取り直す

## 技術スタックと基本方針

React 18 + TypeScript(strict) + Vite / zustand（`persist`）/ Tauri 2（`plugin-http`・`plugin-fs`・`plugin-dialog`・`plugin-opener`・`keyring`）。追加ライブラリは最小限。

- **環境差（Web/Tauri）は `src/lib/platform.ts` に閉じる。** `isTauri()` 分岐をそこ（と `imageStore.ts`）の外に書かない。Tauri の JS パッケージは必ず動的 import
- **LLM は OpenAI 互換 Chat Completions の SSE 一本**（`lib/openrouter.ts`）。プロバイダ差は `Provider` オブジェクトとヘッダ／`response_format` の降格で吸収する
- **素材（Character/World）は不変の再利用資産。** 物語中の変化はセッション側（`state`／`overlay`）に積む
- **状態はすべて prose**（数値・条件・フラグは持たない。`決定記録.md` §1〜2）
- 製品の位置づけは「挿絵入りの本」。立ち絵・背景・VN 的画面は作らない

## ディレクトリ

`src/types.ts` — 全データ型（**最初に読む**）／`src/store.ts` — zustand ストア（状態・全アクション・永続化の口・チェックポイント・描画の購読ヘルパ。4,500行の単一ファイル）／`src/App.tsx` — レール＋サイドバー＋メイン＋常駐モーダルの組み立て・起動時処理／`src/styles/` — `tokens`/`base`/`layout`/`chat`/`composer`/`panels`.css（`index.css` が順に import。色・z-index・spacing は `tokens.css`）／`src-tauri/` — Tauri シェル（`lib.rs`＝plugin 登録＋資格情報の save/load/delete、`oauth.rs`＝PKCE の 127.0.0.1 受け口、`capabilities/default.json`＝http は `http://*:*`/`https://*:*`・fs は `$APPDATA/**`、`installer-hooks.nsh`＝アンインストール時の資格情報削除、`tauri.conf.json` の `app.security.csp`＝**デスクトップ版の CSP の正**）／`src/starter/` — 既定コンテンツ（サンプルの世界観1・登場人物3・開始セッションの雛形。純データ＝`store.ts` を import しない）／`src/**/__tests__/` — vitest のテスト（`*.test.ts`。`src/lib/__tests__/fixtures.ts` は共通のダミーデータ）／`public/` — そのまま `dist/` へ入る静的ファイル（PWA。`manifest.webmanifest`・`sw.js`・`icon-192/512`・`icon-maskable-512`・`favicon.png`。アイコンはリポジトリ直下の `icon.png` から作った）／`scripts/` — 開発・実験用の node スクリプト（`baseline.mjs`＝対照実験の対照側。依存無し・`src/starter/index.ts` を Node の型剥がしで直接 import する。出力先 `scripts/out/` は ignore）

### `src/lib/`
- `platform.ts` — `isTauri`／`oauthPkceMode`（`listener`=Tauri／`redirect`=Web）／`isBrowserStorage`／`registerServiceWorker`（Web の本番ビルドでだけ `sw.js` を登録）／`appFetch`（Tauri は plugin-http で CORS-free。`omitOrigin` で Origin を外す＝ComfyUI 用）／`saveBlob`／`stateStorage`（Web: localStorage、Tauri: `data/state.json` をアトミック書込＋500ms デバウンス＋close 時 flush）／`backupStateSnapshot`／`blockStateWrites`／`CheckpointStore`（Web: IndexedDB、Tauri: `data/checkpoints/<sessionId>/<nodeId>.bin`）／`SessionStore`（Web: IndexedDB `aist-sessions`、Tauri: `data/sessions/<id>.json`。1件＝`{v, session}` で版番をレコードごとに持つ・**読み書きは id ごとに直列化**・`scheduleSessionWrite`＝500ms デバウンス・`deleteSessionRecord`＝取り消してから削除・Web はタブが隠れた時点で flush）／資格情報（`hydrateProviderSecrets`・`stripApiKeyForPersist`）
- `openrouter.ts` — `streamChat`（SSE・`usage` 取得）／`fetchModels`（`name` が無い一覧＝Gemini の OpenAI 互換・Anthropic の `display_name` は id 等で必ず埋める。空だと ModelPicker の検索で落ちる）／`withCacheControl`（Anthropic 系にだけ `cache_control` を2箇所）／`jsonSchema`+`jsonMode` を渡すと `response_format`（弾かれたら schema→object→なし と1段ずつ落として再送し、通った段をモデルごとにプロセス内で記憶）
- `providers.ts` — `Provider` 型・プリセット（OpenRouter / OpenAI / Gemini / Claude / DeepSeek / Groq / カスタム。Gemini・Claude も `kind:'openai'` で URL だけ入った独立の選択肢）・`parseModelRef`/`makeModelRef`・**接続先が使えるかの判定**（`isLocalEndpoint`/`requiresApiKey`/`isProviderUsable`。ローカル宛はキー不要・OpenRouter 用ヘッダも送らない）・`isAnthropicEndpoint`（Anthropic 直叩きはブラウザ用ヘッダ `anthropic-dangerous-direct-browser-access` を付け、`/models` はネイティブ API の形＝`x-api-key`）
- `prompts.ts` — 本編の3層組み立て（`buildSystemPrompt`/`buildMessages`/`selectRawScenes`）と裏方プロンプト全部（選択肢・レビュー A/B/T・次シーン候補・結末提案・エピローグ・幕間・キャラ起案・画像起案・物語の起案）。進行マーカーは `MARKER_PROMPTS`/`isMarkerContent`、本文判定は `isStoryText`/`sceneCharsOf`
- `jsonSchemas.ts` — 裏方 LLM の JSON スキーマ（`reviewSchema(part)`/`CHOICES_SCHEMA`/`ENDING_PROPOSALS_SCHEMA`/`NEXT_SCENE_SCHEMA`/`IMAGE_DRAFT_SCHEMA`/`CHARACTER_DRAFT_SCHEMA`/`KICKOFF_SCHEMA`）と `jsonModeFor(model, models)`（OpenRouter の `supported_parameters` 優先・無ければ名前で推定）
- `kickoff.ts` — 一行からの起案結果を `World`/`Character` へ詰める純関数（`normalizeKickoff`・`KICKOFF_TAG`）。件数の上下限・空欄・名前の空白は**受け側のここで**吸収する（スキーマでは縛らない）
- `json.ts` — `extractJson`（修復フォールバック付き）／`partialString`（ストリーミング途中の JSON から文字列値を読む）
- `names.ts` — `matchCharacterByName`（名前解決の唯一の窓口。レビューの発見キャラが既知の人物を誤検出しないため）／`NARRATION_NAMES`。本文は素のテキスト＝行タグのパーサは無い（構造化出力は 2026-09-21 に撤去。旧データの `@名前「」` は `schema.ts` の `flattenSpeakerTags` が移行で剥がす）
- `lorebook.ts` — ロアを `alwaysOn`（system）とキーワード一致（深さ3・直近6件窓）に分ける
- `tokens.ts` — 文字数（ユーザー向け）とトークン（コスト・窓）の単位。閾値 `SCENE_WIND_DOWN_CHARS`(3000)/`SCENE_WRAP_UP_CHARS`(4500)/`RAW_WINDOW_TOKENS`(12000)
- `schema.ts` — 版番（`APP_STATE_VERSION`=2／`SAVE_DATA_VERSION`=5／`CASSETTE_DATA_VERSION`=5）と移行連鎖
- `version.ts` — `APP_VERSION`（`vite.config.ts` が package.json から注入）・`compareVersions`
- `io.ts` — `downloadBundle`/`downloadBlob`（内部で `saveBlob`）／`parseBundle`（未知キーは捨てずに持ち回る）
- `cards.ts` — キャラカード（`chara_card_v2` 互換）／世界カード（`aist_world`）／カセット（`aist_cassette`）の書き出し・解釈。**読み込み検証は `validateCard` 1本**（`minRuntimeVersion`／`spec`／`spec_version`）。`freshSessionOf` で開始状態へ初期化
- `png.ts` — tEXt チャンク読み書き（数MB級は `push(...spread)` 禁止＝セグメント連結）
- `imageStore.ts` — 画像 blob ストア（Web: IndexedDB、Tauri: `data/images/`）。`putImage`/`getImage`/`gcImages`/`useImageUrl`。localStorage に画像を入れない
- `imageGen.ts` — 画像生成の抽象層。`generateImage` → `ImageGenResult{blob,cost?}`。種別は **`openrouter-image`（`/images`・コストを返す唯一の種別）／`comfyui`（`/prompt`→`/history`→`/view`）／`openai-image` の3つ**（`IMAGE_PROVIDER_KINDS`。旧 civitai/modelslab は persist から `merge` で読み捨てる）。定型タグの結合は `combineWithDefaults` の1箇所
- `comfyWorkflow.ts`（API Format ワークフローのリンク追跡による自動注入・純関数）／`promptTags.ts`／`imageSetup.ts`（初回案内を断ったかの非永続フラグ）／`cost.ts`（課金単位のまま表示。現在は usd のみ）／`imageJobs.ts`（ジョブ型・AbortController の Map・`useBlobUrl`）／`avatarGen.ts`
- `storyExport.ts` — 物語の書き出し（plain/markdown/挿絵つき markdown・分岐時点も可・`isBackstage` で指示とマーカーを落とす）／`storyCard.ts` — 共有用の1枚画像（1080×1350）
- `oauthPkce.ts` — OpenRouter OAuth（PKCE）。Tauri は `startOpenRouterOAuth`（Rust の一回きり受け口。`state` 無しなので nonce 入り URL で代替）、Web は `redirectToOpenRouterOAuth` → 戻りで `pendingOAuthRedirect`／`completeOpenRouterOAuthRedirect`（`code_verifier` はそのタブの `sessionStorage`。成否によらず使い捨て）。UI の可否判定は `openRouterOAuthAvailable` 1本／`checkpoint.ts`（gzip）／`dialogs.ts`（`appConfirm`/`appPrompt`/`appChoices`）／`modalStack.ts`／`shortcuts.ts`（`Ctrl+K` パレット・`Ctrl+1/2/3`・`Ctrl+G` 続ける・`Ctrl+.` 没入）／`useCardDrop.ts`／`useMultiSelect.ts`

### `src/components/`
- 骨格: `WebStorageNotice.tsx`（ブラウザ版の保存先の初回案内。P5）／`Rail.tsx`（Play/Library/System）／`Sidebar.tsx`（セッション一覧・素材ナビ・D&D 取込）／`ChatPanel.tsx`（会話画面本体。トップバー・本文・コンポーザー・右ドック）／`ContextDock.tsx`（状態/発見/画像/分岐/ジョブ のタブ。`StatusView`/`DiscoveryView`/`GalleryModal.GalleryBody`/`BranchTreeModal.BranchTreeBody`/`ImageJobsPanel.ImageJobsBody`）／`LibraryBar.tsx`／`CommandPalette.tsx`／`FirstRunWizard.tsx`（接続先5経路＋接続テスト）／`SettingsModal.tsx`（`SettingsBody`＝System ページ: 接続先・既定モデル・データ入出力・GC・使用状況）／`ImageProviderSettings.tsx`
- 共通部品: `ModalShell`（全モーダル。`dirty` で破棄確認）／`DialogHost`／`MenuPopover`／`ZoomOverlay`（`document.body` へポータル）／`icons.tsx`（自前 SVG。絵文字・文字記号は使わない）／`EntityAvatar`／`NumberInput`／`CsvInput`／`HelpDetails`／`ActivityIndicator`／`IntroTagDefEditor`・`IntroTagFields`
- Play: `StoryKickoffModal.tsx`（一行から始める＝起案 → そのまま `SessionEditor` へ引き継ぐ）／`SceneReviewModal.tsx`（確定前は呼び出し単位の進行表示）／`SceneEditor`／`StoryLogModal`（あらすじ一覧）／`StatusPanel`・`DiscoveryPanel`（編集）／`EndingModal`（結末の提案）／`InterludePanel`（幕間）／`CharacterDraftModal`（発見キャラの起案→`CharacterEditor` draft）／`ImageGenModal`／`StoryExportModal`／`ReaderSettings`
- Library: `library/CharacterLibrary`・`CharacterEditor`・`WorldLibrary`・`WorldEditor`（フルページ。基本／ロア／関係性の次元／開始テンプレート）・`CassetteLibrary`・`AvatarField`・`LibraryMultiSelect`／`CassetteEditor.tsx`／`SessionEditor.tsx`（基本／物語／進行／AIと出力 の4タブ）

## データモデル（要点）

型定義と各フィールドの意味は `src/types.ts` のコメントが正。ここは関係だけ。

- **Provider**（LLM 接続先）／**ImageProvider**（画像接続先）— どちらも persist のみ・**エクスポートに含めない**。Tauri では `apiKey` を資格情報ストアへ分離し `state.json` には空で書く
- **Character** — 人格・口調・外見・セリフ例・`developments`（成長ログ）・`avatar`・`imagePrompt?`・`tags`。中心人物も同じ型
- **World** — `description`（常時）＋`entries: LoreEntry[]`（`keys`/`alwaysOn`/`enabled`）＋`relationAspects`（関係性の次元）＋`calendarFormat?`＋`startPreset?: WorldStartPreset`（セッション作成時に**コピー**される推奨初期設定。素材側は不変）
- **Session** — `characterIds`／`worldId`／**`focusCharacterId`**（中心人物・必須。空文字＝未選択で開始不可）／`authorNote`／`story: StorySetup`（genre/premise/opening/openingTitle/initialDirective）／`scenes`／`currentSceneId`／`narrativeStyle`／`reviewSplit?`／`rawWindowFromSceneId?`／`newCharacterPolicy?`／`state`／`overlay`／`endingGoal?`／`ending?`／`archived?`／`originCassetteId?`／`messages`／`usage?`（このセッションの累計。下記）／`model`・`reviewModel`・`choicesModel`／`temperature`／`maxTokens`
- **SessionState** — `relations: Relation[]`（キャラ→中心人物の有向 prose。`stance`＋次元ごとの `note`）／`moods`／`now`（自由文字列）／`place`／`presentIds`／`situation`／`pending: PendingSlip[]`（`when`/`what`）／`recentDone`
- **SessionOverlay** — `lore`（発見ロア）／`characterDevelopments`。素材を汚さないための上乗せ。本編には素材＋overlay の実効ビュー（`effectiveWorld`/`effectiveCharacter`）で注入。`promoteOverlay*` で素材へ **move**
- **Scene** — `title`/`note`（時・場所・居る人物）/`summary`/`timeLabel?`/`foreground?`（突き合わせ済みの一文）/`illustrations?`/`interludes?`/`endedAt?`
- **Message** — `role`/`characterId?`/`sceneId?`/`content`/`choices?`/`truncated?`/`pending?`/`kind?: 'directive'`（書き手への指示。判定は `isDirective`）
- **AppState 直下（Session の外に置くもの）** — `branchTrees: Record<sessionId, BranchTree>`／`sessionImageLogs`／`cassettes: Cassette[]`／`ui: UiPrefs`／`defaultModelRef`／`favoriteModels`／`lastImageProviderId`／`lastDraftModel`／`starterSeeded`（既定コンテンツを一度入れたか）／`storageNoticeSeen`（ブラウザ版の保存先案内を出したか。P5）。**`branchTrees`・`sessionImageLogs` を Session に入れない**（スナップショットに含まれて再帰肥大・復元で巻き戻る）
- **非永続（`partialize` 除外）** — `imageJobs`/`imageJobToasts`/`reviewProgress`/`sceneReview`/`endingProposals`/`interludeReflection`/`characterDraftQueue`/`scrollTarget`/`usageLog`/`schemaError`/`modelsByProvider`/各 `is*` フラグ
- **BranchNode/BranchTree** — `{id,parentId,kind:'action'|'scene',label,timeLabel?,createdAt,imageIds,bytes,ending?,star?,branchName?,anchorMessageId?}`／`{currentId,nodes}`。実体（gzip した Session）は `CheckpointStore`
- **Cassette** — `{id,title,description,coverImageId?,session(開始状態),createdAt}`。棚に置く配布単位。`playCassette` が新セッションへ複製し `originCassetteId` を刻む
- **SessionUsage**（`Session.usage?`）— `{promptTokens, completionTokens, cost?}`。**加算は `recordUsage` の1か所だけ**（本編も裏方もそこを通る）。単位は提供元が返したまま＝トークンと USD（円換算しない）。**分岐の復元では巻き戻さない**（`restoreCheckpoint` の passthrough。使った額は本文の進行と結合していない）。`freshSessionOf` が落とすのでカセットには載らない

## ModelRef

モデル系フィールドは `"providerId::modelId"`。区切り無しは `providers[0]` へフォールバック、空文字は上位へ継承。解決: 本編 `session.model`／レビュー `reviewModel → model`／選択肢 `choicesModel → model`（`mainModelOf`/`reviewModelOf`/`choicesModelOf`）。新規セッションとカセット開始は `defaultModelRef`（未設定なら `DEFAULT_MODEL`）を刻む。カセット下書きはモデル参照を持たない。

## 永続化とスキーマ版番

- **保存先は2つ**。入れ物＝`PERSIST_KEY`（Web: localStorage／Tauri: `data/state.json`）に**軽い状態だけ**（素材・カセット・分岐木・画像記録・UI・接続先）。**セッション本体は `SessionStore`**（Web: IndexedDB `aist-sessions`／Tauri: `data/sessions/<id>.json`）に1件＝1レコード（`{v, session}`。`v` はそのレコードのセーブ版番）
- 読み書きの口は store.ts の `appStateStorage`（`createJSONStorage` は使わない）。**読み**＝軽い状態に `sessions` を差し込んでから persist へ返す（`migrate`・`merge` の移行と正規化を素通しさせるため）。**書き**＝`partialize` から `sessions` を外し、ハイドレーション後の購読（`startSessionPersistence`）が**参照比較で変わった1件だけ** `scheduleSessionWrite`（500ms デバウンス）へ流す。消えた id は `deleteSessionRecord`。**`pending` メッセージを持つセッションは書かない**（生成中は書かず完了時の1回にまとめる）
- 旧形式（入れ物に `sessions` がある）は起動時に一度だけ `SessionStore` へ移し、**原文を `state.json.bak`／`${PERSIST_KEY}-bak` へ残してから**軽い状態で上書きする。移せなければ封印して案内へ（本体を失わせない）
- 版番は3系統: `APP_STATE_VERSION`（入れ物＝zustand の `migrate`）／`SAVE_DATA_VERSION`／`CASSETTE_DATA_VERSION`（後2つは `partialize` が `schemaVersions` として書き、`merge` で毎回判定）。移行は `migrations[from]` を1段ずつ。**段を飛ばす一発変換を書かない**。セッションを触る段は `sessionMigrations` が本体で、`saveDataMigrations` は**そこから導出**する（＝**セッション以外を触るセーブの段をそこへ直接足さない**。レコード経由の読み出しでは走らない）。1件ぶんを上げるのが `migrateSession`
- 読めなかったら `blockStateWrites()` で書き込みを封印し `schemaError` → App.tsx が案内画面（入れ物と本体、両方の場所を提示）。「無視して続ける」は作らない。**壊れたセッション1件では封印しない**——その1件だけ飛ばして件数を `infoNotice` に出す（保存先のデータは消さない）
- **スキーマ変更の手順**: 型 → 初期値/factory → `exportBundle`/`importBundle` → `partializeAppState` → 破壊的なら該当版番 +1 と移行関数1本（セッションを触るなら `sessionMigrations` へ）。persist キーは変えない
- チェックポイント: 3契機で自動記録（本編生成の正常完了＝action／編集・削除直後＝action／シーン終了確定＝scene）。`stableSessionJson` 一致なら積まない。書込は sessionId ごとに直列化

## プロンプトの構造

本編は **system／深さ3／深さ0 の3層**（`prompts.ts`）。理由はプロンプトキャッシュの粒度がメッセージ単位だから（system が1文字変わると全体が無効）。

| 層 | 変わる頻度 | 中身 |
|---|---|---|
| system（`buildSystemPrompt`） | **シーン境界でのみ** | 世界観概要＋常時ロア／これまでのあらすじ／【現在の場面】＝`scene.note`／【時間】＝`state.now`／【状態】＝関係性 prose・気分／登場人物定義（中心人物ラベル付き）／新しい登場人物の方針／【中心人物】／【目指す結末】／物語設定（ジャンル・前提・最初のシーンだけ初期方向付け）／文体ルール（Web 小説の素の形＝セリフは「」・行頭に話者ラベルを付けない） |
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
| キャラ起案／画像起案 | レビュー承認／挿絵・アバター生成 | 本文＋定義 |
| 物語の起案 | 「一行から始める」 | 利用者が書いた一行だけ（既定モデル・素材は無い） |

→ **シーン終了1回＝3呼び出し、1ターン＝1呼び出し。** 無料枠（OpenRouter 未課金 50 req/日）では短編1本/日が上限になる。

## 主要な振る舞い

- **開始**: `startStory()`。`focusCharacterId` 未選択なら拒否。導入文（`story.opening`）があれば AI 生成せず書かれたまま最初の assistant メッセージに載せる
- **物語モード（読者モデル）**: 入力はすべて `kind:'directive'`。主操作は「続ける」（`continueStory(pace)`。`PACE_PROMPTS` のマーカーを user に積む）／〈もっと詳しく〉〈先へ飛ばす〉／「やり直す」（`regenerate`＝現在シーン末尾の assistant を捨てて再生成）／〈展開を選ぶ〉（`pickDirection`）。ロールプレイだけ「演じて書く／書き手に指示」のチップが残る
- **生成** `runCompletion`: `isProviderUsable` 判定 → 空の pending メッセージを積む → `streamChat` → 一時エラーは最大3回リトライ（何も受信していない時のみ）→ `finish_reason==='length'` なら `truncated`（「続きを生成」`continueLast` は同一メッセージへ追記）→ チェックポイント記録
- **二重送信ガード** `claimStoryTurn(sessionId, parentNodeId)`: 物語を進める操作（`send`/`continueStory`/`continueLast`/`regenerate`/`regenerateFrom`/`startStory`/`beginScene`）は `ensureLineTip` をこれ経由で呼ぶ。`isStreaming` を見てから `await ensureLineTip` が返るまでは生成が始まっていないので、**同期でロックを立ててから待つ**。生成を伴わない操作（`editMessage`/`deleteMessage`/`prepareSceneReview` 等）は `ensureLineTip` を直接呼ぶ
- **中断**は用途別の `mainController`/`choicesController`/`reviewController`（ストア生成関数のスコープ）。**`signal` は必ず各呼び出しのローカル `controller` から取り、後片付けも同一性を見てから行う**——共有変数から読み直すと、並行する別の生成が終了時に null を入れた瞬間に落ちる
- **シーン終了**: `prepareSceneReview` が A/B/T を並列に投げ、`reviewProgress` で進行を見せる（呼び出し1本＝1行）→ `SceneReviewModal` で編集・承認 → `confirmSceneReview`（overlay 追記・`applyReviewToState`・`applyTrackerToState`・新シーン作成・チェックポイント scene）→ `beginScene`（窓を確定し導入マーカーを積んで生成）
- **上書きガード** `ensureLineTip(sessionId, parent)`: 物語操作の冒頭で、現在地より先にある**保護なし**の子サブツリーを削除する（保護＝`branchName`/`star`/`ending` を含む）。scene ノードを含む削除だけ3択（残す→命名／上書き／中止）。分岐を作る操作（`branchFromMessage`/`branchFromNode`）は先端に名前を付けて保護してから巻き戻す。シーン境界をまたぐ巻き戻しは `rewindScenesFor` で置き去りシーンを落とす
- **復元と移動**: `restoreCheckpoint` はスナップショットで全置換（`title/model/reviewModel/choicesModel/temperature/maxTokens/archived` だけ現在値維持）。`navigateToNode` はパス外なら線の先端を復元して該当メッセージへスクロール（`scrollTarget`）。復元自体は何も消さない
- **結末**: `proposeEndings` → `setEndingGoal`（system の【目指す結末】）または `concludeStory`（エピローグシーンを書いて `ending` 確定 → 進行系を隠し「やり直す」だけ残す）。分岐で戻れば未確定
- **幕間**: 終了シーンの末尾に `generateInterlude(sceneId, characterId)`（中心人物以外）。`reflectInterlude` で関係 prose の差分を出し `confirmInterludeReflection` で反映
- **発見キャラ**: レビューの `newCharacters` 承認 → `queueCharacterDrafts`（既知の名前・`NARRATION_NAMES`・待機中同名は弾く）→ `CharacterDraftModal` が起案 → `addDiscoveredCharacter`（ライブラリの通常キャラ＋`characterIds` へ追加）
- **画像**: `startImageJob` → 直列生成 → `selecting`（自動採用しない）→ `applyImageJobResult`（挿絵は `Scene.illustrations`＋`sessionImageLogs`、アバターは `avatar.imageId`。旧画像は参照を外すだけ）。回収は `gcUnusedImages`（使用中集合＝`collectUsedImageIds`）
- **書き出し**: `StoryExportModal`（plain/markdown/挿絵つき/共有カード画像・分岐時点指定可）。キャラ・世界・カセットは PNG カード、全データは JSON バンドル（画像同梱可）。取り込みは `importAnyFile` に一本化
- **初回**: `FirstRunWizard`（OpenRouter で接続=OAuth または鍵貼り付け・**推奨モデル4件を `RECOMMENDED_MODELS` から一言説明つきで一覧表示。価格は表示のたびに `/models` から取り、一覧に無い id は出さない。失敗時は選び直し（自動フォールバックしない）**／無料枠=Gemini／PC で動かす）→ 接続テスト → `defaultModelRef` 設定 → 最後に「サンプルの物語を開く」（`openStarterStory`。「完了」と同義で行き先が1つ増えるだけ）。閉じても `Provider` 未設定なら生成時に案内。**ブラウザ版はウィザードを閉じたあと1回だけ** `WebStorageNotice`（保存先・消える条件・書き出し。`storageNoticeSeen`）
- **ブラウザ承認（OAuth）**: Tauri はその場で鍵が返る。**Web はページごと OpenRouter へ移動し、`?code=` 付きで戻ってくる**——App が起動時に `pendingOAuthRedirect` を見て交換し、接続先へ鍵を入れてからウィザードを開き直す（開いた画面が `settings` なら通知だけ）。**接続先の判定より先に**この処理を通す（先にウィザードが開くと、承認したのに手入力の画面へ着地する）
- **一行から始める**: `kickoffStory(premise, signal)` が既定モデルへ**1呼び出し**（`KICKOFF_SCHEMA`）→ `normalizeKickoff` で `World`1・`Character`2〜4人（先頭が中心人物・タグ「起案」）→ `startPresetPatch` でセッションへ流し込んで開く。**生成は始めない**——`StoryKickoffModal` がそのまま `SessionEditor` を開き、人が直して「保存」してから始める。起案できなくても空のセッションは作る（理由は設定画面の冒頭に出す）。中止されたときだけ何も作らない
- **既定コンテンツ**: 素材が空の初回起動で `seedStarterContent` が `src/starter/` をライブラリへ入れ、開始状態のセッションを1本作って開く。**自動投入は1回きり**（`starterSeeded`）＝消した人へ勝手に戻さない。入れ直しは Library の「サンプルを追加し直す」（素材は固定 id へ上書き＝増えない・セッションだけ1本増える）。Play の空状態は素材が無ければサンプルへ、あれば `SessionEditor` へ送る（物語の導線は1本）
- **起動時**: hydration 後に `hydrateProviderSecrets`・`cleanupOrphanCheckpoints`・`backfillImageLogs`・`seedStarterContent`（初回のみ）

## 描画の購読（P2b）

`set()` 1回＝ストリーミングの1チャンク。**そのとき描き直るコンポーネントを最小にする**のがここの規約。

| 使うもの（`store.ts`） | いつ |
|---|---|
| `useStore((st) => st.x)` | 状態を1つ読む（既定。これで足りるなら他は使わない） |
| `storeActions()` | アクションを取る。**購読しない**（アクションは生成時に固定され差し替わらない）。ここから状態を読まない |
| `useShallowStore(sel)` | 複数スライスをまとめて読む（返り値を1段だけ浅く比べる） |
| `useListStore(sel)` | 一覧用に**プリミティブだけの小さな行オブジェクトの配列**を読む（Sidebar のセッション一覧） |
| `useSessionExceptBody(id)` | **本文を読まない**購読でセッション1件を読む（右ドック）。`messages`／`updatedAt` の変化では同じ参照を返す |

- 本文の描画は `ChatPanel.tsx` の `ChatPanelBody` → `SceneBlock`（memo）→ `SceneContent` → `MessageRow`（memo）。`ChatPanelBody` が `sceneId → messages` の対応表を1回の走査で作り、**内容の変わらないシーンは前回の配列をそのまま返す**（参照が変われば memo が全滅する）
- `SessionMeta`（`ChatPanel.tsx`）＝本文以外のセッションのスライス。`MessageActions` ＝操作をまとめた参照固定のオブジェクト。どちらも `useMemo` で作って配る
- `ContextDock`・`ActivityIndicator`・`InterludePanel` は `memo`。props に `Session` を入れると全部無効になる
- 実測（30シーン・600発言・40チャンク1回）: 全体の再描画 App 44→0／Sidebar 44→1／右ドック 44→0／幕間 1320→60 回

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

**UI**
- モーダルは `ModalShell`。ネイティブ `confirm`/`prompt` 禁止（`appConfirm`/`appPrompt`/`appChoices`）
- `scrollableBody` のモーダル（`SessionEditor` 等）は **`modal-body` が flex 行**。中身を足すときは左ナビ＋右パネルの**内側**へ入れる（手前に兄弟として置くと横並びの1項目になり、本体が右へ押し出される）
- カンマ区切り入力は `CsvInput`、必須の数値欄は `NumberInput`
- アイコンは `icons.tsx` の SVG。絵文字・文字記号（★⑂✕）を UI に使わない（ユーザーが「安っぽい・意味不明」と明言）。アイコン単独は ×/⋯/✎ 等の普遍記号＋tooltip のみ
- 用語: 素材は「キャラクター」（「キャラ」不可）・セッション内は「登場キャラクター」・作成ボタンは「＋ 〜を作る」の動詞形・内部 ID（`openrouter/auto` 等）を UI に出さない
- 長い説明文は `HelpDetails`（要点1文＋折りたたみ）。見出し直下に段落を並べない
- シーン見出しは「本文か要約があるとき」だけ出す
- レビューモーダルは `sceneReview.sessionId === activeId` かつ Play 表示中だけ出す
- `ZoomOverlay` はポータル描画を維持。サムネイルの img ルールは直下セレクタで書く
- **`useStore()` をセレクタ無しで丸ごと購読しない。** 丸ごと購読すると `set()` 1回（＝ストリーミングの1チャンク）ごとに無関係なコンポーネントまで描き直る。使い分けは `store.ts` の購読ヘルパ節を見る
- **本文を描くコンポーネントへ `Session` を丸ごと渡さない。** `messages` が毎チャンク変わるので `React.memo` が全部外れる。渡すのは `SessionMeta`（本文以外のスライス）と、そのメッセージ・シーン自身

**プラットフォーム**
- `<a download>` は Tauri で動かない。ファイル DL は `io.ts` 経由
- `capabilities/default.json` の http スコープはポート成分 `:*` を省略しない
- 画像生成の定型タグ・画風の結合は `generateImage` の1箇所。`promptStyle==='natural'` では結合しない
- コストは円換算しない（画像も、セッション累計＝`formatSessionUsage` も。提供元の課金単位のまま出す）
- ComfyUI のワークフローは「プレースホルダがあれば手動置換・無ければ自動検出」の排他
- **Web 版は静的ホスティングに置く前提**（P5）。`base` は相対（`vite.config.ts`。Tauri ビルドだけ `/`）＝ドメイン直下でもサブパスでも同じ成果物が動く。`index.html`・`manifest.webmanifest`・`sw.js` の中のパスも**すべて相対**で書く（絶対パスを1つ混ぜるとサブパス配信で壊れる）
- **Service Worker（`public/sw.js`）が触るのは同一オリジンの GET だけ。** API（別オリジン）は素通し。ビルド成果物の一覧とキャッシュ名は `vite.config.ts` の `swAssets` が `dist/sw.js` へ差し込む（`public/` はバンドラを通らないので出力後に書き換える。**Tauri ビルドでは差し込まず `sw.js` ごと落とす**）。**初回訪問は SW が効く前に読み込みが終わる**ので、install で成果物を先に取っておかないとオフラインで白画面になる
- **狭い画面（720px 以下）の規則は `layout.css` の末尾の1ブロックだけ**（サイドバーを本文の上へ・右ドックを本文に重ねる）。デスクトップ版の最小幅は 960px なので実質 Web 版だけの話。ここを増やしてモバイル最適化を作り込まない
- **CSP の出所は2つだけ**。Tauri 版＝`src-tauri/tauri.conf.json` の `app.security.csp`（Tauri がヘッダで注入）、Web 版＝`index.html` の `<!--CSP-->` を `vite.config.ts` が meta へ差し替える（Tauri ビルドでは消す＝二重に掛けない）。dev だけ `ws://localhost:5173` と `script-src 'unsafe-inline'`（Vite の HMR と react-refresh のプリアンブル）を足す。`frame-ancestors` は meta では無視されるので入れない。外部から読むリソース（画像・フォント・スクリプト）を足すときは両方を直す

## 既知の問題（2026-09-13 のレビューで確定。対処は計画書）

- lint 無し・CI 無し（テストは P2a で導入済み）
- カセットは開始状態のセッションを内包したまま軽い状態に残る。長い物語からカセットを作ると、そのぶんが毎 `set()` の直列化に乗る（20セッション×150発言の実測で、カセット無し 0.04ms／150発言ぶんを内包したカセット1本で 0.92ms）
- 一行からの起案（P4）は**実モデルで未検証**。配線と正規化はローカルのスタブ応答で確認済みだが、実モデルが `storyKickoffSystem` の指示（人数・名前の空白・他キャラ名を書かない）をどこまで守るかは未計測
- Tauri 側の `data/sessions/`（P2c）と CSP（P2a）は**実機で未検証**（Windows と Rust が要る）。次に `tauri:dev` を回せるときに [`docs/開発環境と配布.md`](docs/開発環境と配布.md) §4 を一巡させる
- 中核主張「状態機械があると長編でも素のチャットより読める」は**未検証**。道具（`scripts/baseline.mjs`・`docs/実験_対照読み比べ.md`）は P6 で用意済みだが、人に読ませて判定する工程はまだ。結果が出るまで README・公開文にこの主張を書かない
- Web 版は**まだどこにも置いていない**（P5 は成果物と手順まで。公開は P7・A1 待ち）。ローカルのサブパス配信で PWA のインストール条件・オフライン復帰・OAuth の往復（認可ページはスタブ）まで確認済みだが、**公開 URL と実モデルでの通しは未実施**

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
| [`docs/実験_対照読み比べ.md`](docs/実験_対照読み比べ.md) | 中核主張（状態機械があると長編でも読める）を人に読ませて確かめる手順・質問票・判定基準。対照側は `scripts/baseline.mjs` |
| [`docs/カセット作成ガイド_AI用.md`](docs/カセット作成ガイド_AI用.md) | カセット JSON を書くためのガイド（利用者・AI 向け） |
| [`docs/ガイド_ローカルLLMで動かす.md`](docs/ガイド_ローカルLLMで動かす.md) | Ollama / LM Studio 接続ガイド（利用者向け） |
| [`docs/環境音_音源調達リスト.md`](docs/環境音_音源調達リスト.md) | **撤去済み**環境音の、過去の同梱音源の出所とライセンス記録（消さない） |
| `docs/archive/` | 完了・撤去済みの設計書。**リンクを辿るとき以外は読まない** |

## コード中のコメントに残るタグ

コメントの `（FB7-E）` のような印は、その変更を入れた設計書の項目名。文書は archive か削除済みなので**辿らなくてよい**。意味だけ: `Fn`=物語の簡素化のフェーズ／`PC*`=プロンプト構造とキャッシュ／`IN1`=入力の二分化／`Rn`=公開前実装（R1 版番・R2 カード検証・R3 資格情報・R4 OAuth・R5 ウィザード・R10 書き出し）／`In`=画像生成の簡易化／`AMn`=環境音ピン（撤去済み）／`Tn`=Tauri 化／`CSn`=登場制御／`FBn-X`=フィードバック反映 n／`Gn`・`CGn`・`En`・`Wn`・`Pn`・`Vn`・`Bn`・`Cn`・`Qn`・`STn`・`UI-n`=旧フェーズ名。

## 進め方（メンテナの方針）

- 大きめの要望は「機能検討（設計提案＋選択式質問）→合意→実装→検証→要約報告」
- 1ターンで作りすぎない。大改修はフェーズ分割し、各フェーズを検証可能にする
- 実装に触れない要件定義書が欲しいことがある（`docs/要件定義書.md`）
- 見た目の確認は AI が行い、報告は「確認した」の形で
- 作業機で使える CLI の一覧はローカルの `docs/環境_ローカルツール_AI用.md`（git 管理外）
