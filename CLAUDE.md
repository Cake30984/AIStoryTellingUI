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
- **ファイル編集を伴う変更をコミットする際は、影響する記述（ディレクトリ構成・データモデル・主要な振る舞い・実装状況・ロードマップ等）があれば `CLAUDE.md` も同じコミットで更新する。**
- 変更が一区切りついた適切なタイミングで、都度 `git commit` → `git push origin main` まで行う（作業を溜め込んでまとめてコミットしない）。

## 技術スタック
React 18 + TypeScript + Vite / 状態管理は zustand（`persist` で localStorage 永続化）/ 追加ライブラリは最小限。バックエンドなし・完全クライアント。

## ディレクトリ
- `src/types.ts` — 全データ型（ここを最初に読む）
- `src/store.ts` — zustand ストア。状態・全アクション・**永続化（クリーンブレイク・移行なし）**・状態エンジン（関係性 prose／事実の数）・ディレクター抽選など中核ロジック
- `src/lib/`
  - `providers.ts` — `Provider` 型・プリセット・`parseModelRef`/`makeModelRef`/`splitRef`/`modelRefLabel`
  - `openrouter.ts` — SSEストリーミング補完・モデル一覧取得（プロバイダ駆動。provider オブジェクトを受け取る）
  - `prompts.ts` — system プロンプト組み立て・選択肢/レビュー用プロンプト・定数（`CONTINUE_PROMPT`/`SCENE_START_PROMPT` 等）・画像プロンプト起案（`illustrationPromptSystem`/`illustrationContextUser`/`avatarContextUser`。G2。V1で「本文が長い場合は末尾の場面を描く」指針を追加、`illustrationContextUser`の文脈見出しは「【このシーンの本文】」）
  - `lorebook.ts` — 世界観ロアのキーワード一致抽出
  - `timeline.ts` — `advanceTimeline`/`timeLabelOf`/`timelinePromptInfo`/`isNearEnd`
  - `json.ts` — `extractJson`（モデル出力から堅牢な JSON 抽出）
  - `tokens.ts` — `estimateTokens`/`tokenLevel`
  - `io.ts` — `downloadBundle`（JSON DL）/`downloadBlob`（任意 blob のDL。カード画像もこれで保存）/`parseBundle`（取り込みファイルの検証・整形）。※エクスポートバンドルの組み立て本体は `store.exportBundle`
  - `imageStore.ts`（P1）— アバター・カード画像の IndexedDB ストア（`putImage`/`getImage`/`deleteImage`/`listImageIds`/`gcImages`）＋表示用 `useImageUrl` フック。localStorage には画像を入れない
  - `avatarGen.ts`（P1）— `generateDefaultAvatar`（名前イニシャル＋色から canvas でデフォルト画像生成）/ `normalizeImage`（アップロード画像の縮小・PNG化）
  - `png.ts`（P3）— PNG の tEXt チャンク読み書き（自前実装。`readTextChunks`/`writeTextChunk`。CRC32はtype+dataのみ対象、textは必ずbase64経由でLatin-1化。**組み立てはセグメント連結方式＝`push(...spread)`は数MB級でスタックオーバーフローするため禁止**）
  - `imageGen.ts`（G1）— 画像生成の抽象層。`generateImage`（comfyui: /prompt→/historyポーリング→/view、openai-image: /images/generations の b64_json）/`testImageProvider`/`fillWorkflow`（プレースホルダ置換。%PROMPT%/%NEGATIVE% はJSONエスケープ、"%SEED%"/"%WIDTH%"/"%HEIGHT%" は引用符ごと数値化）/`DEFAULT_COMFY_WORKFLOW`
  - `imagePresets.ts`（V1）— スタイルプリセット（`STYLE_PRESETS`＝アニメ系/実写系の品質タグ）と`applyStylePreset`（prompt/negative 欄の先頭にプリセットタグを適用。トークン単位の完全一致除去→選択プリセットを先頭付加、で冪等）
  - `imageJobs.ts`（V2）— バックグラウンド画像生成ジョブの型（`ImageJobTarget`＝`scene-illustration`/`character-avatar`/`persona-avatar`、`ImageJob`）とヘルパ。Blob を含むため store の `imageJobs` 配列に置きつつ **partialize からは必ず除外**（永続化しない）。AbortController は store に入れずここのモジュールレベル `Map` で保持（`registerJobAbort`/`clearJobAbort`/`abortJobController`）。`useBlobUrl` は Blob から表示用 objectURL を作る React hook（アンマウント/差し替えで revoke）
  - `cards.ts`（P3〜P4・G4）— キャラカード（`chara_card_v2` 互換＋`extensions.aistorytelling` に独自データ）／世界カード（独自形式`aist_world`）／ペルソナカード（独自形式`aist_persona`）／**セッションカード（独自形式`aist_session`。G4。session＋参照素材＋参照画像（アバター・挿絵）を base64 同梱した完全自己完結バンドル。`exportSessionCard`（合計30MB超で警告）/`sessionCardImageBlob`。キャラの`model`は除外・`avatar.imageId`は同梱画像への参照として保持）**の組み立て・解釈。`exportCharacterCard`/`exportWorldCard`/`exportPersonaCard`（画像未設定なら`generateDefaultAvatar`でカード画像を自動生成→`normalizeImage`→tEXt埋め込み→DL）/`parseCardPng`（chunk種別で判定。キャラは拡張優先、無ければSTネイティブ項目からマッピング）/`attachCardImage`（カードPNG自体を512pxに正規化してputImage→avatar.imageIdへ。キャラ/ペルソナ共用のジェネリック関数）。`model`と`avatar.imageId`は環境固有のためextensionsから除外。Worldはアバター概念を持たないため画像は自動生成のみ
  - `useCardDrop.ts`（P4）— PNGカードのドラッグ&ドロップ受付フック（`dragOver`状態＋`dropProps`）。Character/World/Personaの各Libraryで共用
