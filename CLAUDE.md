# CLAUDE.md — AI Storytelling Studio

マルチプロバイダ（OpenRouter・OpenAI 互換等）で好きなモデルを使い、AI とのロールプレイ／自動進行する物語づくりを行うクライアント完結型 Web アプリ。UI 文言・コメントは日本語。ユーザーは日本語でやり取りする。

## コマンド
- 開発: `npm run dev`（Vite, ポート5173）
- 型チェック: `npx tsc --noEmit`
- ビルド: `npm run build`（`tsc && vite build`）
- 変更後は必ず「型チェック → build」で確認。

## Git・バージョン管理
- リモート: `https://github.com/Cake30984/AIStoryTellingUI.git`（ブランチ: `main`）
- **1つの変更（機能追加・バグ修正・リファクタ等）ごとに必ず `git commit` を行う。**
- コミット後は `git push origin main` でリモートに反映する。
- コミットメッセージは日本語可。変更内容を端的に記述する。

## 技術スタック
React 18 + TypeScript + Vite / 状態管理は zustand（`persist` で localStorage 永続化）/ 追加ライブラリは最小限。バックエンドなし・完全クライアント。

## ディレクトリ
- `src/types.ts` — 全データ型（ここを最初に読む）
- `src/store.ts` — zustand ストア。状態・全アクション・**永続化バージョンと移行**・ディレクター抽選など中核ロジック
- `src/lib/`
  - `providers.ts` — `Provider` 型・プリセット・`parseModelRef`/`makeModelRef`/`splitRef`/`modelRefLabel`
  - `openrouter.ts` — SSEストリーミング補完・モデル一覧取得（プロバイダ駆動。provider オブジェクトを受け取る）
  - `prompts.ts` — system プロンプト組み立て・選択肢/レビュー用プロンプト・定数（`CONTINUE_PROMPT`/`SCENE_START_PROMPT` 等）
  - `lorebook.ts` — 世界観ロアのキーワード一致抽出
  - `timeline.ts` — `advanceTimeline`/`timeLabelOf`/`timelinePromptInfo`/`isNearEnd`
  - `json.ts` — `extractJson`（モデル出力から堅牢な JSON 抽出）
  - `tokens.ts` — `estimateTokens`/`tokenLevel`
  - `io.ts` — `downloadBundle`（JSON DL）/`parseBundle`（取り込みファイルの検証・整形）。※エクスポートバンドルの組み立て本体は `store.exportBundle`
- `src/components/`
  - `Sidebar.tsx` — 左ナビ＋セッション一覧
  - `ChatPanel.tsx` — 会話画面（トップバー・シーン仕切り・話者/選択肢・コンポーザー・メッセージ操作）
  - `SessionEditor.tsx` — セッション設定（参加キャラ/一括モデル設定/世界観/ペルソナ/固定メモ/文体/選択肢/裏方モデル/タイムライン/ディレクター/サンプリング）
  - `SettingsModal.tsx` — プロバイダ管理（追加/編集/削除/モデル読込）・データ入出力
  - `ModelPicker.tsx` — プロバイダ切替・モデル一覧・お気に入り。`onPick` は `"providerId::modelId"` を返す
  - `SceneEditor.tsx` / `SceneReviewModal.tsx` / `StoryLogModal.tsx` / `CsvInput.tsx`
  - `library/` — 各素材の一覧＋エディタ（Character/World/Persona/SceneType）と `AvatarField`
- `docs/要件定義書.md` — 利用者視点の機能要件（実装非依存）

