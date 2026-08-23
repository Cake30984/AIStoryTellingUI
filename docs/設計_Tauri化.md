# 設計: Tauri 化 — デスクトップアプリへの移行（T0〜T4）

2026-07-05 の設計相談で合意した方針転換（ブラウザ完結 → 配布可能なデスクトップアプリ）の実装計画。
**実装は T0 → T1 → T2 → T3 → T4 の順**。各フェーズごとに tsc → build → 検証 → CLAUDE.md 更新 → commit → push（既存の進め方と同じ）。
セーブ/ロードと分岐周回（チェックポイント方式）は本移行の**後**に着手する。チェックポイント層が使うストレージ抽象は T2〜T3 でここに作る。

## 背景と目的

分岐周回機能で保存データが大幅に増える見込みであることを機に、ブラウザ完結の縛りを外す。目的は4つ:

1. **配布**: アプリケーションとして配布できる形態にする（GitHub Releases にインストーラを置く）。
2. **データのファイル化**: セッション・画像を人間が見えるファイルとして持つ。フォルダごとバックアップ/移行が可能になり、「ブラウザのサイトデータ削除で全消失」のリスクを排除する。
3. **CORS 不要化**: HTTP を Rust 側で実行するため CORS の制約を受けない。ComfyUI を `--enable-cors-header` なしの通常起動で叩け、任意の OpenAI 互換 API にも自由に接続できる（ロードマップ残タスク「ComfyUI 実機確認」も T1 で同時に消化する）。
4. **将来の足場**: ローカルプロセス連携（読み上げ TTS・rembg 等）や無制限ストレージ（分岐チェックポイント）の土台。

## 決定事項

| 論点 | 決定 | 理由 |
|---|---|---|
| シェル | **Tauri 2.x**（Electron 不採用） | バイナリが軽量（WebView2 は Win11 標準搭載で Chromium 同梱不要）。フロントは既存の Vite + React が無改造で載る |
| Web 版の扱い | **開発・検証用に併存**。デスクトップが正式版 | 現在の Preview MCP 検証ワークフローがそのまま使える。環境差はアダプタ層（下記）に閉じ込め、コンポーネント・store には持ち込まない |
| 環境差の置き場 | **`src/lib/platform.ts` に集約**。`isTauri()` 分岐はこのファイル（とストレージ実装ファイル）の外に書かない | 分岐が散らばると Web/Tauri の動作差がすぐ追えなくなる。「環境を意識するのはアダプタだけ」を規約にする |
| データ保存形式 | **ファイル群**（`state.json` ＋ `images/` ＋ 将来 `checkpoints/`）。SQLite 不採用 | 「データをファイルとして持つ」目的に直結。エクスプローラで見え、フォルダコピー＝完全バックアップになる。SQLite の強み（トランザクション・クエリ）が要る規模ではまだない |
| HTTP | **`@tauri-apps/plugin-http` の fetch**（Rust 側実行＝CORS 無関係）。ストリーミング非対応だった場合のみ自作 Rust command に切替（T1 に代替案を記載） | WHATWG fetch 互換 API のため、既存 9 箇所の `fetch` を `appFetch` に置換するだけで済む見込み |
| 配布・更新 | **手動配布**（GitHub Releases に NSIS インストーラ・未署名）。自動アップデートはやらない | 署名鍵・マニフェストホスティングの管理が重い。個人配布の規模では新版を入れ直せば足りる |
| 対象 OS | **Windows のみ** | まず手元の Win11 で完結。Tauri はクロスプラットフォームなので将来の拡張障壁は低い |
| persist スキーマ | **変更なし**（キー `ai-storytelling-store-v3` 維持・クリーンブレイク不要） | ストレージ backend の差し替えであってスキーマ刷新ではない。データ形は 1 バイトも変わらない |
| API キーの置き場 | state.json に含める（localStorage と同等の平文保存） | 現状も localStorage 平文であり保護水準は同じ。**データフォルダをクラウド同期に含めるとキーも同期される**旨を README に注意書き |
| ブラウザ→デスクトップのデータ移行 | **T0 の「画像込みフルエクスポート」バンドル経由**（手動1回） | localStorage/IndexedDB はオリジン隔離されており直接は読めない。既存のエクスポート機構の拡張が最小コスト |

