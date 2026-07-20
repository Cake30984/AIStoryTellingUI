# AGENTS.md — AI Storytelling Studio

マルチプロバイダ（OpenRouter・OpenAI 互換等）で好きなモデルを使い、AI とのロールプレイ／自動進行する物語づくりを行うクライアント完結型アプリ。**Tauri 2 デスクトップ版が正式版**（`%APPDATA%` 配下にセッション・画像を保存）＋ **Web 版併存**（開発・検証用）。UI 文言・コメントは日本語。ユーザーは日本語でやり取りする。

> **このファイルの性格**: 現在の状態・規約・データモデルの参照ドキュメント。実装の変遷・意思決定の経緯は `docs/設計_*.md`（下記「設計ドキュメント」）に集約されているので、ここには履歴を書かず現状のみを簡潔に保つ。

## コマンド
- 開発（Web 版）: `npm run dev`（Vite, ポート5173）
- 開発（デスクトップ版・Tauri シェル）: `npm run tauri:dev`（初回は Rust フルビルドで数分。Web dev と同時起動不可＝ポート競合）
- デスクトップ版ビルド: `npm run tauri:build`
- 型チェック: `npx tsc --noEmit` / ビルド: `npm run build`（`tsc && vite build`）
- **変更後は必ず「型チェック → build」で確認。** Tauri 固有部を触った時のみ `npm run tauri:dev` の手動チェックリスト（後述）も実施。
- **Rust 前提環境**（初回のみ）: rustup＋VS Build Tools（C++）。Windows Defender「コントロールされたフォルダーアクセス」有効時は `cargo.exe`/`rustc.exe` を許可アプリに追加しないとビルド失敗する（詳細は `docs/設計_Tauri化.md`）。

## Git・バージョン管理
- リモート: `https://github.com/Cake30984/AIStoryTellingUI.git`（ブランチ: `main`）
- **1つの変更（機能追加・バグ修正・リファクタ等）ごとに必ず `git commit` → `git push origin main`。作業を溜め込まない。**
- コミットメッセージは日本語可・端的に。
- **ファイル編集を伴うコミットでは、影響する記述（ディレクトリ・データモデル・主要な振る舞い・規約等）があれば `AGENTS.md` も同じコミットで更新する。**

## 技術スタック
React 18 + TypeScript + Vite / 状態管理は zustand（`persist`。storage は `src/lib/platform.ts` の `stateStorage` アダプタ経由。Web は localStorage、Tauri は `%APPDATA%/data/state.json` のファイル backend）/ 追加ライブラリは最小限。環境差（Web/Tauri）は `src/lib/platform.ts` に集約し、**`isTauri()` 分岐はこのファイル（とストレージ実装＝`imageStore.ts`）の外に書かない**。

## ディレクトリ
各ファイルの「現在の責務」を1行で。深い経緯は `docs/設計_*.md` を参照。

- `src/types.ts` — 全データ型（**最初に読む**）
- `src/store.ts` — zustand ストア。状態・全アクション・永続化（クリーンブレイク・移行なし）・状態エンジン（関係性 prose／事実の数）・世界観イベント自動発火・チェックポイント記録/復元など中核ロジック
- `src/styles/` — `index.css` の分割先6ファイル（`tokens`/`base`/`layout`/`chat`/`composer`/`panels`.css。`index.css` は順に `@import` するだけ）。意味色・z-index・spacing・リーダー設定用の CSS 変数は `tokens.css` の `:root` に集約
- `src-tauri/` — Tauri シェル（Rust）。設定・権限のみで独自ロジックはほぼ無し。`tauri.conf.json`・`capabilities/default.json`（`http`/`fs`/`dialog` 権限。fs は `$APPDATA/**` 再帰読み書きにスコープ）・`src/lib.rs`（plugin 登録のみ）

### `src/lib/`
- `platform.ts` — 環境差アダプタ層。`isTauri()`/`appFetch`（Tauri は plugin-http で CORS-free、Web は `window.fetch`）/`saveBlob`（Tauri は保存ダイアログ、Web は `<a download>`）/`PERSIST_KEY`/`stateStorage`（Tauri は state.json のアトミック書込＋500msデバウンス＋close時flush・旧WebViewデータからの初回自動移行）/`CheckpointStore` interface（Web:IndexedDB `aist-checkpoints` / Tauri:`data/checkpoints/<sessionId>/<nodeId>.bin`）。gzip 済みバイナリをそのまま扱う
- `checkpoint.ts` — チェックポイント用 gzip ヘルパ（`gzipText`/`gunzipText`）
- `providers.ts` — `Provider` 型・プリセット・`parseModelRef`/`makeModelRef`/`splitRef`/`modelRefLabel`
- `openrouter.ts` — SSE ストリーミング補完・モデル一覧取得（provider オブジェクト駆動）
- `prompts.ts` — system プロンプト組み立て・選択肢/レビュー用プロンプト・定数（`CONTINUE_PROMPT`/`SCENE_START_PROMPT`）・画像プロンプト起案（`illustrationPromptSystem`/`backgroundPromptSystem` 等）・表情判定用 `emotionSystem`。【時間】には時間帯固定の指示（シーン内で時間帯を先へ進めない・進行はシーン切り替わりの役割）を含む。story モードは `story.initialDirective`（最初の方向付け・FB5-②）を**最初のシーン滞在中のみ**【最初の方向付け】として注入（チャット非表示・`@` は `＠` に無害化）。現在シーンの推定トークンが閾値超過なら【シーンの収束】/【シーンの締め】ナッジを注入（履歴に積まない・エピローグ対象外。FB5-①）。`buildSystemPrompt`/`buildMessages` は `session.structuredOutput` で【セリフの出力形式】ブロック追加や矛盾指示の条件無効化を切替。配役済みロール（グループ）は毎ターン `roleMembers`（`casting.ts`）でメンバーを解決し【配役】として実名（複数は「・」連結）＋立場で動的に注入し、`@` 記法は渡さない（A-2）
- `casting.ts` — 置換タグ（`@タグ`）の検出・導入本文の実名解決（`findIntroTagRefs`/`resolveIntroText`）とロールグループのメンバー解決（`roleMembers`）・開始可否の検証（`validateCasting`）・カード/永続化入力の正規化（`normalizeWorldRoles`/`normalizeRoleAssignments`/`normalizeIntroTags`/`normalizeIntroBindings`）。React/store 非依存の純粋関数。名前置換とロール（プロンプト注入）は分離されている（A-1/A-2・`docs/設計_ロールグループと定量条件.md`）
- `lorebook.ts` — 世界観ロアのキーワード一致抽出
- `timeline.ts` — `advanceTimeline`/`timeLabelOf`/`timelinePromptInfo`/`isNearEnd`
- `json.ts` — `extractJson`（モデル出力からの堅牢な JSON 抽出）
- `structured.ts` — 構造化出力（`@名前(感情)「セリフ」`行タグ）のパーサ。全て純粋関数。`parseLine`/`parseStructured`/`matchCharacterByName`（名前解決の一本化窓口）/`resolveEmotionToken`/`hasStructuredLines`（レンダラ分岐用・メッセージ単位）/`plainTextOf`（マークアップ除去）/`emotionUpdatesOf`/`NARRATION_NAMES`（`地の文`等の予約話者名＝ラベル非表示救済）。パース失敗行は必ず narration に落とす（graceful degradation）
- `tokens.ts` — `estimateTokens`/`tokenLevel`/`sceneTokensOf`（現在シーンの推定トークン）＋ペース制御閾値 `SCENE_WIND_DOWN_TOKENS`(3000)/`SCENE_WRAP_UP_TOKENS`(4500)。バッジ・提案チップ・ナッジの3者はこの閾値を共有する（FB5-①）
- `io.ts` — `downloadBundle`/`downloadBlob`（内部で `saveBlob` を呼ぶ）/`parseBundle`（取り込み検証）。バンドル組み立て本体は `store.exportBundle`
- `imageStore.ts` — アバター・カード画像ストア。`putImage`/`putImageAs`/`getImage`/`deleteImage`/`listImageIds`/`gcImages`＋`blobToBase64`/`base64ToBlob`＋表示用 `useImageUrl`。内部は `BlobStore` interface（Web:IndexedDB / Tauri:`data/images/<id>.<拡張子>`）。localStorage には画像を入れない
- `avatarGen.ts` — `generateDefaultAvatar`（イニシャル＋色 canvas）/`normalizeImage`（縮小・PNG化）
- `png.ts` — PNG tEXt チャンク読み書き（`readTextChunks`/`writeTextChunk`）。**組み立てはセグメント連結方式＝`push(...spread)` は数MB級でスタックオーバーフローするため禁止**
- `imageGen.ts` — 画像生成抽象層。`generateImage`（comfyui: /prompt→/history→/view、openai-image: b64_json）/`testImageProvider`/`fillWorkflow`/`DEFAULT_COMFY_WORKFLOW`。**接続先の `defaultPositive`/`defaultNegative` の結合はここ1箇所のみ**（`combineWithDefaults`）
- `promptTags.ts` — `ensureTags`（pins のタグ欠け補完）＋`combineWithDefaults`（接続先デフォルトタグの先頭結合・重複除去）
- `imageJobs.ts` — バックグラウンド画像生成ジョブの型（`ImageJobTarget`/`ImageJob`）とヘルパ。Blob を含むため **partialize から除外**。AbortController はモジュールレベル `Map`（`registerJobAbort`/`clearJobAbort`/`abortJobController`）。`useBlobUrl` フック
- `cards.ts` — キャラカード（`chara_card_v2` 互換）／世界カード（`aist_world`）／ペルソナカード（`aist_persona`）／ゲームカセット（`aist_cassette`＝開始状態に初期化したセッション＋素材＋画像の全部入り＋紹介文メタ）の組み立て・解釈。`exportCharacterCard`/`exportWorldCard`/`exportPersonaCard`/`exportCassetteCard`/`parseCardPng`/`attachCardImage`＋`freshSessionOf`（プレイ記録・モデル参照を初期化。カセット下書きの種にも使う・export）。画像収集/サイズ確認/model 除去は `collectCardImages`/`confirmImageSize`/`stripCharacterModels`。`model`/`avatar.imageId`/`sprites` は通常カードから除外（カセットのみ同梱）。**セッションカード（`aist_session`）は FB3-D で読み書きとも撤去**（過去に書き出した PNG は読めない。共有はカセット・バックアップは System のデータ書き出し）
- `useCardDrop.ts` — PNG カード D&D 受付フック（`dragOver`＋`dropProps`）
- `useMultiSelect.ts` — カード/セッション一覧の複数選択フック（Ctrl/Cmd=個別トグル・Shift=範囲・右クリック選択）。`handleClick` は修飾キー付きのみ true（＝開かない）。FB2-D
- `modalStack.ts` — `useModalEscape`（最前面モーダルだけ Escape で閉じる）/`modalStackSize`
- `dialogs.ts` — ネイティブ `confirm`/`prompt` の置き換え。`appConfirm`/`appPrompt`/`appChoices`（3択等の選択ダイアログ・value か null を返す。FB6-C）（Promise ベース・React 非依存。lib からも呼べる）。`DialogHost.tsx` が描画・解決
- `shortcuts.ts` — `useGlobalShortcuts(onTogglePalette)`。App.tsx から1回だけ登録する単一 keydown リスナ。`Escape`=没入解除専用 → フィールドフォーカス中は Ctrl 系のみ → モーダル中は無効 → `Ctrl+K`=パレット・`Ctrl+1/2/3`=Play/Library/System・`Ctrl+G`=続ける・`Ctrl+.`=没入トグル

