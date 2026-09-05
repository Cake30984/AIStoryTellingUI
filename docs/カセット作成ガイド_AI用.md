# ゲームカセット作成ガイド（AI 用プロンプト）

このファイルは **AI に「ゲームカセット」を JSON で自動生成させる**ための仕様書兼指示書です。
AI にカセットを作らせたいときは、この 1 ファイルをそのまま渡してください（アプリのソースコードを読ませる必要はありません）。

> **このファイルの保守規約**: `src/types.ts` の公開データ型（World / Character / Persona / Session / Cassette と
> その配下）を変更したら、**同じコミットでこのガイドも更新する**。ここが型より古くなると、
> AI は「書けるのに書かない項目」を作り、最悪の場合**撤去済みの書き方を出力して黙って壊れる**。

---

## 0. あなた（AI）へのゴール指示

あなたは「デリスト（Delusion Story）」というアプリ向けの **ゲームカセット** を 1 本、下記の JSON 形式で作ります。
ゲームカセットとは「**世界観 ＋ 登場キャラ ＋ 主人公（ペルソナ）＋ 開始状態のセッション**を 1 束にした、そのまま最初から遊べる配布データ」です。

出力は **1 つの JSON オブジェクト**（アプリの「データ取り込み（インポート）」にそのまま食わせられる ExportBundle）です。
説明文・コードブロックの外に散らさず、**完全な JSON をそのまま**出してください（画像は省略可＝後述）。

作るときの心得（詳細は後半）:

- **事実は数、判断は言葉**（この世界の根本ルール）。好感度・回数・レベル等の「数えられる事実」は `stats`/`counters` に、感情や関係の機微という「言葉で捉える判断」は `relationAspects`（prose）にする。**エンディングや実績の条件は必ず数/フラグで書く**（prose は条件に使えない）。
- キャラは薄いテンプレではなく、口調・価値観・秘密まで作り込む。`exampleDialogues`（セリフ例）と `greeting`（最初のひとこと）は口調再現の要。
- 導入文（`opening`）は「そのまま画面に掲載される最初の本文」。読者を一気に世界へ引き込む描写を書く。
- **出し惜しみを設計する。** この形式の面白さは「最初から全部見えていないこと」にある。条件付きで解禁されるロア（§3.1）・条件で発火する特別イベント（§3.2）・**条件を満たすまで登場しないキャラ**（§9.1）を必ず使う。
- ID の相互参照を必ず正しく結ぶ（後述の「ID 配線ルール」を厳守）。

---

## 1. 全体構造（トップレベル）

出力する JSON のいちばん外側は「ExportBundle」です。

```jsonc
{
  "type": "ai-storytelling-studio",   // 固定値。これが無いと取り込みが拒否される
  "version": 1,                        // 固定
  "exportedAt": 0,                     // 任意の数値（0 でよい）
  "worlds":     [ /* World を 1 つ */ ],
  "characters": [ /* Character を 1〜数体 */ ],
  "personas":   [ /* Persona を 1 つ（主人公）*/ ],
  "sessions":   [],                    // 空配列でよい（実体は cassettes[].session に入る）
  "cassettes":  [ /* Cassette を 1 つ */ ]
}
```

- `worlds`/`characters`/`personas` は **カセットが参照する素材**。取り込み時にライブラリへ登録される。
- `cassettes[0].session` が **開始状態のセッション本体**。ここが `worldId`/`characterIds`/`personaId` で上の素材を参照する。
- 取り込みは **id が既存と衝突しない要素だけ追加**される（同 id は無視）。id は分かりやすい安定文字列にする（例 `w_kohaku`, `c_soujiro`, `p_hero`）。
- `providers`（API キー）や `endingRecords` は入れない。`images` は基本省略（§10）。

---

## 2. ID 配線ルール（最重要・ここを間違えると動かない）

すべての id は自分で決めた文字列でよいが、**参照が一致していなければならない**。

