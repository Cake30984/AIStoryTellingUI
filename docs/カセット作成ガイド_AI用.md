# ゲームカセット作成ガイド（AI 用プロンプト）

このファイルは **AI に「ゲームカセット」を JSON で自動生成させる**ための仕様書兼指示書です。
AI にカセットを作らせたいときは、この 1 ファイルをそのまま渡してください（アプリのソースコードを読ませる必要はありません）。

> **このファイルの保守規約**: `src/types.ts` の公開データ型（World / Character / Session / Cassette と
> その配下）を変更したら、**同じコミットでこのガイドも更新する**。ここが型より古くなると、
> AI は「書けるのに書かない項目」を作り、最悪の場合**撤去済みの書き方を出力して黙って壊れる**。
>
> 2026-09-08 に全面書き直し（F1〜F6）。**条件・数・実績・結末定義・配役・特別イベント・
> 固定タイムライン・ペルソナ・選択肢モードはすべて撤去済み**で、もう書けません。

---

## 0. あなた（AI）へのゴール指示

あなたは「デルシア（Delusia）」というアプリ向けの **ゲームカセット** を 1 本、下記の JSON 形式で作ります。
ゲームカセットとは「**世界観 ＋ 登場キャラ ＋ 開始状態のセッション**を 1 束にした、そのまま最初から遊べる配布データ」です。

出力は **1 つの JSON オブジェクト**（アプリの「データ取り込み（インポート）」にそのまま食わせられる ExportBundle）です。
説明文・コードブロックの外に散らさず、**完全な JSON をそのまま**出してください（画像は省略可＝後述）。

### 0.1 このアプリが何であるか（ここを外すと的外れなカセットになる）

**ノベルゲームではなく「挿絵入りの本」です。** プレイヤーは主人公を演じません——**読者**として、
書き手である AI に指示を出しながら物語を読み進めます。「続ける」で先へ進み、
気に入らなければ引き直し、〈もっと詳しく〉〈先へ飛ばす〉で尺を指示します。

したがって、あなたが作るのは**ゲームのルール**ではなく**物語の初期条件**です。

| 作らないもの | 理由 |
|---|---|
| 好感度・パラメータ・フラグ | **数の状態は存在しない。** 状態はすべて言葉（prose）で持つ |
| 「〜したら〜が起きる」という条件・分岐 | **条件エンジンは存在しない。** 展開は AI の即興に委ねる |
| 実績・エンディング定義・到達条件 | **世界側に結末は無い。** 終わり方はプレイ中に AI が提案し、プレイヤーが選ぶ |
| 配役枠・ロール | **存在しない。** 登場人物は全員ただの `Character` |
| 「何日目の何時」という固定タイムライン | **存在しない。** 時間は自由な文字列で、AI が進める |

**あなたの仕事は「AI が即興しやすい土壌を作ること」です。** 具体的には——

- **世界観の概要とロア**を、少数・濃く書く（多すぎる設定は生成の自然な流れを阻害する）
- **キャラを立てる**。口調・価値観・秘密まで作り込む。`exampleDialogues` と `greeting` が口調再現の要
- **導入文（`opening`）**で、読者を一気に世界へ引き込む
- **中心人物を決める**（`focusCharacterId`）。物語はその人を中心に描かれる
- **最初から控えている予定**（`initialPending`）で、先に何かが待っている感じを作る

---

## 1. 全体構造（トップレベル）

出力する JSON のいちばん外側は「ExportBundle」です。

```jsonc
{
  "type": "ai-storytelling-studio",   // 固定値。これが無いと取り込みが拒否される
  "version": 1,                        // 固定
  "exportedAt": 0,                     // 任意の数値（0 でよい）
  "worlds":     [ /* World を 1 つ */ ],
  "characters": [ /* Character を 2〜6 体 */ ],
  "sessions":   [],                    // 空配列でよい（実体は cassettes[].session に入る）
  "cassettes":  [ /* Cassette を 1 つ */ ]
}
```

- `worlds`/`characters` は **カセットが参照する素材**。取り込み時にライブラリへ登録される。
- `cassettes[0].session` が **開始状態のセッション本体**。ここが `worldId`/`characterIds`/`focusCharacterId` で上の素材を参照する。
- 取り込みは **id が既存と衝突しない要素だけ追加**される（同 id は無視）。id は分かりやすい安定文字列にする（例 `w_kohaku`, `c_soujiro`）。
- `personas` は**書かない**（型ごと廃止された。主人公も `characters` の 1 人）。
- `providers`（API キー）は入れない。`images` は基本省略（§6.2）。