### 既知の制約（報告時に説明すること）

- インストーラは未署名のため、初回実行時に SmartScreen 警告が出る（「詳細情報」→「実行」で起動）。
- Tauri 版の自動検証手段は当面持たない（Preview MCP はブラウザ専用）。Tauri 固有部は手動チェックリスト（後述）で確認する。
- `npm run dev`（ブラウザ）と `npm run tauri:dev` の同時起動はポート 5173 を取り合うため不可。

## 前提環境（初回のみ・未導入）

Rust ツールチェーンが未導入（2026-07-05 確認済み。Node は v24 で OK）。T1 着手前に:

1. **VS Build Tools**（「C++ によるデスクトップ開発」ワークロード）: `winget install Microsoft.VisualStudio.2022.BuildTools`（インストーラ内でワークロード選択）
2. **rustup**: `winget install Rustlang.Rustup` → 既定の `x86_64-pc-windows-msvc` ツールチェーンを導入
3. **WebView2**: Win11 標準搭載のため不要
4. 確認: `rustc --version` / `cargo --version` が通ること

## 全体アーキテクチャ

```
┌─ フロントエンド（既存のまま: Vite + React + zustand）─────────┐
│  components / store.ts / lib/*                                  │
│      │ fetch・DL・永続化だけアダプタを経由                      │
│  ┌───▼──────────────────────────────┐                           │
│  │ src/lib/platform.ts（アダプタ層）  │ isTauri() 分岐はここだけ │
│  │  appFetch / saveBlob /             │                          │
│  │  stateStorage / blobStore          │                          │
│  └───┬───────────────┬──────────────┘                           │
└──────┼───────────────┼──────────────────────────────────────────┘
   Web 実装         Tauri 実装
   window.fetch     plugin-http（Rust 経由・CORS 無関係）
   <a download>     plugin-dialog + plugin-fs（保存ダイアログ）
   localStorage     %APPDATA%/…/data/state.json（アトミック書込）
   IndexedDB        %APPDATA%/…/data/images/<id>.png
```

- `src-tauri/`（Rust シェル）は設定・権限・アイコンのみで、独自ロジックはほぼ書かない（plugin-http がストリーミング非対応だった場合の代替 command が唯一の例外候補）。
- 将来の分岐チェックポイント層は `blobStore`/ファイル層の上に乗る（`checkpoints/` ディレクトリを予約）。

---

## T0: 画像込みフルエクスポート（Web 版に追加・移行準備）

ブラウザ版 → デスクトップ版へデータを持ち込む唯一の経路。分岐機能着手前のフルバックアップ強化としても単独で価値がある。

- `ExportBundle` に `images?: { id: string; mime: string; dataBase64: string }[]` を追加（optional のため `version: 1` のまま。旧バンドルの import は従来動作）。
- 収集対象は `gcUnusedImages` と同じ「使用中 id」集合。収集ロジックを `collectUsedImageIds()`（store.ts）として切り出し、GC・エクスポートの両方から呼ぶ（**片方だけ更新される事故を構造的に防ぐ**。「画像 id を増やしたら GC に追加」の規約はこの関数 1 箇所への追加に変わる）。
- `imageStore.ts` に `putImageAs(id, blob)`（id 指定保存）を追加。インポート時は id を**維持**して復元する（バンドル内の `avatar.imageId` 等の参照を書き換えずに済む。同 id が既に存在する場合は上書き＝同一画像とみなす）。
- `SettingsModal` のエクスポートに「🖼 画像も含める」チェックボックス（既定 ON）。画像込みは数十 MB になり得るため、書き出し前に概算サイズを confirm に表示。
- `importBundle` は `images` があれば先に `putImageAs` で復元してから素材・セッションをマージ。