- `src/components/`
  - `Sidebar.tsx` — 左ナビ＋セッション一覧。セッションカード（PNG）の D&D 受付（G4）
  - `ChatPanel.tsx` — 会話画面（トップバー・シーン仕切り・話者/選択肢・コンポーザー・メッセージ操作）。🎨=挿絵生成（G3→V2で`ImageGenModal`にジョブ用`target`/`label`を渡す形に変更。保存は store の`applyImageJobResult`に集約。最後のメッセージにアンカーしインライン表示・⬇保存/🗑削除/クリック拡大）。挿絵起案の文脈（V1）は現在シーンの本文全体（`sceneId`一致 or 旧データの`sceneId`無し）を末尾から文字数予算8,000でキャップして渡す。トップバーに「⏳ n」バッジ（V2。`imageJobs.length > 0`の時のみ表示）→`ImageJobsPanel`
  - `SessionEditor.tsx` — セッション設定（参加キャラ/一括モデル設定/世界観/ペルソナ/固定メモ/文体/選択肢/裏方モデル/タイムライン/ディレクター/サンプリング）。フッターに「🖼 セッションをカード化」（G4→`SessionCardModal`）
  - `SessionCardModal.tsx`（G4）— セッションカード書き出し（カード画像を挿絵から選択 or タイトルから自動生成→`exportSessionCard`）。読み込みは Sidebar への D&D と SettingsModal のファイル入力（`importSessionCard`＝store。同梱画像を putImage し直して imageId を remap、素材は id マージ・セッションは id 衝突時に新id採番で常に追加、取り込み後にアクティブ化）
  - `SettingsModal.tsx` — プロバイダ管理（追加/編集/削除/モデル読込）・データ入出力・未使用アバター画像のGC（`gcUnusedImages`）
  - `ImageProviderSettings.tsx`（G1）— 画像生成の接続先管理（ComfyUI/画像API の追加・編集・削除・接続テスト）。SettingsModal に組み込み
  - `ImageGenModal.tsx`（G2・V1・V2）— 画像生成モーダル（アバター/挿絵/ペルソナアバターで共用）。接続先・サイズ・**スタイル**（スタイルなし/アニメ系/実写系。`applyStylePreset`）・**枚数（1〜4。V2）**選択、「✨ プロンプトを起案」（`streamChat`＋`extractJson`。JSON失敗時は全文をprompt扱い。maxTokens 4000）、起案モデルは `ModelPicker` で選択、negative は欄の表示こそ comfyui のみだが state は kind に関わらず保持・適用。スタイル選択は起案完了後にも再適用（除去→先頭付加の冪等処理）、選択は `store.lastImageStyle` に永続化しモーダルの初期値・マウント時prefillに使う。**V2でジョブ化**：Props は `onAccept` ではなく `target: ImageJobTarget`＋`label`。「🎨 生成」→ `store.startImageJob` を呼びジョブIDだけ保持、モーダルは開いたまま `imageJobs` を購読してジョブの進捗（`running`は完了枚数、`selecting`は候補サムネイル→クリックで拡大・「✔ この画像を使う」で`applyImageJobResult`）を表示。モーダルを閉じてもジョブは store 側で継続（生成中の中断はしない。閉じるボタンは単に非表示にするだけ）
  - `ImageJobsPanel.tsx`（V2）— 進行中・選択待ちの画像生成ジョブ一覧（ChatPanel トップバーの「⏳ n」バッジから開く）。running=進捗＋キャンセル、selecting=候補サムネイル一覧＋「✔ 採用」（`applyImageJobResult`）／「🗑 破棄」（`dismissImageJob`）、error/canceled=メッセージ＋「🗑 閉じる」。ジョブが選択待ちに変わると `store.imageJobToasts` 経由で App.tsx に「🖼 生成完了」トースト（実績解除トーストと同じパターン）
  - `ModelPicker.tsx` — プロバイダ切替・モデル一覧・お気に入り。`onPick` は `"providerId::modelId"` を返す
  - `SceneEditor.tsx` / `SceneReviewModal.tsx` / `StoryLogModal.tsx` / `StatusPanel.tsx`（状態の閲覧・手動編集＝ChatPanel の 📊）/ `DiscoveryPanel.tsx`（発見ログの閲覧・手動編集・昇格＝ChatPanel の 📖）/ `CsvInput.tsx`
  - `EntityAvatar.tsx`（P2）— 画像があれば表示、なければ色＋名前イニシャルを表示する共通アバター。既存の `.avatar`/`.entity-avatar`/`.dot-avatar` クラスを流用し全画面で表示統一
  - `library/` — 各素材の一覧＋エディタ（Character/World/Persona/SceneType）と `AvatarField`（P2で画像アップロード対応。選択画像は `normalizeImage`→`putImage` で保存し `imageId` を反映。「画像を外す」あり）。CharacterLibrary/WorldLibrary/PersonaLibrary は PNG カードのドラッグ&ドロップ受付（P3〜P4）、CharacterEditor/WorldEditor/PersonaEditor に「🖼 カードとして保存」（P3〜P4）。**V2**: `AvatarField` はジョブの保存先 `target?: {type:'character-avatar'|'persona-avatar', ...}` を受け取り、`✨ 生成` を `ImageGenModal` にそのまま渡す（保存は `applyImageJobResult` に集約・`onAccept` は廃止）。CharacterEditor/PersonaEditor は draft（ローカル編集中コピー）を保存ボタンで store 反映する方式のため、バックグラウンドジョブが直接 store を書き換えても即座に画面に出ない問題があった → `AvatarField` 内で live な store の avatar.imageId を監視し、変化したら `onChange` で draft に取り込む useEffect を追加（保存ボタンでの上書き事故を防ぐ）。新規未保存の素材（store に id が無い）は生成ボタンを無効化（ツールチップで「先に保存してください」）
