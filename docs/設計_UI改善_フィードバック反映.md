# 設計 — UI改善 フィードバック反映（F0〜F5）

**ステータス: 実装用詳細設計（2026-07-10 作成・実装はこれから）**

UI-0〜UI-7（`設計_UI再設計_実装詳細.md`）実装後の**実使用フィードバック**と、それを受けた**全UIコードの再監査**（2026-07-10）の結果をまとめ、修正フェーズ F0〜F5 として設計する。実装の作法（1フェーズ=1コミット・完了報告にユーザー確認チェックリストを転記・CLAUDE.md 同時更新・迷ったら質問）と**共通不変条件**は `設計_UI再設計_実装詳細.md` §0〜§1 をそのまま引き継ぐ。

---

## 1. 問題インベントリ

### 1.1 報告された問題と診断

| # | 報告 | 診断（根本原因） | 対応 |
|---|---|---|---|
| R1 | 分岐ツリー: 続きが大量に表示され、現在地がわからない | `Chain` が現在ノードを**通り過ぎて**単独子を主線として描画し続ける（`children.length===1` で無条件続行）。復元後は「昔の続き」が現在の下に延々並ぶ | F1 |
| R2 | 分岐ツリー: どこで分岐しているか見えない。git 風の視覚化が欲しい | 「⑂ 別の分岐」折りたたみボタンだけで、幹・枝・現在地を示す視覚要素（ガイド線・ドット）が無い | F1 |
| R3 | 枝を選んで子の分岐を削除したい | **機能は実装済み**（`deleteBranchSubtree`＝各行の🗑）だが、行にアイコンが3つ常時並ぶ過密で発見できていない | F1 |
| R4 | 現在の枝以外を削除したい | **機能は実装済み**（`pruneToCurrentPath`＝「✂ この分岐だけ残す」）だが同上・文言も何が消えるか不明瞭 | F1 |
| R5 | 文字サイズ・行間・本文幅を数値で自由に設定したい | S/M/L/XL・狭/標準/広 の段階式（UiPrefs が文字列 union） | F2 |
| R6 | 濃さスライダーが枠からはみ出す | `.rs-row .range-row { max-width:150px }` に対し range input の固有幅(約129px)＋gap12＋数値44px が収まらず、flex の既定最小幅（min-width:auto）で縮まない | F0＋F2 |
| R7 | 没入モードで表示が崩れ、何の機能か不明 | **グリッド崩壊**: `.app.immersive { grid-template-columns: 0 0 1fr }` でレール・サイドバーを `display:none` にすると grid item が消え、唯一の子 `.main` が**幅0の第1カラム**に自動配置される（min-width:0 指定済みのため完全に潰れる）。加えて機能説明が無い | F0＋F2 |
| R8 | トップバーでタイトル編集できることがわかりづらい | 透明 input・hover 背景のみでアフォーダンス無し | F3 |
| R9 | 挿絵・背景生成は⋯メニューでなく入力欄付近に欲しい | UI-2 で⋯メニューへ集約した配置の失敗（生成は「進行しながら使う」操作だった） | F3 |
| R10 | セッション設定「出力」の構造化出力チェックが崩れ「構」1字だけ見える | `.field input { width:100% }` が **checkbox にも適用**され、チェックボックスがモーダル幅いっぱいに伸びてラベルを押し出し、modal の overflow で切れる | F0 |
| R11 | API設定が横に広がって見づらい・ボタンが右端すぎ | System ページの `.library` に **max-width が無い**（モーダル時代の 560px 制約が消えた）。全幅入力の右端に削除/保存ボタンが張り付く | F0 |
| R12 | バックアップのチェックボックス位置がおかしい | R10 と同根（`.field input { width:100% }`） | F0 |
| R13 | 「未使用画像を整理」が何をするのか不明 | ラベル「アバター画像の整理」・説明文が旧仕様（キャラ・ペルソナのみ言及）のまま | F0 |
| R14 | サイドバーのセッション右クリックメニューが欲しい | コンテキストメニュー未実装（クリック=開くのみ） | F3 |
| R15 | ＋ロールプレイ/＋物語で作成したら設定を自動で開いてほしい | `createSession` は作成・アクティブ化のみ | F3 |
| R16 | 発見ログの「関係性・気分・実績は状態タブへ」の文言不要 | DiscoveryView / DiscoveryPanel 双方に固定文言 | F4 |
| R17 | 発見ログ: キャラ区切りがわかりにくい。アイコン＋タブ式に。編集も世界観/キャラ別に分割 | 太字 label の縦積み・編集モーダルは全部入り1画面 | F4 |
| R18 | 全体が間延び。境界を越えた領域は面の色を少し変えるべき | 余白が大きめ（field 18px・modal-body 22px・library 28/32px 等）＋レールとサイドバーが同色（bg-elev）で面の階層が無い | F5 |
| R19 | 左上のアプリ名は不要。設定の奥でひっそりで十分 | sidebar-head に brand 常設 | F3 |

