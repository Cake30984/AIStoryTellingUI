# 設計 — UI再設計 実装詳細（UI-0〜UI-7）

**ステータス: 実装用詳細設計（2026-07-09 合意済み・実装はこれから）**

親ドキュメント: `docs/設計_UI全体再検討.md`（背景・課題分析・ADR はそちら。本書は**実装者向けの手順書**）。
親ドキュメント §8 の未決事項は **2026-07-09 にすべて推奨案で合意**した:

| Q | 決定 |
|---|---|
| Q1 レイアウト | **案A**（3ゾーン＝レール＋文脈サイドバー＋ステージ＋右コンテキストドック） |
| Q2 着手順 | **UI-0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 の直列**（§11 依存関係） |
| Q3 ドック第1弾 | **状態・発見・ジョブ**（第2弾で分岐・ギャラリー。同じ UI-3 内の2コミット目） |
| Q4 ライトテーマ | **作らない**（ダーク専用継続。UI-7 から除外） |
| Q5 アイコン | **自前SVGモジュール**（lucide の SVG パスを個別コピーして埋め込み・依存追加なし）。彩り用途の絵文字は残す |
| Q6 没入モード | **手動トグルのみ**（Aa ポップオーバー内トグル＋ `Ctrl+.`。自動発動なし） |
| Q7 WorldEditor | **フルページ化する**（モーダル卒業） |
| Q8 コマンドパレット | **採用**（UI-7） |

---

## 0. 実装者への指示（この文書の使い方）

- **1フェーズ＝1コミット（＋push）を基本**とする。フェーズ内に「コミット分割案」がある場合はそれに従い、各コミットで `npx tsc --noEmit` → `npm run build` を通す。
- 各フェーズの「完了条件」にある**ユーザー確認チェックリストを、作業完了報告にそのまま箇条書きで転記**する（検証ワークフロー方針: 見た目確認はユーザーが行う。Claude は Preview MCP を見た目確認に使わない）。
- **CLAUDE.md の更新は各フェーズと同一コミット**で行う（各フェーズ末尾に更新ポイントを記載）。
- 本書に書かれていない判断が必要になったら、親ドキュメントの原則（ADR-UI-1〜6・§4.5 配置原則）に従う。それでも決まらない場合は**実装せずユーザーに質問**する。
- コード例は「スケッチ」。そのまま貼るのではなく、既存コードの流儀（日本語コメント・命名・zustand の使い方）に合わせて仕上げること。

## 1. 全フェーズ共通の不変条件（違反したらそのフェーズは失敗）

1. **persist キー `ai-storytelling-store-v3` を変えない。** 状態の追加は optional またはデフォルト値付きで行い、partialize に追加する（`imageJobs` 等の非永続と混同しない）。
2. **データモデルの意味変更禁止。** 追加はすべて optional（本書での追加は `Session.archived?`・AppState の `ui`・`isClassifyingEmotions` のみ）。
3. `isTauri()` 分岐を components / store に書かない（既存規約）。
4. 画像の即時 `deleteImage` を書かない／画像 id フィールドを増やす場合は `sessionImageIds` へ追加（既存規約。※本書のフェーズでは画像 id フィールドは増えない）。
5. 構造化出力の graceful degradation・マーカー疑似メッセージの扱い・チェックポイント3契機・`restoreCheckpoint` の passthrough（UI-5 で `archived` を**追加**する以外）に触れない。
6. **依存パッケージを追加しない。** アイコンは自前 SVG（lucide のパスデータをコピー）、ポップオーバー・パレットも自前実装。
7. 既存 CSS クラス名は原則維持。**リネーム・削除は本書で明記されたもののみ**（例: UI-2 の `.scene-bar` 削除）。
8. `color-mix()` は使用可（対象環境は Web 版・Tauri WebView2 とも Chromium。V5d で既に使用実績あり）。
9. **絵文字→SVG 置換の対象は「機能ボタン・ナビ・タブ・メニュー項目」のみ。** トースト内の 🏆🖼、実績・感情などのデータ表現、セッション種別バッジ等の「彩り・意味内容」の絵文字は残す。
10. 各フェーズは「見た目の変化」が受け入れ条件に含まれるか否かを明記してある。**UI-0 は見た目不変が条件**。それ以外のフェーズでも、対象外の画面の見た目を変えない。

## 2. 新規モジュール全体図

| ファイル | 導入フェーズ | 役割 |
|---|---|---|
| `src/styles/*.css`（6ファイル） | UI-0 | `index.css` の分割先。`index.css` は `@import` のみに |
| `src/lib/modalStack.ts` | UI-1 | Escape の最前面判定用スタック（`useModalEscape`/`modalStackSize`） |
| `src/lib/dialogs.ts` | UI-1 | `appConfirm`/`appPrompt`（Promise ベース・React 非依存の要求キュー） |
| `src/components/DialogHost.tsx` | UI-1 | dialogs.ts のキューを描画する常駐ホスト（App.tsx に1つ） |
| `src/components/ModalShell.tsx` | UI-1 | overlay＋modal＋head＋body＋foot の共通シェル（Escape・破棄確認込み） |
| `src/components/ZoomOverlay.tsx` | UI-1 | 画像クリック拡大の共通オーバーレイ |
| `src/components/icons.tsx` | UI-2 | 自前 SVG アイコン（`<Icon name="x"/>`） |
| `src/components/MenuPopover.tsx` | UI-2 | 汎用ポップオーバー（⋯メニュー・アクティビティ内訳・Aa 設定で共用） |
| `src/components/ActivityIndicator.tsx` | UI-2 | 全非同期動作の一元表示＋中止 |
| `src/components/ContextDock.tsx` | UI-3 | 右ドック本体（タブバー＋各タブ body） |
| `src/components/StatusView.tsx` / `DiscoveryView.tsx` | UI-3 | ドック用の**読み取り専用**ビュー（編集は既存モーダルへ） |
| store `ui: UiPrefs` | UI-3（UI-4 で拡張） | ドックタブ・リーダー設定・没入モードの永続 UI 状態 |
| `src/components/ReaderSettings.tsx` | UI-4 | Aa ポップオーバー（文字サイズ・行間・幅・ステージ濃度・没入） |
| `src/components/Rail.tsx` | UI-5 | 左端 48px の領域スイッチ（Play/Library/System） |
| `SettingsBody`（SettingsModal から抽出） | UI-5 | System ページの中身 |
| `src/lib/shortcuts.ts` | UI-7 | グローバルショートカット登録 |
| `src/components/CommandPalette.tsx` | UI-7 | Ctrl+K パレット |