| 参照元 | 参照先 | 必須 |
|---|---|---|
| `cassettes[0].session.worldId` | `worlds[0].id` | ✔ |
| `cassettes[0].session.characterIds[]` | 各 `characters[].id` | ✔ |
| `cassettes[0].session.personaId` | `personas[0].id` | ✔ |
| `cassettes[0].session.characterGates[].characterId` | `session.characterIds[]` の要素 | 登場条件を使うなら |
| `cassettes[0].session.roleAssignments[].roleId` | `worlds[0].roles[].id` | roles を使うなら |
| `cassettes[0].session.roleAssignments[].characterId` | `characters[].id` | 同上 |
| `cassettes[0].session.introBindings[].tag` | `startPreset.introTags[].tag` | 導入文で `@タグ` を使うなら ✔ |
| `cassettes[0].session.introBindings[].characterId` | `characters[].id` | `kind:"character"` のとき |
| 導入文 `opening` の `@タグ` | `startPreset.introTags[].tag` | 導入文で `@` を使うなら ✔ |
| すべての `condition` 内の `defId` | `stats[].id` / `counters[].id` / `achievements[].id` | 条件を書くなら ✔ |
| `condition` の `eventFired.eventId` | `scheduledEvents[].id` | その節を使うなら |
| `condition` の `group.roleId` | `roles[].id` | その節を使うなら |

また `cassettes[0].session.story.premise`/`genre`/`opening`/`openingTitle`/`initialDirective`/`introTags` は
`worlds[0].startPreset` の同名項目と **同じ内容にそろえる**（開始テンプレートと実セッションを一致させる）。
`session.authorNote` は `startPreset.authorNote`、`session.newCharacterPolicy` は `startPreset.newCharacterPolicy`、
`session.scenes[0].note` は `startPreset.openingSceneNote` と一致させる。
`session.timeline` も `startPreset.timeline` の定義（slots/totalDays/spanLabel/startDay/startSlot）と一致させる。

---

## 3. World（世界観・ゲームシステム定義）

`worlds[0]` に 1 つ。この世界の設定とゲームシステム（数・条件・エンディング）をすべて定義する。

```jsonc
{
  "id": "w_xxx",
  "name": "世界の名前",
  "description": "常に AI へ注入される世界観の概要（数文〜1段落）。舞台・トーン・基本ルール。",
  "entries":        [ /* LoreEntry: キーワード連動／条件解禁で注入される設定辞書（§3.1） */ ],
  "scheduledEvents":[ /* ScheduledEvent: 日付・時間帯・条件で自動発火する特別イベント（§3.2） */ ],
  "relationAspects":[ /* RelationAspectDef: 関係性を言葉で捉える「次元」（§3.3） */ ],
  "stats":          [ /* StatDef: 数の定義（§3.4） */ ],
  "counters":       [ /* CounterDef: 累計回数の定義（§3.5） */ ],
  "achievements":   [ /* AchievementDef: 条件成立で自動達成される実績（§3.6） */ ],
  "roles":          [ /* WorldRole: 配役枠（§3.7） */ ],
  "reviewGuidance": "レビュー指針（任意・§3.8）",
  "startPreset":    { /* WorldStartPreset: 開始テンプレート（§8） */ },
  "endings":        [ /* EndingDef: 到達条件つきの結末（§7） */ ],
  "createdAt": 0,
  "updatedAt": 0
}
```

### 3.1 LoreEntry（`entries[]`）— 設定辞書

```jsonc
{
  "id": "lore_xxx",
  "keys": ["トリガー語1", "トリガー語2"], // 直近の会話にこの語が出たとき注入。alwaysOn なら無視される
  "content": "その設定の説明本文",
  "alwaysOn": false,   // true なら常時注入（重要設定向け）
  "enabled": true,
  "order": 0,          // 小さいほど先に注入
  "condition": null    // 解禁条件（任意・下記）。付けないなら**キーごと省略する**（null は書かない）
}
```

**`alwaysOn: false` なら `keys` は 1 語以上必須。**
`keys` が空で `alwaysOn` も false の項目は、**どちらの経路にも乗らず永久に注入されない**（黙って死ぬ）。
キーワードは会話文に実際に現れる語にする（「王都」「アルカディア城」等の固有名詞が向く）。

**`condition`（解禁条件・任意）**——ここが「出し惜しみ」の主役。§4 の Condition をそのまま書く。

- 条件が未達のあいだ、その項目は **AI にまったく渡らない**（存在しないのと同じ）。
- **`alwaysOn: true` より条件のほうが強い**（`alwaysOn` でも条件未達なら渡らない）。
- 条件を満たすと、以後は通常どおり（`alwaysOn` または `keys` 一致で）注入され、プレイヤーに一度だけ通知が出る。

```jsonc
// 例: 「デート回数が3以上」になって初めて明かされる、この街の裏の顔
{
  "id": "lore_underside", "keys": ["夜の港", "倉庫街"], "alwaysOn": false, "enabled": true, "order": 5,
  "content": "夜の倉庫街は、昼の顔とは別の商いの場になる。……",
  "condition": { "all": [ { "kind": "counter", "defId": "cnt_date", "op": ">=", "value": 3 } ] }
}
```