**完了条件**: 画像込みエクスポート → localStorage・IndexedDB を全消去 → インポートで画像（アバター・立ち絵・挿絵・背景）含め完全復元されること（Preview MCP で検証・エラー 0 件）。

## T1: Tauri シェル起動＋CORS-free HTTP（PoC 最優先）

**このフェーズの最重要ゴールは「plugin-http で SSE ストリーミングと中断が動く」の実証**。ここが崩れると HTTP 層の設計が変わるため、シェルが起動したら真っ先に確認する。

### 導入

- `npm i -D @tauri-apps/cli` / `npm i @tauri-apps/api @tauri-apps/plugin-http`
- `npx tauri init` で `src-tauri/` を生成。主要設定（`tauri.conf.json`）:
  - `productName: "Delist"`（**ASCII。実行ファイル名・インストーラ名になる**。ウィンドウ `title` だけ `デリスト`）／ `identifier: "com.tokatokage.delist"`（**2026-08-10 に `com.cake30984.aistorytelling` から変更。公開後は変更不可＝データ保存先がここで決まる**）／ `version` は package.json と揃える
  - `build`: `beforeDevCommand: "npm run dev"` / `devUrl: "http://localhost:5173"` / `beforeBuildCommand: "npm run build"` / `frontendDist: "../dist"`
  - ウィンドウ: 1280×800・タイトル同名
- `vite.config.ts`: Tauri 起動時（`process.env.TAURI_ENV_PLATFORM` あり）は `server.strictPort: true`（devUrl とポートがずれると白画面になるため。5173 占有時は `npx kill-port 5173`）
- `package.json` scripts: `"tauri": "tauri"` / `"tauri:dev": "tauri dev"` / `"tauri:build": "tauri build"`
- `.gitignore` に `src-tauri/target` を追加
- capabilities（`src-tauri/capabilities/default.json`）: `core:default` ＋ http の scope を `http://**`・`https://**` の**全許可**にする（ユーザーが任意の接続先 URL を登録するアプリのため限定不能。権限識別子の正確な書式は実装時に使用バージョンのドキュメントで確認）

### appFetch アダプタ（`src/lib/platform.ts` 新設）

```ts
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** 環境に応じた fetch。Tauri では Rust 側で実行され CORS の制約を受けない */
export async function appFetch(input: string, init?: RequestInit): Promise<Response> {
  if (isTauri()) {
    // 動的 import: Web ビルドに plugin コードを混ぜない
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    return tauriFetch(input, init)
  }
  return window.fetch(input, init)
}
```

- 置換対象は 9 箇所: `openrouter.ts` の `streamChat`/`fetchModels`、`imageGen.ts` の ComfyUI 3 箇所（/prompt・/history・/view）・openai-image 2 箇所（/images/generations・URL 型結果の取得）・接続テスト 2 箇所。
- `location.origin` は Tauri では `http://tauri.localhost` になるが、使用箇所は OpenRouter の任意ヘッダ `HTTP-Referer` のみで無害。

### PoC チェック（T1 の完了判定の中心）

1. `npm run tauri:dev` でアプリが起動し、既存機能が一通り動く（この時点のデータは WebView 内蔵の localStorage/IndexedDB のまま＝従来と同じ挙動）
2. OpenRouter で本編生成 → **delta が逐次表示される**（全文が最後にまとめて出るならストリーミング非対応＝下記の代替へ）
3. 生成中の ◼ 停止が**即座に**効く（AbortSignal 伝播）
4. **ComfyUI を CORS フラグなしで通常起動**し、接続テスト → 画像生成 → 採用まで通る（ロードマップ「ComfyUI 実機確認」を消化）

### 代替案（plugin-http がストリーミング不可だった場合のみ）

Rust command `stream_chat(url, headers, body, channel)` を自作: `reqwest` の `bytes_stream()` を読みながら `tauri::ipc::Channel` で断片を push、`openrouter.ts` 側は Tauri 時のみ channel 受信で `onDelta` を呼ぶ。中断は `AbortController` の代わりに command へ cancel イベントを送る。**採用したら本設計書のこの節を実装内容で更新する。**