- `docs/要件定義書.md` — 利用者視点の機能要件（実装非依存）
- `docs/設計_ステータスエンジン.md` — 状態エンジン（関係性 prose ＋ 事実の数）の設計仕様。下記 ADR-1 の実装計画
- `docs/設計_ワールド再利用とオーバーレイ.md` — セッション・オーバーレイ（発見ロア／キャラ成長の置き場を素材からセッションへ分離）の設計仕様。フェーズB1〜B4の実装計画
- `docs/設計_画像カードとアバター.md` — PNG カード入出力（SillyTavern 互換キャラカード＋独自世界/ペルソナカード）・絵文字全廃のアバター画像化（IndexedDB 画像ストア）の設計仕様。フェーズP1〜P4は実装済み
- `docs/設計_画像生成連携.md` — P5 の詳細設計。ImageProvider（comfyui/openai-image）抽象層・ImageGenModal（裏方LLMプロンプト起案）・アバター生成・`imagePrompt` 固定タグ・挿絵（`Scene.illustrations`）・セッションカード（`aist_session`・画像base64同梱）。フェーズG1〜G4は実装済み
- `docs/設計_画像改善_立ち絵と生成ジョブ.md` — 画像改善 V1〜V4 の詳細設計（スタイルプリセット・バックグラウンド生成ジョブ・ギャラリー・立ち絵/表情差分/背景）。**V1〜V2実装済み・V3〜V4未実装**

