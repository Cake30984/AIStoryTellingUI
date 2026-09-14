// 永続データのスキーマ版番と移行（R1。docs/設計_公開前実装.md）。
//
// 公開後は「後方互換は不要」の前提が崩れるため、番号が刻まれた状態で世に出す。中身が空でも
// 版番が入っていること自体が要件で、あとから足せない唯一の要素。
//
// **3系統を別々にバージョニングする。** 片方の変更でもう片方を壊さないため。
//   - app   … 永続化の入れ物そのもの（zustand persist の `version`。ui/providers 等を含む全体）
//   - save  … セーブデータ（sessions / branchTrees / チェックポイント）＝「途中まで遊んだ人の思い出」
//   - cassette … カセット定義（cassettes）＝配布物
// app だけ zustand が持つ仕組みに乗る（version が違う時だけ migrate が呼ばれる）。save/cassette は
// 単独で上げても移行が走るよう、永続ペイロード内の `schemaVersions` を見て merge 側で毎回判定する。
//
// 移行に失敗したとき（＝未来の版番のデータを読まされたとき）は黙って落とさない。既定値で上書きすると
// ユーザーのセーブが復旧不能になるため、書き込みを封印して起動時に案内を出す（App.tsx）。

/**
 * 永続化の入れ物の版番（zustand persist の `version`）。
 * v1 が初版・v2 でペルソナ素材を撤去（F3）・**v3 でセッション本体を入れ物から出した**（計画 P2c）。
 */
export const APP_STATE_VERSION = 3

/**
 * セーブデータ（sessions / branchTrees / チェックポイント）の版番。
 *
 * **v1 は R7 = 案 a（発見キャラは素材に入れたまま・`SessionOverlay` にキャラを持たせない）を
 * 前提に確定した**（2026-08-15 決定。docs/設計_公開前実装.md R7）。将来 b へ寝返る場合は
 * `SessionOverlay` に `characters` を足したうえでこの版番を 2 に上げ、`saveDataMigrations[1]` を
 * 1本書く（＝**もう「あとから足せない」状態ではない**。migrate が入ったのでスキーマの
 * 判断を先送りしても復旧可能になった）。
 */
export const SAVE_DATA_VERSION = 5

/** カセット定義（cassettes）の版番 */
export const CASSETTE_DATA_VERSION = 5

/** 永続ペイロードに同梱する版番。app 側は zustand が別に持つのでここには入れない */
export interface SchemaVersions {
  save: number
  cassette: number
}

export const CURRENT_SCHEMA_VERSIONS: SchemaVersions = {
  save: SAVE_DATA_VERSION,
  cassette: CASSETTE_DATA_VERSION,
}

export type SchemaScope = 'app' | 'save' | 'cassette'

/** 読めなかった理由。App.tsx が起動時の案内に使う（`schemaErrorMessage`） */
export interface SchemaError {
  scope: SchemaScope
  /** 保存されていた版番 */
  found: number
  /** この本体が読める版番 */
  supported: number
  /**
   * 版番の不一致ではなく**読み出しそのものに失敗した**ときの理由（P2c）。
   * セッション本体は別ストア（IndexedDB／ファイル）にあるので、版番の話にならない失敗がありうる。
   */
  reason?: string
}

const SCOPE_LABEL: Record<SchemaScope, string> = {
  app: '設定・ライブラリ',
  save: 'セーブデータ',
  cassette: 'カセット',
}

/** 版番 n のデータを n+1 へ上げる変換。純関数（副作用を持たせない） */
type Migration = (state: any) => any

// v1 が初版のため中身は空。以降は from の番号をキーに1段ずつ足す（例: 1: (s) => ({...s, foo: []})）。
// **飛ばさない。** 0→2 のような一発変換を書くと、途中の版から上げてきたデータが素通りする。
const appStateMigrations: Record<number, Migration> = {
  // 版番を持たない時代（zustand の既定値 0）のデータ。クリーンブレイク直後なので変換不要
  0: (s) => s,
  /** v1 → v2（F3・ペルソナ統合）。素材ライブラリから `personas` を落とす（型ごと廃止した） */
  1: (s) => {
    const { personas: _personas, ...rest } = s ?? {}
    return rest
  },
  /**
   * v2 → v3（計画 P2c・セッション本体の分割）。**ここでは何もしない。**
   * 実際の移行（`sessions` を `SessionStore` へ移して入れ物から落とす）は読み出しの口
   * （store.ts の `PersistStorage.getItem`）が、この `migrate` より前に済ませている。
   * 版番を上げるのは**旧い本体が新しいデータを黙って「セッション0件」で開かないようにする**ため
   * ——旧本体から見れば未来の版番になり、書き込みを封印して案内画面へ回る（R1）。
   */
  2: (s) => s,
}

/**
 * セッション1件ぶんの移行（P2c）。`SessionStore` は**レコードごとに版番を持つ**ので、
 * セーブデータの移行のうちセッションを触る段はここに置き、state 全体を受け取る
 * `saveDataMigrations` は `mapSessions` でこれを包むだけにする（定義を二重に持たない）。
 */