---

## 2. ID 配線ルール（最重要・ここを間違えると動かない）

すべての id は自分で決めた文字列でよいが、**参照が一致していなければならない**。

| 参照元 | 参照先 | 必須 |
|---|---|---|
| `cassettes[0].session.worldId` | `worlds[0].id` | ✔ |
| `cassettes[0].session.characterIds[]` | 各 `characters[].id` | ✔ |
| `cassettes[0].session.focusCharacterId` | **`session.characterIds[]` に含まれる id** | ✔ |
| `cassettes[0].session.introBindings[].tag` | `startPreset.introTags[].tag` | 導入文で `@タグ` を使うなら ✔ |
| `cassettes[0].session.introBindings[].characterId` | `characters[].id` | 同上 ✔ |
| 導入文 `opening` の `@タグ` | `startPreset.introTags[].tag` | 導入文で `@` を使うなら ✔ |
| `cassettes[0].session.currentSceneId` | `session.scenes[0].id` | ✔ |

また `cassettes[0].session.story.premise`/`genre`/`opening`/`openingTitle`/`initialDirective`/`introTags` は
`worlds[0].startPreset` の同名項目と **同じ内容にそろえる**（開始テンプレートと実セッションを一致させる）。
`session.authorNote` は `startPreset.authorNote`、`session.newCharacterPolicy` は `startPreset.newCharacterPolicy`、
`session.scenes[0].note` は `startPreset.openingSceneNote`、
`session.state.now` は `startPreset.startNow`、`session.state.pending` は `startPreset.initialPending` と一致させる。

---

## 3. World（世界観）

`worlds[0]` に 1 つ。**これだけです**——ゲームシステムの定義はもう存在しません。

```jsonc
{
  "id": "w_xxx",
  "name": "世界の名前",
  "description": "常に AI へ注入される世界観の概要（数文〜1段落）。舞台・トーン・基本ルール。",
  "entries":        [ /* LoreEntry: キーワード連動で注入される設定辞書（§3.1） */ ],
  "relationAspects":[ /* RelationAspectDef: 関係性を言葉で捉える「次元」（§3.2） */ ],
  "calendarFormat": "◯月◯日／朝・昼・夕・夜",
  "startPreset":    { /* WorldStartPreset: 開始テンプレート（§5） */ },
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
  "order": 0           // 小さいほど先に注入
}
```

**`alwaysOn: false` なら `keys` は 1 語以上必須。**
`keys` が空で `alwaysOn` も false の項目は、**どちらの経路にも乗らず永久に注入されない**（黙って死ぬ）。
キーワードは会話文に実際に現れる語にする（「王都」「アルカディア城」等の固有名詞が向く）。

- **`condition`（解禁条件）は撤去された。** 書いても読み捨てられる。「出し惜しみ」は条件ではなく
  **書かないこと**で作る——世界の裏側は `entries` に書かず、プレイ中に AI が見つけた設定が
  シーン終了レビューを通じて自動で追加されていく。
- `addedInStory` は**書かない**（プレイ中にレビューが追加した項目の目印）。
- **6〜12 件が目安。** 多すぎるロアは生成の自然な流れを阻害する。

### 3.2 RelationAspectDef（`relationAspects[]`）— 関係の「次元」

キャラが**中心人物**をどう見ているかを、数値ではなく言葉で捉える軸。
シーン終了レビューがこの次元名でだけ記述を書き直す＝**レビューを拘束する唯一の仕掛け**。

```jsonc
{ "id": "asp_trust", "name": "信頼", "guidance": "相手の何を信じ何を疑うか、をレビューへ指示する一文" }
```

**2〜4 個が目安**（例: 信頼 / 恋愛 / 警戒 / 心の距離）。世界のテーマに合う軸を選ぶ
（料理の世界なら「腕への評価」、探偵ものなら「疑い」など）。

### 3.3 calendarFormat（任意）

この世界の日時の**書き方の見本**を 1 行。レビューが現在時刻を書くときの体裁を揃えるためだけのもので、
**粒度は縛らない**（「◯月◯日」の見本でも、AI は「6月半ば」「翌年の春」と書いてよい）。

```jsonc
"calendarFormat": "第三紀・◯の月・◯日／夜明け・日中・黄昏・夜半"
```

異世界・ファンタジーで独自の暦を使いたいときだけ書く。現代日本が舞台なら省略してよい。