## データモデル（要点）
すべて「再利用可能な素材ライブラリ」をセッションが参照する構造。
- **Provider** — `{id,label,kind:'openrouter'|'openai',baseUrl,apiKey}`。localStorage のみ保存。エクスポートには含めない。
- **ImageProvider**（G1）— `{id,label,kind:'comfyui'|'openai-image',baseUrl,apiKey,model,workflowJson}`。画像生成の接続先（LLM の Provider とは別リスト `imageProviders`）。localStorage のみ保存・エクスポート除外。
- **Avatar**（P1で刷新・絵文字廃止）— `{imageId?, color}`。`imageId` は `imageStore.ts` の IndexedDB 画像 id（未設定なら色＋名前イニシャルで表示。表示は `EntityAvatar` コンポーネントに統一済み＝P2）。
- **Character** — name/persona/speechStyle/appearance/exampleDialogues/greeting/avatar/tags＋`developments: Development[]`＋`model?`（ModelRef。chat 群像で話者確定時のみ有効）＋`imagePrompt?`（画像生成用の固定英語タグ。カードにも同梱＝G2）
- **World** — description（常時）＋`entries: LoreEntry[]`＋`scheduledEvents: ScheduledEvent[]`（`{day,name,note}`）＋**`relationAspects: RelationAspectDef[]`（関係性 prose の次元・ワールド固定）＋`stats: StatDef[]`（事実の数の定義）＋`counters: CounterDef[]`（行動カウンター定義）**。プリセット `WORLD_PRESETS`（恋愛/RPG/経営）で投入可
- **Persona** — 利用者が演じる人物。`imagePrompt?`（画像生成用の固定英語タグ。G2）あり
- **SceneType**（グローバル素材）— `{name,guidance,weight,minGap,color,builtin}`。既定6種を初回シード
- **Session** — characterIds/worldId/personaId/authorNote/story/`scenes: Scene[]`/currentSceneId/timeline/choiceMode（off|always|auto）/narrativeStyle（novel|chat）/`reviewModel`/`choicesModel`/director（`{enabled,typeIds}`）/usedEventIds/`state: SessionState`/`overlay: SessionOverlay`/messages/model/temperature/maxTokens
- **SessionState**（セッション固有・素材化しない）— `{relations: Relation[], moods: {characterId,mood}[], stats: StatValue[], counters: CounterValue[]}`（「事実は数、判断は言葉」。ADR-1）
- **SessionOverlay**（セッション固有・素材化しない）— `{lore: LoreEntry[], characterDevelopments: {characterId,developments:Development[]}[]}`。物語中に発見・深化した設定の上乗せ。**元 Character/World は不変**、レビュー承認の追記先はここ。本編プロンプトへは素材＋オーバーレイを合成した実効ビュー（`resolveRefs` の `effectiveWorld`/`effectiveCharacter`）で注入。気に入った発見は `promoteOverlayLore`/`promoteOverlayDev`（`store.ts`）で元素材へ move 昇格可能
- **Relation**（判断＝言葉）— `{fromId,toId,stance,aspects:{aspectId,note}[],flags:string[],updatedAt}`。キャラ→主人公（toId='hero'）の prose。stance＋ワールド固定 aspect ごとの記述＋恒久 flag。数値ティア（band）は持たない
- **StatDef/StatValue**（事実＝数）— `StatDef{name,scope:'character'|'global',default,min?,max?,inject}` は World 定義、`StatValue{defId,characterId?,value}` は SessionState。実効値＝StatValue or `def.default`。好感度メーター/レベル/所持金等。`inject:true` のみ本編注入
- **CounterDef/CounterValue**（事実＝数・累計）— `CounterDef{name,scope,inject}` は World 定義、`CounterValue{defId,characterId?,value}` は SessionState。デート回数/戦闘回数等、レビューの `counterEvents` で加算（単調増加）
- **Scene** — `{title,activeCharacterIds,note,summary,timeLabel?,sceneTypeId?,illustrations?,endedAt?}`。`illustrations?: SceneIllustration[]`（G3。任意＝旧データには無いので読む側は `?? []`）
- **SceneIllustration**（G3）— `{id,imageId,prompt,messageId?,createdAt}`。挿絵1枚。`messageId` のメッセージ直後に表示（消失時はシーン末尾）。画像本体は IndexedDB
- **Message** — role/characterId?/sceneId?/content/choices?/truncated?/pending?
- **ImageJob**（V2・`imageJobs.ts`。store の `imageJobs: ImageJob[]`。**非永続・partialize除外**）— `{id,label,target:ImageJobTarget,providerId,prompt,negative?,width,height,count,status:'running'|'selecting'|'error'|'canceled',results:Blob[],error?,createdAt}`。`target`＝`{type:'scene-illustration',sessionId,sceneId,messageId?}`|`{type:'character-avatar',characterId}`|`{type:'persona-avatar',personaId}`。1枚でも自動採用しない（採用は常にユーザー選択＝`applyImageJobResult`）。`store.imageJobToasts: {jobId,label}[]`（選択待ちになった通知。非永続）