- `addedInStory` は**書かない**（プレイ中にレビューが追加した項目の目印。作者が付けるものではない）。

### 3.2 ScheduledEvent（`scheduledEvents[]`）— 特別イベント

日付・時間帯・条件が揃うと、**次のシーンの方向性としてアプリが自動で差し込む**もの。物語の骨格になる。

```jsonc
{
  "id": "ev_xxx",
  "day": 2,               // タイムラインの何日目に起きるか（任意。省略＝日付を問わない）
  "slot": "夜",           // 起きる時間帯ラベル（任意。timeline.slots の値と一致させる。省略＝時間帯を問わない）
  "name": "嵐の夜の来客",
  "note": "次シーンの状況・方向性。ここに書いた内容が次のシーンの土台になる（2〜4文）。",
  "condition": null       // 発火条件（任意・§4）。付けないなら**キーごと省略する**
}
```

- `day`/`slot`/`condition` は **すべて AND**。`day` だけなら日付イベント、`condition` だけなら「条件が揃った次のシーンで起きる」イベントになる。
- 一度発火したイベントは消化済みになり、二度は起きない。
- `note` の中では `@ロール名` と `@相手` が使える（条件の `group` 節で当事者が決まっている場合、実名へ置換される）。
- **6〜12 個**用意すると、3 日間程度の物語でも密度が出る。

### 3.3 RelationAspectDef（`relationAspects[]`）— 関係の「次元」（言葉）

好感度メーターとは別。**数値化しない**、キャラが主人公をどう見ているかを prose で捉える軸。

```jsonc
{ "id": "asp_trust", "name": "信頼", "guidance": "相手の何を信じ何を疑うか、をレビューへ指示する一文" }
```

2〜4 個が目安（例: 信頼 / 恋愛 / 警戒 / 心の距離）。**条件には使えない**（判定は数と実績だけ）。

### 3.4 StatDef（`stats[]`）— 数の定義

```jsonc
{
  "id": "stat_favor",
  "name": "好感度",
  "scope": "character",  // "character"=キャラ別に1値 / "global"=世界で1値
  "default": 0,
  "min": 0, "max": 100,  // 任意（この範囲にクランプされる）
  "deltaMin": 1,         // 任意。レビュー1回で動かすときの変動幅の下限（絶対値）
  "deltaMax": 8,         // 任意。同上限。「平凡なシーンは下限寄り／決定的な場面は上限近く」の物差しになる
  "inject": false        // true なら現在値を本編プロンプトに注入。好感度メーターは通常 false（言葉で読ませる）
}
```

`deltaMin`/`deltaMax` は**指定を強く推奨**。無指定だとレビューが1シーンで大きく動かしすぎ、
エンディング条件が序盤で埋まってしまう。好感度なら `1〜8`、体力なら `5〜20` のような幅にする。

### 3.5 CounterDef（`counters[]`）— 累計回数

```jsonc
{
  "id": "cnt_date",
  "name": "デート回数",
  "scope": "global",     // "character"=キャラ別累計 / "global"=全体累計
  "note": "主人公が誰かと店の外へ二人で出かけ、実際にその時間を過ごしたシーンで1回",
  "amountMin": 1, "amountMax": 1,  // 任意。1回あたりの加算量の下限・上限
  "inject": true
}
```

単調増加（減らない）。エンディング/実績条件のしきい値に向く。

**`note` は必ず書く。** これは「どんな時に計上するか」の説明で、**そのままレビューへ渡る唯一の指示**。
特に「一度きりの不可逆な出来事」（告白した・秘密を知った）を条件に使うときは、
`note` に何をもって1回とするかを書き、`amountMax: 1` を付けること。これが無いと狙って当てられない。

### 3.6 AchievementDef（`achievements[]`）— 実績

```jsonc
{
  "id": "ach_first",
  "name": "はじめての一杯",
  "description": "実績の説明",
  "condition": { "all": [ { "kind": "counter", "defId": "cnt_cups", "op": ">=", "value": 1 } ] },
  "hidden": false         // true なら未達成のうちは名前・内容を ？？？ で隠す
}
```

`condition` は**必須**。実績は他の条件（ロアの解禁・イベント発火・エンディング）から
`{"kind":"achievement"}` 節で参照できるので、**物語の段階を表すマイルストーン**として使うと組み立てやすい。

### 3.7 WorldRole（`roles[]`）— 配役枠