### `src/components/`
共通部品:
- `DialogHost.tsx` — `dialogs.ts` のキューを描画する常駐ホスト（App.tsx に1つ）
- `ModalShell.tsx` — 全モーダル共通シェル（overlay＋modal＋head＋body＋foot）。`dirty` が真の時のみオーバーレイクリック・Escape で破棄確認
- `ZoomOverlay.tsx` — 画像クリック拡大の共通オーバーレイ（`caption` でキャプション付き対応）。**`document.body` へのポータル描画**（呼び出し元サムネイルの img セレクタ・stacking context の影響を受けない）でフィット表示。閉じるのは画像クリック・背景クリック・Escape（キャプションは本文選択のため stopPropagation）。FB7-A
- `icons.tsx` — 自前 SVG アイコン（依存追加なし）。`<Icon name size? className? filled?/>`。`IconName` は機能ボタン用のみ（彩り用絵文字は対象外）
- `MenuPopover.tsx` — 汎用ポップオーバー（親に `position:relative` 必要・外側クリック＋Escape で閉じる）
- `ActivityIndicator.tsx` — 本編/選択肢/レビュー/画像生成/表情判定の進行状態を1チップに集約。クリックで内訳＋中止
- `LibraryBar.tsx` — Library（作る）画面用の細いトップバー（`ActivityIndicator`＋インポートボタン＋ジョブボタン）。画像生成の進行/採用を Play に行かず確認できるよう App.tsx が各 Library ビューを `.main` でラップして表示（F6）。ジョブ一覧はドックが無いので `ModalShell`＋`ImageJobsBody`。インポートは PNG カード/JSON バンドルを `store.importAnyFile` で種別自動判別し、結果は `infoNotice` トーストに出す
- `EntityAvatar.tsx` — 画像 or 色＋イニシャルの共通アバター（全画面で統一）
- `CastingFields.tsx` — セッション設定・カセット・開始時モーダルで共有する、世界観ロール（グループ）への配役欄。ロールごとに参加キャラをチェックボックスで複数選択（1ロール複数人・1人が複数ロール兼任も可。A-2）
- `IntroTagDefEditor.tsx` — 置換タグの定義編集（追加・削除・メモ）。WorldEditor 開始テンプレート／SessionEditor／CassetteEditor で共有。`opening`/`onOpeningChange` を渡すとタグ名変更時に本文中の `@旧タグ名` を追従書き換えする（A-1）
- `IntroTagFields.tsx` — 置換タグ（`@タグ`）→ ペルソナ/参加キャラ の対応付け欄＋導入文の実名解決プレビュー。セッション設定・カセット・開始時モーダルで共有（A-1）

Play 領域:
- `ChatPanel.tsx` — 会話画面。トップバー（①`.session-title-wrap`＝タイトル入力＋hover鉛筆で編集可視化・F3②`.scene-chip`＝クリックで SceneEditor③`ActivityIndicator`④`.topbar-group`＝状態/発見/ギャラリー/分岐/ジョブの5ボタン＝`ui.dockTab` トグル⑤`ReaderSettings`（Aa）⑥`⋯`メニュー）。本文領域は `.play-body`＝`.play-col`（`StageBackdrop`＋`chat-wrap`＋`composer-wrap`）と `<ContextDock/>` の2カラム。コンポーザーに常時レンダリングの `.composer-tools`（開始/続ける・やり直す・続きを生成・選択肢生成・挿絵🎨・背景🏞・シーン編集・シーン終了）。シーン推定トークンが締め閾値（`SCENE_WRAP_UP_TOKENS`）超過で操作行の直上に `.scene-wrap-hint`（シーン終了レビューの提案チップ。自動では開かない・×でシーン単位で非表示。FB5-①c）。挿絵・背景生成は `illustGenFor: {sceneId, messageId?}`／`bgGenFor: {sceneId}` state で `ImageGenModal` を開く（FB6-B）: 導線はコンポーザー・⋯メニュー（現在シーン）＋メッセージ操作行の「🎨 挿絵」（そのメッセージがアンカー）＋あらすじ一覧の各シーン行（過去シーン）。起案文脈は `sceneMessagesUpto`（対象シーンの本文をアンカーまで・マーカー除く）で組み立て、過去シーンはそのシーンの配役（`sceneParticipants`）を使う。assistant メッセージは `hasStructuredLines` が真なら `StructuredMessage` に描画切替。発見編集は `discoveryScope`（`DiscoveryScope`）で `DiscoveryPanel` を開く
- `StructuredMessage.tsx` — 構造化出力の表示専用。`StructuredNovelBody`（narration そのまま＋dialogue は話者チップ独立行）／`StructuredChatBody`（同一話者を1吹き出しにまとめ・narration は間ブロック）。ストリーミング中の末尾未改行行は未確定表示。話者→アイコンは `useSpeakers`（参加キャラ＋persona 合成）
- `StageBackdrop.tsx` — チャット背面のバックドロップ（表示専用・`pointer-events:none`）。`scene.backgroundImageId` を背景、参加キャラの `sprites` を現在感情→neutral→先頭の順で解決し等分セルに横並び。濃さは `ui.stageBgOpacity`/`ui.stageSpriteOpacity`
- `ContextDock.tsx` — 右コンテキストドック本体。`ui.dockTab`（null=非表示）を購読し `status`=`StatusView`／`discovery`=`DiscoveryView`／`gallery`=`GalleryBody`／`branch`=`BranchTreeBody`／`jobs`=`ImageJobsBody` を出し分け。幅は `ui.dockWidth`（左端 `.dock-resizer` ドラッグで 300〜560 可変・F1）。状態タブは head の「✎ 編集」で `StatusPanel` を開く。発見タブの編集は `DiscoveryView` 内タブ横の「✎ 編集」が選択スコープ（世界観 or キャラ）で `DiscoveryPanel` を開く（`onEditDiscovery(scope)`・F4）
- `StatusView.tsx`/`DiscoveryView.tsx` — ドック専用の**読み取り専用**ビュー（編集 UI・保存処理を持たない）。`StatusView` は参加キャラ名へ現在の配役ロールを併記する。`DiscoveryView` は「🌍世界観／キャラ（アバター＋件数）」のタブ切替（F4）
- `ReaderSettings.tsx` — Aa ボタン→ポップオーバー。文字サイズ/行間/本文幅（`RsField`＝スライダー＋数値入力・数値で自由設定。F2）/セリフ色分け/ステージ表示ON/OFF（`spritesEnabled`）/背景・立ち絵の濃さ/没入モード/「表示を既定に戻す」を `store.ui` へ即時反映（保存ボタンなし）
- `Rail.tsx` — 左端48px の領域スイッチ（Play/Library/System・アイコン＋日本語ラベル。設定は最下段固定。F0/F5）。Library は直前の素材ビューをローカル state で記憶
- `Sidebar.tsx` — 文脈サイドバー。`areaOf(view)` で出し分け（play=検索＋新規＋セッション一覧＋アーカイブトグル／library=キャラ/世界観/ペルソナ/カセットの縦ナビ）。ブランド表示なし（F3で撤去）。セッション右クリックで `MenuPopover`（開く/設定/カード化/アーカイブ/削除）。Ctrl/Shift で複数選択→選択バー・右クリックで一括削除/アーカイブ（`useMultiSelect`・FB2-D）。＋新規作成は `createSession` の返す id で設定モーダルを自動オープン。セッションカード PNG の D&D 受付
- `CommandPalette.tsx` — `Ctrl+K` で開くパレット。セッション/素材の名前検索→移動＋固定コマンド。実行は既存 store アクション／`setUiPrefs` のみ