## ModelRef 形式
モデル系フィールドはすべて `"providerId::modelId"` 形式の文字列（`::` 区切り）。区切り無しのプレーン文字列は `providers[0]`（OpenRouter）にフォールバック。空文字は「上位にフォロー（継承）」。

モデル解決の優先順位:
- 本編: `character.model`（chat 群像・話者確定時のみ）→ `session.model`
- レビュー用: `session.reviewModel` → `session.model`
- 選択肢用: `session.choicesModel` → `session.model`

ヘルパ: `mainModelOf(session, character?)` / `reviewModelOf(session)` / `choicesModelOf(session)`（store.ts エクスポート）

## 永続化（クリーンブレイク方針）
`store.ts` の persist `name: 'ai-storytelling-store-v3'`（P1で Avatar 型刷新のため v2 から刷新）。**後方互換は持たない（ADR-1）**：旧 migrate 連鎖・`version`/`migrate` は廃止し、スキーマ刷新時は persist キーを変えて旧データを破棄する。`exportBundle.version` は現行 `1`、`importBundle` は現行スキーマのみ id マージ（正規化連鎖なし。worlds は新フィールド欠落のみ最小補完）。

**スキーマ変更時: 型更新 → 初期state/factory更新 → exportBundle/importBundle 反映 → partialize に新フィールド。**（破壊的変更なら persist キーも更新）