「性格」ではなく「世界での立場・物語上の機能」を書く。**プロンプトの【配役】として注入される**。

```jsonc
{ "id": "role_master", "name": "マスター", "description": "閉店を決めた店の主。多くを語らない導き手。", "required": true }
```

- `required: true` の枠は配役されていないと開始できない → `session.roleAssignments` で必ず埋めること。
- 1つのロールに**複数人**を配役してよい（「常連」「乗員」のようなグループ枠）。同じキャラが複数ロールを兼ねてもよい。
- 条件の `group` 節（§4.2）はこのロール単位で書く。
- **導入文の `@タグ` 置換は roles ではなく `introTags` が担う**（§8.1）。混同しないこと。

### 3.8 reviewGuidance（任意）

シーン終了レビューへ毎回そのまま渡る、世界固定の状態変動方針。

```jsonc
"reviewGuidance": "体力は毎シーン必ず 5〜15 消耗させる。実績『祝福』の達成後は消耗を半分にする。"
```

条件つきの方針（「〜のときは」）も書ける。レビューは現在のステータス・カウンター・日付・本文の描写から判断する。

---

## 4. Condition（条件式）の書き方

`entries[].condition`（ロアの解禁）/ `scheduledEvents[].condition`（イベント発火）/
`achievements[].condition`（実績）/ `endings[].condition`（結末）/
`session.characterGates[].condition`（キャラの登場）に使う、**共通の条件式**。

**数・実績・イベント発火のみで書く。**（`relationAspects` の prose は再現性が無いため条件に使えない。）

```jsonc
{ "all": [ Clause, Clause, ... ] }   // すべて満たす
{ "any": [ Clause, ... ] }           // いずれか満たす
```

### 4.1 節（Clause）は 5 種類

```jsonc
{ "kind": "stat",        "defId": "stat_favor", "op": ">=", "value": 60 }
{ "kind": "stat",        "defId": "stat_favor", "characterId": "c_mio", "op": ">=", "value": 60 }
{ "kind": "counter",     "defId": "cnt_date",   "op": ">=", "value": 3 }
{ "kind": "achievement", "defId": "ach_first",  "have": true }
{ "kind": "eventFired",  "eventId": "ev_storm", "have": true }
{ "kind": "group",       "roleId": "role_regular", "quantifier": { "kind": "atLeast", "n": 2 },
                         "subject": true,
                         "clauses": [ { "kind": "stat", "defId": "stat_favor", "op": ">=", "value": 50 } ] }
```

- `op` は `>=` `>` `<=` `<` `==` `!=`。
- **`stat`/`counter` で `characterId` を省略すると「参加キャラの誰か1人が満たせば成立」**（存在条件）。特定キャラ限定にしたいときだけ `characterId` を付ける。
- **`eventFired`** — その特別イベントが発火済みか。**イベントの連鎖**（「あの事件のあとでしか起きないこと」）はこれで書く。物語を段階的に進める最も強い道具。
- 節が空の condition（`{"all": []}`）は **不成立**扱い。条件を付けないなら `condition` キーごと省略すること。

### 4.2 group 節（ロールへの定量条件）

`roles` のメンバー全員に同じ条件を課し、「何人が満たしたか」で判定する。

```jsonc
{
  "kind": "group",
  "roleId": "role_regular",
  "quantifier": { "kind": "all" },              // 全員
  // { "kind": "atLeast", "n": 2 }              // 2人以上
  // { "kind": "exactly", "n": 1 }              // ちょうど1人（当事者を1人に絞る）
  "subject": true,                              // このロールのメンバーを「結果の当事者」にする
  "clauses": [                                  // 各メンバーに課す条件（キャラ別の stat/counter のみ）
    { "kind": "stat", "defId": "stat_favor", "op": ">=", "value": 50 }
  ]
}
```

- `clauses` の中に書けるのは `stat` と `counter` だけで、**`scope: "character"` の定義に限る**（`characterId` は書かない＝各メンバーに対して評価される）。
- **`subject: true`** を付けると、条件を満たしたメンバーが「当事者」になり、
  イベントの `note`・エンディング名・`epilogueGuidance` の中の **`@ロール名`（そのロールの当事者名）**と
  **`@相手`（全当事者名）**が実名へ置換される。恋愛系の「相手が誰か」で分岐する結末はこれで書く。

### 4.3 使ってはいけない書き方

- **`{"kind": "relationFlag", ...}` は存在しない**（撤去済み）。書くと読み込み時に黙って削除され、その条件は成立しなくなる。「一度きりの出来事」は **`counter` を 1 回以上**（＋ `note` と `amountMax: 1`）で書くこと。
- prose（`relationAspects`）・自由文字列を条件にすることはできない。

