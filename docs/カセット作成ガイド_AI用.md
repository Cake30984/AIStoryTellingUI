# ゲームカセット作成ガイド（AI 用プロンプト）

このファイルは **AI に「ゲームカセット」を JSON で自動生成させる**ための仕様書兼指示書です。
AI にカセットを作らせたいときは、この 1 ファイルをそのまま渡してください（アプリのソースコードを読ませる必要はありません）。

---

## 0. あなた（AI）へのゴール指示

あなたは「AI Storytelling Studio」というアプリ向けの **ゲームカセット** を 1 本、下記の JSON 形式で作ります。
ゲームカセットとは「**世界観 ＋ 登場キャラ ＋ 主人公（ペルソナ）＋ 開始状態のセッション**を 1 束にした、そのまま最初から遊べる配布データ」です。

出力は **1 つの JSON オブジェクト**（アプリの「データ取り込み（インポート）」にそのまま食わせられる ExportBundle）です。
説明文・コードブロックの外に散らさず、**完全な JSON をそのまま**出してください（画像は省略可＝後述）。

作るときの心得（詳細は後半）:

- **事実は数、判断は言葉**（この世界の根本ルール）。好感度・回数・レベル等の「数えられる事実」は `stats`/`counters` に、感情や関係の機微という「言葉で捉える判断」は `relationAspects`（prose）にする。**エンディングや実績の条件は必ず数/フラグで書く**（prose は条件に使えない）。
- キャラは薄いテンプレではなく、口調・価値観・秘密まで作り込む。`exampleDialogues`（セリフ例）と `greeting`（最初のひとこと）は口調再現の要。
- 導入文（`opening`）は「そのまま画面に掲載される最初の本文」。読者を一気に世界へ引き込む描写を書く。
- ID の相互参照を必ず正しく結ぶ（後述の「ID 配線ルール」を厳守）。

参考にできる完成品が `samples/純喫茶こはく.json` と `samples/螺旋塔アルシオン.json` にあります（同じ形式）。

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
- `providers`（API キー）や `endingRecords` は入れない。`images` は基本省略（下記 §8）。

---

## 2. ID 配線ルール（最重要・ここを間違えると動かない）

すべての id は自分で決めた文字列でよいが、**参照が一致していなければならない**。

| 参照元 | 参照先 | 必須 |
|---|---|---|
| `cassettes[0].session.worldId` | `worlds[0].id` | ✔ |
| `cassettes[0].session.characterIds[]` | 各 `characters[].id` | ✔ |
| `cassettes[0].session.personaId` | `personas[0].id` | ✔ |
| `cassettes[0].session.roleAssignments[].roleId` | `worlds[0].roles[].id` | roles を使うなら |
| `cassettes[0].session.roleAssignments[].characterId` | `characters[].id` | 同上 |
| `worlds[0].scheduledEvents[].condition` 内の `defId` | `stats[].id` / `counters[].id` / `achievements[].id` | 条件を書くなら |
| `worlds[0].achievements[].condition` 内の `defId` | 同上 | ✔ |
| `worlds[0].endings[].condition` 内の `defId` | 同上 | 条件付きなら |
| `导入文 opening 内の @ロール名` | `worlds[0].roles[].name` | roles を使うなら |

また `cassettes[0].session.story.premise`/`genre`/`opening`/`openingTitle` は
`worlds[0].startPreset` の同名項目と **同じ内容にそろえる**（開始テンプレートと実セッションを一致させる）。
`session.timeline` も `startPreset.timeline` の定義（slots/totalDays/spanLabel/startDay/startSlot）と一致させる。

---

## 3. World（世界観・ゲームシステム定義）

`worlds[0]` に 1 つ。この世界の設定とゲームシステム（数・条件・エンディング）をすべて定義する。

```jsonc
{
  "id": "w_xxx",
  "name": "世界の名前",
  "description": "常に AI へ注入される世界観の概要（数文〜1段落）。舞台・トーン・基本ルール。",
  "entries":        [ /* LoreEntry: キーワード連動で注入される設定辞書 */ ],
  "scheduledEvents":[ /* ScheduledEvent: 日付/時間帯/条件で自動発火する特別イベント */ ],
  "relationAspects":[ /* RelationAspectDef: 関係性を言葉で捉える「次元」 */ ],
  "stats":          [ /* StatDef: 数の定義（好感度・腕前・所持金 等） */ ],
  "counters":       [ /* CounterDef: 累計回数の定義（デート回数 等） */ ],
  "achievements":   [ /* AchievementDef: 条件成立で自動達成される実績 */ ],
  "roles":          [ /* WorldRole: 配役枠（マスター・幼馴染 等） */ ],
  "startPreset":    { /* WorldStartPreset: 開始テンプレート（§7） */ },
  "endings":        [ /* EndingDef: 到達条件つきの結末（§6） */ ],
  "createdAt": 0,
  "updatedAt": 0
}
```

### 3.1 LoreEntry（`entries[]`）— 設定辞書