## 主要な振る舞い
- **シーン進行**: `このシーンを終える` → `prepareSceneReview`（要約＋`directNextScene`＋成長案＋関係値差分生成。**max_tokens不足での途中切れ対策**＝maxTokensを拡大＋`finish_reason==='length'`時は最大2回まで再試行、失敗時は raw.text フォールバックせず明示エラー表示）→ レビュー確認 → `confirmSceneReview`（成長/イベント反映・**関係値加算/気分更新**・タイムライン前進・新シーン作成）→ `beginScene()`（導入生成）→ 選択肢。物語開始は `startStory()`。
- **セッション・オーバーレイ**（`Session.overlay`／設計は `docs/設計_ワールド再利用とオーバーレイ.md`）: 素材（`Character`/`World`）は複数セッションから参照される再利用資産なので、**レビューはこれを書き換えない**。採用された成長案・発見ロアは `confirmSceneReview`（`applyDiscovery`）で対象セッションの `overlay.characterDevelopments`/`overlay.lore` に追記（現在シーン確定時のみ）。本編プロンプト・レビュー文脈は `resolveRefs` の `effectiveWorld`/`effectiveCharacter` が素材＋オーバーレイを合成した実効ビューを `refs.world`/`refs.characters` に格納して供給（developments を読む経路は必ず実効キャラを使うこと。片方だけ素材素を読むと発見が消えて見える）。閲覧/手動編集は `ChatPanel` の 📖 `DiscoveryPanel`（`updateOverlayLore`/`removeOverlayLore`/`toggleOverlayLore`/`updateOverlayDev`/`removeOverlayDev`/`toggleOverlayDev`）。気に入った発見は「⬆ 昇格」で `promoteOverlayLore`/`promoteOverlayDev` が元 World/Character へ **move**（copy にすると実効合成で二重注入されるため）。ワールド未設定セッションはロア昇格不可。関係性 prose は既存どおり 📊 `StatusPanel` に残る（オーバーレイとは別レイヤー）。
- **ディレクター** `directNextScene`: ①特別イベント（未消化 かつ `day` 未指定または到来 かつ `condition` 未指定または成立）最優先 → ②`director.typeIds` から重み＋クールダウン（`minGap`）で抽選。イベントは人の承認なしでコードが自動判定して発火（ADR-1）。
- **状態エンジン** (`Session.state`／ADR-1・P1実装済み): 関係性は **prose**（`Relation` の stance＋ワールド固定 aspect＋flag）、進捗は **事実の数**（`StatValue`）。`reviewSystem(aspectNames, statNames, counterNames)` がレビュー時に `relationUpdates`（stance/aspects を全文書き直し・flagsAdd）／`statChanges`（delta）／`counterEvents`（amount）／`moods` を出力（ワールド定義名に拘束、未定義は除外）。**prose は全文置換・数値の加算はコードが行う**（`confirmSceneReview`：relations を upsert＝stance/aspects 置換・flags 和集合、stats は `clampStat`、counters は累計加算、現在シーン確定時のみ反映）。現在値は `buildStateInfo`→`refs.stateInfo`→本編 system の【状態（現在）】に注入（関係 prose＋`inject:true` のスタット【ステータス】・カウンター【カウンター】の数値）。閲覧/手動編集は `ChatPanel` の 📊 `StatusPanel`。**条件エンジン(P4)まで実装済み**：`World.achievements`（`AchievementDef{condition:Condition}`）＋`SessionState.achievements`、`World.scheduledEvents[].condition?:Condition`（`day` は任意化）。`evalCondition`/`evalClause`（store.ts）が `Clause`（stat/counter/relationFlag/achievement、`characterId`/`fromId` 省略時は「セッション参加キャラのいずれかが満たす」＝ワールドは特定キャラに固定されない再利用素材のため）を判定し、①`confirmSceneReview` 適用後に World 定義を反復評価（実績の連鎖依存も1パスで解決）→新規解除を `SessionState.achievements` に記録・`newlyUnlockedAchievements`（ランタイム）でトースト通知、②`directNextScene` のイベント抽出でも同じ `evalCondition` を用い自動発火判定。定義/条件ビルダー UI（`ClauseRow` 共通コンポーネント）は `WorldEditor`（実績・特別イベント双方）、達成一覧は `StatusPanel`。実績の反復評価は `unlockAchievements()`（store.ts）に共通化し、`confirmSceneReview` と選択肢の加点（P5・下記）の両方から呼ぶ。
- **選択肢** `genChoices`: choiceMode≠off で各応答後に生成。`choicesModelOf` 使用、`extractJson`→`coerceChoices`（素の配列のほか `{"choices":[...]}` ラップや `[{"text":...}]` オブジェクト配列も吸収。**P5実装済み**：ワールドにスタット定義があれば `{"text":...,"effects":[{"stat":名称,"character":省略可,"delta":数値}]}` 形式も受け取り、`stat` 名から `World.stats` の defId を解決した `Choice.effects: ChoiceEffect[]` にする）。**末尾に `choicesUserNudge` の user 念押しを積み**（本編継続でなく JSON を出させる）、temperature 0.5、`always` は抽出失敗で最大2回試行。失敗時は `console.warn('[choices]…')` で可視化。手動再生成は `regenChoices()`（ChatPanel の「🔁 選択肢を生成」ボタン＝選択肢未付与時に表示）。選択肢ボタンは `effects` があれば加点バッジ（例: 「+2 好感度」）を表示し、クリック時に `applyChoiceEffects()`（stats を `clampStat` で加算 → `unlockAchievements()` 再評価・通知）を `send()` の前に適用（"細かく上昇する" 手応え）。
- **次シーン候補の再生成** `regenerateSuggestions`: レビューで方向性（種類/イベント）を変えると次シーン候補を作り直す。`setReviewNextType`／`rerollReviewType` から呼ぶ。`nextSceneSystem()` で suggestions のみ生成（要約＋方向性＋次の時刻を文脈に）。`isRegenSuggestions` 中は要約編集を保持（モーダルの useEffect は `review.sceneId` 起点でのみリセット）。
- **文体** novel=地の文＋「」混在（話者プレフィックスなし）/ chat=キャラ別吹き出し（「名前:」先頭をパースして characterId 判定）。
- **出力停止対策**: `finish_reason==='length'` で `message.truncated` → 「⤵ 続きを生成」（`continueLast`＝appendToId で同一メッセージへ追記）。生成開始の一時エラーは最大3回自動リトライ。
- **メッセージ操作**: 編集/削除/「↻ ここから」（`regenerateFrom`＝その地点以降を切り詰め再生成）。
- **`runCompletion(speakerId?, appendToId?)`**: novel 時は speaker 無効。chat 時は speaker を先に確定 → `mainModelOf(s, speaker)` でキャラ別モデル解決 → `parseModelRef` でプロバイダ＋modelId 取得 → `streamChat`。
- **画像生成ジョブ**（`Session`非依存・store の `imageJobs`。V2）: `startImageJob(args)` がジョブを追加後、fire-and-forget な非同期ループで `count` 枚を **直列**生成（ComfyUI は並列に弱いため）。各枚完了ごとに `results` へ push（進捗表示）。全滅なら `status:'error'`、1枚以上成功なら `status:'selecting'`（**1枚でも自動採用しない**。品質が悪ければ破棄したいため）。AbortController は `imageJobs.ts` のモジュールレベル Map で保持（store には入れない＝非シリアライズ物を永続化対象に混ぜない）。`cancelImageJob`（実行中断）／`dismissImageJob`（一覧から除去）／`applyImageJobResult(jobId, index)`（採用。target で分岐：挿絵は`addIllustration`、アバターは`normalizeImage`→`putImage`→対象キャラ/ペルソナの`avatar.imageId`を直接更新→自動dismiss）。ジョブが `selecting` に変わると `imageJobToasts` に積んでトースト通知（実績解除と同じパターン）。`ImageGenModal`/`ImageJobsPanel` はどちらも同じ store アクションを呼ぶだけなので、モーダルを閉じてもジョブは継続し、後からジョブパネルで採用できる。`AvatarField` は既存素材（`target`のid が store に存在）でのみ生成可能とし、ジョブが外部（ジョブパネル）で採用された場合に備えて live な store の avatar.imageId 変化を draft へ同期する（保存ボタンでの上書き事故を防ぐ）。

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
**主要機能はすべて実装済み**。実装済み: セッション(RP/物語)・キャラ/世界観/ペルソナ/シーンタイプの素材ライブラリ・ロアブック・グループ会話・シーン管理・タイムライン・選択肢進行・統合レビュー・シーン演出エンジン・文体切替・**マルチプロバイダ（プロバイダ管理・キャラ別モデル・役割別裏方モデル）**・あらすじ閲覧・会話編集/削除/作り直し・エクスポート/インポート・トークン目安・出力停止対策・状態エンジン（関係性prose＋事実の数＋条件エンジン＋実績＋選択肢連動加点。ADR-1 P1〜P5）・**セッション・オーバーレイ（発見ロア／キャラ成長を素材から分離しセッションへ隔離＋実効ビュー注入＋発見ログUI＋素材への昇格。B1〜B4）**・**画像基盤とPNGカード入出力（IndexedDB画像ストア・EntityAvatar・ST互換キャラカード・世界/ペルソナカード。P1〜P4）**・**画像生成連携（ComfyUI/OpenAI互換の接続先管理・裏方LLMプロンプト起案・アバター生成・挿絵・セッションカード。G1〜G4）**・**画像生成のプロンプト品質改善（スタイルプリセットprefill・起案maxTokens拡大・挿絵起案のシーン全文文脈。V1）**・**画像生成のバックグラウンドジョブ化（複数枚シード違い生成・候補選択・ジョブパネル・完了トースト。V2）**。