---

## 4. Character（登場人物）

**主人公を含め、全員をここに書く。** 主人公だけの特別な型はもうありません。

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
- **2〜6 体が扱いやすい。** 各キャラに「隠している何か」「中心人物との関係の初期値」を用意すると物語が動く。
- **中心人物にも `speechStyle`・`appearance`・`exampleDialogues` を書く。**
  中心人物は視点人物であって、書き手が最も細かく描く相手です。
- `persona`・`speechStyle`・`appearance` に**他の登場人物の名前を書かない**。
  素材は単体で再利用されるため（「〜との関係」ではなく「初対面の相手にどう接するか」と書く）。
- **後から登場させたいキャラ**は `session.characterIds` に入れないでおく（入れると最初から AI に見える）。
  `newCharacterPolicy: "allow"` にしておけば AI が新しい人物を出せますし、出てきた人物は
  プレイ中の「発見キャラ」機能でプレイヤーがライブラリへ取り込めます
  （条件で登場を制御する仕組み `characterGates` は撤去済み）。

---

## 5. WorldStartPreset（`worlds[0].startPreset`）— 開始テンプレート

セッション開始時の初期本文・設定。`session` 側の同名項目と内容を一致させる（§2）。

```jsonc
{
  "genre": "ジャンル・トーン",
  "premise": "あらすじ・前提（毎回背景として注入される）",
  "opening": "導入本文（開始時に一度だけそのまま画面に掲載される最初のシーン。作り込む。§5.1）",
  "openingTitle": "導入シーンの見出し",
  "openingSceneNote": "開始シーンの状況メモ。時・場所と**その場に居る人物**を書く（例: 開店前の店内。壮次郎とマスターの二人だけ）",
  "initialDirective": "最初のシーンだけ効く、書き手 AI への非表示の方向づけ（例: まず店の掃除をさせ、マスターの寡黙さを描く）",
  "newCharacterPolicy": "allow",     // "allow"=未定義の人物を AI が新しく出してよい / "avoid"=出さない（モブは無名で描かせる）
  "authorNote": "常に記憶させたい固定メモ（任意・空文字可）",
  "introTags": [                     // 導入文の @タグ 定義（§5.1）
    { "id": "it_master", "tag": "マスター", "note": "店の主" },
    { "id": "it_hero",   "tag": "主人公",   "note": "中心人物" }
  ],
  "startNow": "4月7日 朝",           // 開始時点の日時（任意・自由な書き方。空なら物語側で決めさせる）
  "initialPending": [                // 最初から控えている予定（§5.2）
    { "when": "三日後の夜", "what": "店の最後の営業日を迎える" }
  ]
}
```

- **`openingSceneNote` は必ず書く。** 2シーン目以降の状況メモはレビューが自動で書くが、
  1シーン目だけは書き手が居ない。「最初は誰と誰が居るのか」を作者が指定できる唯一の場所。

### 5.1 導入文（`opening`）の書式

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
  タグ→実キャラの対応付けは `session.introBindings`（§6）が持つ。
  **定義していないタグを `@` で書くと、置換されずそのまま画面に出る。**
- **束縛先のキャラには必ず `name` を入れる。** 名前が空のキャラへ対応付けても解決できず、
  「対応先が未解決です」で開始できなくなる。
- 地の文には `@` を付けない。地の文の中に鉤括弧のセリフを埋め込まない（発話は必ず `@` 行に分ける）。

### 5.2 initialPending（最初から控えている予定）

「これから起きること」を短いスリップとして最初から積んでおく仕組み。
撤去された特別イベントの受け皿で、**条件も id 参照も持たない**——作者が書くのは 2 つの欄だけです。

```jsonc
{ "when": "8月31日", "what": "夏休みが終わる" }
{ "when": "降り続いた雨がやんだとき", "what": "橋の向こうから使者が来る" }
```

- `when` は**日時でも出来事でもよい**。「祭りの前日」「初雪の朝」——AI が言葉として解釈します。
- **基準日のない相対表現（「来週水曜」「三日後」だけ）は避ける。** 解釈できず、実測でも
  30 回中 2 回しか発火せず、その 2 回とも誤りでした。「三日後の夜、最後の営業日に」のように
  **物語内の出来事に結びつけた書き方**なら通ります。
- **2〜5 件が目安。** アプリは件数に上限を設けていませんが、多すぎると物語の主導権が予定に移ります。
- 予定は消化されると自動で消えます。プレイヤーは触りません。