---

## 5. Character（登場キャラ）

```jsonc
{
  "id": "c_xxx",
  "name": "キャラ名",
  "persona": "人格・性格・価値観・背景（作り込む。数文〜1段落）",
  "speechStyle": "口調・話し方の癖（一人称・語尾・敬語/タメ・口数など具体的に）",
  "appearance": "外見",
  "exampleDialogues": "セリフ例を改行区切りで数個。口調の few-shot になるので最重要のひとつ",
  "greeting": "登場時の最初のセリフ",
  "developments": [],           // 空配列（プレイ中に増える成長ログ。初期は空）
  "avatar": { "color": "#6f4e37" },  // imageId は付けない。色は 16進。名前イニシャル＋色で表示される
  "imagePrompt": "英語タグ列。挿絵生成用（例: 1girl, silver hair, ...）。任意だが付けると良い",
  "tags": ["属性", "役割"],
  "createdAt": 0, "updatedAt": 0
}
```

- `model` フィールドは付けない（環境依存のため）。
- 主要キャラは 3〜6 体が扱いやすい。各キャラに「隠している何か」「主人公との関係の初期値」を用意すると物語が動く。
- **後から登場させたいキャラもここに書く。** 登場のタイミングは `session.characterGates`（§9.1）で制御する。

---

## 6. Persona（`personas[]`）— プレイヤーが演じる主人公

```jsonc
{
  "id": "p_xxx",
  "name": "あなた",              // プレイヤーが上書き前提なら「あなた」等でよい
  "description": "主人公の立ち位置・境遇。名前や経歴はプレイヤーが自由に決められる旨も書いてよい",
  "avatar": { "color": "#e8a13d" },
  "imagePrompt": "英語タグ列（任意）",
  "createdAt": 0, "updatedAt": 0
}
```

---

## 7. EndingDef（`worlds[0].endings[]`）— 結末

配列の**並び順が優先度**（上が優先）。到達判定はアプリがコードで自動処理する。

```jsonc
{
  "id": "end_true",
  "name": "エンディング名",
  "description": "一覧・到達時に見せる説明（条件そのものは書かない＝ネタバレ防止）",
  "condition": { "all": [ ... ] },   // 到達条件（§4）。fallback:true のときは付けない
  "epilogueGuidance": "エピローグ生成への指示。結末のトーン・締め方を具体的に。到達後のみ AI に渡る",
  "auto": false,     // true=条件成立で強制突入（バッドエンド向け・「まだ続ける」を出さない）
  "hidden": false,   // true=未到達のうちは名前を ？？？ 表示
  "fallback": false  // true=期間満了時に条件成立エンディングが無ければ採用（ノーマル/ビターエンド）。1つ用意推奨
}
```

- 少なくとも「真エンド（条件付き）」＋「fallback エンド 1 つ」を用意すると綺麗に完結する。
- `condition` はプレイヤーの積み上げ（`stats`/`counters`/`achievements`/`eventFired`）で自然に届く値にする。
- **`description` はプレイヤーがゲーム開始時に読む「目標」になる。** 何を目指す物語なのかが伝わる一文にする（`hidden: true` にしたものは伏せられる）。

---

## 8. WorldStartPreset（`worlds[0].startPreset`）— 開始テンプレート

セッション開始時の初期本文・設定。`session` 側の同名項目と内容を一致させる（§2）。

```jsonc
{
  "genre": "ジャンル・トーン",
  "premise": "あらすじ・前提（毎回背景として注入される）",
  "opening": "導入本文（開始時に一度だけそのまま画面に掲載される最初のシーン。作り込む。§8.1）",
  "openingTitle": "導入シーンの見出し",
  "openingSceneNote": "開始シーンの状況メモ。時・場所と**その場に居る人物**を書く（例: 開店前の店内。主人公とマスターの二人だけ）",
  "initialDirective": "最初のシーンだけ効く、書き手 AI への非表示の方向づけ（例: 主人公にまず店の掃除をさせ、マスターの寡黙さを描く）",
  "newCharacterPolicy": "avoid",     // "allow"=未定義の人物を AI が新しく出してよい / "avoid"=出さない（モブは無名で描かせる）
  "authorNote": "常に記憶させたい固定メモ（任意・空文字可）",
  "introTags": [                     // 導入文の @タグ 定義（§8.1）
    { "id": "it_master", "tag": "マスター", "note": "店の主" },
    { "id": "it_hero",   "tag": "主人公",   "note": "プレイヤー" }
  ],
  "timeline": {
    "slots": ["朝", "昼", "夜"],  // 1日の区切り。世界に合わせて命名可（例: 開店前/モーニング/昼下がり/夕暮れ/閉店後）
    "totalDays": 3,               // 総日数。無制限なら null
    "spanLabel": "期間の呼称（例: 閉店までの三日間）",
    "startDay": 1,
    "startSlot": 0                // slots の先頭からなら 0
  }
}
```