モーダル・パネル:
- `SessionEditor.tsx` — セッション設定。「基本／進行／モデル／出力」4タブ（同一 draft を共有）。フッターに「カセットにする…」（`CassetteEditor` を `seedSession` 付きで開く）。「構造化出力」チェックボックスあり。世界観選択時に開始テンプレートを空欄項目のみ自動コピー（`startPresetPatch`・W1。置換タグ定義 `introTags` も同じ規則でコピー）＋「開始テンプレートを読み込む」リンクで全上書き（確認つき）。story モードは最初の方向付け（`story.initialDirective`・非表示注入）欄→導入（`story.opening`/`openingTitle`・そのまま掲載）欄の直下に `IntroTagDefEditor`（置換タグ定義）→`IntroTagFields`（タグ→ペルソナ/参加キャラの対応付け）→`CastingFields`（世界観ロールグループへの配役）の順に並ぶ。進行タブに開始時間帯（`timeline.currentSlot`／未開始時は `startDay`/`startSlot` として記録）
- `CastingModal.tsx` — 導入文の置換タグ未束縛または必須ロール未配役の開始時に開くモーダル。`IntroTagFields`＋`CastingFields` で埋めてから、そのまま `startStory` を再実行する
- `CassetteEditor.tsx` — カセット専用エディタ（FB3-D）。左セクションナビ（基本〔タイトル・紹介文・表紙〕／世界観／登場キャラ／ペルソナ／開始・進行）で `Cassette`（内部に開始状態のセッション）を編成。開始・進行に最初の方向付け（`initialDirective`）欄があり、導入欄直下に `IntroTagDefEditor`→`IntroTagFields`→`CastingFields` を置く。新規＝`newCassette()`／既存編集＝`cassette` prop／セッションから＝`seedSession`（`freshSessionOf` で下書き化）。表紙はタイトルから自動（保存時に生成焼付け）／画像ファイル選択（`normalizeImage`→`putImage`）／種セッションの挿絵から選択。保存は `upsertCassette`。読み込みは Sidebar D&D・System ファイル入力・カセット棚 D&D（`importCassette`＝「棚に登録のみ」＝`cassettes` に積む。FB2-E）。PNG 書き出しは未解決の配役・置換タグ束縛があると拒否する
- `SettingsModal.tsx` — `export function SettingsBody()`（System ページ本体）。プロバイダ管理・新しい物語の既定モデル（`defaultModelRef`）・データ入出力（「画像も含める」チェックボックス。取り込みは `store.importAnyFile` に共通化＝Library のインポートボタンと同じ入口）・未使用画像 GC。App.tsx が `view==='system'` で描画
- `ImageProviderSettings.tsx` — 画像生成接続先の管理（ComfyUI/画像API の追加・編集・削除・接続テスト・デフォルトタグ入力）。`SettingsBody` に組み込み
- `ImageGenModal.tsx` — 画像生成モーダル（アバター/挿絵/ペルソナ/立ち絵/背景で共用）。接続先・サイズ・枚数選択、「プロンプトを起案」、`target: ImageJobTarget`＋`label` で `store.startImageJob` を呼びジョブ購読。接続先/起案モデルは記憶（`lastImageProviderId`/`lastDraftModel`）。`initialPrompt`/`initialNegative` で再生成時のプロンプト事前入力に対応（FB7-A追修）
- `ImageJobsPanel.tsx` — `ImageJobsBody()`（ドックの jobs タブ）。running=進捗＋キャンセル、selecting=候補サムネ＋採用/破棄
- `GalleryModal.tsx` — `GalleryBody({session, onRegenerateIllustration, onRegenerateBackground})`（ドックの gallery タブ）。「この分岐」（挿絵・背景のシーン見出し付きグリッド・本文から外す）／「すべての記録」（`sessionImageLogs` の永続アルバム・配置中バッジ・記録から削除。FB6-A）のタブ切替。**`PromptCaption`**（export・ChatPanel の `IllustrationView` とも共用）＝拡大表示キャプションの共通部品。positive/negative それぞれ見出し＋グレー背景ボックス（`.prompt-box`）で表示し、元プロンプトがあれば「同じプロンプトで再生成」ボタンを出す（クリックで `ImageGenModal` を `initialPrompt`/`initialNegative` 事前入力つきで開く。対象シーンが現存しない記録は再生成不可＝ボタン非表示。FB7-A追修）。背景の採用記録（プロンプト・ネガティブ）は `Scene` に直接持たないため `sessionImageLogs` から imageId で逆引きする
- `BranchTreeModal.tsx` — `BranchTreeBody({session})`（ドックの branch タブ）。**SourceTree 風コミットグラフ**（FB3-B2・`.bg-*` クラス）: 全ノードを pre-order（現在パスの子を最優先＝現在パスをレーン0の直線に保つ）で縦1列に並べ、`buildGraph` がレーン割り当て＋各行の通過縦線／分岐カーブを計算し SVG で描画。**レビュー単位の折りたたみ**（FB6-D）: `condenseTree`（純関数・export）が畳まれた章（`chapterOf`＝最寄り祖先 scene ノード）内の鎖内部 action ノードを隠して parentId を辺縮約した合成ツリーを作り、それを `buildGraph` に渡す（グラフ本体は無改修）。分岐点・葉・いまここ・★・⑂・🏁・scene ノードは畳んでも常に表示。既定＝現在いる章のみ展開（currentId の章移動で自動展開・▸/▾ トグル・畳み中は件数表示）。最初の子は親と同じレーンを継ぎ2番目以降は新レーンへ（木なので merge 無し＝分岐カーブは親行の下半分のみ）。レーン色は `--graph-lane-0..5`。行＝色ドット＋ラベル＋timeLabel＋⑂分岐名＋★＋いまここ。**行クリック＝その地点を本文で開く移動 `navigateToNode`**（hover で「→ 開く」表示。何も消さない・確認なし。FB7-B）＋⋯メニュー（しおり `setBranchStar`/`removeBranchStar`・**↩ この時点に戻す `restoreCheckpoint`**（従来の復元・確認あり。FB7-B で hover ボタンから移設）・**⑂ ここから分岐して再開 `branchFromNode`**（FB6-C）・シーン開始前へ戻る・この分岐を削除 `deleteBranchSubtree`＝現在パス上は無効）。「✂ 現在の分岐だけ残す（他n件を削除）」`pruneToCurrentPath`・「★ しおり」タブ・currentId 変化で自動スクロール
- `ModelPicker.tsx` — プロバイダ切替・モデル一覧・お気に入り。`onPick` は `"providerId::modelId"`
- `SceneEditor.tsx`/`SceneReviewModal.tsx`/`StoryLogModal.tsx`/`StatusPanel.tsx`/`DiscoveryPanel.tsx`/`CsvInput.tsx` — 各種閲覧・編集モーダル。`StoryLogModal` は `onGenIllustration?`/`onGenBackground?` を受け取り各シーン行に 🎨/🏞 ボタンを出す（過去シーンへの後付け生成の導線。FB6-B）。`SceneReviewModal` はヘッダの「✎ 編集」トグルで全項目（あらすじ・候補・成長・ロア・関係性・数値）をローカル draft 編集でき、閲覧モードは読み取り専用・編集モードはチェックボックス非表示（追加/削除なし。FB5-C）。「自分で決める」はタイトル/内容の直接記入で AI 候補と同扱い。エンディング到達プレビューは draft で計算し、確定は `updateSceneReview` で draft を書き戻してから（プレビューと発火の一致）。StatusPanel/DiscoveryPanel はドックの「✎ 編集」経由で開く。`DiscoveryPanel` は `scope`（`'lore' | {characterId}`・F4）で世界観/キャラ別に編集画面を分割し、保存は live 起点でスコープ分だけ差し替え（編集中の他スコープ追記を巻き戻さない）
- `library/` — 各素材の一覧＋エディタ（Character/World/Persona）と `CassetteLibrary`（🎮カセット棚＝「＋カセットを作る」で `CassetteEditor` 起動・表紙/紹介文/▶遊ぶ/✎編集/PNG書き出し/削除・D&D取込。FB2-E/FB3-D）と `AvatarField`/`SpriteSetField`。各 Library は PNG カード D&D 受付＋検索＋複数選択（`useMultiSelect`・右クリックメニュー＝`LibraryMultiSelect.tsx` の `SelectionBar`/`CardContextMenu`。Ctrl/Shift 選択→一括削除。FB2-D）。CharacterEditor/PersonaEditor は draft を保存ボタンで反映、`AvatarField`/`SpriteSetField` は store 直管理フィールド（avatar.imageId/sprites）を live 購読して同期。WorldEditor はフルページ（`.section-nav`＋`.section-content` の9セクション。「開始テンプレート」= `World.startPreset` の編集・W1（`IntroTagDefEditor` で置換タグ定義も編集・A-1）、「配役」= `World.roles`＝ロールグループの編集・プロンプト注入専用（@名前 置換は担わない・A-2））

## 設計ドキュメント（`docs/`）
実装の詳細設計・意思決定の経緯はここに集約。AGENTS.md で疑問が残ったら該当ドキュメントを読む。