## データモデル（要点）
すべて「再利用可能な素材ライブラリ」をセッションが参照する構造。
- **Provider** — `{id,label,kind:'openrouter'|'openai',baseUrl,apiKey}`。localStorage のみ保存。エクスポートには含めない。
- **Character** — name/persona/speechStyle/appearance/exampleDialogues/greeting/avatar/tags＋`developments: Development[]`＋`model?`（ModelRef。chat 群像で話者確定時のみ有効）
- **World** — description（常時）＋`entries: LoreEntry[]`＋`scheduledEvents: ScheduledEvent[]`（`{day,name,note}`）
- **Persona** — 利用者が演じる人物
- **SceneType**（グローバル素材）— `{name,guidance,weight,minGap,color,builtin}`。既定6種を初回シード
- **Session** — characterIds/worldId/personaId/authorNote/story/`scenes: Scene[]`/currentSceneId/timeline/choiceMode（off|always|auto）/narrativeStyle（novel|chat）/`reviewModel`/`choicesModel`/director（`{enabled,typeIds}`）/usedEventIds/`state: SessionState`/messages/model/temperature/maxTokens
- **SessionState**（セッション固有・素材化しない）— `{relationships: Relationship[], moods: {characterId,mood}[]}`
- **Relationship** — `{characterId,axis,value}`。キャラ→主人公の片方向、ユーザー定義自由軸、value 0〜100（中立50）
- **Scene** — `{title,activeCharacterIds,note,summary,timeLabel?,sceneTypeId?,endedAt?}`
- **Message** — role/characterId?/sceneId?/content/choices?/truncated?/pending?

## ModelRef 形式
モデル系フィールドはすべて `"providerId::modelId"` 形式の文字列（`::` 区切り）。区切り無しのプレーン文字列は `providers[0]`（OpenRouter）にフォールバック。空文字は「上位にフォロー（継承）」。

モデル解決の優先順位:
- 本編: `character.model`（chat 群像・話者確定時のみ）→ `session.model`
- レビュー用: `session.reviewModel` → `session.model`
- 選択肢用: `session.choicesModel` → `session.model`

ヘルパ: `mainModelOf(session, character?)` / `reviewModelOf(session)` / `choicesModelOf(session)`（store.ts エクスポート）

## 永続化と移行（重要）
`store.ts` の persist `name: 'ai-storytelling-store'`、**現在 `version: 9`**。

移行チェーン: v0→v1（素材ライブラリ化）/ v1→v2（シーン導入）/ v2→v3（タイムライン・選択肢・developments）/ v3→v4（文体）/ v4→v5（developmentsオブジェクト化）/ v5→v6（シーンタイプ・特別イベント・director）/ v6→v7（providers・reviewModel・choicesModel）/ v7→v8（Character.model?）/ v8→v9（Session.state＝感情・関係値トラッカー）

**スキーマ変更時は必ず: 型更新 → migrateVXtoVY 追加 → version++ → 初期state/factory更新 → exportBundle version++ → importBundle 連鎖に追加 → partialize に新フィールド。**