### 1.2 監査で追加発見した問題（未報告）

| # | 内容 | 対応 |
|---|---|---|
| A1 | `.field input { width:100% }` は R10/R12 以外の**全チェックボックス**に効く共通バグ（タイムライン・ディレクターは inline style で個別回避している） | F0 |
| A2 | コンポーザーの `.hint` 行が**常時表示**（UI-2 設計「メッセージ0件時のみ」から乖離）→ 常設1行ぶん間延び | F0 |
| A3 | 古い文言が2箇所: chat-hint「右上の ⚙ から…設定しましょう」／hint「設定は右上の ⚙ から」— ⚙ ボタンはもう存在しない（⋯メニュー内） | F0 |
| A4 | App 空状態の文言「左のレール**最下段** ⚙」と実際の Rail（上から3つ目）が不一致 | F0（Rail の設定を最下段へ移動） |
| A5 | 送信ボタンだけテキスト「↑」のまま（SVG 一掃漏れ） | F0 |
| A6 | 没入モードが Library/System ビューでも効き、ナビ（レール）ごと消えて戻り方がわからなくなる | F0（Play ビュー限定に） |
| A7 | `--dialogue` の ON 値が App.tsx にハードコード（tokens.css と二重管理） | F2 |
| A8 | 没入モードON直後、Aa ポップオーバーごとトップバーが消えて何が起きたかわからない（案内も無い） | F2（ON時にポップオーバーを閉じ＋案内トースト） |
| A9 | ドック幅固定 360px が分岐ツリー・ギャラリー（160pxサムネ2列でギリギリ）に手狭 | F1（ドック幅リサイズ） |
| A10 | 分岐行の「レビュー前に戻る」の意味が難解（scene ノードの親＝前シーン末尾へ復元） | F1（文言と配置を整理） |
| A11 | 分岐行に ☆・🗑・戻る ボタン＋バッジが常時並び1行が過密（発見性と可読性の両方を害する。R3/R4 の遠因） | F1（行アクションを⋯へ集約） |
| A12 | Rail がアイコンのみ（title 頼み）で、初見では Play/Library/System の区別がつかない | F5（9px ラベル追加） |
| A13 | モデル名がトップバーから消え、現在の本編モデルを一目で確認できない（⋯を開く必要） | スコープ外（§10。要望が出たら再検討） |

---

## 2. フェーズ構成と順序

```
F0 即効バグ修正（レイアウト崩れ・文言・小物）   ← 最優先・全部小粒
F1 分岐ツリー刷新＋ドック幅リサイズ            ← 最大の作り直し
F2 リーダー設定の数値化＋没入モード仕上げ
F3 動線改善（生成ボタン・タイトル・右クリック・新規→設定・ブランド）
F4 発見ログ再構成
F5 密度・コントラスト調整（デザインパス）
```

F0 を最初に行うこと（F2 が F0 の修正の上に建つ）。F1〜F5 は相互依存が薄く順序入替可。

---

## 3. F0 即効バグ修正

**目的**: 崩れ・誤案内を即座に直す。すべて小さく機械的。

**変更ファイル**: `panels.css`・`layout.css`・`App.tsx`・`ChatPanel.tsx`・`SettingsModal.tsx`・`Rail.tsx`

1. **没入モードのグリッド崩壊（R7/A6）**
   - `layout.css`: `.app.immersive { grid-template-columns: 0 0 1fr; }` → **`grid-template-columns: 1fr;`**（display:none のレール・サイドバーは grid item を生成しないため、唯一の `.main` が全幅の単一カラムに正しく置かれる）。
   - `App.tsx`: immersive クラスの付与を **Play ビュー限定**に: `(ui.immersive && view === 'sessions' ? ' immersive' : '')`。Library/System では通常表示（設定値は保持され、Play に戻ると効く）。