- `要件定義書.md` — 利用者視点の機能要件（実装非依存）
- `設計_ステータスエンジン.md` — 状態エンジン（関係性 prose＋事実の数）。ADR-1 の実装計画（P1〜P5）
- `設計_ワールド再利用とオーバーレイ.md` — セッション・オーバーレイ（発見ロア／キャラ成長の素材↔セッション分離）。B1〜B4
- `設計_画像カードとアバター.md` — PNG カード入出力・アバター画像化。P1〜P4
- `設計_画像生成連携.md` — ImageProvider 抽象層・ImageGenModal・挿絵・セッションカード。G1〜G4
- `設計_画像改善_立ち絵と生成ジョブ.md` — バックグラウンドジョブ・ギャラリー・立ち絵/表情差分/背景。V1〜V4
- `設計_画像改善_V5_不具合修正とステージ改善.md` — 立ち絵保存バグ修正・ステージのバックドロップ化・起案タグ維持。V5a〜V5c
- `設計_Tauri化.md` — デスクトップ化（T0=画像込みエクスポート → T1=CORS-free HTTP → T2=アダプタ層 → T3=ファイルストレージ → T4=配布）
- `設計_セーブロードと分岐.md` — チェックポイント方式（C1=基盤 → C2=ツリーUI → C3=しおり）
- `設計_品質プロンプトのユーザー定義化.md` — スタイルプリセット廃止・接続先ごとのデフォルトタグ。Q1〜Q5
- `設計_構造化出力.md` — `@名前(感情)「セリフ」`行タグ・graceful degradation（D-1〜D-6）。ST1〜ST5
- `設計_UI全体再検討.md` — UI 全体の0ベース再検討・ADR-UI・ロードマップ UI-0〜UI-7
- `設計_UI再設計_実装詳細.md` — UI-0〜UI-7 の実装者向けフェーズ別手順書。**UI 周りを触る時は該当節を読み直し、乖離が出たら本書も同コミットで修正**
- `設計_開始テンプレートとゲームカセット.md` — 世界観の開始テンプレート（W1=実装済み・コピー方式）とゲームカセット専用カード `aist_cassette`（W2=未着手）。検討経緯・却下案（フォルダ方式・閉じたカセット等）含む
- `設計_フィードバック反映2.md` — 実使用フィードバック第2弾（2026-07-11 合意）。プロンプト注入タイミングの回答表・ユーザー決定事項（導入文=そのまま掲載／設定UI=3案ブランチ試作／カセット取込=棚登録のみ）・FB2-A（即効修正4件=分岐ツリー枝連結・カセット画像プレビュー・maxTokens既定・D&D枠。実装済み）／B（導入文・主人公像削除・開始時間帯）／C（セッション設定UI 3案）／D（右クリック＋複数選択削除）／E（カセット棚）の手順書
- `設計_フィードバック反映3.md` — 実使用フィードバック第3弾（2026-07-11 合意・**全フェーズ未着手**）。FB3-A（本文表示の即効改善=開始シーン見出し・マーカー罫線化・自動スクロール停止・分岐ラベル・選択UX・選択肢生成ボタン）／B（分岐チェックポイントの分岐化=anchor 親付け＋SourceTree 風フルグラフUI）／C（演出ディレクター廃止・世界観イベント一本化）／D（セッションカード全廃＋カセット専用エディタ）の手順書。決定事項: セッションカード読み書きとも撤去／カセットは専用エディタ＋セッション種も可／演出は素材ごと全廃／ツリーはフルグラフ
- `設計_分岐ツリー生成順と導入ロール.md` — 分岐ツリーの生成順表示（BT1/BT2=実装済み）＋番号スロット式導入ロール（OR1〜3=**未実装のまま廃止**・却下経緯として保存）
- `設計_配役システム.md` — 世界観ロール（`World.roles`）とセッション配役（`roleAssignments`）・導入文 `@ロール名` の実名解決・【配役】system 注入・開始時配役モーダル。CA1〜CA3（**実装済み**・2026-07-12 合意。**2026-07-20、`設計_ロールグループと定量条件.md` の Part A で @ロール名 の実名解決は置換タグへ分離・ロールはグループ化された**）
- `設計_ロールグループと定量条件.md` — FB7-D の作り直し（2026-07-20 合意）。Part A（**実装済み**）＝名前置換（`@タグ`）を導入文専用機能へ分離（`IntroTag`/`IntroTagBinding`・`casting.ts`）／ロールをグループ化（`WorldRole`＝1..N人・`roleMembers`・【配役】注入一本化）。Part B（条件を「ロールグループ＋数量詞」に一本化し `charVar` を撤去）／拡張（N人ぴったり＋エンディングのプルダウン選択）は**未着手**
- `設計_エンディング.md` — World のエンディング定義（`EndingDef`＝条件・エピローグ指針・auto/hidden/fallback）・レビュー確定時のコード判定・エピローグシーン・完結演出・周回横断到達記録。E1〜E3（**実装済み**・2026-07-17）
- `設計_フィードバック反映5.md` — 実使用フィードバック第5弾（2026-07-18 合意）。シーン区切りのペース制御・時間帯固定・最初の方向付け・既定モデル・Library インポート・レビュー編集モード（FB5-A〜C）の決定と手順書。③ステージ透かし改善は見送り（別途検討）
- `設計_フィードバック反映6.md` — 実使用フィードバック第6弾（2026-07-19 合意・**全フェーズ未着手**）。FB6-A（セッション画像記録=分岐から独立した生成画像アルバム・全チェックポイント走査バックフィル・ギャラリー「すべての記録」タブ）／B（挿絵・背景の後付け生成=メッセージ単位アンカー・過去シーン・起案文脈をアンカーまでに変更）／C（明示分岐=自動フォーク廃止・上書き方式・⑂ボタン・保護ルール・大きい巻き戻しのみ3択確認）／D（分岐ツリーのレビュー単位折りたたみ=既定折りたたみ・condenseTree 辺縮約）の決定と手順書。実装順は A→B→C→D 固定（C の削除は A の画像保全が前提）
- `設計_フィードバック反映7.md` — 実使用フィードバック第7弾（2026-07-19 合意・**A〜D実装済み・E未着手**）。FB7-A（即効修正=画像ズームのポータル化＋等倍トグル・「スタット」→「ステータス」表記統一・最初の方向付けの開始テンプレート化）／B（分岐ツリーの履歴リンク化=行クリック＝移動・`lineTipOf`・`navigateToNode`・スクロールアンカー）／C（ポイントのレビュー確定一本化=選択肢 effects 廃止・変動幅 deltaMin/deltaMax・世界観レビュー指針 `reviewGuidance`）／D（条件エンジンのキャラ変数化=`Clause.charVar` 相手1/2/3・`matchAssignments`・キャラの組ごとの独立発火・`@相手` プレースホルダ `bindPartnerNames`・相手つきエンディング。A〜D実装済み）／E（発見キャラ=新キャラ登場ポリシー・未解決話者の？バッジ→キャラ化・ライブラリ直行保存・未着手）の決定と手順書
- `設計_ロールグループと定量条件.md` — FB7-D の作り直し（2026-07-20 合意・**未着手**）。名前置換（`@タグ`）を導入文専用機能へ分離／ロールをグループ化（1..N人・プロンプト注入一本化）／条件を「ロールグループ＋数量詞（全員/N人以上/N人ぴったり）」に一本化し相手1/2/3（`charVar`）を撤去／判定と結果（当事者）を `subject` フラグで分離・`@ロール名` 置換／当事者記録はロール別 `parties`。フェーズ A（分離・グループ化）→B（定量条件コア）→拡張（N人ぴったり＋エンディングのプルダウン選択）
- `設計_フィードバック反映4.md` — 実使用フィードバック第4弾（2026-07-12 合意）。FB4-A（開始時間帯の防御的修正=クランプ＋開始→次シーンのプレビュー行。※繰り上げロジック自体は正しいことを全経路確認済み・症状は「夜が先頭の区切り定義」疑い）／B（選択肢の既定を auto に）／C（特別イベントの時間帯指定 `ScheduledEvent.slot`）／D（タイムライン設定欄のグレーアウト化=チェック OFF でも常時表示・fieldset disabled）／E（物語設定3欄の説明強化=3欄維持を決定）の手順書
- `設計_UI改善_フィードバック反映.md` — UI-0〜UI-7 実装後の実使用フィードバック＋コード再監査（2026-07-10）に基づく修正フェーズ F0〜F5 の実装手順書。問題インベントリ（報告 R1〜R19・監査発見 A1〜A13、根本原因の診断付き）→ F0=即効バグ修正（没入グリッド崩壊・checkbox全幅化・System幅等）／F1=分岐ツリー刷新（主線を現在で止める・章折りたたみ・⑂/▷展開・行アクション⋯集約・ドック幅リサイズ `ui.dockWidth`）／F2=リーダー設定の数値化（UiPrefs を number 化・`normalizeUiPrefs`）＋没入案内トースト（`infoNotice`）／F3=動線（生成ボタンをコンポーザーへ・タイトル鉛筆・セッション右クリックメニュー・新規作成→設定自動オープン・ブランド撤去）／F4=発見ログのタブ化＋編集スコープ分割／F5=密度・面の階層（`--bg-rail`・余白締め・railラベル）

## データモデル（要点）
すべて「再利用可能な素材ライブラリ」をセッションが参照する構造。