## 主要な振る舞い
- **シーン進行**: `このシーンを終える` → `prepareSceneReview`（要約＋`directNextScene`＋成長案＋関係値差分生成）→ レビュー確認 → `confirmSceneReview`（成長/イベント反映・**関係値加算/気分更新**・タイムライン前進・新シーン作成）→ `beginScene()`（導入生成）→ 選択肢。物語開始は `startStory()`。
- **ディレクター** `directNextScene`: ①特別イベント（`day<=nextDay`・未消化）最優先 → ②`director.typeIds` から重み＋クールダウン（`minGap`）で抽選。
- **感情・関係値トラッカー** (`Session.state`): キャラ→主人公の片方向・セッション固有・ユーザー定義自由軸（0〜100、中立50）。`reviewSystem(axes)` がレビュー時に `relationshipDeltas`/`moods` を出力（自由軸の auto-discovery：初出はモデルが軸定義、以降は既存軸に拘束）。**数値の加算はコードが行う**（`confirmSceneReview` で `clampValue`、現在シーン確定時のみ反映＝過去シーン再レビューでは加算しない）。現在値は `buildRelationshipInfo`→`refs.relationshipInfo`→本編 system プロンプトの【主人公への感情】ブロックに注入（数値＋`valueLabel` の段階ラベル）。**Phase 2（サイドパネル可視化・SessionEditor 軸管理）・Phase 3（しきい値→Director連動）は未実装。**
- **選択肢** `genChoices`: choiceMode≠off で各応答後に生成。`choicesModelOf` 使用、`extractJson`→`coerceChoices`（素の配列のほか `{"choices":[...]}` ラップや `[{"text":...}]` オブジェクト配列も吸収）。失敗時は `console.warn('[choices]…')` で可視化。手動再生成は `regenChoices()`（ChatPanel の「🔁 選択肢を生成」ボタン＝選択肢未付与時に表示）。
- **次シーン候補の再生成** `regenerateSuggestions`: レビューで方向性（種類/イベント）を変えると次シーン候補を作り直す。`setReviewNextType`／`rerollReviewType` から呼ぶ。`nextSceneSystem()` で suggestions のみ生成（要約＋方向性＋次の時刻を文脈に）。`isRegenSuggestions` 中は要約編集を保持（モーダルの useEffect は `review.sceneId` 起点でのみリセット）。
- **文体** novel=地の文＋「」混在（話者プレフィックスなし）/ chat=キャラ別吹き出し（「名前:」先頭をパースして characterId 判定）。
- **出力停止対策**: `finish_reason==='length'` で `message.truncated` → 「⤵ 続きを生成」（`continueLast`＝appendToId で同一メッセージへ追記）。生成開始の一時エラーは最大3回自動リトライ。
- **メッセージ操作**: 編集/削除/「↻ ここから」（`regenerateFrom`＝その地点以降を切り詰め再生成）。
- **`runCompletion(speakerId?, appendToId?)`**: novel 時は speaker 無効。chat 時は speaker を先に確定 → `mainModelOf(s, speaker)` でキャラ別モデル解決 → `parseModelRef` でプロバイダ＋modelId 取得 → `streamChat`。

## 規約・落とし穴
- **カンマ区切り入力は必ず `CsvInput`**（タグ・ロアのキーワード・timeline slots）。生の `value=arr.join` + split はカンマが消えるバグの原因。
- マーカー疑似メッセージ（`CONTINUE_PROMPT`/`SCENE_START_PROMPT`）は user として積むが UI では控えめ表示。`isMarker` で判定。
- API キーは localStorage のみ。エクスポートバンドルに providers は含めない（`importBundle` は providers をマージしない）。

## 検証ワークフロー
1. `npx tsc --noEmit` → `npm run build` を必ず通す。
2. Preview MCP（`preview_start` 等）で起動。`preview_eval` で旧バージョンの localStorage を seed → reload → 移行確認。`preview_console_logs(level:error)` でエラー0件。
3. 純粋関数は `preview_eval` で `await import('/src/lib/xxx.ts')` して直接テスト可能。
4. 検証後は seed した localStorage を削除し `preview_stop`。ポート残留時は `npx kill-port 5173`。

## 実装状況
**画像/ComfyUI 以外はほぼ実装済み**。実装済み: セッション(RP/物語)・キャラ/世界観/ペルソナ/シーンタイプの素材ライブラリ・ロアブック・グループ会話・シーン管理・タイムライン・選択肢進行・統合レビュー・シーン演出エンジン・文体切替・**マルチプロバイダ（プロバイダ管理・キャラ別モデル・役割別裏方モデル）**・あらすじ閲覧・会話編集/削除/作り直し・エクスポート/インポート・トークン目安・出力停止対策。

## 次にやること（ロードマップ）
1. **画像 & ComfyUI 連携（後回し）**: キャラ画像＋挿絵生成。画像は localStorage では容量不足のため IndexedDB 等への移行が必要。ComfyUI(localhost:8188) は CORS 許可起動が前提、workflow テンプレ定義が必要。

## ユーザーの進め方の好み
- 大きめの要望は「機能検討（設計提案＋選択式質問）→合意→実装→検証→要約報告」の流れを好む。
- 1ターンで作りすぎない（大改修はフェーズ分割して各ターンで検証可能に）。
- 実装/技術に触れない要件定義書が欲しい場合がある（`docs/要件定義書.md` 参照）。