2. **チェックボックスの全幅化（R10/R12/A1）**
   - `panels.css` の `.field input, .field textarea, .field select { width:100% }` の直後に追加:
     ```css
     .field input[type='checkbox'],
     .field input[type='radio'] {
       width: auto;
     }
     ```
   - SessionEditor 出力タブ・SettingsBody バックアップの表示を確認（コード変更不要のはず。タイムライン等の inline `width:'auto'` は無害なので触らない）。
3. **range のはみ出し保険（R6 の応急処置）**
   - `panels.css`: `.range-row input[type='range']` に `min-width: 0;` を追加（flex で縮めるように。ReaderSettings の本修正は F2）。
4. **System ページの幅（R11）**
   - `App.tsx` の system ビューを内側コンテナで包む:
     ```tsx
     <div className="library">
       <div className="page-narrow">
         <div className="library-head"><h2>⚙ 設定・データ管理</h2></div>
         <SettingsBody />
       </div>
     </div>
     ```
   - `layout.css`: `.page-narrow { max-width: 720px; margin: 0 auto; }`
5. **「未使用画像を整理」の説明（R13）** — `SettingsModal.tsx` の該当 field を差し替え:
   - label: `未使用画像の整理`
   - desc: `どのキャラ・セッション・分岐チェックポイントからも参照されなくなった画像（アバター・立ち絵・挿絵・背景）をストレージから完全に削除し、容量を空けます。使用中の画像が消えることはありません。`
   - ボタン文言: `🧹 未使用画像を削除`（実行後の件数 notice は現行のまま）
6. **hint 行の表示条件（A2）** — `ChatPanel.tsx`: `.hint` を `session.messages.length === 0` のときだけ描画。
7. **古い文言（A3/A4）**
   - chat-hint: `右上の ⚙ から〜` → `右上の ⋯ メニュー →「セッション設定」から〜`
   - hint（RPモード）: `設定は右上の ⚙ から。` → `設定は右上の ⋯ メニューから。`
   - App 空状態: `左のレール最下段 ⚙ から〜` はそのまま生かし、**Rail 側を最下段に**（次項）。
8. **Rail の設定を最下段へ（A4）** — `Rail.tsx`: System ボタンの直前にスペーサ `<div style={{flex:1}} />` を挿入（`.rail` は flex-column なので margin-top:auto でも可）。Play/Library=上、設定=下の定位置に。
9. **送信ボタンのアイコン化（A5）** — `ChatPanel.tsx`: 送信ボタンの `↑` を `<Icon name="arrow-up" size={16} />` に（`arrow-up` は登録済み）。

**完了条件**: `tsc`/`build` 通過。ユーザー確認: ①没入モードONで本文が全幅表示され、上端ホバーでトップバーが降りる・Escで解除 ②Library/Systemでは没入が効かない ③セッション設定「出力」タブの構造化出力チェックが正常表示 ④System設定が中央720pxに収まり、バックアップのチェックボックスが正常 ⑤未使用画像整理の説明が具体的 ⑥入力欄下のヒントが会話開始後に消える ⑦Railの⚙が最下段。
コミット例: `F0: 没入グリッド崩壊・checkbox全幅化・System幅・文言などの即効修正`

---

## 4. F1 分岐ツリー刷新＋ドック幅リサイズ

**目的**: 「いまどこにいて、どこで分岐したか」が一目でわかる git ログ風の見た目に作り直し、既存の削除・剪定機能を発見可能にする（R1〜R4/A9〜A11）。

**変更ファイル**: `BranchTreeModal.tsx`（Body 全面書き換え）、`ContextDock.tsx`＋`layout.css`（リサイズ）、`types.ts`/`store.ts`（`ui.dockWidth`）、`panels.css`（`.bt-*` 新設・旧 `.branch-*` 置換）

### 4.1 表示モデル（再設計の核）

store API（`restoreCheckpoint`/`deleteBranchSubtree`/`pruneToCurrentPath`/`setBranchStar`/`removeBranchStar`）は**一切変更しない**。描画だけを作り直す。