---

## 3. UI-0 基盤（トークン拡充・CSS分割・粗修正）

**目的**: 以降の全フェーズの下地。**見た目は変えない**（トースト積層と窓最小サイズのみ挙動変更）。

**変更ファイル**: `src/index.css`（分割）、`src/styles/*.css`（新規）、`src/App.tsx`（トースト）、`src-tauri/tauri.conf.json`。

### 3.1 デザイントークン追加（`:root`）

既存 16 変数に**既存のハードコード値をそのまま昇格**して追加（値を変えないこと）:

```css
:root {
  /* 意味色（既存ハードコード値の昇格） */
  --ok: #4cc9a4;
  --warn: #e0b341;
  --bad: #ef6f6c;      /* 下降・過大の弱い危険色（--danger=#ef4444 とは別物として現状維持） */
  --star: #f5c518;
  --dialogue: #cfe3ff; /* 小説セリフの色。UI-4 でリーダー設定と接続 */
  --badge-rp: #f0a76b;
  --badge-story: #6bd6f0;
  /* z-index スケール */
  --z-dock: 40;
  --z-modal: 50;
  --z-toast: 60;
  --z-palette: 70;
  /* spacing（新規コードで使う。既存値の一括置換はしない） */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px; --sp-6: 32px;
  /* リーダー設定のフック（UI-4 で可変化。既定値=現行値） */
  --font-size-prose: 15.5px;
  --line-height-prose: 1.9;
  --content-width: 760px;
}
```

### 3.2 ハードコード値の置換（見た目不変）

| 既存箇所 | 置換 |
|---|---|
| `.scene-btn.end` の `#4cc9a4`・`rgba(76,201,164,0.4)`・`rgba(76,201,164,0.12)` | `var(--ok)`・`color-mix(in srgb, var(--ok) 40%, transparent)`・`color-mix(in srgb, var(--ok) 12%, transparent)` |
| `.token-badge.low` の色2つ | `--ok`（背景は color-mix 14%） |
| `.token-badge.mid` / `.event-badge` の `#e0b341` 系 | `--warn`（背景・枠は color-mix。元の alpha% を維持） |
| `.token-badge.high` / `.delta-down` の `#ef6f6c` 系 | `--bad` |
| `.delta-up` の `#4cc9a4` | `--ok` |
| `.prose-block .dialogue` の `#cfe3ff` | `var(--dialogue)` |
| `.badge.roleplay` / `.badge.story` | `var(--badge-rp)` / `var(--badge-story)` |
| `.model-row .star.on` の `#f5c518` | `var(--star)` |
| `.overlay` の `z-index: 50` / `.toast` の `z-index: 60` | `var(--z-modal)` / `var(--z-toast)` |
| `.chat-inner` と `.composer` の `max-width: 760px`（2箇所とも） | `var(--content-width)` |
| `.prose-block` の `font-size: 15.5px; line-height: 1.9` | `var(--font-size-prose)` / `var(--line-height-prose)` |

トーストのグラデーション（`.toast.achievement`/`.toast.image`）は装飾なのでリテラルのまま残す。上記以外の「ついで置換・ついで整形」は禁止。

### 3.3 CSS ファイル分割

`src/styles/` に以下の6ファイルを作り、`src/index.css` は `@import './styles/tokens.css';` … の**6行だけ**にする（インポート順は下表の上から順。Vite が結合するので実行時挙動は不変）:

| ファイル | 移すセクション（index.css のコメント区切り名） |
|---|---|
| `tokens.css` | `:root` ブロック2つ（冒頭＋「ステージ・バックドロップ」内の `--stage-*`。**--stage-* は tokens に統合移動**） |
| `base.css` | `*`・`html,body,#root`・`body`・`button`・`textarea,input,select`・「雑多」（divider/notice/chat-hint）・`.scroll-anchor` |
| `layout.css` | 「レイアウト」「サイドバー」「ナビ」「メイン」（topbar/icon-btn/model-chip）「空状態」「ライブラリ」 |
| `chat.css` | 「会話エリア」「挿絵」「シーン」「小説形式」「構造化出力」「メッセージ編集ボックス」「トークン目安バッジ」「ステージ・バックドロップ」（--stage-* 変数を除く） |
| `composer.css` | 「コンポーザー」「話し手選択」「選択肢」 |
| `panels.css` | 「モーダル」（field/row2/btn 含む）「モデルピッカー」「トースト/エラー」「画像生成ジョブ」（seg/range-row 含む）「アバター編集」「セッション設定: キャラ選択」「ロアブック」「レビューモーダル」「タイムライン設定」「ストーリーログ」「分岐ツリー」「しおり」「立ち絵セット」 |

**規則**: ①プロパティの追加・削除・変更をしない（§3.2 の置換を除く）、②各ファイル内の相対順序は元ファイルの出現順を維持、③**既知の重複 `.new-buttons`（2定義ある）は layout.css で1つにマージ**する。マージ後の宣言は現在の実効スタイルと同じにする:

```css
.new-buttons { display: flex; gap: 8px; margin-top: 14px; padding: 12px 12px 4px; }
/* button 側の定義は同一内容なので1つ残す */
```

### 3.4 トーストの積層＋自動消滅

App.tsx の3トースト（error / achievement / image）を単一の `.toast-stack` コンテナ内に縦積みする:

- `.toast-stack { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 8px; z-index: var(--z-toast); max-width: 90vw; }`
- `.toast` から `position/bottom/left/transform/z-index` を除去（stack 内の通常フローに）。
- App.tsx 内に小さな `ToastItem` を定義: props `{ className, text, onClose, autoCloseMs? }`。`autoCloseMs` があれば `useEffect` の `setTimeout` で `onClose`（アンマウント時 clear）。
- error → 手動閉じのみ（現状維持）。achievement / image → `autoCloseMs: 6000`。閉じるボタンは3種とも維持。

### 3.5 その他の粗修正

- `tauri.conf.json` の window に `"minWidth": 960, "minHeight": 640` を追加。
- ナビ5個目の欠け: `layout.css` に `.nav-btn:first-child { grid-column: 1 / -1; }`（「セッション」が全幅・下2×2）。

### 完了条件

- `tsc`/`build` 通過。
- ユーザー確認: ①全画面の見た目が以前と同じ（特に ChatPanel・各モーダル・ライブラリ）②画像生成完了トーストが約6秒で自動で消える ③エラーと完了トーストが同時に出ると縦に並ぶ ④（Tauri時）ウィンドウを 960×640 未満に縮められない ⑤サイドバーのナビが「セッション全幅＋2×2」になっている。
- CLAUDE.md: ディレクトリ節に `src/styles/`（分割の趣旨1行）を追記。
- コミット例: `UI-0: デザイントークン拡充・CSS分割・トースト積層/自動消滅・窓最小サイズ`

