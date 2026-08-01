import type { AmbientSoundDef } from '../types'

/**
 * 内蔵環境音カタログ（AM1）。**これはアプリの一部であって世界観データではない**。
 * 世界観・セッションに載るのは `AmbientPin.soundId`（下の安定キー文字列）だけで、
 * 音声バイトは state.json にもカセットにも入らない（`docs/設計_環境音ピン_実験.md` §6）。
 *
 * id は `uid()` にしない。カタログはアプリと一緒にバージョン管理される作り込み資産なので、
 * `'rain-soft'` のような安定・可読キーにする（カセットを別バージョンのアプリで開いた時の
 * 解決性とフォールバックのため）。
 *
 * 実体は `src/assets/ambient/<id>.ogg`。**カタログに宣言があってファイルが無い id は
 * 起動時に落とす**（`AMBIENT_SOUNDS` は解決できたものだけを持つ）ので、音源の調達と
 * 実装を非同期に進められる。ライセンス確認待ちの音もここに宣言だけしておける。
 */

/** Vite のアセットグラフ経由で同梱音源の URL を解決する（Web / Tauri で同じ結果になる） */
const FILES = import.meta.glob('../assets/ambient/*.ogg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

const urlOf = (id: string): string | undefined => FILES[`../assets/ambient/${id}.ogg`]

/** 音源ファイルの有無に関わらない宣言。実体が無いものは `AMBIENT_SOUNDS` から落ちる */
interface CatalogEntry {
  id: string
  label: string
  category: string
  credit: string
}

/**
 * カタログ宣言。`credit` は表示義務のためではなく**ライセンス根拠を後から辿るため**に持つ
 * （出所と加工の記録は `_ambient_work/出所と帰属.md`）。
 * すべて 48kHz モノラル・約 -23 LUFS・末尾クロスフェードでループ化済み。
 */
const CATALOG: CatalogEntry[] = [
  // ── 天候 ───────────────────────────────────────────────
  { id: 'rain-soft', label: '雨（弱）', category: '天候', credit: 'VSQ plus+ (VSQSE_0354_rain_03)' },
  { id: 'rain-heavy', label: '雨（強）', category: '天候', credit: 'VSQ plus+ (VSQSE_0651_rain_05)' },
  { id: 'blizzard', label: '吹雪', category: '天候', credit: '効果音ラボ（吹雪）' },
  // ── 風 ─────────────────────────────────────────────────
  { id: 'wind-plain', label: '風（草原）', category: '風', credit: 'VSQ plus+ (VSQSE_0611_wind_02)' },
  { id: 'wind-gust', label: '風（吹きすさぶ）', category: '風', credit: 'VSQ plus+ (VSQSE_0613_wind_04)' },
  { id: 'wind-rumble', label: '風（低くうなる）', category: '風', credit: 'VSQ plus+ (VSQSE_0612_wind_03)' },
  { id: 'wind-blow-1', label: '風が吹く（1）', category: '風', credit: '効果音ラボ（風が吹く1）' },
  { id: 'wind-blow-2', label: '風が吹く（2）', category: '風', credit: '効果音ラボ（風が吹く2）' },
  { id: 'leaves-rustle-1', label: '風に揺れる草木（1）', category: '風', credit: '効果音ラボ（風に揺れる草木1）' },
  { id: 'leaves-rustle-2', label: '風に揺れる草木（2）', category: '風', credit: '効果音ラボ（風に揺れる草木2）' },
  // ── 水辺 ───────────────────────────────────────────────
  { id: 'waves-shore', label: '波（浜辺）', category: '水辺', credit: '効果音ラボ（海岸3）' },
  { id: 'waves-calm', label: '波（穏やか）', category: '水辺', credit: '効果音ラボ（海岸4）' },
  { id: 'pond-mountain', label: '山奥の池', category: '水辺', credit: '効果音ラボ（山奥の池）' },
  { id: 'cave-drips', label: '水のしたたる洞窟', category: '水辺', credit: '効果音ラボ（水のしたたる洞窟）' },
  // ── 自然・季節 ─────────────────────────────────────────
  { id: 'spring-mountain', label: '春の山', category: '自然', credit: '効果音ラボ（春の山）' },
  { id: 'summer-mountain', label: '夏の山', category: '自然', credit: '効果音ラボ（夏の山2）' },
  { id: 'summer-countryside', label: '夏の田舎道', category: '自然', credit: '効果音ラボ（夏の田舎道）' },
  // ── 生き物 ─────────────────────────────────────────────
  { id: 'cicada-summer', label: '蝉（ミンミンゼミ）', category: '生き物', credit: '効果音ラボ（ミンミンゼミが鳴く雑木林）' },
  { id: 'crow-evening', label: 'カラスの鳴く夕方', category: '生き物', credit: '効果音ラボ（カラスが鳴く夕方）' },
  // ── 火・屋内 ───────────────────────────────────────────
  { id: 'campfire', label: '焚き火', category: '火・屋内', credit: '効果音ラボ（たき火）' },
  { id: 'furin-house', label: '風鈴の鳴る家', category: '火・屋内', credit: '効果音ラボ（風鈴が鳴る家1）' },
  { id: 'furin-room', label: '風鈴の鳴る部屋', category: '火・屋内', credit: '効果音ラボ（風鈴のなる部屋）' },
  { id: 'bathhouse', label: '大浴場', category: '火・屋内', credit: '効果音ラボ（大浴場）' },
  // ── 街・人 ─────────────────────────────────────────────
  { id: 'fireworks', label: '花火大会', category: '街・人', credit: '効果音ラボ（花火大会）' },
  // ── 空間 ───────────────────────────────────────────────
  { id: 'magic-room', label: '魔力に満ちた部屋', category: '空間', credit: '効果音ラボ（魔力に満ちた部屋）' },
]

/** 実体（同梱ファイル）が解決できた音だけのカタログ。UI とエンジンはこれだけを見る */
export const AMBIENT_SOUNDS: AmbientSoundDef[] = CATALOG.flatMap((c) => {
  const url = urlOf(c.id)
  return url ? [{ ...c, url }] : []
})

/** カテゴリの並び順（カタログの登場順を保つ） */
export const AMBIENT_CATEGORIES: string[] = AMBIENT_SOUNDS.reduce<string[]>(
  (acc, s) => (acc.includes(s.category) ? acc : [...acc, s.category]),
  [],
)

/** soundId → 定義。カタログに無い（＝別バージョンで消えた・未同梱）なら undefined＝黙ってスキップ */
export function ambientSoundById(soundId: string): AmbientSoundDef | undefined {
  return AMBIENT_SOUNDS.find((s) => s.id === soundId)
}

/** 表示用の名前。解決できない id は素の文字列を返す（ピンの存在自体は隠さない） */
export function ambientSoundLabel(soundId: string): string {
  return ambientSoundById(soundId)?.label ?? soundId
}