## 次にやること（ロードマップ）
計画済みフェーズ（画像カード P1〜P4・画像生成連携 G1〜G4・画像改善 V1〜V2）は実装完了。残タスク:
1. **画像改善 V3〜V4（設計済み・未実装）**: `docs/設計_画像改善_立ち絵と生成ジョブ.md` に詳細設計あり。V3=セッション内画像ギャラリー → V4=立ち絵・表情差分（裏方LLM毎応答判定）・シーン背景・ステージ表示。**必ずこの順で1フェーズずつ実装・検証・コミットする**。
2. **ComfyUI 実機での動作確認**: 生成経路はモック検証済みだが、実機（CORS許可起動）での通し確認とワークフローテンプレの拡充（SDXL以外・LoRAノード入りの例）は未実施。
3. **openai-image 系の実プロバイダ確認**: `response_format: b64_json` 非対応 API（gpt-image-1 等）への追従が必要になったら `imageGen.ts` の openai 経路にバリエーションを足す。ComfyUI は CORS 許可起動（`--enable-cors-header '*'`）が前提。追加フィールドはすべて optional のため persist キーは v3 のまま。

## 設計上の根本分岐（ADR）
後から別パターンを試せるよう、根本決定と**却下案**を残す。詳細実装計画は `docs/設計_ステータスエンジン.md`。