---

## 4. UI-1 ダイアログ共通化・モーダル保護

**目的**: draft 無警告破棄の事故防止・Escape 対応・ネイティブ confirm/prompt の全廃。

**変更ファイル**: 新規4つ（§2 参照）＋モーダルを持つ全18ファイル＋`App.tsx`＋`cards.ts`。

### 4.1 `src/lib/modalStack.ts`（全文スケッチ）

```ts
import { useEffect, useRef } from 'react'

const stack: symbol[] = []

/** マウント中のレイヤーをスタックに積み、最前面のときだけ Escape で onEscape を呼ぶ */
export function useModalEscape(onEscape: () => void) {
  const cb = useRef(onEscape)
  cb.current = onEscape
  useEffect(() => {
    const id = Symbol()
    stack.push(id)
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === id) {
        e.preventDefault()
        cb.current()
      }
    }
    window.addEventListener('keydown', h)
    return () => {
      const i = stack.indexOf(id)
      if (i >= 0) stack.splice(i, 1)
      window.removeEventListener('keydown', h)
    }
  }, [])
}

export function modalStackSize() { return stack.length } // UI-4 の没入 Escape・UI-7 が使う
```

### 4.2 `src/lib/dialogs.ts` ＋ `DialogHost.tsx`

React 非依存の要求キュー（`cards.ts` からも呼べるように lib に置く）:

```ts
// dialogs.ts（API）
export function appConfirm(opts: string | { message: string; title?: string; okLabel?: string; danger?: boolean }): Promise<boolean>
export function appPrompt(opts: { message: string; title?: string; initial?: string; placeholder?: string }): Promise<string | null>
// 内部: モジュールレベルのキュー＋subscribe。DialogHost が購読して先頭1件を描画、
// OK/キャンセル/Escape/Enter で resolve してキューから除去。
```

- `DialogHost.tsx`: App.tsx のトーストより前に常駐マウント。先頭の要求だけを小さなモーダル（`.overlay`＋`.modal` 流用・max-width 420px）で描画。confirm は「キャンセル / OK（`danger` なら `.btn.danger` 風の赤主釦）」、prompt は input＋「キャンセル / OK」。**Enter=OK・Escape=キャンセル**（`useModalEscape` を使う→自動的に最前面優先）。prompt の input は autoFocus。
- confirm のキャンセル=false、prompt のキャンセル=null。

### 4.3 ネイティブ confirm/prompt の置換（16箇所）

すべて `await appConfirm(...)` / `await appPrompt(...)` に置換（呼び出し元ハンドラを async 化）:

| ファイル | 箇所 | 備考 |
|---|---|---|
| ChatPanel.tsx | 挿絵削除・セッション削除 | 削除系は `danger: true` |
| BranchTreeModal.tsx | ⏪復元・↩復元・🗑サブツリー削除・✂剪定（confirm 4）＋しおり名（prompt 1） | 既存の busyAction/try-catch 構造は不変 |
| DiscoveryPanel.tsx | 昇格 confirm ×2 | |
| GalleryModal.tsx | 挿絵削除・背景削除 | danger |
| WorldEditor / CharacterEditor / PersonaEditor / SceneTypeEditor | 各削除 confirm | danger |
| SettingsModal.tsx | エクスポート容量確認 | |
| cards.ts | `exportSessionCard` の 30MB 警告 | lib から `appConfirm` を import（React 不要なので可） |

### 4.4 `ModalShell.tsx` と全モーダルの移行

```tsx
interface Props {
  title: string
  onClose: () => void        // 破棄確認を通過した後に呼ばれる素の close
  dirty?: boolean            // true なら閉じる前に破棄確認
  discardMessage?: string    // 既定「編集内容を破棄しますか？」
  wide?: boolean
  footer?: ReactNode
  children: ReactNode
}
// requestClose = async () => { if (dirty && !(await appConfirm({ message: discardMessage, okLabel: '破棄', danger: true }))) return; onClose() }
// ・overlay の onClick は e.target === e.currentTarget のときだけ requestClose（modal 側の stopPropagation は不要になる）
// ・useModalEscape(requestClose)
// ・head: <h3>{title}</h3> ＋ ✕（requestClose）
```

**移行表（18ファイル）** — 中身（body/foot の JSX）は無変更で、シェルだけ ModalShell に差し替える:

| コンポーネント | dirty | dirty の判定 |
|---|---|---|
| SessionEditor / SceneEditor / CharacterEditor / WorldEditor / PersonaEditor / SceneTypeEditor | ✔ | `const [dirty, setDirty] = useState(false)` を追加し、draft を書き換える全ハンドラ（`patch` 等の共通入口）で `setDirty(true)`。保存ボタンは従来どおり `save()`→`onClose()`（dirty を経由しない） |
| StatusPanel / DiscoveryPanel | ✔ | 同上（draft `st`/`ov` の変更で dirty） |
| SceneReviewModal | ✔（常時） | レビューは生成コストがあるため `dirty={true}` 固定・`discardMessage="生成済みのレビューを破棄しますか？"`。onClose は既存の `cancelReview` |
| ModelPicker / StoryLogModal / GalleryModal / BranchTreeModal / ImageJobsPanel / SessionCardModal / SettingsModal / ImageGenModal | — | dirty なし。**ImageGenModal はジョブが閉じても継続する設計なので確認なしで正しい**（明文化しておく）。SettingsModal はその場 upsert 型なので対象外（localKeys の未保存は許容） |

補足: StatusPanel の見出し「📊 状態」のような絵文字入りタイトルは title 文字列としてそのまま渡してよい。

### 4.5 `ZoomOverlay.tsx`

`{ url: string; onClose: () => void }` を受け、`.overlay`＋`<img>`＋クリック/Escape で閉じるだけの共通部品。ChatPanel（挿絵拡大）・GalleryModal（2箇所）・ImageGenModal・ImageJobsPanel の zoom オーバーレイ5箇所を置換。

### 完了条件