---

## 6. Cassette と session（開始状態）

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
    "mode": "story",             // 物語モード。単体キャラとの会話中心なら "roleplay"
    "model": "",                 // 空文字（受け手の既定モデルにフォールバック）
    "reviewModel": "",
    "choicesModel": "",
    "characterIds": ["c_hero", "c_a", "c_b"],   // 参加キャラ（characters の id）。中心人物も含める
    "worldId": "w_xxx",
    "focusCharacterId": "c_hero",   // ★必須。characterIds のどれか1つ（§6.1）
    "introBindings": [                        // 導入文の @タグ → 実キャラ
      { "tag": "マスター", "characterId": "c_a" },
      { "tag": "主人公",   "characterId": "c_hero" }
    ],
    "authorNote": "",            // startPreset.authorNote と同じ
    "newCharacterPolicy": "allow",  // startPreset.newCharacterPolicy と同じ
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
    "narrativeStyle": "novel",   // "novel"=小説形式 / "chat"=会話劇
    "state": {
      "relations": [], "moods": [],
      "now": "4月7日 朝",        // startPreset.startNow と同じ
      "place": "", "presentIds": [], "situation": "",
      "pending": [               // startPreset.initialPending と同じ内容（id と bornAt を付ける）
        { "id": "pd_1", "when": "三日後の夜", "what": "店の最後の営業日を迎える", "bornAt": 0 }
      ],
      "recentDone": []
    },
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
`messages: []` / `scenes` は 1 シーンのみ / `state.relations`・`moods`・`recentDone` は空 /
`overlay` は空 / `ending`・`endingGoal` は付けない / `currentSceneId` は唯一のシーン id /
シーンに `interludes`（別視点の幕間）を書かない＝プレイ中に読者が生成する読み物なので、配布物には入れない。

### 6.1 focusCharacterId（中心人物）— 必須

**物語がその人を中心に描かれます。** 空だとプレイヤーは物語を開始できません。

| モード | 意味 |
|---|---|
| `story` | **視点人物。** 情景と心情はこの人が見聞きし感じ取れる範囲で書かれる |
| `roleplay` | **プレイヤーが演じる人物。** AI はこの人のセリフ・行動を書かない |

- **関係性の宛先も兼ねる。** シーン終了レビューは「各キャラ → 中心人物」の向きだけを書き直します
  （中心人物は自分自身への関係を持ちません）。
- `roleplay` にする場合、AI が演じるのは**中心人物以外**です。`characterIds` に相手役を必ず入れてください。

### 6.2 画像について

- 通常は **画像を同梱しない**（`avatar` は `color` のみ、トップレベル `images` も省略）。取り込み後にアプリ内で生成/設定できる。`imagePrompt` を各キャラに入れておけば、あとから画像生成しやすい。
- どうしても画像を埋め込む場合のみトップレベルに
  `"images": [ { "id": "画像id", "mime": "image/png", "dataBase64": "..." } ]` を足し、
  参照側で `avatar.imageId` にその id を指す（base64 が巨大になるため非推奨）。

---

## 7. 書いてはいけないもの（撤去済みの項目）

以下は**すべて型ごと廃止されました**。書いても読み捨てられるか、取り込みが壊れます。

| 書かない | 代わりに |
|---|---|
| `condition` / `all` / `any` / `kind:"stat"` 等の条件式 | 何も書かない。展開は AI の即興に委ねる |
| `stats` / `counters` / `achievements`（数と実績） | `relationAspects`（言葉の次元）だけを使う |
| `endings` / `epilogueGuidance`（結末定義） | 何も書かない。終わり方はプレイ中に AI が提案する |
| `scheduledEvents`（特別イベント） | `startPreset.initialPending`（§5.2） |
| `roles` / `roleAssignments`（配役） | 何も書かない。`introTags`＋`introBindings` だけが残る |
| `timeline`（固定タイムライン） | `startPreset.startNow`（自由な文字列） |
| `personas` / `personaId` | `characters` ＋ `session.focusCharacterId` |
| `characterGates`（キャラの登場条件） | 何も書かない。`newCharacterPolicy` で AI に任せる |
| `choiceMode` | 何も書かない。選択肢はプレイヤーが〈展開を選ぶ〉を押した時だけ出る |
| `reviewGuidance` | `relationAspects[].guidance` に書く |
| `eventAutoFire` / `usedEventIds` / `revealedLoreIds` / `revealedCharacterIds` | 何も書かない |
| `relationFlag` 節 | 何も書かない |
| `scenes[].interludes`（別視点の幕間） | 何も書かない。プレイ中に読者が生成する |