- **`openingSceneNote` は必ず書く。** 2シーン目以降の状況メモはレビューが自動で書くが、
  1シーン目だけは書き手が居ない。「最初は誰と誰が居るのか」を作者が指定できる唯一の場所。
- `newCharacterPolicy` は、キャラの登場条件（§9.1）を使うなら **`"avoid"` を推奨**。
  `"allow"` のままだと、伏せておいたキャラの穴を AI が勝手な新キャラで埋めてしまう。

### 8.1 導入文（`opening`）の書式

- 地の文＋セリフで、映画の冒頭のように世界へ引き込む。
- **セリフは `@タグ「セリフ」` の1行1発話**で書く。行頭に `@`、続けて名前、そのまま鉤括弧。

```
　カウベルが鳴った。
@マスター「……いらっしゃい」
　十年ぶりの声だった。
@主人公「ただいま、って言っていいのかな」
```

- **`(感情)` のような括弧は付けない。** `@マスター(neutral)「…」` と書くと、`マスター(neutral)` という
  名前の人物として扱われ、正体不明の話者になってしまう。
- **`@` の後に書けるのは `introTags[].tag` で定義したタグだけ。**
  実キャラ名を直接書かない（素材は再利用されるので、実名を焼き込むと使い回せなくなる）。
  タグ→実キャラ/ペルソナの対応付けは `session.introBindings`（§9）が持つ。
  **定義していないタグを `@` で書くと、置換されずそのまま画面に出る。**
- 地の文には `@` を付けない。地の文の中に鉤括弧のセリフを埋め込まない（発話は必ず `@` 行に分ける）。
- 主人公（プレイヤー）を「きみ」「あなた」で二人称呼びすると没入しやすい。

---

## 9. Cassette と session（開始状態）

`cassettes[0]` は 1 本。`session` は「まだ 1 度も遊んでいない開始状態」でなければならない。

```jsonc
{
  "id": "cas_xxx",
  "title": "カセットの表題（キャッチコピー可。例: 純喫茶こはく ―― 閉店まで、あと三日）",
  "description": "棚・取り込み確認で見せる紹介文（1〜数文。惹きのあるあらすじ）",
  "createdAt": 0,
  "session": {
    "id": "sess_xxx",
    "title": "セッション名",
    "mode": "story",             // 物語モード。会話劇中心なら "roleplay"
    "model": "",                 // 空文字（受け手の既定モデルにフォールバック）
    "reviewModel": "",
    "choicesModel": "",
    "characterIds": ["c_a", "c_b", "c_c"],   // 参加キャラ（characters の id）。**後から登場する子も含める**
    "characterGates": [ /* 登場条件（§9.1）。無いなら空配列 */ ],
    "worldId": "w_xxx",
    "personaId": "p_xxx",
    "roleAssignments": [ { "roleId": "role_master", "characterId": "c_a" } ],
    "introBindings": [                        // 導入文の @タグ → 実キャラ/ペルソナ
      { "tag": "マスター", "kind": "character", "characterId": "c_a" },
      { "tag": "主人公",   "kind": "persona" }
    ],
    "authorNote": "",            // startPreset.authorNote と同じ
    "newCharacterPolicy": "avoid",  // startPreset.newCharacterPolicy と同じ
    "story": {
      "premise": "…",           // startPreset.premise と同じ
      "genre": "…",             // startPreset.genre と同じ
      "opening": "…",           // startPreset.opening と同じ
      "openingTitle": "…",      // startPreset.openingTitle と同じ
      "initialDirective": "…",  // startPreset.initialDirective と同じ
      "introTags": [ /* startPreset.introTags と同じ */ ]
    },
    "scenes": [
      { "id": "scene_1", "title": "シーン 1",
        "note": "…",             // startPreset.openingSceneNote と同じ
        "summary": "", "createdAt": 0 }
    ],
    "currentSceneId": "scene_1", // scenes[0].id と一致させる
    "timeline": {
      "enabled": true,
      "slots": ["…"], "totalDays": 3, "spanLabel": "…",
      "currentDay": 1, "currentSlot": 0, "startDay": 1, "startSlot": 0
    },
    "choiceMode": "auto",        // "off" | "always" | "auto"
    "narrativeStyle": "novel",   // "novel"=小説形式 / "chat"=会話劇
    "eventAutoFire": true,
    "usedEventIds": [],
    "state":   { "relations": [], "moods": [], "stats": [], "counters": [], "achievements": [] },
    "overlay": { "lore": [], "characterDevelopments": [] },
    "structuredOutput": true,    // 導入文で @タグ「…」 を使うなら true
    "messages": [],              // 必ず空（未プレイ）
    "temperature": 0.9,
    "maxTokens": 32768,
    "createdAt": 0, "updatedAt": 0
  }
}
```