1. **主線 = ルート→現在ノード（pathIds）のみ。** 現在ノードで必ず止める。※現行バグ（単独子で主線続行）の廃止。
2. 主線を **scene ノードで章に区切る**: scene ノード（および ルート）を「章見出し行」、続く action ノードを章の中身とする。**現在ノードを含む章だけ既定で展開**、他の章は「▸ 章タイトル（n手）」に畳む（クリックで開閉）。
3. **主線ノードに主線外の子がいる場合**、その行の直下に `⑂ 別の分岐 (n)` トグル行。展開すると、その子を先頭とするサブツリーを**同じ規則で再帰描画**（1レベルインデント＋左ガイド線）。
4. **現在ノードの子孫**（＝復元前に進めていた「この先」）は主線に続けず、現在行の直下の `▷ この先の展開 (n)` トグルに畳む（展開時は淡色表示）。
5. **現在行の強調**: 背景 `accent-soft`・太字・●ドット（accent）＋「▶ いまここ」バッジ。分岐タブを開いた時／currentId 変化時に `scrollIntoView({ block: 'center' })`。

### 4.2 行レイアウトとアクション整理

```
[ガイド列 18px] [ラベル（action の要約 / 📖 シーン名）]  [🕐時刻・サイズ(小・faint)]  [↩ ここに戻る] [⋯]
```

- **ガイド列**: 各行の `::before` で縦線（主線=accent 40%、サブツリー=border 色）、ノード位置に 7px ドット（current=accent・しおり=--star・通常=border）。CSS だけで実現（SVG 不要）。
- **「ここに戻る」**は非 current 行のみ・行 hover で表示（`opacity` 切替。過密解消）。
- **⋯メニュー**（`MenuPopover` 流用）に集約: `しおりを付ける／外す`・`このシーンの開始前に戻る`（scene 行のみ。旧「レビュー前に戻る」の改名）・`この分岐を削除（n件・サイズ）`（`subtreeNodes` で件数算出済みの文言を出す。現在パス上は disabled＋title「現在の分岐上のため削除できません」）。
- 行の常設アイコンボタン（☆・🗑）は廃止（⋯へ）。しおり付き行はドット色とラベル横の ★名前 で示す。

### 4.3 ヘッダ・凡例

- 既存 dock-toolbar（ツリー/しおり seg・合計件数）は維持し、**剪定ボタンを明確化**: `✂ 現在の分岐だけ残す（他 n 件を削除）`（pruneCount>0 のとき。danger。confirm 文言は現行のまま）。
- toolbar 直下に凡例1行（faint・11px）: `● いまここ ／ ⑂ 別の分岐 ／ ▷ この先`。

### 4.4 ドック幅リサイズ（A9）

- `UiPrefs` に `dockWidth: number` を追加（既定 360・clamp 300〜560）。`DEFAULT_UI` 更新。persist は既存の ui 深マージで自動対応。
- `ContextDock`: ルートを `<div className="dock" style={{ width: ui.dockWidth }}>` にし、左端に `.dock-resizer`（幅5px・`cursor: col-resize`）。mousedown で document に mousemove/mouseup リスナを張り、`clamp(300, 開始幅 + (開始X − e.clientX), 560)` をローカル state で追従、mouseup で `setUiPrefs({ dockWidth })`。ドラッグ中は `user-select: none` を body に付与。
- `layout.css`: `.dock-resizer { flex-shrink:0; width:5px; cursor:col-resize; } .dock-resizer:hover { background: var(--accent-soft); }`

### 4.5 実装順・注意

- `Chain`/`NodeRow` は捨てて `BtSection`（章）・`BtRow`（行）・`BtSubtree`（再帰）に書き直す。`childrenOf`/`currentPathIds`/`subtreeNodes`/`starredNodesOf`/`formatBytes` はそのまま流用。
- しおりタブ・busy 制御（生成中 disabled）・confirm 文言は現行を維持。
- 旧 `.branch-*` CSS は使用箇所が無くなったら削除（しおりタブの `.star-*` は残る）。

**完了条件**: ユーザー確認: ①開くと現在地が強調され自動スクロールで見える ②復元しても「昔の続き」は「▷ この先」に畳まれ、主線が現在で止まる ③分岐点に ⑂ が出て、展開すると枝がインデント＋ガイド線で見える ④行の⋯から「この分岐を削除」ができ、現在パス上では無効 ⑤「✂ 現在の分岐だけ残す（他n件を削除）」が見つけられ、動く ⑥ドック左端ドラッグで幅が変わり、再起動後も維持 ⑦しおりの付与/解除・しおりタブが従来どおり。
コミット分割案: (1) ツリー描画刷新 → (2) ドック幅リサイズ。