- `tsc`/`build` 通過。`confirm(`・`prompt(`・`window.confirm` の grep ヒットが src 配下 0 件。
- ユーザー確認: ①SessionEditor で何か変更→オーバーレイをクリック→破棄確認が出る（変更なしなら即閉じ）②Escape で全モーダルが閉じる（重ねた場合は最前面から）③レビュー中のオーバーレイ誤クリックで破棄確認 ④削除確認・しおり名入力がアプリ内ダイアログになった ⑤ダイアログで Enter=OK・Escape=キャンセル。
- CLAUDE.md: 規約に「モーダルは `ModalShell` を使う／`confirm`・`prompt` 直呼び禁止（`appConfirm`/`appPrompt`）」を追記。
- コミット分割案: (1) modalStack＋dialogs＋confirm/prompt 置換 → (2) ModalShell＋ZoomOverlay 移行。

---

## 5. UI-2 ChatPanel の chrome 再編（トップバー＋コンポーザー）

**目的**: 絵文字11個→4要素・進行状態の一元化・コンポーザー積層の削減。**このフェーズから見た目が変わる。**

**変更ファイル**: 新規 `icons.tsx`・`MenuPopover.tsx`・`ActivityIndicator.tsx`、`ChatPanel.tsx`、`store.ts`（`isClassifyingEmotions`）、`layout.css`/`composer.css`。

### 5.1 `icons.tsx`

```tsx
// lucide (https://lucide.dev, ISC License) のパスデータを個別コピーして埋め込む方針（依存追加なし）。
// 各アイコンは https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/<name>.svg
// から <svg> の中身（path 等）をコピーする。取得できない場合は簡素な自作パスで代替してよい。
export type IconName = /* 下表の名前 */
export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {PATHS[name]}
    </svg>
  )
}
```

このフェーズで必要な割当（lucide 名）:

| 用途 | name（lucide） |
|---|---|
| ⋯メニュー | `more-horizontal` |
| あらすじ | `scroll-text` |
| 状態タブ | `bar-chart-3` |
| 発見タブ | `book-open` |
| ギャラリータブ | `image` |
| 分岐タブ | `git-branch` |
| ジョブタブ | `loader-2`（または `hourglass`） |
| 挿絵生成 | `palette` |
| 背景生成 | `mountain` |
| カード化 | `id-card`（無ければ `credit-card`） |
| ステージ表示 | `layers`（または `venetian-mask` 相当が無ければ layers） |
| 設定 | `settings` |
| 削除 | `trash-2` |
| 閉じる | `x` |
| シーン編集 | `pencil` |
| シーン終了 | `check` |
| 続ける／開始 | `fast-forward` ／ `play` |
| やり直す | `rotate-ccw` |
| 続きを生成 | `corner-down-right`（相当） |
| 選択肢再生成 | `refresh-cw` |

### 5.2 `MenuPopover.tsx`（汎用）

- 開いている間だけ条件レンダリングされる前提の部品: `{ onClose: () => void; align?: 'right' | 'left'; children: ReactNode }`。親要素（トリガーの包み）に `position: relative` を要求し、`position: absolute; top: calc(100% + 6px)` で表示。
- 閉じる契機: 外側クリック（`document` の mousedown で ref 外判定）＋ `useModalEscape(onClose)`（モーダルスタックに乗るので Escape 競合しない）。
- メニュー項目は `.menu-item`（icon＋label の横並びボタン・`danger` バリアント・チェック状態表示用の `check` アイコン枠）。CSS は `panels.css` に `.menu-pop / .menu-item` を追加（bg-elev2・border・radius・shadow は modal に準拠）。

### 5.3 トップバー新構成

左→右の順（既存の state 変数はそのまま流用）:

1. `session-title` input（現行のまま）
2. **シーンチップ** `.scene-chip`: `<Icon name="book-open"/> {scene.title}（timeLabel があれば ・{timeLabel}）` ＋ 既存 `token-badge`（シーントークン量。コンポーザーから移設）。クリックで SceneEditor を開く。scene が無いときは非表示。
3. **`<ActivityIndicator/>`**（§5.4）
4. **パネル群** `.topbar-group`: 状態・発見・ギャラリー・分岐・ジョブの5ボタン（`Icon`＋`title` 属性。ジョブは running/selecting 件数バッジを重ねる。**UI-3 でドックタブ化するまでは従来どおり各モーダルを開く**。ジョブ0件でもボタンは常設に変更＝押すと空のパネル）
5. **⋯メニュー**: 項目＝あらすじ / 挿絵を生成（scene 必須・disabled 制御は現行踏襲）/ 背景を生成（同）/ セッションをカード化 / ステージ表示（チェック項目・`spritesEnabled` トグル）/ セッション設定 / セッションを削除（danger・appConfirm）。
   - カード化: `SessionCardModal` を ChatPanel から直接開けるよう import＋state 追加（SessionEditor フッターの既存ボタンは残す）。
   - モデルチップ（モデル変更）はスペース都合で⋯メニューの上部に「モデル: <現在値>」項目として移す。**ただし現行の topbar 常設のままでも横幅が許せば可**（実装時にタイトル input が極端に狭くならない方を選ぶ。迷ったらメニューへ）。

削除する topbar 要素: 📜📊📖🖼🕘🎭🎨🏞⏳⚙🗑 の絵文字ボタン列（機能は上記 2〜5 に再配置済み）。

### 5.4 `ActivityIndicator.tsx`

- 購読: `isStreaming` / `isGeneratingChoices` / `isReviewing` / `imageJobs`（`status==='running'` の件数）/ `isClassifyingEmotions`（**store に boolean を新設**: 非永続・`classifyEmotions` の冒頭で true・finally で false）。
- 表示: すべて false なら null。1件なら `●（点滅ドット）＋ラベル`（例「本編を生成中」「選択肢を考え中」「レビュー作成中」「画像を生成中 (2)」「表情を判定中」）。複数なら最優先1件＋`+n`（優先順: 本編→レビュー→選択肢→画像→表情）。
- クリックで MenuPopover を開き、進行中の各行に中止ボタン: 本編=`stop` / 選択肢=`stopChoices` / レビュー=`stopReview` / 画像=各ジョブの `cancelImageJob`（表情判定は中止なし・表示のみ）。
- CSS `.activity`: `model-chip` に似たチップ。ドットは `.choices-loading::before` の点滅を流用。

### 5.5 コンポーザー再編