**開始状態の鉄則**（ここを空にしないと「プレイ済み」データになる）:
`messages: []` / `scenes` は 1 シーンのみ / `state` と `overlay` は空 / `usedEventIds: []` /
`ending` は付けない / `revealedLoreIds`・`revealedCharacterIds` は付けない / `currentSceneId` は唯一のシーン id。

### 9.1 characterGates（キャラの登場条件）

**条件を満たすまで、そのキャラを AI に一切渡さない**——存在ごと伏せる仕組み。
ロアの解禁条件（§3.1）のキャラ版で、条件式は §4 と同じもの。

```jsonc
"characterGates": [
  {
    "characterId": "c_natsu",
    "condition": { "all": [ { "kind": "achievement", "defId": "ach_shop_story", "have": true } ] }
  }
]
```

- 条件が未達のあいだ、そのキャラは**本編・選択肢・レビュー・プレイヤーの画面のどこにも出ない**。
  AI はその人物を知らないので、勝手に登場させることができない。
- 条件を満たすと以後は普通に登場し、プレイヤーに一度だけ通知が出る（名前は出ない＝本編で自然に登場する）。
- `characterGates` に載っていないキャラは条件なし＝最初から登場する。
- **「終盤に現れる真の相手」「特定ルートでしか会えない人物」はこれで書く。**
  条件は実績（`achievement`）かイベント発火（`eventFired`）を使うと狙いどおりのタイミングで開く。
- 伏せたキャラを `roleAssignments` に配役してもよい（配役は作者の宣言、ゲートは登場のタイミング）。
- **「導入文にだけ出て、以降は出てこない人物」もこれで書ける。** 導入文の `@タグ` に伏せたキャラを
  割り当ててよい——導入文の置換と、既に書かれた本文の話者表示はゲートを見ないので、
  その人物は導入文では普通に喋り、以後はプロンプトから完全に消える。
  この使い方をするときは、条件に**到達しえない値**（例: 総日数を超えるカウンター）を入れるか、
  終盤にだけ戻ってくる値を入れる。どちらにするかは作者が決めること。

### 9.2 画像について

- 通常は **画像を同梱しない**（`avatar` は `color` のみ、トップレベル `images` も省略）。取り込み後にアプリ内で生成/設定できる。`imagePrompt` を各キャラ・ペルソナに入れておけば、あとから画像生成しやすい。
- どうしても画像を埋め込む場合のみトップレベルに
  `"images": [ { "id": "画像id", "mime": "image/png", "dataBase64": "..." } ]` を足し、
  参照側で `avatar.imageId` にその id を指す（base64 が巨大になるため非推奨）。

---

## 10. 取り込み手順（ユーザー向け・生成物の使い方）

1. 生成した JSON を `.json` ファイルとして保存する。
2. アプリ左端のレールから **「作る」→ 右上の「インポート」** でそのファイルを選ぶ
   （**「設定」→「データのバックアップ」→「インポート」**でも同じ）。
3. 世界観・キャラ・ペルソナがライブラリに、カセットが **「作る」→「カセット」** に追加される。
4. カセットの **「遊ぶ」** で新規セッションとして開始（何度でも最初から遊べる）。

---

## 11. 生成前チェックリスト（AI は出力前に自己確認）

構造:
- [ ] `type: "ai-storytelling-studio"` と `version: 1` がある
- [ ] `session.worldId` / `characterIds` / `personaId` が実在する素材 id を指している
- [ ] `session` が開始状態（messages 空・1 シーン・state/overlay 空・usedEventIds 空・ending 無し）
- [ ] `story` と `startPreset`、`timeline` 同士の内容が一致（premise/genre/opening/openingTitle/initialDirective/introTags/authorNote/newCharacterPolicy、`scenes[0].note` = `openingSceneNote`）