---

## 8. 取り込み手順（ユーザー向け・生成物の使い方）

1. 生成した JSON を `.json` ファイルとして保存する。
2. アプリ左端のレールから **「作る」→ 右上の「インポート」** でそのファイルを選ぶ
   （**「設定」→「データのバックアップ」→「インポート」**でも同じ）。
3. 世界観・キャラがライブラリに、カセットが **「作る」→「カセット」** に追加される。
4. カセットの **「遊ぶ」** で新規セッションとして開始（何度でも最初から遊べる）。

---

## 9. 生成前チェックリスト（AI は出力前に自己確認）

構造:
- [ ] `type: "ai-storytelling-studio"` と `version: 1` がある
- [ ] `session.worldId` / `characterIds` が実在する素材 id を指している
- [ ] **`session.focusCharacterId` が `characterIds` に含まれている**（空でない）
- [ ] `session` が開始状態（messages 空・1 シーン・relations/moods/overlay 空・ending 無し）
- [ ] `story` と `startPreset` の内容が一致（premise/genre/opening/openingTitle/initialDirective/introTags/authorNote/newCharacterPolicy、`scenes[0].note` = `openingSceneNote`、`state.now` = `startNow`、`state.pending` = `initialPending`）

撤去済み項目を書いていないか:
- [ ] `condition` / `stats` / `counters` / `achievements` / `endings` を**書いていない**
- [ ] `scheduledEvents` / `roles` / `roleAssignments` / `characterGates` を**書いていない**
- [ ] `timeline` / `personas` / `personaId` / `choiceMode` を**書いていない**
- [ ] `introBindings` の各要素が `{ "tag": ..., "characterId": ... }` の形（`kind` を書いていない）

中身:
- [ ] `relationAspects` が 2〜4 個ある
- [ ] `alwaysOn: false` のロアには `keys` が 1 語以上ある
- [ ] `initialPending` に 2 件以上あり、`when` が基準日のない相対表現になっていない
- [ ] 各キャラに `exampleDialogues` が数個・`greeting` がある
- [ ] キャラの `persona`/`speechStyle`/`appearance` に他キャラの名前が入っていない

導入文:
- [ ] `opening` の `@タグ` がすべて `startPreset.introTags[].tag` にあり、`session.introBindings` で対応付けられている
- [ ] `opening` の `@` 行に `(感情)` のような括弧を書いていない
- [ ] `openingSceneNote` に時・場所・その場に居る人物が書かれている

その他:
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
    "entries": [], "relationAspects": [],
    "startPreset": {
      "genre": "", "premise": "", "opening": "", "openingTitle": "",
      "openingSceneNote": "", "initialDirective": "", "newCharacterPolicy": "allow", "authorNote": "",
      "introTags": [], "startNow": "", "initialPending": []
    },
    "createdAt": 0, "updatedAt": 0
  }],
  "characters": [{
    "id": "c1", "name": "", "persona": "", "speechStyle": "", "appearance": "",
    "exampleDialogues": "", "greeting": "", "developments": [],
    "avatar": { "color": "#5b8def" }, "imagePrompt": "", "tags": [], "createdAt": 0, "updatedAt": 0
  }],
  "sessions": [],
  "cassettes": [{
    "id": "cas1", "title": "", "description": "", "createdAt": 0,
    "session": {
      "id": "s1", "title": "", "mode": "story", "model": "", "reviewModel": "", "choicesModel": "",
      "characterIds": ["c1"], "worldId": "w1", "focusCharacterId": "c1",
      "introBindings": [], "authorNote": "", "newCharacterPolicy": "allow",
      "story": { "premise": "", "genre": "", "opening": "", "openingTitle": "", "initialDirective": "", "introTags": [] },
      "scenes": [{ "id": "sc1", "title": "シーン 1", "note": "", "summary": "", "createdAt": 0 }],
      "currentSceneId": "sc1",
      "narrativeStyle": "novel",
      "state": { "relations": [], "moods": [], "now": "", "place": "", "presentIds": [], "situation": "", "pending": [], "recentDone": [] },
      "overlay": { "lore": [], "characterDevelopments": [] },
      "structuredOutput": true, "messages": [], "temperature": 0.9, "maxTokens": 32768,
      "createdAt": 0, "updatedAt": 0
    }
  }]
}
```