- **`.scene-bar` を削除**（CSS ごと。情報は topbar のシーンチップへ移設済み）。
- 新しい1行 `.composer-tools`（常時レンダリング・高さ固定で「画面が跳ねない」ことが目的）:
  - 左: story モードのプライマリ（未開始なら `▶ 物語をはじめる`、以降 `⏩ 続ける`。`.btn primary` 相当は既存 story-actions の primary スタイルを流用）。RP モードでは無し。
  - 続けて小さなアイコンボタン（条件付き・`Icon`＋title）: `↻ やり直す`（既存条件）/ `⤵ 続きを生成`（truncated 時）/ `🔁 選択肢を生成`（既存条件）。
  - 右端（spacer の後ろ）: `✎ シーン編集`（アイコン＋短ラベル）と `✓ このシーンを終える`（`.scene-btn.end` の見た目を継承。isReviewing 中の「◼ レビュー作成中…（中止）」文言切替も現行踏襲）。
- 既存の `story-actions` ブロック群（3箇所）と選択肢下の「🔁 選択肢を生成」ブロックは `.composer-tools` に統合して削除。
- speaker-row（話者選択）と choices は現行のまま（位置: composer-tools の上に choices、その上に speaker-row）。
- `.hint` は `session.messages.length === 0` のときだけ表示。

### 完了条件

- `tsc`/`build` 通過。
- ユーザー確認: ①トップバーが「タイトル/シーンチップ/（動作中のみ）インジケータ/パネル5ボタン/⋯」になっている ②⋯メニューから あらすじ・挿絵・背景・カード化・ステージON/OFF・設定・削除 すべてに到達できる ③本編生成中にインジケータが出て、クリック→中止できる（選択肢・レビュー・画像も同様）④シーン終了・シーン編集が入力欄の上の右端から使える ⑤トークンバッジが topbar のシーンチップ内に出る ⑥story モードで「続ける」だけが目立つ主ボタンになっている。
- CLAUDE.md: ChatPanel の記述（トップバー・シーンバー）を新構成に書き換え。`isClassifyingEmotions` を表情判定の節に追記。
- コミット分割案: (1) icons＋MenuPopover＋トップバー → (2) ActivityIndicator＋コンポーザー再編。

---

## 6. UI-3 コンテキストドック

**目的**: 「読みながら見る」5機能（状態・発見・ジョブ・分岐・ギャラリー）を右ドックに常駐化し、該当モーダルを削減する。

**変更ファイル**: 新規 `ContextDock.tsx`・`StatusView.tsx`・`DiscoveryView.tsx`、`ChatPanel.tsx`（構造変更）、`GalleryModal.tsx`/`BranchTreeModal.tsx`/`ImageJobsPanel.tsx`（Body 抽出）、`store.ts`（`ui`）、`types.ts`（`UiPrefs`）、`layout.css`（`.dock` ほか）。

### 6.1 store: `ui: UiPrefs` の導入

```ts
// types.ts
export type DockTab = 'status' | 'discovery' | 'gallery' | 'branch' | 'jobs'
export interface UiPrefs {
  dockTab: DockTab | null   // null = ドック閉
  // UI-4 で fontScale 等を拡張
}
export const DEFAULT_UI: UiPrefs = { dockTab: null }
```

- AppState に `ui: UiPrefs`（初期値 `DEFAULT_UI`）とアクション `setUiPrefs(patch: Partial<UiPrefs>)` を追加。
- partialize（store.ts の一覧・3100行付近）に `ui: st.ui,` を追加。
- **persist に custom `merge` を追加**（将来 UiPrefs にフィールドを足しても旧永続データで新フィールドが欠落しないように）:

```ts
merge: (persisted, current) => {
  const p = (persisted ?? {}) as Partial<AppState>
  return { ...current, ...p, ui: { ...current.ui, ...(p.ui ?? {}) } }
},
```

（既に merge オプションがある場合はそこに ui の深いマージを組み込む。）

### 6.2 ChatPanel の構造変更

```
<div class="main …">
  <div class="topbar">…</div>
  <div class="play-body">            ← 新設: display:flex; flex:1; min-height:0
    <div class="play-col">           ← 新設: flex:1; min-width:0; display:flex; flex-direction:column; position:relative
      {stageOn && <StageBackdrop …/>}   ← .main 直下から移設。CSS の top:56px を top:0 に変更
      <div class="chat-wrap">…</div>
      <div class="composer-wrap">…</div>
    </div>
    <ContextDock session={session} />
  </div>
</div>
```

- StageBackdrop の位置指定は play-col 基準（`inset: 0` 相当）になるため、**ドックには背景・立ち絵が重ならない**。`stage-on` のコンポーザー透過（V5d）は play-col 内で従来どおり機能する。
- CSS: `.stage-backdrop { top: 0; }` に変更（V5d の「top:56px（topbar の高さ）」コメントを更新）。

### 6.3 `ContextDock.tsx`

- `ui.dockTab` を購読。null なら**タブバーだけの細い縦列も出さない**＝完全非表示（開閉は topbar のパネル群から）。
- 構造: `.dock { width: 360px; border-left: 1px solid var(--border); background: var(--bg-elev); display: flex; flex-direction: column; min-height: 0; }`
  - `.dock-head`: タブ名見出し＋（状態/発見タブのみ）`✎ 編集` ボタン＋ `✕`（`setUiPrefs({dockTab:null})`）。
  - `.dock-body`: `flex:1; overflow-y:auto; padding: 14px;`
- topbar のパネル5ボタン（UI-2 で作成）を**ドックタブトグル**に変更: クリックで `setUiPrefs({dockTab: x})`、同じタブ再クリックで null。アクティブタブのボタンに `.on`。
- 中身:
  - **状態**: 新規 `StatusView`（**読み取り専用**）。world 未設定メッセージ／関係（キャラ名→stance・aspect ごとの記述・flags）／気分／グローバル・キャラ別 stats と counters の現在値／解除済み実績。データ取得は StatusPanel と同じ経路（`session.state`・`worlds`）。編集は `.dock-head` の `✎ 編集` → 既存 StatusPanel モーダル（showStatus state は残す）。
  - **発見**: 新規 `DiscoveryView`（読み取り専用）。overlay.lore（無効は淡色表示）・characterDevelopments を一覧。`✎ 編集` → 既存 DiscoveryPanel モーダル。
  - **ジョブ**: `ImageJobsPanel` の modal-body 中身を `export function ImageJobsBody()` に抽出してドックに描画（採用・破棄・キャンセル・zoom すべて動く＝アクション型なのでそのまま）。**モーダル版 ImageJobsPanel は廃止**（ChatPanel の showImageJobs state・render を削除）。
  - **分岐**（2コミット目）: `BranchTreeModal` から `export function BranchTreeBody({ session })` を抽出（ツリー/しおりタブ・復元・削除・剪定・busyAction ロジックは無変更。appConfirm/appPrompt は UI-1 で置換済み）。**モーダル版廃止**。
  - **ギャラリー**（2コミット目）: `GalleryModal` から `GalleryBody` 抽出（thumb グリッドは 360px 幅で2列に自然に落ちる）。zoom は ZoomOverlay のまま。**モーダル版廃止**。
