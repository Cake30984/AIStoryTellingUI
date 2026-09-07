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

/** 永続化の入れ物の版番（zustand persist の `version`）。v1 が初版 */
export const APP_STATE_VERSION = 1

/**
 * セーブデータ（sessions / branchTrees / チェックポイント）の版番。
 *
 * **v1 は R7 = 案 a（発見キャラは素材に入れたまま・`SessionOverlay` にキャラを持たせない）を
 * 前提に確定した**（2026-08-15 決定。docs/設計_公開前実装.md R7）。将来 b へ寝返る場合は
 * `SessionOverlay` に `characters` を足したうえでこの版番を 2 に上げ、`saveDataMigrations[1]` を
 * 1本書く（＝**もう「あとから足せない」状態ではない**。migrate が入ったのでスキーマの
 * 判断を先送りしても復旧可能になった）。
 */
export const SAVE_DATA_VERSION = 2

/** カセット定義（cassettes）の版番 */
export const CASSETTE_DATA_VERSION = 2

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
}

const saveDataMigrations: Record<number, Migration> = {
  /**
   * v1 → v2（F2・時間と予定）。`Timeline` を廃止して `SessionState` に
   * `now`/`place`/`presentIds`/`situation`/`pending`/`recentDone` を足した。
   * 旧セッションは「時刻はまだ決まっていない」状態から始め直す＝
   * 旧 `timeline` の日付は自由文字列へ機械的に写せない（暦が違う世界がありうる）ので、
   * `timeLabel` の写しだけ拾って残りは空にする。
   */
  1: (s) => ({
    ...s,
    sessions: (s?.sessions ?? []).map((sess: any) => {
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
    }),
  }),
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

/** 起動時に出す説明文。原因（新しすぎる／移行の欠落）を利用者の言葉で1行に */
export function schemaErrorMessage(error: SchemaError): string {
  const label = SCOPE_LABEL[error.scope]
  if (error.found > error.supported) {
    return `保存されている${label}は、この本体より新しいバージョン（形式 v${error.found}）で作られています。この本体が読めるのは v${error.supported} までです。`
  }
  return `保存されている${label}（形式 v${error.found}）を、この本体の形式 v${error.supported} へ移行できませんでした。`
}