### ADR-1: 状態（感情・関係・パラメータ）の表現方式（2026-06-30 決定 / 実装は順次）
- **背景**: 「ワールドごとに独自ゲームシステムを構築できる、自由度の極めて高いギャルゲ」を目指す。任意キャラパラメータ・実績・行動カウンター・条件付きイベントを足すにあたり、状態の表現方式を根本から再検討した。
- **原則: 事実は数、判断は言葉。**
  - 判断（感情の機微・関係の質）＝ **prose**（ワールド固定の次元 aspect ごとの記述＋ stance）。LLM が読み生成に使う。**条件判定には使わない**。
  - 事実（好感度ポイント・回数・所持金・レベル・日数）＝ **数 / フラグ**。プレイヤーとコードが読み、**イベント発火条件**に使う。
- **採用（案A）**:
  - 関係性は **prose**（数値化しない）。次元（信頼/恋愛 等）は**ワールド固定**（セッション側の自動発見はしない）。
  - 進捗（レベル上げの楽しみ）は **prose とは別レイヤーの「好感度ポイント」**。イベント/行動を踏むと**固定値で加点される事実**（LLM に現在値を査定させない）。"細かく上昇"は選択肢連動の小刻み加点で出す（P5）。
  - イベント発火は **人の承認なし・コード自動判定**（ポイント/フラグ/カウンターのしきい値）。没入を切らさず再現可能。
  - **band（low/mid/高の派生ティア）は不採用**（3段階では"細かく上昇する"楽しみを生めないため、いっそ持たない）。
  - レビューが状態の**唯一の書き手**（prose は追記でなく全文書き直し、数値はコードが加算）。
- **却下した代替（後で試す用）**:
  - **案B**: 進捗は主人公の数値スタット（レベル/所持金/名声）のみに置き、関係性は純 prose（キャラ別の好感度ポイントを持たない）。
  - **案C**: 純 prose 一本。進捗の可視的な楽しみ（メーター/加点）を持たない。最小だが"レベル上げ感"は出ない。
  - **band を条件にも使う**: 偽閾値とドリフトが条件層に侵入するため不採用。
  - **イベントの LLM 言語判定発火**: 非再現・早漏発火のため不採用。**人による承認制発火**: 無粋で没入を損なうため不採用。
  - **旧来の連続数値（信頼60 等）**: LLM が数値更新を苦手＋機微を非可逆圧縮するため不採用（＝現行 `Session.state` の方式は置換予定）。
- **共有/コミュニティ観点**: 構造（固定 aspect・名前付きイベント・実績）と発火の再現性が、「共有可能なゲーム」を成立させる要。prose は没入、数/フラグは再現、で役割分担。
- **後方互換**: 不要。クリーンブレイク（persist キー変更で旧データ破棄、移行連鎖を全廃）。

## ユーザーの進め方の好み
- 大きめの要望は「機能検討（設計提案＋選択式質問）→合意→実装→検証→要約報告」の流れを好む。
- 1ターンで作りすぎない（大改修はフェーズ分割して各ターンで検証可能に）。
- 実装/技術に触れない要件定義書が欲しい場合がある（`docs/要件定義書.md` 参照）。