- 廃止に伴い ChatPanel の `showGallery`/`showBranchTree`/`showImageJobs` state と該当 import を削除（`showStatus`/`showDiscovery` は ✎ 編集用に残す）。

### 完了条件

- `tsc`/`build` 通過。
- ユーザー確認: ①本文を読みながら状態タブを開いたままにできる（本文のスクロール・入力が普通に効く）②タブ切替が再起動後も記憶されている ③ジョブの採用・破棄・中止がドックから動く ④分岐の復元・削除・しおりがドックから動く（確認ダイアログも出る）⑤ギャラリーの保存・削除・拡大がドックから動く ⑥ステージ背景・立ち絵がドックの下に重ならない ⑦状態・発見の「✎ 編集」で従来の編集モーダルが開き、保存が反映される。
- CLAUDE.md: データモデルに `UiPrefs`/`ui`、ChatPanel/StageBackdrop の配置記述更新、GalleryModal/BranchTreeModal/ImageJobsPanel の「ドック Body 化」を反映。
- コミット分割案: (1) ui slice＋play-body 構造＋状態/発見/ジョブ → (2) 分岐/ギャラリー移設＋モーダル版廃止。

---

## 7. UI-4 リーダー設定＋没入モード

**目的**: 本文の読書体験を可変に。chrome を退避する没入モード。

**変更ファイル**: `types.ts`/`store.ts`（UiPrefs 拡張）、新規 `ReaderSettings.tsx`、`App.tsx`（CSS 変数適用・immersive クラス・Escape/Ctrl+.）、`ChatPanel.tsx`（Aa ボタン・top-hover）、`chat.css`/`layout.css`。

### 7.1 UiPrefs 拡張

```ts
export interface UiPrefs {
  dockTab: DockTab | null
  fontScale: 's' | 'm' | 'l' | 'xl'          // 既定 'm'（=現行見た目）
  lineHeight: 'compact' | 'normal' | 'wide'  // 既定 'normal'
  contentWidth: 'narrow' | 'normal' | 'wide' // 既定 'normal'
  dialogueTint: boolean                      // 既定 true（セリフ色分け）
  stageBgOpacity: number                     // 0〜0.6 / 既定 0.25
  stageSpriteOpacity: number                 // 0〜0.9 / 既定 0.5
  immersive: boolean                         // 既定 false
}
```

対応表（App.tsx の `useEffect` で `document.documentElement.style.setProperty`）:

| pref | CSS 変数 | 値 |
|---|---|---|
| fontScale | `--font-size-prose` | s=14px / m=15.5px / l=17px / xl=18.5px |
| lineHeight | `--line-height-prose` | compact=1.7 / normal=1.9 / wide=2.1 |
| contentWidth | `--content-width` | narrow=660px / normal=760px / wide=900px |
| dialogueTint | `--dialogue` | true=#cfe3ff（tokens の既定値） / false=`var(--text)` |
| stageBgOpacity / stageSpriteOpacity | `--stage-bg-opacity` / `--stage-sprite-opacity` | スライダー値そのまま |

- chat 形式にも効かせるため `chat.css` に追加: `.bubble .content, .st-narration { font-size: var(--font-size-prose); line-height: var(--line-height-prose); }`（既定 m で従来比 +0.5px になるが、リーダー設定導入と同時の意図した統一として許容）。

### 7.2 `ReaderSettings.tsx`（Aa ポップオーバー）

- topbar の⋯メニューの左に `Aa` ボタン（テキストでよい）→ MenuPopover 内に:
  - 文字サイズ（seg: S/M/L/XL）・行間（seg: 狭/標準/広）・本文幅（seg: 狭/標準/広）・「セリフを色分け」チェック
  - ステージ: 「背景・立ち絵を表示」チェック（`session.spritesEnabled` トグル。**⋯メニューからはこの項目を削除**しこちらへ移設）・背景の濃さ slider（0〜0.6, step 0.05）・立ち絵の濃さ slider（0〜0.9, step 0.05）
  - 「⛶ 没入モード」トグル（`Ctrl+.` の表記を添える）
- すべて `setUiPrefs` で即時反映（保存ボタンなし）。

### 7.3 没入モード

- App.tsx: ルート `<div className={'app' + (ui.immersive ? ' immersive' : '')}>`。
- CSS（layout.css）:

```css
.app.immersive { grid-template-columns: 0 1fr; }
.immersive .sidebar { display: none; }
.immersive .dock { display: none; }
/* topbar はホバーで降りてくる */
.immersive .top-hover { position: absolute; top: 0; left: 0; right: 0; height: 12px; z-index: 21; }
.immersive .topbar { position: absolute; top: 0; left: 0; right: 0; z-index: 20;
  transform: translateY(-100%); transition: transform 0.18s ease; }
.immersive .top-hover:hover ~ .topbar, .immersive .topbar:hover,
.immersive .topbar:focus-within { transform: none; }
```

- ChatPanel: `.main` 直下・topbar の**前**に `{ui.immersive && <div className="top-hover" />}` を挿入（`~` セレクタのため兄弟順が必須）。topbar が absolute になると `.play-body` が最上部から始まる＝没入時は本文が全高になる（StageBackdrop は play-col 基準なので追加調整不要）。
- キーボード（App.tsx に単一 `keydown` リスナ）: `Ctrl+.` で `setUiPrefs({immersive: !ui.immersive})`。`Escape` は **`modalStackSize() === 0` かつ immersive のとき**のみ解除（モーダルの Escape と衝突させない）。
- 没入はステージ濃度を自動変更しない（濃度はスライダーに一任。親ドキュメント §4.7 からの簡素化）。

### 完了条件

- `tsc`/`build` 通過。
- ユーザー確認: ①Aa から文字サイズ・行間・本文幅の変更が novel/chat 両文体で即反映 ②セリフ色分け OFF が効く ③背景・立ち絵の濃度スライダーが即反映 ④没入トグルでサイドバー・ドックが消え、上端ホバーで topbar が降りてくる ⑤Escape（モーダルが開いていない時）と Ctrl+. で没入解除 ⑥再起動後も設定が維持される ⑦ステージ表示トグルが Aa 内に移動している。
- CLAUDE.md: UiPrefs のフィールド一覧・没入モード・Aa の場所を追記。⋯メニュー項目の変更を反映。
- コミット例: `UI-4: リーダー設定（文字サイズ/行間/幅/セリフ色/ステージ濃度）と没入モード`