- **Provider** — `{id,label,kind:'openrouter'|'openai',baseUrl,apiKey}`。localStorage のみ・エクスポート除外
- **ImageProvider** — `{id,label,kind:'comfyui'|'openai-image',baseUrl,apiKey,model,workflowJson,defaultPositive?,defaultNegative?}`。画像生成の接続先（LLM の Provider とは別リスト `imageProviders`）。localStorage のみ・エクスポート除外。`defaultPositive?`/`defaultNegative?` は生成時に先頭結合される定型タグ（`defaultNegative` は comfyui のみ）
- **Avatar** — `{imageId?, color}`。`imageId` は画像ストア id（未設定なら色＋イニシャル。表示は `EntityAvatar`）
- **Character** — name/persona/speechStyle/appearance/exampleDialogues/greeting/avatar/tags＋`developments: Development[]`＋`model?`（chat 群像で話者確定時のみ）＋`imagePrompt?`（画像生成用固定英語タグ）＋`sprites?: {emotion:EmotionId,imageId}[]`（表情つき立ち絵。通常カードには含めずカセットのみ同梱）
- **EMOTIONS**（`types.ts`）— 固定セット `neutral/joy/anger/sadness/shy/surprise`（`EmotionId`）。各 `{id,label,tags}`
- **World** — description＋`entries: LoreEntry[]`＋`scheduledEvents: ScheduledEvent[]`＋`relationAspects: RelationAspectDef[]`（関係性 prose の次元・ワールド固定）＋`stats: StatDef[]`＋`counters: CounterDef[]`＋`achievements: AchievementDef[]`＋`reviewGuidance?`（レビュー指針＝シーン終了レビューの system に【世界のレビュー指針】として毎回そのまま注入する状態変動方針。FB7-C）＋`roles?: WorldRole[]`（世界観が定義するロールグループ。`id`/`name`/立場の`description`/`required?`。1..N人のメンバーを持てる〔A-2〕。@名前 による導入文置換は担わない＝プロンプト注入（【配役】）専用。配役本体〔`RoleAssignment[]`＝多対多〕は Session 側に持ち、開始テンプレートへコピーしない）＋`startPreset?: WorldStartPreset`（セッション開始テンプレート＝genre/premise/opening/openingTitle/initialDirective〔最初の方向付け・FB7-A〕/authorNote/`introTags?: IntroTag[]`〔導入文専用の置換タグ定義。`id`/`tag`/`note?`。実名を含まない自由な `@` 文字列・A-1〕/timeline〔開始日・開始時間帯含む〕定義。世界選択時にセッションへ**コピー**され素材側は不変。反映は `startPresetPatch`/`hasStartPreset`（store.ts の純関数）・W1）＋`endings?: EndingDef[]`（名前つきエンディング定義。`condition`・`epilogueGuidance`・`auto`/`hidden`/`fallback`。配列順=優先度。到達判定はコード＝`checkEndings`/`evalCondition`・E1〜E3）。プリセット `WORLD_PRESETS`（恋愛/RPG/経営）
- **Persona** — 利用者が演じる人物。`imagePrompt?` あり
- **Session** — characterIds/worldId/personaId＋`roleAssignments?: {roleId,characterId}[]`（世界観ロールグループへの配役。多対多＝同一ロールに複数メンバー・同キャラの複数ロール兼任も可・無効参照は開始時に無視・`roleMembers` で解決。A-2）＋`introBindings?: IntroTagBinding[]`（`story.introTags` の各タグ→ペルソナ/参加キャラ1名の対応付け。A-1）/authorNote/story（`StorySetup` に `introTags?: IntroTag[]`＝世界選択時に `WorldStartPreset.introTags` からコピーされ、以後はセッション側で自由に編集可）/`scenes: Scene[]`/currentSceneId/timeline/choiceMode（off|always|auto）/narrativeStyle（novel|chat）/`reviewModel`/`choicesModel`/`eventAutoFire?`（世界観イベント自動発火＝undefined/true で有効・FB3-C）/usedEventIds/`state: SessionState`/`overlay: SessionOverlay`/messages/model/temperature/maxTokens＋`spritesEnabled?`（ステージ表示）＋`spriteEmotions?: {characterId,emotion}[]`（表情判定結果）＋`structuredOutput?`（本編を行タグ形式で書かせる。`newSession` は既定 true・既存は `?? false`）＋`archived?`（一覧から既定除外）＋`ending?`（到達エンディング＝`{defId,name,reachedAt,epilogueSceneId,partners?}`。`partners?`＝相手つきエンディングの当事者〔キャラ変数条件・FB7-D〕。チェックポイント対象＝分岐で戻れば未到達に戻る。`restoreCheckpoint` passthrough には**入れない**。「完結済み」は ending＋epilogue シーンの endedAt から導出。E2）
- **SessionState**（セッション固有・素材化しない）— `{relations, moods, stats, counters, achievements}`（「事実は数、判断は言葉」＝ADR-1）。`achievements[]`＝`{defId,unlockedAt,characterIds?}`（`characterIds?`＝キャラ系条件の当事者組・FB7-D。同じ (defId, characterIds) は再解除しない）
- **Clause/Condition**（`types.ts`）— 条件の節。`{kind:'stat'|'counter'|'relationFlag'|'achievement', …, charVar?:1|2|3}`（`charVar`＝キャラ変数〔相手1〜3〕・キャラ系の節のみ有効・既定1。FB7-D）＋`Condition={all|any: Clause[]}`。判定は `matchAssignments`（成立するキャラ変数→キャラ割り当ての列挙）に一本化し、`evalCondition` は「割り当てが1つ以上あるか」の互換窓口。当事者名は `Partner{characterId,name}`・`@相手` 置換は `bindPartnerNames`
- **SessionOverlay**（セッション固有）— `{lore: LoreEntry[], characterDevelopments: {characterId,developments}[]}`。物語中の発見の上乗せ。**元 Character/World は不変**、レビュー承認の追記先はここ。本編には素材＋オーバーレイの実効ビュー（`resolveRefs` の `effectiveWorld`/`effectiveCharacter`）で注入。`promoteOverlayLore`/`promoteOverlayDev` で元素材へ move 昇格可
- **Relation** — `{fromId,toId,stance,aspects:{aspectId,note}[],flags,updatedAt}`。キャラ→主人公（toId='hero'）の prose。数値ティア（band）は持たない
- **StatDef/StatValue** — `StatDef{name,scope,default,min?,max?,deltaMin?,deltaMax?,inject}` は World 定義、`StatValue{defId,characterId?,value}` は SessionState。`inject:true` のみ本編注入。`deltaMin?/deltaMax?`＝レビュー1回あたりの変動幅（絶対値の下限/上限。プロンプトの範囲付き列挙＋受領時 `clampReviewDelta` の両方に使う。0=変動なしは常に許される。FB7-C）
- **CounterDef/CounterValue** — 累計カウンター。レビューの `counterEvents` で単調増加加算。`amountMin?/amountMax?`＝レビュー1回あたりの加算幅（既定 1..1000 の中でさらに絞る。`clampCounterAmount`。FB7-C）
- **Scene** — `{title,activeCharacterIds,note,summary,timeLabel?,illustrations?,backgroundImageId?,endedAt?}`。読む側は `illustrations ?? []`
- **SceneIllustration** — `{id,imageId,prompt,negative?,messageId?,createdAt}`。`messageId` 直後に表示（消失時はシーン末尾）。`negative` は結合前のユーザーネガティブプロンプト（`ImageJob.negative` と同じ規約。FB7-A追修）
- **Message** — role/characterId?/sceneId?/content/choices?/truncated?/pending?
- **ImageJob**（`imageJobs.ts`・store の `imageJobs`・**非永続**）— `{id,label,target,providerId,prompt,negative?,width,height,count,status:'running'|'selecting'|'error'|'canceled',results:Blob[],error?,createdAt}`。`target`＝`scene-illustration`/`character-avatar`/`persona-avatar`/`character-sprite`/`scene-background`。1枚でも自動採用せず、採用は常にユーザー選択（`applyImageJobResult`）。`store.imageJobToasts`（選択待ち通知・非永続）
- **Cassette/`cassettes`**（FB2-E）— `{id,title,description,coverImageId?,session,createdAt}`。ゲームカセット（`aist_cassette`）を棚に素材化して保持。`session` は開始状態（`freshSessionOf` 済み）・参照素材は取込時にライブラリへマージ済み。取込＝`importCassette`（棚登録のみ・セッションは作らない・表紙=取込カード PNG を putImage）、新規作成/編集＝`CassetteEditor`＋`upsertCassette`（`newCassette(seed?)` で下書き生成）、開始＝`playCassette`（session を新 id に複製）、削除＝`deleteCassette`。**AppState 直下**（`cassettes: Cassette[]`）・persist 対象・exportBundle/importBundle 対象・画像 GC 集合（`collectUsedImageIds` の第4引数）に含める
- **EndingDef/`World.endings`/`EndingRecord`/`endingRecords`**（E1〜E3 / FB7-D）— `EndingDef{id,name,description,condition?,epilogueGuidance,auto?,hidden?,fallback?}` は World 固定・配列順=優先度。到達判定は `checkEndings`（純関数・`matchAssignments` 使用＝最上位成立エンディングの当事者割り当てを `{def,partners}[]` で列挙・fallback/条件なしはスキップ）＝レビュー確定時にコードが自動判定。プレビュー（`SceneReviewModal`）と確定（`confirmSceneReview`）は共に `applyReviewToState`（confirmから抽出した純関数）で「確定後 state」を計算し**予告と発火を一致**させる。複数の相手が同時成立したらレビューで選べる（既定=参加キャラ順の最初）。名前・エピローグ指針の `@相手` は当事者名へ置換（`bindPartnerNames`・FB7-D）。発火＝エピローグシーン作成（タイムライン据え置き・`Session.ending` set〔partners 含む〕・特別イベント同時発火はエンディングが勝つ）→ `beginScene`。エピローグ滞在中のみ `resolveRefs` が `ResolvedRefs.ending`（partners 込み）を詰め本編に【エンディング】注入〔「相手: X」明示〕＋nearEnd スキップ。完結は `finalizeStory`（レビュー飛ばして epilogue シーンに endedAt＋完結オーバーレイ）。`EndingRecord{worldId,endingDefId,sessionId,reachedAt,characterIds?}` は **AppState 直下 `endingRecords`**（周回横断・エピローグ突入時に追記・persist・export/import は同値 dedupe マージ・World 削除時掃除）。到達トーストは `endingToast`（非永続）
- **BranchNode/BranchTree/`branchTrees`** — `BranchNode{id,parentId,kind:'action'|'scene',label,timeLabel?,createdAt,imageIds,bytes,ending?,star?:{name,thumbImageId?},branchName?}`（`ending`＝突入・完結ノードの結末名＝ツリーで 🏁 表示。`branchName`＝⑂明示分岐の名前・線の先端に付く git ブランチ ref 相当＝ツリーで ⑂ チップ表示。FB6-C）（`parentId:null`=ルート・実体は `checkpointStore` に nodeId で保存）、`BranchTree{currentId,nodes}`。`branchTrees: Record<sessionId,BranchTree>` は **Session の外・AppState 直下**（Session 内だとスナップショット深コピーが木を含んで再帰肥大するため）。persist 対象
- **SessionImageRecord/`sessionImageLogs`**（FB6-A）— `{id,imageId,kind:'illustration'|'background',prompt,negative?,sceneId?,sceneTitle?,timeLabel?,messageId?,createdAt}`。`negative` は結合前のユーザーネガティブプロンプト（`ImageJob.negative` と同じ規約。FB7-A追修）。採用した挿絵・背景の永続記録（分岐・シーンの生死と独立のアルバム。sceneTitle/timeLabel は採用時点の非正規化コピー）。`sessionImageLogs: Record<sessionId, SessionImageRecord[]>` は **Session の外・AppState 直下**（branchTrees と同じ理由）・persist・exportBundle/importBundle 対象（`mergeImageLogs`＝record id で dedupe マージ）・GC 使用中集合（`collectUsedImageIds` 第5引数）。追記は `applyImageJobResult`（挿絵・背景の採用時）と `backfillImageLogs`（初回起動時の全チェックポイント走査。App.tsx から呼ぶ・`imageLogBackfillDone` フラグで1回・imageId dedupe・実在画像のみ）。削除は `deleteImageRecord`（record 除去のみ＝実体は GC 回収）と `deleteSession`（セッションと運命共同）。UI はギャラリーの「すべての記録」タブ
- **UiPrefs/`ui`**（`types.ts`）— `{dockTab: DockTab|null, dockWidth, fontSize, lineHeight, contentWidth, dialogueTint, stageBgOpacity, stageSpriteOpacity, immersive}`（`DockTab='status'|'discovery'|'gallery'|'branch'|'jobs'`）。**AppState 直下**（`DEFAULT_UI`）・persist 対象。`fontSize`/`lineHeight`/`contentWidth`/`dockWidth` は number（F2で段階式 union から数値化）で可変範囲は `UI_LIMITS`。`merge` は `normalizeUiPrefs()`（旧・段階式文字列値 s/m/l/xl・compact/normal/wide 等を数値へ引き継ぎ＋範囲クランプ＋欠落補完の純関数）を通す。更新は `store.setUiPrefs(patch)` に一本化（没入 OFF→ON で `infoNotice` 案内トーストをセット）・編集 UI は `ReaderSettings.tsx`（Aa。スライダー＋数値入力の `RsField`・「表示を既定に戻す」）

## ModelRef 形式
モデル系フィールドはすべて `"providerId::modelId"` 形式（`::` 区切り）。区切り無しは `providers[0]`（OpenRouter）にフォールバック。空文字は「上位に継承」。

解決の優先順位:
- 本編: `character.model`（chat 群像・話者確定時のみ）→ `session.model`
- レビュー用: `session.reviewModel` → `session.model`
- 選択肢用: `session.choicesModel` → `session.model`

新規作成時の初期値: `createSession`（新規セッション）と `playCassette`（カセット開始）は System の「新しい物語の既定モデル」＝AppState 直下 `defaultModelRef`（persist のみ・エクスポート除外＝プロバイダ id が端末固有のため）を刻印する。未設定なら `DEFAULT_MODEL`。カセット下書き（`newCassette`/`freshSessionOf`）はモデル参照を持たない（空文字）。

ヘルパ: `mainModelOf(session, character?)`/`reviewModelOf(session)`/`choicesModelOf(session)`（store.ts エクスポート）