const sessionMigrations: Record<number, Migration> = {
  /**
   * v1 → v2（F2・時間と予定）。`Timeline` を廃止して `SessionState` に
   * `now`/`place`/`presentIds`/`situation`/`pending`/`recentDone` を足した。
   * 旧セッションは「時刻はまだ決まっていない」状態から始め直す＝
   * 旧 `timeline` の日付は自由文字列へ機械的に写せない（暦が違う世界がありうる）ので、
   * `timeLabel` の写しだけ拾って残りは空にする。
   */
  1: (sess) => {
    const cur = (sess?.scenes ?? []).find((sc: any) => sc?.id === sess?.currentSceneId)
    const { timeline: _timeline, ...rest } = sess ?? {}
    return {
      ...rest,
      state: {
        relations: sess?.state?.relations ?? [],
        moods: sess?.state?.moods ?? [],
        now: typeof cur?.timeLabel === 'string' ? cur.timeLabel : '',
        place: '',
        presentIds: [],
        situation: '',
        pending: [],
        recentDone: [],
      },
    }
  },
  /**
   * v2 → v3（F3・ペルソナ統合）。`personaId` を落として `focusCharacterId` を足す。
   * **中心人物は機械的に決められない**（ペルソナは `Character` ではなかったので写す先が無い）ので
   * 未選択にし、開始時の検証でユーザーへ選ばせる。宛先を失った関係性 prose（旧 `toId: 'hero'`）は
   * 指す相手が居なくなるため捨てる（残しても表示されず、レビューが新しい宛先で書き直す）。
   */
  2: (sess) => {
    const { personaId: _personaId, ...rest } = sess ?? {}
    return {
      ...rest,
      focusCharacterId: typeof sess?.focusCharacterId === 'string' ? sess.focusCharacterId : '',
      // 束縛は `kind` を落として `{ tag, characterId }` だけにする（ペルソナ束縛はここで消える）
      introBindings: (sess?.introBindings ?? [])
        .filter((b: any) => typeof b?.tag === 'string' && typeof b?.characterId === 'string')
        .map((b: any) => ({ tag: b.tag, characterId: b.characterId })),
      state: {
        ...(sess?.state ?? {}),
        relations: (sess?.state?.relations ?? []).filter((r: any) => r?.toId !== 'hero'),
      },
    }
  },
  /**
   * v3 → v4（F4・読者モデル）。`choiceMode` を落とす（`ChoiceMode` を型ごと廃止し、
   * 選択肢は〈展開を選ぶ〉のオンデマンド生成だけになった）。
   * `endingGoal`/`ending` は任意フィールドなので足す必要はない（未設定＝目標なし・未完結）。
   */
  3: (sess) => {
    const { choiceMode: _choiceMode, ...rest } = sess ?? {}
    return rest
  },
  /**
   * v4 → v5（計画 P1・環境音ピンの撤去）。`Scene.ambientPins` を落とす（`AmbientPin` を型ごと廃止した）。
   * 音源は内蔵カタログだったので画像と違い GC・実体削除は無い＝フィールドを消すだけでよい。
   */
  4: (sess) => ({
    ...sess,
    scenes: (sess?.scenes ?? []).map(dropAmbientPins),
  }),
}

/** セッション1件ぶんの段を、永続ペイロード全体を受け取る段へ持ち上げる */
function mapSessions(step: Migration): Migration {
  return (s) => ({ ...s, sessions: (s?.sessions ?? []).map(step) })
}

/**
 * セーブデータ（sessions / branchTrees）の段。**`sessionMigrations` を持ち上げたものだけ**で構成する
 * （＝段を1本ずつ書き写さない。書き写すと片方に足し忘れる）。
 *
 * **セッション以外（`branchTrees` 等）を触る段をここへ直接足さないこと。** P2c 以降、セッションは
 * `SessionStore` から**レコード単位で** `migrateSession` を通って読まれ、読み出しの口（store.ts）は
 * そのぶんのセーブ版番を現行として `merge` へ渡す＝ここへ直接足した段は新しい経路では走らない。
 * 必要になったら「セッション以外の残り」を掛ける道を読み出しの口に作ってから足す。
 */
const saveDataMigrations: Record<number, Migration> = Object.fromEntries(
  Object.entries(sessionMigrations).map(([v, step]) => [Number(v), mapSessions(step)]),
)

/** `Scene` から `ambientPins` を落とす（save v4→5 / cassette v4→5 で共用） */
function dropAmbientPins(scene: any): any {
  const { ambientPins: _ambientPins, ...rest } = scene ?? {}
  return rest
}