---

## 5. F2 リーダー設定の数値化＋没入モード仕上げ

**目的**: 文字サイズ・行間・本文幅をスライダー＋数値入力で自由に（R5）。ポップオーバーのはみ出しを根治（R6）。没入モードを「使える機能」に（R7 後半/A7/A8）。

**変更ファイル**: `types.ts`・`store.ts`・`App.tsx`・`ReaderSettings.tsx`・`panels.css`

### 5.1 UiPrefs の数値化

```ts
export interface UiPrefs {
  dockTab: DockTab | null
  dockWidth: number            // F1
  fontSize: number             // px。12〜22・step 0.5・既定 15.5（旧 fontScale を置換）
  lineHeight: number           // 1.4〜2.4・step 0.05・既定 1.9（旧 lineHeight(文字列) を置換）
  contentWidth: number         // px。560〜1200・step 20・既定 760（旧 contentWidth(文字列) を置換）
  dialogueTint: boolean
  stageBgOpacity: number       // 0〜0.6（既存のまま）
  stageSpriteOpacity: number   // 0〜0.9（既存のまま）
  immersive: boolean
}
```

- `types.ts` に **`normalizeUiPrefs(raw: unknown): UiPrefs`** を新設: 旧文字列値の変換（fontScale s/m/l/xl→14/15.5/17/18.5、旧 lineHeight compact/normal/wide→1.7/1.9/2.1、旧 contentWidth narrow/normal/wide→660/760/900）、数値の clamp、欠落キーの既定値補完を行う純関数。
- `store.ts` の persist `merge`: ui 統合部を `ui: normalizeUiPrefs({ ...current.ui, ...(p.ui ?? {}) })` に変更（既存ユーザーの段階設定を数値へ引き継ぐ）。
- `App.tsx`: `FONT_SIZE_MAP` 等の3定数を削除し、`--font-size-prose: ${ui.fontSize}px`・`--line-height-prose: String(ui.lineHeight)`・`--content-width: ${ui.contentWidth}px` を直接 set。
- **A7 修正**: `--dialogue` は ON 時 `root.removeProperty('--dialogue')`（tokens.css の既定に戻す）、OFF 時のみ `'var(--text)'` を set。

### 5.2 ReaderSettings の作り直し

- ポップオーバー幅を固定: `.reader-settings { width: 300px; }`（min-width をやめる）。
- 数値系4行（文字サイズ・行間・本文幅・背景/立ち絵の濃さ）は**2段構成**の共通部品 `RsSlider` を作る:
  ```
  ラベル                 [数値入力]
  [────────スライダー────────]
  ```
  - `.rs-field { display:flex; flex-direction:column; gap:4px; }`・`.rs-field-top { display:flex; justify-content:space-between; align-items:center; }`・`.rs-num { width:64px; text-align:right; padding:4px 6px; }`（`.field` 外なので width:100% は当たらない。bg-elev / border は入力欄標準に合わせる）
  - スライダーは `input[type=range]` 全幅（`width:100%; min-width:0`）。
  - 数値入力: `type="number"`・min/max/step は各定義に従い、onChange で clamp して `setUiPrefs`。
- 行構成: 文字サイズ(px)／行間／本文幅(px)／セリフを色分け(チェック)／—区切り—／背景・立ち絵を表示(チェック)／背景の濃さ／立ち絵の濃さ／—区切り—／没入モード(チェック)／`表示を既定に戻す`（`.link`。fontSize/lineHeight/contentWidth/dialogueTint/stage濃度2種を DEFAULT_UI へ）。
- **A8 修正**: 没入チェックを ON にしたら `setOpen(false)` でポップオーバーを閉じる。

### 5.3 没入モードの案内（何をする機能か伝える）

- store に非永続 `infoNotice: string | null` と `setInfoNotice(msg: string | null)` を追加。
- `setUiPrefs` 内で `immersive` が false→true に変わったら `infoNotice = '没入モード: 上端にマウスでバーを表示 / Esc で解除'` をセット（store 内で一元化。Ctrl+. でも Aa でも同じ案内が出る）。
- `App.tsx` のトーストスタックに `.toast.info`（`background: var(--bg-elev2); border:1px solid var(--border); color: var(--text)`）を追加し、`autoCloseMs: 4000` で表示。
- Aa 内チェックの文言を `没入モード（上端ホバーでバー / Esc解除）` に。