## 永続化（クリーンブレイク方針）
`store.ts` の persist `name: 'ai-storytelling-store-v3'`。**後方互換は持たない（ADR-1）**：`version`/`migrate` は廃止し、破壊的スキーマ変更時は persist キーを変えて旧データを破棄する（optional 追加ならキー据え置き可）。`exportBundle.version` は現行 `1`、`importBundle` は現行スキーマのみ id マージ。

**スキーマ変更時の手順: 型更新 → 初期state/factory更新 → exportBundle/importBundle 反映 → partialize に新フィールド。**（破壊的なら persist キーも更新）

## 主要な振る舞い
- **シーン進行**: `このシーンを終える` → `prepareSceneReview`（要約＋`nextScheduledEvent`＋成長案＋関係値差分。max_tokens 途中切れ対策＝拡大＋`finish_reason==='length'` で最大2回再試行、失敗時は明示エラー）→ レビュー確認 → `confirmSceneReview`（成長/イベント反映・関係値加算/気分更新・タイムライン前進・新シーン作成。新シーンのタイトルは 提案タイトル → イベント名 → 連番 の優先＝ユーザー編集を優先。FB5-C）→ `beginScene()` → 選択肢。物語開始は `startStory()`。**導入（`story.opening`）が非空なら AI 生成せずその文章を最初の assistant メッセージとして掲載**（`openingTitle` があれば見出しに採用）→ 選択肢生成＋チェックポイント（FB2-B）
- **セッション・オーバーレイ**: 素材（Character/World）は再利用資産なので**レビューは書き換えない**。採用された発見は `confirmSceneReview`（`applyDiscovery`）で `overlay` に追記。本編・レビュー文脈は必ず実効ビュー（`effectiveWorld`/`effectiveCharacter`）を読む（片方だけ素材素を読むと発見が消えて見える）。閲覧/編集は `DiscoveryPanel`、昇格は `promoteOverlayLore`/`promoteOverlayDev`（**move**。copy だと実効合成で二重注入）
- **世界観イベント自動発火** `nextScheduledEvent`: 未消化・day 到来・condition 成立の「(特別イベント, キャラ割り当て)」を day 順・参加キャラ順で1つ選び、人の承認なしでコードが自動発火（`session.eventAutoFire===false` で無効化）。キャラ変数条件はキャラの組ごとに独立発火し、消化キーは `eventUsedKey`（`eventId` or `eventId@charId1[+charId2]`）で `usedEventIds` に積む（素の eventId は旧データ＝全組み消化済み扱い）。note の `@相手` は当事者名へ置換（`bindPartnerNames`）。FB7-D。**演出タイプ抽選（旧ディレクター・SceneType）は FB3-C で全廃**し、世界観イベントに一本化
- **状態エンジン**（`Session.state`／ADR-1）: 関係性は prose、進捗は数（`StatValue`）。`reviewSystem` がレビュー時に `relationUpdates`（stance/aspects 全文書き直し・flagsAdd）／`statChanges`（delta）／`counterEvents`／`moods` を出力。**prose は全文置換・数値の加算はコードが行う**。**ポイント確定はシーン終了レビューに一本化**（FB7-C。選択肢の事前 effects=P5 は廃止＝選択肢経由・自由入力の独自行動を問わず「実際に起きた結果」を評価）: `reviewSystem` は定義を変動幅つきで列挙（「好感度（動かすなら±5〜15）」）し `World.reviewGuidance` を毎回注入、レビュー user 文脈に【現在のステータス・カウンター】（全定義の現在値）＋関係フラグを注入（指針の条件参照用）、受領時に `clampReviewDelta`/`clampCounterAmount`（export・符号維持・0除外）でクランプ。**レビュー画面での手動編集は def の min/max クランプのみ**（ユーザー主権）。現在値は `buildStateInfo`→本編 system の【状態（現在）】に注入。条件エンジン: `matchAssignments` が `Clause`（stat/counter/relationFlag/achievement＋キャラ変数 `charVar`）の成立する「キャラ変数→キャラ」割り当てを列挙し（`all`＝同一キャラで全節・別変数は相異なるキャラ／`any`＝節単位）、`evalCondition`/`checkEndings`/`nextScheduledEvent`/`unlockAchievements` はこれを窓口に判定（FB7-D）。実績・イベント・エンディングは当事者の組ごとに独立発火（実績＝`characterIds`、イベント＝`eventUsedKey`）。実績の反復評価は `unlockAchievements()` に共通化（`confirmSceneReview`・状態の手動編集から呼ぶ）
- **選択肢** `genChoices`: choiceMode≠off で各応答後に生成。`choicesModelOf` 使用、`extractJson`→`coerceChoices`（文字列配列・`{"text":...}` ラップを受理。旧 effects は読み捨て）。手動再生成は `regenChoices()`。**選択肢は加点を持たない**（FB7-C）＝クリックはそのまま `send`
- **次シーン候補の再生成** `regenerateSuggestions`: レビュー画面で候補を作り直す（`nextSceneSystem()`。方向性は発火中の特別イベント有無のみ）
- **文体**: novel=地の文＋「」混在（話者プレフィックスなし）/ chat=キャラ別吹き出し（「名前:」先頭をパースして characterId 判定）
- **出力停止対策**: `finish_reason==='length'` で `message.truncated`→「続きを生成」（`continueLast`＝appendToId で同一メッセージへ追記）。開始の一時エラーは最大3回自動リトライ。**中断は用途別に独立**: `stop`（本編）/`stopChoices`（選択肢）/`stopReview`（レビュー）でモジュールレベル AbortController を分離
- **メッセージ操作と上書き方式（FB6-C）**: 編集/削除/「ここから」（`regenerateFrom`）/「⑂ 分岐」（`branchFromMessage`）。**物語操作（`send`/`continueStory`/`continueLast`/`regenerate`/`regenerateFrom`/`editMessage`/`deleteMessage`/`beginScene`/`prepareSceneReview`/`startStory`）は冒頭で上書きガード `ensureLineTip(sessionId, parent)` を通す**（parent＝巻き戻し系は `findReanchorTarget` の戻り先・それ以外は currentId）。ガードは parent 直下の**保護なし子サブツリー**（保護＝`branchName`/`star`/`ending` をサブツリーに含む＝`subtreeHasProtection`）をチェックポイントごと即時削除し、currentId が削除対象なら parent へ付け替える。**削除対象に scene ノードを含む時のみ** `appChoices` 3択（⑂残す→最新の葉に命名／上書き／キャンセル=操作中止）。保護枝は丸ごと温存（部分削除しない）・別の線へジャンプして続けても離れた線は消さない。巻き戻し後の currentId 移動は従来どおり `reanchorBranch`（anchor 無しの旧木は直列動作）。`editMessage`/`deleteMessage` は async（キャンセル時は本文も変えない）。⑂ボタン＝`branchFromMessage`（本文操作行）/`branchFromNode`（ツリー行）は**現在の線の先端（currentId）に名前を付けて保護**してから regenerateFrom/restore を実行。**`regenerateFrom` はシーン境界をまたいだ巻き戻しで `rewindScenesFor(session, kept)` を通す**（export・純関数）: kept の末尾メッセージが属するシーンが `currentSceneId` と異なる場合、後続の置き去りシーン（stale な見出し・あらすじが本文に残ってしまうバグの原因だった）を `scenes` 配列から落とし `currentSceneId` を戻す。またがない通常のケース（`regenerate`＝同一シーン内のみ末尾を差し戻す設計なので対象外）は変更なし
- **`runCompletion(speakerId?, appendToId?)`**: novel 時は speaker 無効。chat 時は speaker 確定→`mainModelOf`→`parseModelRef`→`streamChat`
- **画像生成ジョブ**（store の `imageJobs`）: `startImageJob(args)`→`runImageJobLoop`（fire-and-forget）で `count` 枚を**直列**生成（ComfyUI は並列に弱い）。全滅で `error`、1枚以上で `selecting`（自動採用しない）。`cancelImageJob`/`dismissImageJob`（除去前に `abortJobController` で実行中 fetch も中断）/`applyImageJobResult(jobId, index)`（target で分岐・**旧 imageId は削除せず参照を外すだけ**）。一括生成 `startSpriteBatch` は6感情ジョブを前を await して順次
- **表情判定**（方式A・`Session.spriteEmotions`）: `classifyEmotions(sessionId)` を `runCompletion` 正常完了後に fire-and-forget。`spritesEnabled` かつ参加キャラが sprites 保有時のみ実行。`extractJson`→`resolveEmotionUpdates`（`matchCharacterByName` 経由）で upsert。**構造化出力 ON 時**は `runCompletion` がストリーミング中の確定行から `emotionUpdatesOf` で直接抽出しリアルタイム upsert、この経路で取れたら方式A をスキップ（フォーマット無視/感情括弧なしのみフォールバック）。`store.isClassifyingEmotions`（非永続）を `ActivityIndicator` が購読
- **構造化出力の裏方文脈整流**（`plainTextOf`）: 裏方 LLM への文脈・UI ラベルには自然表記で渡す。適用は5箇所のみ——①`prepareSceneReview` transcript（assistant 行）②`actionCheckpointLabel`③`classifyEmotions` recent④挿絵起案 recentMessages⑤背景起案 recentMessages。**`buildMessages` 履歴・`estimateTokens`・編集UI・エクスポート・チェックポイント本体は対象外**（生テキストのまま）
- **ステージ・バックドロップ**（`StageBackdrop.tsx`）: `stageOn = spritesEnabled ?? true`。背景＝`scene.backgroundImageId`、立ち絵＝参加キャラの sprites を現在感情→neutral→先頭で解決し等分セル横並び。濃さは `ui.stageBgOpacity`/`ui.stageSpriteOpacity`
- **チェックポイント記録**（`recordCheckpoint`・UIなし）: 3契機——①`runCompletion` 正常完了後（kind:action・`finishReason===null` は積まない）②`editMessage`/`deleteMessage` 直後（kind:action）③`confirmSceneReview` 直後（kind:scene）。木が空ならルート（label「開始時点」）を遅延生成（`recordCheckpoint` に `rootLabel` を渡すとルート自体をその名前で命名＝導入テキスト開始時は「空の開始時点＋導入」に割らず**シーンのタイトルを持つルート1つ**に畳む。FB3追補）。action ノードのラベルは末尾アシスタント本文の冒頭（`actionCheckpointLabel`・「⏩ 続き」等の固定ラベルは廃止＝中身が分かるように。FB3-A4）。dedupe＝`stableSessionJson`（updatedAt 除外）一致なら積まない。書込は `serializeCheckpointWrite` で sessionId ごと直列化
- **復元** `restoreCheckpoint(sessionId, nodeId)`: streaming/choices/review 中は例外。スナップショットで全置換するが**プレイ用ノブだけ現在値維持**（passthrough: title/model/reviewModel/choicesModel/temperature/maxTokens/spritesEnabled/archived）。復元自体は何も削除しない（過去を読みに行くだけの移動は安全）。置き去りの記録の削除・確認は次の物語操作冒頭の `ensureLineTip` が行う（FB6-C）
- **ツリー行クリックの移動** `navigateToNode(sessionId, nodeId)`（FB7-B）: ノードが現在パス上なら復元せず、パス外なら**乗っている線の先端**（`lineTipOf`＝nodes 配列順で最初の子を辿った葉・export・`buildGraph` のレーン継承と同規則）を `restoreCheckpoint` で読み込み、非永続 state `scrollTarget: {sessionId, messageId, seq}` をセット。アンカーは `node.anchorMessageId` → 無い旧ノードは自身のスナップショット末尾 → それも無ければスクロールなし。ChatPanel が effect で消化: シーンが畳まれていれば `queueMicrotask` へ逃がしてから `flushSync(setExpanded)` で同期展開（`useEffect` 内で直接 `flushSync` を呼ぶと「レンダリング中」警告になり展開が rAF の DOM 検索に間に合わない競合の元になるため、レンダリングが確実に終わるマイクロタスクへずらす。バグ修正）→ rAF 2フレーム後に `[data-msg-id]` へ `scrollIntoView({block:'center'})`＋`.msg-flash` 約2秒 → `scrollTarget` を null に。DOM に無い id（マーカー等）は直前の描画メッセージ・それも無ければ末尾へフォールバック
- **GC 一本化**: 立ち絵・背景置換等の**即時 `deleteImage` は全廃**、参照除去のみ。回収は `gcUnusedImages` に一本化。使用中集合＝`collectUsedImageIds`（characters/personas/sessions＋`cassettes`＝表紙・同梱セッション画像＋`sessionImageLogs`＝画像の永続記録。FB2-E/FB6-A）∪`branchTrees` 全ノードの `imageIds`∪`star.thumbImageId`。セッション1件分の抽出は `sessionImageIds(session)`。`deleteSession` は木・画像記録も削除し `checkpointStore.deleteSession`
- **剪定**: `deleteBranchSubtree`（サブツリー削除・**現在パス上は例外で拒否**）/`pruneToCurrentPath`（現在パス以外を一括削除）。書込は `Promise.all` 並列（削除は順序非依存）
- **しおり**: `setBranchStar(sessionId, nodeId, name)` はチェックポイントを読み `pickThumbFromSnapshot`（背景優先→挿絵）でサムネ自動選択。取得失敗でも名前は保存。`removeBranchStar` は同期
- **孤児掃除** `cleanupOrphanCheckpoints`: `checkpointStore.listNodeIds` と木の id を突き合わせ、木に無い実体だけ削除。App.tsx 起動時（hydration 後）に1回