**完了条件**: PoC 1〜4 すべて通過。`npm run dev`（ブラウザ版）が従来通り動くこと（Preview MCP・エラー 0 件）。

### 実装結果（2026-07-05）

- 導入・appFetch 置換・capabilities は上記のとおり実装。**plugin-http でストリーミング・中断は正常動作**（代替の Rust command は不要だった）。
- **Vite の watcher が `src-tauri` を監視し cargo のビルド書き込みと競合する問題**が発生（`EBUSY: resource busy or locked`）。`vite.config.ts` の `server.watch.ignored: ['**/src-tauri/**']` で解消（本設計書 T1 節に記載漏れだったため追記・実装済み）。
- **Windows Defender の「コントロールされたフォルダーアクセス」(Controlled Folder Access) が cargo/rustc の書き込みをブロックし、ビルド成果物ディレクトリが ReadOnly 属性を帯びて `num-traits`（autocfg 使用）のビルドが `output path is not a writable directory` で失敗する**環境要因を確認。`cargo.exe`/`rustc.exe` を Windows セキュリティの「ランサムウェア防止 → アプリを許可する」に追加して解消。**開発機でこのビルドエラーが再発した場合はまずこれを疑う**（Malwarebytes 等の他のリアルタイム保護は無関係だった）。
- PoC 1〜3（起動・ストリーミング逐次表示・◼ 停止の即時反映）は確認 OK。

### 既知の問題（次セッションで対応。T1 の完了自体は妨げない）

1. **選択肢生成中に次シーンの本編生成が始まると、選択肢生成側の AbortController が追従せず `Cannot read properties of null (reading 'signal')` が発生（3回試行後にエラー表示）**。本編生成の中断は `stop`/`stopChoices`/`stopReview` に独立済み（V5d）だが、「次の本文の生成を開始したら、進行中の選択肢生成も自動的に中断する」導線が無い。本編生成開始時に `stopChoices` 相当のキャンセルを先んじて呼ぶ修正が必要。
2. ~~**ComfyUI が `--enable-cors-header` なしの通常起動では接続できなかった**~~ → **原因特定・修正済み（2026-08-08）。下の「ComfyUI にデスクトップ版から接続できない」節を参照。CORS は無関係だった**（設計「Tauri なら ComfyUI 側のフラグは不要」自体は正しい）

### ComfyUI にデスクトップ版から接続できない（2026-08-08 解決）

**症状**: `--enable-cors-header` なしで起動した ComfyUI に、デスクトップ版から接続できない。

**原因は独立に 2 つあった**。①スコープがポート付き URL を弾いていた（そもそもリクエストが出ていなかった）②Origin ヘッダで ComfyUI の CSRF 対策に 403 される。①を直すと②が露出する関係なので、両方直さないと通らない。

#### 原因①: capabilities の URL パターンがポートを許していなかった

`capabilities/default.json` の `{"url": "http://**"}` は、**ポート成分が空文字＝デフォルトポート限定**として解釈される。plugin-http のスコープは constructor-string 形式で `UrlPattern` を組み（`scope.rs` の `parse_url_pattern`）、pathname/search/hash が空のときだけ `*` に補正するが、**port は補正しない**。結果、`http://127.0.0.1:8188/...` は `url not allowed on the configured scope` で拒否される。**OpenRouter が動いていたのは https の 443＝デフォルトポートだったから**で、ローカルサーバ全般が使えない状態だった。

**修正**: スコープを `http://*:*` / `https://*:*` に変更（ポート成分 `:*` を明示）。

**落とし穴**: URLPattern を object 形式（`{protocol, hostname, ...}`）で検証すると、省略した `port` が `*` に既定化されるため**マッチすると誤判定する**。Tauri が使うのは constructor-string 形式なので、検証もその形で行うこと。

#### 原因②: plugin-http が付ける Origin ヘッダで 403