条件まわり:
- [ ] すべての `condition` の `defId` が `stats`/`counters`/`achievements` の id と一致
- [ ] `eventFired` の `eventId` が `scheduledEvents[].id`、`group` の `roleId` が `roles[].id` と一致
- [ ] **`relationFlag` を使っていない**（存在しない節）
- [ ] 条件を付けない項目では `condition` キーごと省略している（`{"all": []}` を書いていない）

出し惜しみ:
- [ ] `condition` 付きのロアが 3 件以上ある
- [ ] `scheduledEvents` が 6 件以上あり、うち 1 件以上が `eventFired` で連鎖している
- [ ] `characterGates` を使い、少なくとも 1 人は途中から登場する（そのとき `newCharacterPolicy: "avoid"`）
- [ ] エンディングに条件付き 1 つ以上＋`fallback:true` 1 つがある

導入文:
- [ ] `opening` の `@タグ` がすべて `startPreset.introTags[].tag` にあり、`session.introBindings` で対応付けられている
- [ ] `opening` の `@` 行に `(感情)` のような括弧を書いていない
- [ ] `openingSceneNote` に時・場所・その場に居る人物が書かれている

その他:
- [ ] `alwaysOn: false` のロアには `keys` が 1 語以上ある
- [ ] `stats` に `deltaMin`/`deltaMax`、`counters` に `note` が入っている
- [ ] avatar に imageId を付けていない（色のみ）／数値フィールドは数値・真偽値は boolean
- [ ] 出力は説明抜きの**完全な JSON 1 個**

---

## 付録: 最小スケルトン

まず骨組みを固め、そこから肉付けすると破綻しにくい。

```jsonc
{
  "type": "ai-storytelling-studio", "version": 1, "exportedAt": 0,
  "worlds": [{
    "id": "w1", "name": "", "description": "",
    "entries": [], "scheduledEvents": [], "relationAspects": [],
    "stats": [], "counters": [], "achievements": [], "roles": [], "reviewGuidance": "",
    "startPreset": { "genre": "", "premise": "", "opening": "", "openingTitle": "",
      "openingSceneNote": "", "initialDirective": "", "newCharacterPolicy": "avoid", "authorNote": "",
      "introTags": [],
      "timeline": { "slots": ["朝","昼","夜"], "totalDays": null, "spanLabel": "", "startDay": 1, "startSlot": 0 } },
    "endings": [], "createdAt": 0, "updatedAt": 0
  }],
  "characters": [{
    "id": "c1", "name": "", "persona": "", "speechStyle": "", "appearance": "",
    "exampleDialogues": "", "greeting": "", "developments": [],
    "avatar": { "color": "#5b8def" }, "imagePrompt": "", "tags": [], "createdAt": 0, "updatedAt": 0
  }],
  "personas": [{
    "id": "p1", "name": "あなた", "description": "", "avatar": { "color": "#e8a13d" }, "imagePrompt": "",
    "createdAt": 0, "updatedAt": 0
  }],
  "sessions": [],
  "cassettes": [{
    "id": "cas1", "title": "", "description": "", "createdAt": 0,
    "session": {
      "id": "s1", "title": "", "mode": "story", "model": "", "reviewModel": "", "choicesModel": "",
      "characterIds": ["c1"], "characterGates": [], "worldId": "w1", "personaId": "p1",
      "roleAssignments": [], "introBindings": [],
      "authorNote": "", "newCharacterPolicy": "avoid",
      "story": { "premise": "", "genre": "", "opening": "", "openingTitle": "", "initialDirective": "", "introTags": [] },
      "scenes": [{ "id": "sc1", "title": "シーン 1", "note": "", "summary": "", "createdAt": 0 }],
      "currentSceneId": "sc1",
      "timeline": { "enabled": true, "slots": ["朝","昼","夜"], "totalDays": null, "spanLabel": "",
        "currentDay": 1, "currentSlot": 0, "startDay": 1, "startSlot": 0 },
      "choiceMode": "auto", "narrativeStyle": "novel", "eventAutoFire": true, "usedEventIds": [],
      "state": { "relations": [], "moods": [], "stats": [], "counters": [], "achievements": [] },
      "overlay": { "lore": [], "characterDevelopments": [] },
      "structuredOutput": true, "messages": [], "temperature": 0.9, "maxTokens": 32768,
      "createdAt": 0, "updatedAt": 0
    }
  }]
}
```