## 規約・落とし穴
- **カンマ区切り入力は必ず `CsvInput`**（タグ・ロアのキーワード・timeline slots）。生の `value=arr.join`＋split はカンマが消えるバグの原因
- マーカー疑似メッセージ（`CONTINUE_PROMPT`/`SCENE_START_PROMPT`）は user として積むが、UI では本文を描かず**ターン境界の薄い水平線 `.gen-divider`** で表現（続ける＝線、シーン導入＝見出しが担うので線なし）。小説形式ではユーザー入力の前にも `.gen-divider` を1本入れる（`renderSceneContent` の `seenContent` 判定・FB3-A2）。`isMarker` で判定
- API キーは localStorage のみ。エクスポートバンドルに providers は含めない
- **画像 id を持つフィールドを増やしたら `sessionImageIds`（store.ts）に追加する**。入れ忘れると GC で使用中画像が消える／チェックポイント参照画像が誤回収される。カセットの画像収集（`collectCardImages`）・remap にも追加が必要。**セッション外のデータに画像 id を持たせる場合は `collectUsedImageIds` の引数に追加する**（`sessionImageLogs` が前例。FB6-A）
- **画像の即時 `deleteImage` を新規に書かない**。分岐チェックポイントが imageId を参照しうるため、削除は常に「参照除去のみ＋`gcUnusedImages` 回収」
- **`branchTrees`・`sessionImageLogs` を `Session` の中に入れない**。スナップショット深コピーに含まれて再帰肥大する／復元で巻き戻ってしまう。必ず AppState 直下
- **`restoreCheckpoint` の passthrough リストの変更は慎重に**。「本文・進行と結合しているか」で判定（結合＝復元対象／非結合＝現在値維持）。迷ったらスナップショット側に倒す
- **store 直接管理のフィールド（`character.sprites`）を draft 全置換系のエディタ保存で上書きしない**。`upsertCharacter` は既存キャラで常に store 側 `sprites` を保持する。同種フィールドを増やす時も同じ罠に注意
- **`<a download>` は Tauri の WebView で機能しない**。ファイル DL は必ず `io.ts` の `downloadBundle`/`downloadBlob`（内部で `saveBlob` 経由）を使う
- **`isTauri()` 分岐は `platform.ts`（と `imageStore.ts`）の外に書かない**。コンポーネント・store に環境分岐を持ち込まない
- **Tauri plugin の JS パッケージ（`@tauri-apps/plugin-*`）は必ず動的 import**（Web バンドルを汚さない・Web 実行時に評価させない）
- **画像生成のプロンプトへ定型タグを UI 側で結合しない**。結合は `generateImage`（imageGen.ts）1箇所のみ。`ImageJob.prompt`/`SceneIllustration.prompt` は結合前のユーザープロンプトを保つ
- **構造化出力のパース失敗行は必ず narration に落とす**（graceful degradation）。名前解決は `matchCharacterByName`（`structured.ts`）に一本化し、他所でコピーしない
- **構造化レンダラのフォールバック判定はメッセージ単位**（`hasStructuredLines`）。トグルでレンダラを直接切り替えると旧平文・フォーマット無視応答で表示が崩れる
- **`buildMessages` の履歴からマークアップを剥がさない**。過去メッセージは `@名前(感情)「…」` 込みの生テキストで送る（few-shot 効果で形式遵守が強化される）。`plainTextOf` を適用してよいのは裏方文脈・ラベルの5箇所のみ
- **ZoomOverlay はポータル描画を維持する**（サムネイル内で普通に描画すると `.job-thumb > img` 等の祖先セレクタが拡大画像に当たる事故に戻る）。サムネイル用の img ルールは**直下セレクタ（`> img`）**で書き、子孫全体に効く `... img` を書かない（FB7-A）
- **モーダルは `ModalShell` を使う。ネイティブ `confirm`/`prompt` の直呼び禁止**。破棄/削除確認・名前入力は `appConfirm`/`appPrompt`/`appChoices`。draft を持つモーダルは `dirty` state を共通変更入口で立てて `ModalShell` に渡す
- **分岐の自動削除は必ず保護判定（`subtreeHasProtection`）を通し、`recordCheckpoint` 内では剪定しない**（fail-open。ガード＝`ensureLineTip` を通らない経路で兄弟ができたら従来どおり表示され、取り漏らしをバグとして発見できる。FB6-C）
- **ツリー行クリックは移動（`navigateToNode`）**。ツリーは「読む・移動する」装置で、分岐を作る操作は本文の操作行（⑂・ここから・編集・削除）に集約。復元＝「↩ この時点に戻す」は ⋯ メニューのみ（FB7-B）
- **選択肢は加点を持たない**（P5 廃止・FB7-C）。状態の書き手はシーン終了レビュー（＋状態パネルの手動編集）のみ。選択肢生成・表示に effects 系の分岐を復活させない
- **条件のキャラ判定は `matchAssignments` に一本化**（FB7-D）。キャラ系の節（`stat`/`counter` scope=character・characterId 未指定／`relationFlag` fromId 未指定）は**キャラ変数（相手1〜3＝`Clause.charVar`）**に属し、同じ変数の節は同一キャラ・別変数は相異なるキャラで評価する（`all` は全節を同一キャラで満たす割り当てが必要＝A の好感度と B のフラグの合成では成立しない。`any` は節単位）。他所で「いずれかのキャラ」判定をコピーしない。`evalCondition` は「成立割り当てが1つ以上あるか」の互換窓口
- **実績・イベントの発火記録は「定義×当事者の組」単位**（キャラ系条件を含む場合。FB7-D）。実績＝`SessionState.achievements[].characterIds`、イベント消化＝`usedEventIds` のキー `eventId@charId1[+charId2]`（`eventUsedKey`）。キャラの組ごとに独立発火（A で解除→後日 B でも同じ定義が再発火）。素の `eventId` は「全組み消化済み」扱い（旧データ安全側）
- **名前の `@相手` 置換は `bindPartnerNames` に一本化**（FB7-D）。`@相手1`/`@相手2`/`@相手3`（1変数なら `@相手` も同義）を当事者名へ。適用箇所＝実績トースト・状態パネル解除一覧・イベント note・エンディング名/エピローグ指針注入

## 検証ワークフロー
**方針（2026-07-08合意）: 見た目・UX の挙動確認はユーザーが直接ブラウザ／`npm run tauri:dev` で行う。** Claude は Preview MCP でのスクリーンショット・snapshot を目視確認目的では行わない（トークン消費が重く目視は人間が速い）。Claude の担当は型チェック・ビルド・`preview_eval` での純粋関数/store 関数の直接検証など「目視では追いにくい」確認のみ。「ブラウザで確認して」と明示された時のみ Preview MCP を使う。