**CORS ではなく ComfyUI の CSRF 対策**。ComfyUI は `--enable-cors-header` を「CORS ヘッダを足すフラグ」ではなく **`origin_only_middleware` と排他のフラグ**として扱う（`server.py`: `if args.enable_cors_header: … else: middlewares.append(create_origin_only_middleware())`）。フラグなし起動だと「Host がループバック かつ Origin のホスト名が Host と不一致」の全リクエストを **403** で落とす。一方 `tauri-plugin-http` は Rust 側で実行するにもかかわらず **WebView の origin を Origin ヘッダとして必ず付与する**（`commands.rs` の "ensure we have an Origin header set"）。dev は `http://localhost:5173`、本番 Windows は `http://tauri.localhost` が乗るため Host（`127.0.0.1:8188`）と食い違い、403 になっていた。

実測（稼働中の ComfyUI に curl で直接）: Origin なし→200 / `Origin: http://127.0.0.1:8188`→200 / `Origin: http://localhost:5173`→**403** / Referer だけ→200。

**修正（②に対して）**:

- `src-tauri/Cargo.toml` の `tauri-plugin-http` に **`unsafe-headers` feature** を付ける。これが無いと呼び出し側の Origin は forbidden header として捨てられ、上書きもできない。
- `platform.ts` の `appFetch` に **`omitOrigin` オプション**を追加。Tauri 経路でのみ `Origin: ''` を送る（plugin-http は空の Origin をヘッダごと削除する実装。`commands.rs` の "Some services do not like Origin header"）。Web ではブラウザが Origin を管理するので無視。**環境分岐を platform.ts の外に出さないため、呼び出し側は「Origin を外したい」という意図だけを宣言する**。
- `imageGen.ts` の ComfyUI 経路 4 箇所（`/prompt`・`/history`・`/view`・接続テストの `/system_stats`）で `omitOrigin: true`。403 は専用メッセージに分岐（従来は `res.ok === false` なので CORS ヒントに落ちず「応答はありますがエラーです (403)」と出ていた＝誤誘導）。
- 設定 UI とエラー文言を「デスクトップ版は通常起動のままでよい／CORS 許可が要るのはブラウザ版だけ」に修正。

**注意**: `unsafe-headers` は Origin 以外の forbidden header（Host・Cookie・Referer 等）も呼び出し側から指定可能にする。ヘッダを直に触る新規コードを書くときはこの前提を意識すること。

#### 検証結果

`npm run tauri:dev` で **`--enable-cors-header` なしで起動した ComfyUI への接続テスト成功**（2026-08-08）。①だけ直した段階では 403（＝②が露出）、②まで直して 200。

実生成も同日に実機確認済み（`imageGen.ts` を esbuild でバンドルし Node から `generateImage` を直接実行。Node の fetch は Origin を付けないので Origin 除去後の Tauri と同条件）: `fillWorkflow` の置換が `"`・日本語・改行入りで壊れないこと／`POST /prompt` 200／`/history` ポーリングの離脱／`GET /view` → 550KB の `image/png`（PNG シグネチャ一致・1024×1024）まで通過、41.2 秒。**未検証は plugin-http 経由の POST（JSON ボディ）とバイナリ blob だけ**（GET は接続テストで検証済み、POST は OpenRouter で実績あり）。

**環境依存の詰まり方**: 既定ワークフローの `ckpt_name`（`sd_xl_base_1.0.safetensors`）は書き換え前提のプレースホルダなので、そのままだと `ComfyUI エラー (400): {"error":{"type":"prompt_outputs_failed_validation" … "value_not_in_list"}}` の生 JSON が出る。読みやすい日本語への翻訳は公開フェーズ Phase 3（`docs/公開計画_マネタイズと配布.md` §5.7「エラーを日本語の原因に翻訳する」）でまとめて扱う方針とし、今回は入れていない。

#### 教訓: 接続エラーの文言で例外を握り潰さない

この件は「CORS が原因」という**誤った文言**（`catch` で一律に CORS ヒントを返していた）が診断を丸ごと誤らせ、原因①に至るまでに 2 回の切り分けを要した。実際の例外は `url not allowed on the configured scope: …` で、**一目で原因が分かる文字列だった**。`testImageProvider`／`generateComfy` は例外の生メッセージを `［詳細: …］` として必ず添える（`detailOf`）。**推測でエラー文言を書かない・原因の違うものを同じ文言に潰さない**。