```jsonc
{
  "id": "lore_xxx",
  "keys": ["トリガー語1", "トリガー語2"], // 本文にこの語が出たとき注入。alwaysOn なら無視される
  "content": "その設定の説明本文",
  "alwaysOn": false,   // true なら常時注入（重要設定向け）
  "enabled": true,
  "order": 0           // 小さいほど先に注入
}
```

### 3.2 RelationAspectDef（`relationAspects[]`）— 関係の「次元」（言葉）

好感度メーターとは別。**数値化しない**、キャラが主人公をどう見ているかを prose で捉える軸。

```jsonc
{ "id": "asp_trust", "name": "信頼", "guidance": "相手の何を信じ何を疑うか、をレビューへ指示する一文" }
```

2〜4 個が目安（例: 信頼 / 恋愛 / 警戒 / 心の距離）。

### 3.3 StatDef（`stats[]`）— 数の定義

```jsonc
{
  "id": "stat_favor",
  "name": "好感度",
  "scope": "character",  // "character"=キャラ別に1値 / "global"=世界で1値
  "default": 0,
  "min": 0, "max": 100,  // 任意
  "inject": false        // true なら現在値を本編プロンプトに注入。好感度メーターは通常 false（言葉で読ませる）
}
```

### 3.4 CounterDef（`counters[]`）— 累計回数

```jsonc
{ "id": "cnt_date", "name": "デート回数", "scope": "global", "inject": true }
```

単調増加（減らない）。エンディング/実績条件のしきい値に向く。

### 3.5 AchievementDef（`achievements[]`）— 実績

```jsonc
{
  "id": "ach_first",
  "name": "はじめての一杯",
  "description": "実績の説明",
  "condition": { "all": [ { "kind": "counter", "defId": "cnt_cups", "op": ">=", "value": 1 } ] },
  "hidden": false         // true なら未達成のうちは名前・内容を隠す
}
```

### 3.6 WorldRole（`roles[]`）— 配役枠

「性格」ではなく「世界での立場・物語上の機能」を書く。導入文では `@ロール名` で参照する。

```jsonc
{ "id": "role_master", "name": "マスター", "description": "閉店を決めた店の主。多くを語らない導き手。", "required": true }
```

`required: true` の枠は配役されていないと開始できない → `session.roleAssignments` で必ず埋めること。

---

## 4. Condition（条件式）の書き方

`scheduledEvents` / `achievements` / `endings` の `condition` に使う。**数・フラグ・実績のみ**で書く（prose は不可）。

```jsonc
// すべて満たす
{ "all": [ Clause, Clause, ... ] }
// いずれか満たす
{ "any": [ Clause, ... ] }
```

Clause（節）は 4 種類:

```jsonc
{ "kind": "stat",        "defId": "stat_favor", "op": ">=", "value": 60 }
{ "kind": "counter",     "defId": "cnt_date",   "op": ">=", "value": 3 }
{ "kind": "relationFlag","flag": "命を救われた", "have": true }   // 関係に立った恒久フラグ
{ "kind": "achievement", "defId": "ach_first",  "have": true }
```

- `op` は `>=` `>` `<=` `<` `==` `!=`。
- `stat`/`counter` は `characterId` を省略すると「参加キャラの**いずれか**が満たせば成立」。特定キャラ限定にしたいときのみ `characterId` を付ける。
- 節が空の condition は「不成立」扱い。

---

## 5. Character（登場キャラ）と 6. Persona（主人公）