**完了条件**: ユーザー確認: ①文字サイズ・行間・本文幅がスライダーでも数値入力でも変えられ、novel/chat 両文体に即反映 ②濃さスライダーがポップオーバー内に収まる ③旧設定（S/M/L等）から数値へ引き継がれている ④没入ONで案内トーストが出て、ポップオーバーが閉じ、上端ホバー/Escが機能 ⑤「表示を既定に戻す」が効く ⑥再起動後も数値が維持。
コミット例: `F2: リーダー設定を数値化（スライダー+数値入力）・没入モード案内トースト`

---

## 6. F3 動線改善

**目的**: 画像生成をコンポーザー付近へ（R9）・タイトル編集のアフォーダンス（R8）・セッション右クリックメニュー（R14）・新規作成→設定自動オープン（R15）・ブランド表示の撤去（R19）。

**変更ファイル**: `ChatPanel.tsx`・`Sidebar.tsx`・`MenuPopover.tsx`・`store.ts`（createSession 返り値）・`App.tsx`・`SettingsModal.tsx`・`layout.css`

### 6.1 挿絵・背景生成をコンポーザーへ（R9）

- `.composer-tools` の右側グループ（「シーン編集」の左）にアイコンボタン2つを追加:
  ```tsx
  <button className="composer-tool-btn" disabled={!scene} title="この場面の挿絵を生成"
    onClick={() => setShowImageGen(true)}><Icon name="palette" size={14} /></button>
  <button className="composer-tool-btn" disabled={!scene} title="この場面の背景を生成"
    onClick={() => setShowBgGen(true)}><Icon name="mountain" size={14} /></button>
  ```
- ⋯メニューの「挿絵を生成／背景を生成」項目は**残す**（両導線）。

### 6.2 タイトル編集のアフォーダンス（R8）

- topbar のタイトルを wrapper で包む:
  ```tsx
  <div className="session-title-wrap">
    <input className="session-title" value={session.title}
      placeholder="無題（クリックで名前を編集）" … />
    <Icon name="pencil" size={13} className="title-pencil" />
  </div>
  ```
- CSS: `.session-title-wrap { position:relative; flex:1; min-width:0; display:flex; }`（input は width:100%）。`.title-pencil { position:absolute; right:10px; top:50%; transform:translateY(-50%); color:var(--text-faint); opacity:0; pointer-events:none; transition:0.12s; }`。`.session-title-wrap:hover .title-pencil { opacity:1 }`・`.session-title:focus + .title-pencil { opacity:0 }`（`.topbar .session-title` の flex:1 は wrap 側へ移す）。

### 6.3 セッションの右クリックメニュー（R14）

- `MenuPopover` に固定座標モードを追加: `position?: { x: number; y: number }`。指定時は `style={{ position:'fixed', left: position.x, top: Math.min(position.y, window.innerHeight - 260), right:'auto' }}` を適用（下端はみ出しの簡易 clamp。外側クリック/Escape で閉じる挙動は共通）。
- `Sidebar.tsx`:
  - state: `ctxMenu: { id: string; x: number; y: number } | null`・`editingId: string | null`・`cardId: string | null`
  - `.session-item` に `onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ id: s.id, x: e.clientX, y: e.clientY }) }}`
  - メニュー項目: `開く`（setActive）／`セッション設定`（setEditingId）／`セッションをカード化`（setCardId）／`アーカイブする／戻す`（updateSession）／`削除`（danger・appConfirm→deleteSession）
  - 描画: `{editingId && session見つかれば <SessionEditor session={…} onClose={() => setEditingId(null)} />}`・`{cardId && <SessionCardModal … />}`（session は毎レンダー `sessions.find` で live 参照）
- ⋯メニュー（ChatPanel）は現状維持（両導線）。

### 6.4 新規作成→設定を自動で開く（R15）