## T2: 環境アダプタ層の整備（保存ダイアログ・ストレージ interface）

Tauri の WebView では `<a download>` によるダウンロードが機能しない（カード PNG・バンドル JSON の保存が全滅する）ため、保存経路をアダプタ化する。同時に、T3 と将来の分岐チェックポイントが乗るストレージ interface を定義する。

- `npm i @tauri-apps/plugin-dialog @tauri-apps/plugin-fs`（capabilities に dialog と、appdata 配下に限定した fs 権限を追加）
- **saveBlob**（platform.ts）: Web は従来のアンカー DL、Tauri は保存ダイアログ（`plugin-dialog` の save → `plugin-fs` で書き込み）。`io.ts` の `downloadBlob`/`downloadBundle` の内部実装を差し替え（呼び出し元 8 箇所は無変更）。**以後、新規のダウンロード機能は必ず `downloadBlob` を経由する**（規約）。
- **StateStorage interface**: zustand `createJSONStorage` 互換の `{ getItem / setItem / removeItem }`（async 可）。Web 実装は localStorage の薄いラッパ。store.ts の persist を `storage: createJSONStorage(() => stateStorage)` に切り替える。
  - async storage 化で hydration が非同期になり得るため、`useStore.persist.hasHydrated()` が false の間は App がスプラッシュ（「読み込み中…」）を出す。Web 実装は同期なので従来と体感差なし。既存の `merge`（pending 掃除）はそのまま生きる。
- **BlobStore interface**: `{ put(blob)→id / putAs(id, blob) / get(id) / delete(id) / listIds() }`。`imageStore.ts` の公開関数名（`putImage` 等）と `useImageUrl` は維持し、内部を interface + Web 実装（現行 IndexedDB コード）に再編する（呼び出し元 0 変更）。

**完了条件**: Web 版の全機能が従来通り（Preview MCP・エラー 0 件＝アダプタの Web 実装を通っても挙動不変）。Tauri 版でキャラカード保存・エクスポートが保存ダイアログ経由で成功。

## T3: ファイルストレージ backend（デスクトップの本命）

保存先はアプリデータディレクトリ（`%APPDATA%\com.cake30984.aistorytelling\data\`）:

```
data/
  state.json         ← persist 全体（キー ai-storytelling-store-v3 の中身そのまま）
  images/<id>.png    ← BlobStore の Tauri 実装（mime→拡張子。読み出しは拡張子→mime）
  checkpoints/       ← 予約（分岐周回フェーズで使用。今回は作らない）