### 5. Character（`characters[]`）

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
  "imagePrompt": "英語タグ列。挿絵/立ち絵生成用（例: 1girl, silver hair, ...）。任意だが付けると良い",
  "tags": ["属性", "役割"],
  "createdAt": 0, "updatedAt": 0
}
```

- `model` フィールドは付けない（環境依存のため）。
- 主要キャラは 3〜6 体が扱いやすい。各キャラに「隠している何か」「主人公との関係の初期値」を用意すると物語が動く。

### 6. Persona（`personas[]`）— プレイヤーが演じる主人公

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

## 6.5 EndingDef（`worlds[0].endings[]`）— 結末

配列の**並び順が優先度**（上が優先）。到達判定はアプリがコードで自動処理する。

```jsonc
{
  "id": "end_true",
  "name": "エンディング名",
  "description": "一覧・到達時に見せる説明（条件そのものは書かない＝ネタバレ防止）",
  "condition": { "all": [ ... ] },   // 到達条件（§4）。fallback:true のときは付けない
  "epilogueGuidance": "エピローグ生成への指示。結末のトーン・締め方を具体的に。到達後のみ AI に渡る",
  "auto": false,     // true=条件成立で強制突入（バッドエンド向け・「まだ続ける」を出さない）
  "hidden": false,   // true=未到達のうちは名前を ??? 表示
  "fallback": false  // true=期間満了時に条件成立エンディングが無ければ採用（ノーマル/ビターエンド）。1つ用意推奨
}
```

- 少なくとも「真エンド（条件付き）」＋「fallback エンド 1 つ」を用意すると綺麗に完結する。
- `condition` はプレイヤーの積み上げ（`stats`/`counters`/`achievements`）で自然に届く値にする。

---

## 7. WorldStartPreset（`worlds[0].startPreset`）— 開始テンプレート

セッション開始時の初期本文・設定。`session.story` / `session.timeline` と内容を一致させる。

```jsonc
{
  "genre": "ジャンル・トーン",
  "premise": "あらすじ・前提（毎回背景として注入される）",
  "opening": "導入本文（開始時に一度だけそのまま画面に掲載される最初のシーン。作り込む）",
  "openingTitle": "導入シーンの見出し",
  "authorNote": "常に記憶させたい固定メモ（任意・空文字可）",
  "timeline": {
    "slots": ["朝", "昼", "夜"],  // 1日の区切り。世界に合わせて命名可（例: 開店前/モーニング/昼下がり/夕暮れ/閉店後）
    "totalDays": 3,               // 総日数。無制限なら null
    "spanLabel": "期間の呼称（例: 閉店までの三日間）",
    "startDay": 1,
    "startSlot": 0                // slots の先頭からなら 0
  }
}
```

### 導入文（`opening`）の書式

- 地の文＋セリフで、映画の冒頭のように世界へ引き込む。
- セリフは **構造化出力タグ**で書ける: `@ロール名(感情)「セリフ」`
  - ロール名は `roles[].name`（例 `@マスター`）。感情は `neutral / joy / anger / sadness / shy / surprise` のいずれか。
  - 例: `@マスター(neutral)「……いらっしゃい」`
- 主人公（プレイヤー）を「きみ」「あなた」で二人称呼びすると没入しやすい。

---

## 8. Cassette と session（開始状態）

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
    "characterIds": ["c_a", "c_b"],   // 参加キャラ（characters の id）
    "worldId": "w_xxx",
    "personaId": "p_xxx",
    "roleAssignments": [ { "roleId": "role_master", "characterId": "c_a" } ],
    "authorNote": "",            // startPreset.authorNote と同じ
    "story": {
      "premise": "…",           // startPreset.premise と同じ
      "genre": "…",             // startPreset.genre と同じ
      "opening": "…",           // startPreset.opening と同じ
      "openingTitle": "…"       // startPreset.openingTitle と同じ
    },
    "scenes": [
      { "id": "scene_1", "title": "シーン 1", "activeCharacterIds": ["c_a","c_b"],
        "note": "", "summary": "", "createdAt": 0 }
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
    "structuredOutput": true,    // 導入文で @名前(感情)「」を使うなら true 推奨
    "messages": [],              // 必ず空（未プレイ）
    "temperature": 0.9,
    "maxTokens": 32768,
    "createdAt": 0, "updatedAt": 0
  }
}
```

**開始状態の鉄則**（ここを空にしないと「プレイ済み」データになる）:
`messages: []` / `scenes` は 1 シーンのみ / `state` と `overlay` は空 / `usedEventIds: []` / `ending` は付けない / `currentSceneId` は唯一のシーン id。

### 画像について

- 通常は **画像を同梱しない**（`avatar` は `color` のみ、トップレベル `images` も省略）。取り込み後にアプリ内で生成/設定できる。`imagePrompt` を各キャラ・ペルソナに入れておけば、あとから画像生成しやすい。
- どうしても画像を埋め込む場合のみトップレベルに
  `"images": [ { "id": "画像id", "mime": "image/png", "dataBase64": "..." } ]` を足し、
  参照側で `avatar.imageId` にその id を指す（base64 が巨大になるため非推奨）。

---

## 9. 取り込み手順（ユーザー向け・生成物の使い方）

1. 生成した JSON を `.json` ファイルとして保存する。
2. アプリの **System（設定）画面 → データ取り込み** でそのファイルを選ぶ。
3. 世界観・キャラ・ペルソナがライブラリに、カセットが「🎮 カセット棚」に追加される。
4. カセット棚の「▶ 遊ぶ」で新規セッションとして開始（何度でも最初から遊べる）。

---

## 10. 生成前チェックリスト（AI は出力前に自己確認）

- [ ] `type: "ai-storytelling-studio"` と `version: 1` がある
- [ ] `session.worldId` / `characterIds` / `personaId` が実在する素材 id を指している
- [ ] `roleAssignments` が `roles`（特に `required:true`）を埋め、`characterId` も実在する
- [ ] すべての `condition` の `defId` が `stats`/`counters`/`achievements` の id と一致
- [ ] エンディングに条件付き 1 つ以上＋`fallback:true` 1 つがある
- [ ] `session` が開始状態（messages 空・1 シーン・state/overlay 空・ending 無し）
- [ ] `story` と `startPreset`、`timeline` 同士の内容が一致
- [ ] `opening` の `@ロール名` が `roles[].name` と一致（使う場合）
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
    "stats": [], "counters": [], "achievements": [], "roles": [],
    "startPreset": { "genre": "", "premise": "", "opening": "", "openingTitle": "", "authorNote": "",
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
      "characterIds": ["c1"], "worldId": "w1", "personaId": "p1", "roleAssignments": [],
      "authorNote": "", "story": { "premise": "", "genre": "", "opening": "", "openingTitle": "" },
      "scenes": [{ "id": "sc1", "title": "シーン 1", "activeCharacterIds": ["c1"], "note": "", "summary": "", "createdAt": 0 }],
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