1. `npx tsc --noEmit` → `npm run build` を必ず通す
2. ロジック検証が必要な場合のみ Preview MCP（`preview_eval` で純粋関数/store を直叩き・`preview_console_logs(level:error)` で0件確認）。検証後は seed した localStorage を削除し `preview_stop`
3. **見た目・UX に関わる変更をしたら、完了報告に「確認してほしいこと」と「手順」を箇条書きで明記する**（例: 「① 🎭トグルをON→発言に応じて立ち絵の表情が変わることを確認」）
4. **Tauri 固有部**（appFetch/saveBlob/ファイルストレージ）を触った時は `npm run tauri:dev` の手動チェックリストを上記3の形式で提示（本編ストリーミング＋停止／ComfyUI 生成→採用／保存ダイアログでカード PNG・JSON 保存／再起動でデータ保持＝`%APPDATA%\com.cake30984.aistorytelling\data\` の state.json・images/／旧 WebView データの自動移行）

## 実装状況
**主要機能はすべて実装済み**。セッション(RP/物語)・素材ライブラリ（キャラ/世界観/ペルソナ）・ロアブック・グループ会話・シーン管理・タイムライン・選択肢進行・統合レビュー・世界観イベント自動発火・文体切替・マルチプロバイダ・会話編集/削除/作り直し・エクスポート/インポート・出力停止対策、および以下の大型フェーズが完了:

- 状態エンジン（関係性 prose＋事実の数＋条件エンジン＋実績。ADR-1 / P1〜P5。※P5=選択肢連動加点は FB7-C でレビュー一本化により廃止）
- セッション・オーバーレイ（発見の素材↔セッション分離・実効ビュー注入・昇格。B1〜B4）
- 画像基盤・PNG カード入出力（IndexedDB 画像ストア・EntityAvatar・ST 互換キャラカード・世界/ペルソナカード・ゲームカセット。P1〜P4 / G1〜G4。※セッションカードは FB3-D で撤去）
- 画像改善（バックグラウンドジョブ・ギャラリー・立ち絵/表情差分/背景・ステージのバックドロップ化・各種 store 不具合修正。V1〜V5）
- Tauri 化（画像込みエクスポート・CORS-free HTTP・環境アダプタ層・`%APPDATA%` ファイルストレージ＋自動移行。T0〜T3。**T4=配布は当面見送り**）
- セーブ/ロードと分岐周回（チェックポイント基盤・ツリーUI・しおり。C1〜C3）
- 品質プロンプトのユーザー定義化（スタイルプリセット廃止・接続先ごとのデフォルトタグ。Q1〜Q5）
- 構造化出力（行タグパーサ・構造化レンダラ・プロンプト形式指示・ストリーミング表情切替・裏方文脈整流・`@地の文` ラベル非表示。ST1〜ST5）
- UI 再設計（3領域IA＋右コンテキストドック・トップバー4要素化・リーダー設定＋没入モード・ショートカット/コマンドパレット・SVG アイコン一掃。UI-0〜UI-7）
- 世界観の開始テンプレート＋ゲームカセット（世界からセッションへ推奨初期設定をコピー／1枚で最初から遊べる `aist_cassette` 配布カード。W1〜W2）
- エンディング定義（`EndingDef`＝条件・エピローグ指針・auto/hidden/fallback／`checkEndings`＋`applyReviewToState` の純関数判定／レビュー内到達プレビュー・エピローグシーン・【エンディング】注入・`finalizeStory`・完結演出／周回横断到達記録 `endingRecords`・ツリー🏁・カセット棚バッジ。E1〜E3）
- フィードバック反映5（シーン区切りのペース制御＋時間帯固定・最初の方向付け `initialDirective`・既定モデル `defaultModelRef`・Library インポート・レビュー編集モード。FB5-A〜C）
- フィードバック反映6（セッション画像記録 `sessionImageLogs`＋全チェックポイント走査バックフィル＋ギャラリー「すべての記録」タブ／挿絵・背景の後付け生成＝メッセージ単位アンカー・過去シーン／明示分岐＝上書き方式・`ensureLineTip` ガード・⑂ボタン・保護ルール・シーン跨ぎ3択／分岐ツリーのレビュー単位折りたたみ `condenseTree`。FB6-A〜D）

各フェーズの詳細・検証記録は対応する `docs/設計_*.md` を参照。

## 未着手・残タスク
- **ロールグループと定量条件（Part A実装済み 2026-07-20・Part B/拡張未着手）**: 手順書 → `docs/設計_ロールグループと定量条件.md`。Part A=名前置換の分離（`IntroTag`/`IntroTagBinding`・`findIntroTagRefs`/`resolveIntroText`・`IntroTagDefEditor`/`IntroTagFields`）＋ロールのグループ化（`roleMembers`・`CastingFields` 複数選択・【配役】注入一本化。**実装済み**）／Part B=`group` 節＋`matchGroups`＋`charVar` 撤去＋subject＋`@ロール名` 置換＋実績/エンディング/イベント適用（未着手）／拡張=N人ぴったりの当事者選択（エンディングレビューのプルダウン。未着手）
- **フィードバック反映7（FB7・A〜D実装済み 2026-07-19・E未着手）**: 手順書 → `docs/設計_フィードバック反映7.md`。A=即効修正（画像ズームのポータル化＋等倍トグル・表記統一・方向付けテンプレート。**実装済み**）／B=分岐ツリーの履歴リンク化（行クリック＝移動 `navigateToNode`・`lineTipOf`・`scrollTarget`。**実装済み**）／C=ポイントのレビュー確定一本化＋変動幅＋レビュー指針（選択肢 effects 廃止・`deltaMin/deltaMax`・`reviewGuidance`。**実装済み**）／D=条件エンジンのキャラ変数化（`Clause.charVar`＝相手1〜3・`matchAssignments`・キャラの組ごとの独立発火・`@相手` 置換 `bindPartnerNames`・相手つきエンディング。**実装済み**）／E=発見キャラ（未着手）
- **フィードバック反映6（FB6・A〜D すべて実装済み・2026-07-19）**: 手順書 → `docs/設計_フィードバック反映6.md`。A=セッション画像記録／B=挿絵・背景の後付け生成／C=明示分岐（上書き方式）／D=ツリーのレビュー単位折りたたみ
- **フィードバック反映3（FB3・A〜D すべて実装済み・2026-07-12）**: 手順書 → `docs/設計_フィードバック反映3.md`。A=本文表示の即効改善（`.gen-divider`・自動スクロール停止・分岐ラベル本文冒頭・選択UX・選択肢生成ボタン）／B=巻き戻しの兄弟分岐化（`anchorMessageId`＋`reanchorBranch`）＋SourceTree 風フルグラフ／C=演出ディレクター廃止（`nextScheduledEvent` 一本化・`eventAutoFire`）／D=セッションカード全廃＋`CassetteEditor`（専用エディタ・`newCassette`/`upsertCassette`・セッションからは「カセットにする…」で `seedSession`）
- **T1 で判明した既知の問題**: ①選択肢生成中に本編生成が始まると選択肢側 AbortController が追従せず `Cannot read properties of null (reading 'signal')`（再現手順が不明で切り分け未着手のまま据え置き）②ComfyUI が通常起動（`--enable-cors-header` なし）で接続できない＝設計通りでないバグ。**未解決・現在も再現する**。appFetch 未置換経路や `isTauri()` 誤判定を疑い切り分けが必要（詳細は `docs/設計_Tauri化.md`）
- **T4（配布）**: NSIS・GitHub Releases。ユーザー判断で当面見送り（まだ公開しない）
- **ComfyUI 実機動作確認・ワークフローテンプレ拡充**（SDXL 以外・LoRA ノード入り）
- **openai-image 系の実プロバイダ確認**（`response_format: b64_json` 非対応 API への追従が必要になったら `imageGen.ts` の openai 経路にバリエーション追加）

## 設計上の根本分岐（ADR）
後から別パターンを試せるよう、根本決定と**却下案**を残す。詳細は `docs/設計_ステータスエンジン.md`。

### ADR-1: 状態（感情・関係・パラメータ）の表現方式（2026-06-30 決定）
- **背景**: 「ワールドごとに独自ゲームシステムを構築できる、自由度の極めて高いギャルゲ」を目指す。任意キャラパラメータ・実績・行動カウンター・条件付きイベントを足すにあたり、状態表現を根本から再検討
- **原則: 事実は数、判断は言葉。**
  - 判断（感情の機微・関係の質）＝ **prose**（ワールド固定の aspect ごとの記述＋stance）。LLM が読み生成に使う。**条件判定には使わない**
  - 事実（好感度ポイント・回数・所持金・レベル・日数）＝ **数/フラグ**。プレイヤーとコードが読み、**イベント発火条件**に使う
- **採用（案A）**: 関係性は prose（数値化しない・次元はワールド固定）／進捗は prose と別レイヤーの「好感度ポイント」（イベント/行動で固定値加点・LLM に査定させない・"細かく上昇"は選択肢連動の小刻み加点＝P5）／イベント発火は人の承認なし・コード自動判定／**band（派生ティア）は不採用**／レビューが状態の唯一の書き手（prose は全文書き直し・数値はコードが加算）
- **方針転換（FB7-C・2026-07-19）**: P5 の選択肢連動加点は**廃止**し、ポイント確定をシーン終了レビューの結果ベース評価に一本化（「事前にポイントが見えると面白味が半減」「独自行動にも同じ土俵で加点したい」という実プレイの知見）。「LLM に査定させない」は緩和し、定義ごとの変動幅（`deltaMin/deltaMax`＝プロンプト目安＋コードのクランプ）と世界観のレビュー指針（`reviewGuidance`）で暴走を抑制する。機械的保証が必要になったら「条件付き自動変動ルール」（コード実行）を次弾で検討（発展案）
- **却下した代替（後で試す用）**:
  - **案B**: 進捗は主人公の数値スタットのみ・関係性は純 prose（キャラ別好感度ポイントなし）
  - **案C**: 純 prose 一本（進捗の可視的な楽しみを持たない・最小だが"レベル上げ感"が出ない）
  - **band を条件にも使う**: 偽閾値とドリフトが条件層に侵入するため不採用
  - **イベントの LLM 言語判定発火**: 非再現・早漏発火／**人による承認制発火**: 無粋で没入を損なう、ため不採用
  - **旧来の連続数値（信頼60 等）**: LLM が数値更新を苦手＋機微を非可逆圧縮するため不採用
- **共有/コミュニティ観点**: 構造（固定 aspect・名前付きイベント・実績）と発火の再現性が「共有可能なゲーム」の要。prose は没入、数/フラグは再現、で役割分担
- **後方互換**: 不要。クリーンブレイク（persist キー変更で旧データ破棄・移行連鎖を全廃）

## ユーザーの進め方の好み
- 大きめの要望は「機能検討（設計提案＋選択式質問）→合意→実装→検証→要約報告」の流れを好む
- 1ターンで作りすぎない（大改修はフェーズ分割して各ターンで検証可能に）
- 実装/技術に触れない要件定義書が欲しい場合がある（`docs/要件定義書.md`）