- `store.ts`: `createSession` の戻り値を `string`（新 session id）に変更（`return s.id`。既存呼び出しは戻り値未使用なので互換）。
- `Sidebar.tsx`: ＋ボタンで `const id = createSession(mode); setEditingId(id)`（6.3 の SessionEditor がそのまま開く）。
- `App.tsx` 空状態 CTA: `const [showNewEditor, setShowNewEditor] = useState(false)`。`createSession(mode); setShowNewEditor(true)` → `{showNewEditor && active && <SessionEditor session={active} onClose={() => setShowNewEditor(false)} />}`。

### 6.5 ブランド表示の撤去（R19）

- `Sidebar.tsx`: `.sidebar-head`（brand 行）を削除。Play では検索ボックスが先頭に来る（`.sidebar-search { padding: 14px 12px 0 }` に微調整）、Library では `.nav-vertical` が先頭。
- `SettingsModal.tsx`（SettingsBody）末尾に控えめな1行: `<p className="desc" style={{ marginTop: 32, textAlign: 'center' }}>AI Storytelling Studio</p>`。
- ウィンドウタイトル（tauri.conf.json）は変更しない。

**完了条件**: ユーザー確認: ①入力欄上の🎨/🏔ボタンから挿絵・背景生成が開く（シーン未開始時は無効） ②タイトルにホバーで鉛筆が見え、クリックで編集できると直感できる ③セッション右クリックでメニューが出て、設定・カード化・アーカイブ・削除が動く（画面下端でもはみ出さない） ④＋ロールプレイ/＋物語（サイドバー・空状態とも）で作成直後に設定モーダルが開く ⑤サイドバー左上のアプリ名が消え、System ページ最下部に控えめに表示。
コミット分割案: (1) 6.1＋6.2 → (2) 6.3〜6.5。

---

## 7. F4 発見ログ再構成

**目的**: 世界観/キャラごとのタブ切替＋アイコンで一目化（R17）、不要文言の削除（R16）、編集画面のスコープ分割（R17 後半）。

**変更ファイル**: `DiscoveryView.tsx`・`DiscoveryPanel.tsx`・`ContextDock.tsx`・`ChatPanel.tsx`

### 7.1 DiscoveryView（ドック・読み取り専用）

- 冒頭にタブチップ行（`.dock-chip-row`＋`pick-chip` 流用・件数付き）:
  - `🌍 世界観 (n)`（lore）＋ 発見設定を持つキャラごとに `[EntityAvatar] 名前 (n)`
  - state `selected: 'lore' | characterId`。既定は lore に発見があれば lore、無ければ最初のキャラ。
- 本文は選択タブの内容のみ表示（現行の lore 一覧 / キャラ developments 一覧の描画を流用）。
- 空状態文言はタブごと（例: `このキャラの発見はまだありません`）。全体空なら現行文言。
- 末尾の「関係性・気分・実績は『状態』タブをご覧ください。」を**削除**（R16）。

### 7.2 DiscoveryPanel（編集モーダル）のスコープ分割

- props に `scope: 'lore' | { characterId: string }` を追加（必須化）。
  - `'lore'`: タイトル `発見ロア（世界観）`・lore セクションのみ表示・draft も lore のみ保持。
  - `{characterId}`: タイトル `「名前」の発見設定`・そのキャラの developments のみ。
- **保存は live 起点のスコープ限定マージ**（SessionEditor と同じ規則。全置換だと編集中に進んだレビューの他スコープ追記を巻き戻すため）:
  ```ts
  const live = useStore.getState().sessions.find((x) => x.id === session.id)?.overlay ?? session.overlay
  // scope==='lore' → { ...live, lore: draftLore }
  // scope===char  → { ...live, characterDevelopments: live の該当 characterId エントリだけ draft に差し替え }
  ```
- 末尾の「📊 状態パネルをご覧ください」行を削除（R16）。昇格・削除・有効切替のロジックは不変。
- `ContextDock`: `onEditDiscovery` を `(scope) => void` に変更し、discovery タブの ✎ は**現在選択中のタブ**のスコープで開く（DiscoveryView の selected を ContextDock 側へ lift するか、DiscoveryView に `onEdit(scope)` を渡してタブ横に ✎ を置く。**推奨: dock-head の ✎ をやめ、DiscoveryView のタブ行右端に ✎ を置く**＝選択スコープと編集対象が視覚的に一致する）。
- `ChatPanel`: `showDiscovery: boolean` → `discoveryScope: DiscoveryScope | null` に変更して受け渡し。