const cassetteMigrations: Record<number, Migration> = {
  /** v1 → v2（F2）。カセットが内包する開始状態のセッションにも同じ変換を掛ける */
  1: (s) => ({
    ...s,
    cassettes: (s?.cassettes ?? []).map((cas: any) => {
      const { timeline: _timeline, ...rest } = cas?.session ?? {}
      return {
        ...cas,
        session: {
          ...rest,
          state: {
            relations: cas?.session?.state?.relations ?? [],
            moods: cas?.session?.state?.moods ?? [],
            now: '',
            place: '',
            presentIds: [],
            situation: '',
            pending: [],
            recentDone: [],
          },
        },
      }
    }),
  }),
  /** v2 → v3（F3）。カセットが内包するセッションにも同じ変換を掛ける */
  2: (s) => ({
    ...s,
    cassettes: (s?.cassettes ?? []).map((cas: any) => {
      const { personaId: _personaId, ...rest } = cas?.session ?? {}
      return {
        ...cas,
        session: {
          ...rest,
          focusCharacterId:
            typeof cas?.session?.focusCharacterId === 'string' ? cas.session.focusCharacterId : '',
          introBindings: (cas?.session?.introBindings ?? [])
            .filter((b: any) => typeof b?.tag === 'string' && typeof b?.characterId === 'string')
            .map((b: any) => ({ tag: b.tag, characterId: b.characterId })),
          state: {
            ...(cas?.session?.state ?? {}),
            relations: (cas?.session?.state?.relations ?? []).filter((r: any) => r?.toId !== 'hero'),
          },
        },
      }
    }),
  }),
  /** v3 → v4（F4）。カセットが内包するセッションからも `choiceMode` を落とす */
  3: (s) => ({
    ...s,
    cassettes: (s?.cassettes ?? []).map((cas: any) => {
      const { choiceMode: _choiceMode, ...rest } = cas?.session ?? {}
      return { ...cas, session: rest }
    }),
  }),
  /** v4 → v5（計画 P1）。カセットが内包するセッションのシーンからも `ambientPins` を落とす */
  4: (s) => ({
    ...s,
    cassettes: (s?.cassettes ?? []).map((cas: any) => ({
      ...cas,
      session: {
        ...cas?.session,
        scenes: (cas?.session?.scenes ?? []).map(dropAmbientPins),
      },
    })),
  }),
}

export type MigrateResult = { ok: true; state: any } | { ok: false; error: SchemaError }

/** from → to まで1段ずつ適用する。欠けた段があれば失敗扱い（黙って素通しさせない） */
function applyChain(
  scope: SchemaScope,
  state: any,
  from: number,
  to: number,
  migrations: Record<number, Migration>,
): MigrateResult {
  if (from > to) return { ok: false, error: { scope, found: from, supported: to } }
  let s = state
  for (let v = from; v < to; v++) {
    const step = migrations[v]
    if (!step) {
      console.error(`[schema] ${scope}: v${v} → v${v + 1} の移行が定義されていません`)
      return { ok: false, error: { scope, found: from, supported: to } }
    }
    s = step(s)
  }
  return { ok: true, state: s }
}

/**
 * 永続化の入れ物を現行版へ上げる（zustand persist の `migrate` から呼ぶ）。
 * 未来の版番（この本体より新しいデータ）は上げようがないので失敗を返す。
 */
export function migrateAppState(persisted: unknown, from: number): MigrateResult {
  return applyChain('app', persisted, from, APP_STATE_VERSION, appStateMigrations)
}

/**
 * セッション1件を現行のセーブデータ版へ上げる（P2c。`SessionStore` の1レコード＝1版番）。
 * 版番がレコードごとに付くので、**移行の途中で落ちても次回は残りだけが上がる**（二重適用が起きない）。
 * 失敗（未来の版番・欠けた段）は `migrateSubSchemas` と同じく `SchemaError` を返す＝黙って読み捨てない。
 */
export function migrateSession(session: any, from: number): MigrateResult {
  return applyChain('save', session, from, SAVE_DATA_VERSION, sessionMigrations)
}

/**
 * セーブデータとカセット定義を現行版へ上げる（`merge` から毎回呼ぶ）。
 * 入れ物の版番が据え置きでも、この2つは単独で上げられる。
 * 版番が無いデータは初版（1）とみなす。
 */
export function migrateSubSchemas(persisted: any): MigrateResult {
  const found = persisted?.schemaVersions as Partial<SchemaVersions> | undefined
  const save = typeof found?.save === 'number' ? found.save : SAVE_DATA_VERSION
  const cassette = typeof found?.cassette === 'number' ? found.cassette : CASSETTE_DATA_VERSION

  const afterSave = applyChain('save', persisted, save, SAVE_DATA_VERSION, saveDataMigrations)
  if (!afterSave.ok) return afterSave
  return applyChain('cassette', afterSave.state, cassette, CASSETTE_DATA_VERSION, cassetteMigrations)
}

/** 起動時に出す説明文。原因（読めない／新しすぎる／移行の欠落）を利用者の言葉で1行に */
export function schemaErrorMessage(error: SchemaError): string {
  const label = SCOPE_LABEL[error.scope]
  if (error.reason) {
    return `保存されている${label}を読み出せませんでした（${error.reason}）。`
  }
  if (error.found > error.supported) {
    return `保存されている${label}は、この本体より新しいバージョン（形式 v${error.found}）で作られています。この本体が読めるのは v${error.supported} までです。`
  }
  return `保存されている${label}（形式 v${error.found}）を、この本体の形式 v${error.supported} へ移行できませんでした。`
}