```

- **state.json の書き込み**: `state.json.tmp` に書いて rename する**アトミック書き込み**（書き込み中のクラッシュで全データ破損を防ぐ）＋ **500ms デバウンス**（zustand は set のたびに setItem を呼ぶため、ストリーミング中の delta 毎書き込みを潰す）。ウィンドウの close 要求時に未書き込み分を flush してから終了。
- **WebView 内蔵データからの自動移行**: 起動時に state.json が無く、WebView の localStorage に `ai-storytelling-store-v3` が残っていれば（T1〜T2 期間に使ったデータ）、それを state.json に書き出し、IndexedDB の画像も `images/` にコピーして移行完了フラグを立てる。WebView 側データは**消さない**（ロールバックの余地を残す）。
- **ブラウザ版からの移行**: T0 の画像込みバンドルをデスクトップ版でインポートする（手順を README に記載）。
- `gcUnusedImages` はファイル実装の `listIds`/`delete` 経由でそのまま動くことを確認する。

**完了条件**: Tauri 版でセッション作成・画像生成 → 再起動してデータ保持。エクスプローラで `images/` に画像ファイルが見える。`data/` フォルダを別の場所へコピー → 戻すだけで完全復元できる。localStorage 自動移行・T0 バンドル取り込みの両経路を確認。Web 版は従来通り（IndexedDB/localStorage のまま）。

## T4: 配布（手動・GitHub Releases）

- アイコン: 1024×1024 PNG を 1 枚用意して `npx tauri icon` で全サイズ生成（当面は仮アイコンで可・後で差し替え）。
- バージョン運用: `package.json` と `tauri.conf.json` の `version` を揃えて上げる（0.x.y）。
- `npm run tauri:build` → NSIS インストーラ（`src-tauri/target/release/bundle/nsis/*.exe`）を GitHub Releases に手動アップロード。
- README に追記: インストール手順・SmartScreen 警告の回避（未署名のため）・データの場所（`%APPDATA%\…\data`）・バックアップ方法（フォルダコピー）・クラウド同期時の API キー注意。

**完了条件**: ビルドしたインストーラをクリーンな環境（別ユーザー等）で実行 → 起動 → データが `%APPDATA%` 配下に作られ、再起動で保持されること。

---

## 検証ワークフローへの影響

- **Web 版**: 従来の Preview MCP フロー（CLAUDE.md「検証ワークフロー」）がそのまま正。アダプタの Web 実装を通るため、通常の機能開発の検証はこれで完結する。
- **Tauri 固有部**（appFetch / saveBlob / ファイルストレージ）を触った時のみ、`npm run tauri:dev` で手動チェックリスト:
  1. 本編生成が逐次ストリーミング表示される／◼ 停止が効く
  2. ComfyUI（通常起動）で画像生成 → 採用できる
  3. カード PNG・エクスポート JSON が保存ダイアログで保存できる
  4. 再起動してセッション・画像が保持されている（T3 以降）

## リスク・落とし穴（実装時の規約）

1. **plugin-http のストリーミング互換性が最大リスク**。T1 の最初に PoC で潰す。ダメなら Rust command 代替（T1 記載）へ即切替し、設計書を更新する。
2. **`<a download>` は Tauri で動かない**。ダウンロードは必ず `io.ts` の `downloadBlob`（内部で saveBlob アダプタ）を経由する。直接アンカー DL を書かない。
3. **`isTauri()` 分岐を platform.ts（とストレージ実装ファイル）の外に書かない**。コンポーネント・store に環境分岐を持ち込まない。
4. **Tauri plugin の JS パッケージは動的 import**（Web ビルドのバンドルを汚さない・Web 実行時に評価させない）。
5. ~~**API キーは state.json に平文**で入る~~ → **R3 で解消（2026-08-16 実装・2026-08-23 実機確認）。** キーは OS の資格情報ストア（Windows 資格情報マネージャー・service `com.tokatokage.delist`）へ分離済みで、`state.json` の `apiKey` は空。**ただし `data/` をクラウド同期対象にする場合の注意は README に要る**——キーは入っていないが、**物語の本文と画像はそのまま入っている**（＋複数 PC での同時起動は `state.json` の上書き事故になる）。
6. ポート 5173 が他プロセスに占有されていると `tauri:dev` は起動失敗（strictPort）。`npx kill-port 5173` で解放。ブラウザ版 dev との同時起動不可。
7. T3 以降も WebView 内蔵の旧データは削除しない（移行フラグ方式・ロールバック可能に）。
8. Rust 側の依存は公式プラグインのみに保つ（自作 command は plugin-http 代替が必要になった場合の 1 個だけ）。
9. スキーマは不変なので persist キーは `ai-storytelling-store-v3` のまま。**Tauri 化を理由にクリーンブレイクしない**（分岐周回フェーズで必要になった時に初めて上げる）。

## CLAUDE.md への反映（各フェーズのコミット時）

- コマンド節: `npm run tauri:dev` / `npm run tauri:build` と Rust 前提環境
- 技術スタック節: 「完全クライアント」→「デスクトップ（Tauri 2）が正式版・Web はdev/検証用」に更新
- ディレクトリ節: `src-tauri/`・`src/lib/platform.ts` の追加、`io.ts`/`imageStore.ts` の記述更新
- 検証ワークフロー節: Tauri 固有部の手動チェックリスト
- 規約・落とし穴節: 上記リスク 2・3・4 を転記