**完了条件**: ユーザー確認: ①発見タブが「世界観／キャラ（アイコン付き）」のチップで切り替わる ②✎ で選択中スコープだけの編集画面が開き、保存で反映 ③編集中に別スコープへレビュー追記が起きても巻き戻らない（余裕があれば: 編集を開いたままシーンを終える→保存→両方残る） ④「状態タブをご覧ください」が消えている。
コミット例: `F4: 発見ログをタブ+アイコン化・編集をスコープ分割`

---

## 8. F5 密度・コントラスト調整（デザインパス）

**目的**: 「間延び」の解消（R18）。面の階層（レール<サイドバー<カード）を色で作り、余白を一段締める。数値は一括適用→ユーザー目視→微調整の前提。

**変更ファイル**: `tokens.css`・`layout.css`・`panels.css`・`chat.css`・`Rail.tsx`

### 8.1 面の階層（境界で色を変える）

- `tokens.css` に `--bg-rail: #0b0d12;` を追加（--bg より一段暗い）。
- `.rail { background: var(--bg-rail); }`（サイドバーと分離して見える）。
- `.dock { background: var(--bg); }`・`.dock-head { background: var(--bg-elev); }`（ドックの読み面を本文と同じ面に、ヘッダは chrome 色に）。
- サイドバー（bg-elev）・トップバー（bg-elev）・コンポーザー（bg-elev）・カード/入力（bg-elev2）は現状維持。→ 左から `rail(最暗) → sidebar(chrome) → 本文(--bg) → dock(--bg)` の階層が生まれる。

### 8.2 余白の一括締め（対象と新値）

| セレクタ | 現在 → 新値 |
|---|---|
| `.field { margin-bottom }` | 18px → 14px |
| `.field label { margin-bottom }` | 6px → 4px |
| `.field .desc { margin-bottom }` | 8px → 6px |
| `.modal-body { padding }` | 22px → 18px 20px |
| `.library { padding }` | 28px 32px → 22px 28px |
| `.dock-body { padding }` | 14px → 12px |
| `.session-item { padding }` | 10px 12px → 8px 10px |
| `.msg / .st-message { margin-bottom }` | 22px → 18px |
| `.prose-block { margin-bottom }` | 18px → 16px |
| `.new-buttons { padding }` | 12px 12px 4px → 10px 12px 2px |

（本文の行間・文字サイズは F2 のリーダー設定領分なので触らない。）

### 8.3 Rail のラベル（A12）

- `.rail-btn` を `width:40px; height:44px; display:flex; flex-direction:column; gap:2px; align-items:center; justify-content:center; font-size:9.5px;` に変更し、アイコン下に短ラベル: `プレイ`・`作る`・`設定`（Icon size 18 に縮小）。title 属性は維持。

**完了条件**: ユーザー確認: ①レールとサイドバーが色で区別でき、レールに文字ラベルが付く ②各画面の余白が締まって見える（気になる箇所があれば個別に指摘→微調整） ③ドックの本文面が背景と揃い、境界が自然。
コミット例: `F5: 面の階層（rail暗色化・dock読み面）・余白の一括締め・railラベル`

---

## 9. 実施順序・依存関係

```
F0（必須先行: F2 が没入修正・range 保険の上に建つ）
 └→ F1 / F2 / F3 / F4 / F5 は独立（推奨順: F1 → F2 → F3 → F4 → F5）
```

- F1 の `ui.dockWidth` と F2 の UiPrefs 数値化は同じ型を触る。**F1 を先に**やる場合、F2 の `normalizeUiPrefs` に dockWidth の clamp（300〜560・既定360）も含めること。
- 各フェーズとも `npx tsc --noEmit` → `npm run build` 必須。見た目確認はユーザー（完了報告にチェックリスト転記）。実装中に本書と食い違いが出たら、本書を修正して同コミットに含める。

## 10. スコープ外（今回やらないこと）

- **モデル名のトップバー常設復帰**（A13）: ⋯メニュー先頭の「モデル: 名前」で足りるとみて据え置き。不便なら次回。
- 完全な複数レーン git グラフ（SVG レーン描画）: 360〜560px のドックでは1主線＋展開式が可読性で勝る。
- メッセージ削除の confirm / undo（従来からの挙動のため。要望が出たら別途）。
- ドックの複数タブ同時表示・タブのポップアウト。
- オンボーディングウィザード（親ドキュメント §4.11。引き続き将来課題）。