---

## 8. UI-5 IA再編（レール・文脈サイドバー・検索・アーカイブ・System ページ）

**目的**: 素材とセッションの二層混線を解消し、一覧のスケーラビリティを確保。SettingsModal をページ化。

**変更ファイル**: 新規 `Rail.tsx`、`Sidebar.tsx`（全面改修）、`App.tsx`、`store.ts`（View 拡張）、`types.ts`（`Session.archived?`）、`SettingsModal.tsx`（Body 抽出）、`ChatPanel.tsx`（⋯にアーカイブ項目）、`layout.css`。

### 8.1 View と領域

- `export type View = 'sessions' | 'characters' | 'worlds' | 'personas' | 'sceneTypes' | 'system'` に拡張。
- 領域導出（store.ts に export）: `areaOf(view)` → `'play' | 'library' | 'system'`（sessions→play / system→system / それ以外→library）。

### 8.2 `Rail.tsx` と App グリッド

- `.app { grid-template-columns: 48px 240px 1fr; }`。System 表示中はサイドバー列を潰す: `.app.no-side { grid-template-columns: 48px 1fr; }`（App.tsx で `view==='system'` のとき付与）。没入時は `.app.immersive { grid-template-columns: 0 0 1fr; }` に**更新**（UI-4 の定義を上書き）。
- Rail: 縦 48px・上から Play（`message-circle`）/ Library（`library-big`）/ System（`settings`）。`Icon` size 20・`title` 付き・active は `.on`。クリック: Play→`setView('sessions')`、Library→**直前の素材ビュー**（ローカル state で記憶。初期 'characters'）、System→`setView('system')`。
- Sidebar の brand 行は維持（第2列の頭）。`sidebar-foot` の「⚙ 設定・データ管理」は**削除**（rail に移行。`onOpenSettings` prop も廃止）。

### 8.3 文脈サイドバー

- **Play**（view==='sessions'）: 検索 input（`.model-search` 流用）→「＋ロールプレイ／＋物語」→ セッション一覧 → 下部「アーカイブ済み (n) を表示」トグル。
  - 検索: タイトル＋参加キャラ名の部分一致（小文字化して includes）。
  - 一覧はアーカイブ除外が既定。トグル ON で archived も表示（`.session-item` に淡色スタイル）。
- **Library**（characters/worlds/personas/sceneTypes）: セッション一覧の代わりに素材4種の縦ナビ（icon＋label・active 表示）。一覧本体は従来どおり main の各 Library ページ。新規ボタン群はライブラリページ側（既存の library-head「＋新規」）に任せる。
- **System**: 第2列なし（8.2 の `.app.no-side`）。

### 8.4 アーカイブ

- `types.ts`: `Session.archived?: boolean`。
- ChatPanel ⋯メニューに「アーカイブする／アーカイブから戻す」（`updateSession(id, {archived: !s.archived})`）。
- `restoreCheckpoint` の **passthrough リストに `archived` を追加**（本文・進行と非結合＝現在値維持。CLAUDE.md の passthrough 注意書きに従った判定）。
- exportBundle / importBundle / セッションカードは sessions に内包されるため変更不要（何もしないことを確認する）。
- 各 Library の library-head に検索 input（名前＋タグの部分一致）。該当0件時は「見つかりません」表示。

### 8.5 System ページ

- `SettingsModal.tsx` の modal-body の中身＋notice を `export function SettingsBody()` に抽出（プロバイダ管理・ImageProviderSettings・バックアップ・GC。ロジック無変更）。
- App.tsx: `view === 'system'` で `<div className="library"><div className="library-head"><h2>設定・データ管理</h2></div><SettingsBody /></div>` を表示。**SettingsModal の render と showSettings state を App から削除**（コンポーネントファイルは SettingsBody の置き場として残してよい）。
- 初回誘導: `!hasApiKey` の自動オープンは `setView('system')` に置換。ホーム空状態の文言「左下の設定から…」→「左のレール最下段 ⚙ から…」に更新。

### 完了条件

- `tsc`/`build` 通過。
- ユーザー確認: ①レールで Play/Library/System を行き来できる（Ctrl+1/2/3 は UI-7）②Library 表示中にセッション一覧が出ない ③セッション検索が効く ④アーカイブ→一覧から消え、トグルで再表示・復帰できる ⑤アーカイブ状態が分岐の復元で巻き戻らない ⑥設定がページとして開き、プロバイダ編集・エクスポート・インポート・GC が従来どおり動く ⑦APIキー未設定の初回起動で System ページが開く。
- CLAUDE.md: View の値・`Session.archived?`・passthrough リスト・Sidebar/Rail 構成・SettingsModal→SettingsBody を反映。
- コミット分割案: (1) Rail＋View 拡張＋文脈サイドバー → (2) 検索＋アーカイブ → (3) System ページ化。

---

## 9. UI-6 フォーム再設計

**目的**: SessionEditor の1本長スクロール解消・WorldEditor のモーダル卒業。

### 9.1 SessionEditor の4タブ化

- modal-body 先頭に `.seg`（既存クラス）でタブ: **基本 / 進行 / モデル / 出力**。ローカル state `tab`。draft `d`・save ロジック（liveScenes マージ含む）・フッター（カード化・保存）は**無変更**。
- フィールド配置（既存フィールドを漏れなく移す。表に無いものが見つかったら趣旨が最も近いタブへ）:

| タブ | フィールド |
|---|---|
| 基本 | タイトル / 参加キャラ（＋chat 群像時のキャラ別モデル注記）/ 世界観 / ペルソナ / 固定メモ（authorNote）/ 物語の前提（story。story モード時） |
| 進行 | タイムライン設定一式 / 選択肢モード（choiceMode）/ ディレクター（enabled＋シーンタイプ選択） |
| モデル | 一括モデル設定（bulk）/ レビュー用モデル / 選択肢用モデル / temperature / 最大トークン |
| 出力 | 文体スタイル（narrativeStyle）/ 構造化出力トグル |

### 9.2 WorldEditor のフルページ化

- `WorldLibrary.tsx`: `editing` 状態のとき card-grid の代わりに `WorldEditorPage`（WorldEditor.tsx を改修）を main 全面に描画（モーダル廃止・ルーター不要）。カード D&D は一覧表示時のみ有効で従来どおり。
- ページ構成:
  - `.page-head`: `← 戻る`（**dirty なら appConfirm で破棄確認**）・ワールド名（h2）・右端に「🖼 カードとして保存」「保存」。
  - 本体2カラム: 左 `.section-nav`（sticky・縦ボタン7つ: 基本 / ロア / 特別イベント / 関係性の次元 / ステータス / カウンター / 実績）＋右コンテンツ（選択セクションのみ表示）。
  - 既存フォーム JSX・ClauseRow・プリセット投入はロジック無変更でセクションへ再配置。
  - 素材共有の注記（C2 で追加した「分岐を戻しても素材は巻き戻らない」）はページ冒頭に維持。
- draft＋保存ボタン方式・`upsertCharacter` 同様の sprites 型の罠は World には無いが、**保存時に live 状態とマージすべきフィールドが無いか既存 save 実装を確認してから移植**する（現行 save のロジックを変えない）。

### 完了条件

- `tsc`/`build` 通過。
- ユーザー確認: ①セッション設定が4タブで開き、全項目が従来どおり保存される（タブを跨いだ変更も1回の保存で反映）②WorldEditor がページで開き、7セクションの編集・保存・カード保存・削除が動く ③「← 戻る」で未保存変更の破棄確認 ④ロア・実績・条件ビルダーの挙動が従来どおり。
- CLAUDE.md: SessionEditor（タブ構成）・WorldEditor（フルページ）・WorldLibrary の記述更新。
- コミット分割案: (1) SessionEditor タブ化 → (2) WorldEditor ページ化。

---

## 10. UI-7 仕上げ（ショートカット・コマンドパレット・SVG一掃）

### 10.1 `src/lib/shortcuts.ts`

- App.tsx から1回だけ登録する単一 `keydown` リスナ。判定規則: ①`e.isComposing` は無視 ②input/textarea/select にフォーカス中は **Ctrl 系のみ**許可 ③`modalStackSize() > 0` の間は Escape 以外無効。
- 割当:

| キー | 動作 |
|---|---|
| `Ctrl+K` | コマンドパレット開閉 |
| `Ctrl+1` / `Ctrl+2` / `Ctrl+3` | Play / Library / System |
| `Ctrl+G` | story モードのアクティブセッションで「続ける」（RP では何もしない） |
| `Ctrl+.` | 没入モード（UI-4 の実装をこちらへ移管） |

### 10.2 `CommandPalette.tsx`

- `Ctrl+K` → overlay（上から 15%・幅 560px）・検索 input＋結果リスト・`↑↓` 選択・`Enter` 実行・`useModalEscape` で閉じ。
- データ源（単純 `includes` マッチ・小文字化）:
  - セッション（タイトル）→ `setActive`＋Play へ
  - 素材（キャラ/世界/ペルソナ/演出の名前）→ 該当 Library ビューへ（エディタ直開きはしない）
  - 固定コマンド: 続ける / このシーンを終える / 挿絵を生成 / 背景を生成 / あらすじ / 状態・発見・ギャラリー・分岐・ジョブの各タブ / 没入モード / リーダー設定 / 設定（System） — セッション文脈が必要なものはアクティブセッションが無ければ非表示。
- 実行はすべて既存 store アクション／既存 UI state の呼び出しに限定（新ロジックを書かない）。ChatPanel 内 state（showLog 等）が必要なコマンドは、`ui` に依頼フラグを足すのではなく、**パレットから直接 store アクション＋`setUiPrefs` で表現できるものだけに絞ってよい**（挿絵・背景・あらすじが難しければコマンドから除外し、その旨を完了報告に書く）。

### 10.3 SVG アイコン一掃

- 置換対象（機能ボタン）: msg-actions（✎↻🗑）・scene-summary-regen（🔄）・illustration-actions（⬇🗑）・モーダルの ✕・ライブラリの＋新規/カード保存（🖼）・Sidebar ナビ（💬🎭🌍🙂🎬）・SettingsBody 内の操作ボタン（🔄⬇⬆🧹）・BranchTreeBody（↩⏪🗑✂☆★）・ジョブ（✔🗑◼）等。
- 残す絵文字: トースト（🏆🖼）・セッション種別バッジ・EMOTIONS ラベル・シーン見出しの 📖・speaker の 🎲・空状態の文言内など「意味・彩り」のもの。
- ライトテーマは**やらない**（A4）。

### 完了条件

- `tsc`/`build` 通過。
- ユーザー確認: ①Ctrl+K→「続ける」等が実行できる・セッション名で移動できる ②Ctrl+1/2/3・Ctrl+G・Ctrl+. が効く（入力中は誤発火しない）③主要ボタンのアイコンが SVG になり、ホバー色が追従する（currentColor）。
- CLAUDE.md: ショートカット表・パレット・icons.tsx の対象/非対象規約を追記。
- コミット分割案: (1) shortcuts＋palette → (2) アイコン一掃。

---

## 11. フェーズ依存関係

```
UI-0（トークン/分割） → UI-1（dialogs/ModalShell） → UI-2（icons/MenuPopover/topbar/composer）
  → UI-3（ui slice/ドック。UI-2 のパネル群と UI-1 の appConfirm に依存）
  → UI-4（ReaderSettings。UI-3 の ui slice と UI-2 の topbar に依存）
  → UI-5（Rail/検索/アーカイブ/System。UI-1 の appConfirm に依存。UI-4 の immersive CSS を更新）
  → UI-6（フォーム。UI-1 の ModalShell/appConfirm に依存）
  → UI-7（shortcuts/palette/icon 一掃。全部に依存）
```

直列実施が前提（合意済み）。UI-5 と UI-6 は入替可能だが、immersive の grid 上書き（§8.2）にだけ注意。

## 12. スコープ外（今回やらないと決めたこと）

- **ライトテーマ**（A4 で不採用）
- **没入モードの自動発動**（A6 で不採用・手動のみ）
- **オンボーディング・ウィザード**（親ドキュメント §4.11。今回のフェーズには含めない。System ページ化＋空状態文言更新まで）
- メッセージ一覧の仮想スクロール／i18n／完全なフォーカストラップ（Escape と初期フォーカスのみ対応）
- モバイル・レスポンシブ対応

## 13. 実装順の運用メモ

- 各フェーズ着手時: 本書の該当節だけを読み直し、対象ファイルを Read してから編集する（本書のコードはスケッチであり、実ファイルの現状が正）。
- フェーズ完了時: `git commit` → `git push origin main`・CLAUDE.md 更新・完了報告に「ユーザー確認チェックリスト」を転記。
- フェーズ途中で本書と実装が食い違う事情が出たら、**本書を修正して同コミットに含める**（ドキュメントと実装の乖離を残さない）。
