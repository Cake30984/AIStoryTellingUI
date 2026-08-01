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

/**
 * Vite のアセットグラフ経由で同梱音源の URL を解決する（Web / Tauri で同じ結果になる）。
 * 形式は **FLAC（可逆）**。元素材が 320kbps の MP3 なので、そこから非可逆で再エンコードすると
 * 世代劣化が乗る。加工（切り出し・ラウドネス調整・ループのクロスフェード）だけを掛けて
 * 可逆で格納する。ステレオ・48kHz も素材のまま（モノラル化・リサンプルは劣化なので行わない）。
 */
const FILES = import.meta.glob('../assets/ambient/*.flac', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

const urlOf = (id: string): string | undefined => FILES[`../assets/ambient/${id}.flac`]

/** 音源ファイルの有無に関わらない宣言。実体が無いものは `AMBIENT_SOUNDS` から落ちる */
interface CatalogEntry {
  id: string
  label: string
  category: string
  credit: string
}

/**
 * カタログ宣言。すべて **VSQ plus+** の素材（利用規約の確認結果は
 * `docs/環境音_音源調達リスト.md` §0.2）。`credit` は表示義務のためではなく
 * **ライセンス根拠を後から辿るため**に持つ。
 * 加工＝切り出し → -23 LUFS 正規化（一定ゲイン）→ 末尾クロスフェードでループ化。
 * ステレオ・48kHz のまま可逆（FLAC）で格納している。
 *
 * ⚠ 波が7本あるが、**ラベルは測定（低域/高域のバランス）で機械的に付けた暫定名**。
 * 実際に聴いて違えば張り替えること。
 */
const CATALOG: CatalogEntry[] = [
  // ── 天候 ───────────────────────────────────────────────
  { id: 'rain-soft', label: '雨（弱）', category: '天候', credit: 'VSQ plus+ (VSQSE_0354_rain_03)' },
  { id: 'rain-mid', label: '雨', category: '天候', credit: 'VSQ plus+ (VSQSE_0992_rain_08)' },
  { id: 'rain-heavy', label: '雨（強）', category: '天候', credit: 'VSQ plus+ (VSQSE_0651_rain_05)' },
  { id: 'thunder', label: '雷', category: '天候', credit: 'VSQ plus+ (VSQSE_0988_thunder_02)' },
  // ── 風 ─────────────────────────────────────────────────
  { id: 'wind-plain', label: '風（草原）', category: '風', credit: 'VSQ plus+ (VSQSE_0611_wind_02)' },
  { id: 'wind-gust', label: '風（吹きすさぶ）', category: '風', credit: 'VSQ plus+ (VSQSE_0613_wind_04)' },
  { id: 'wind-rumble', label: '風（低くうなる）', category: '風', credit: 'VSQ plus+ (VSQSE_0612_wind_03)' },
  // ── 水辺 ───────────────────────────────────────────────
  { id: 'waves-shore', label: '波（浜辺）', category: '水辺', credit: 'VSQ plus+ (VSQSE_0588_wave_02)' },
  { id: 'waves-calm', label: '波（穏やか）', category: '水辺', credit: 'VSQ plus+ (VSQSE_0648_wave_04)' },
  { id: 'waves-close', label: '波（間近）', category: '水辺', credit: 'VSQ plus+ (VSQSE_0866_wave_14)' },
  { id: 'waves-ripple', label: 'さざ波', category: '水辺', credit: 'VSQ plus+ (VSQSE_0868_wave_16)' },
  { id: 'waves-steady', label: '波（絶え間なく）', category: '水辺', credit: 'VSQ plus+ (VSQSE_0872_wave_20)' },
  { id: 'waves-fine', label: '波（細かい）', category: '水辺', credit: 'VSQ plus+ (VSQSE_0981_wave_26)' },
  { id: 'waves-heavy', label: '大波', category: '水辺', credit: 'VSQ plus+ (VSQSE_1189_wave_35)' },
  { id: 'river', label: '川', category: '水辺', credit: 'VSQ plus+ (VSQSE_0966_river_18)' },
  // ── 火・屋内 ───────────────────────────────────────────
  { id: 'campfire', label: '焚き火', category: '火・屋内', credit: 'VSQ plus+ (VSQSE_0615_fire_02)' },
  { id: 'room-furin', label: '室内（風鈴）', category: '火・屋内', credit: 'VSQ plus+ (VSQSE_1010_room_ambient_05)' },
  { id: 'room-crow', label: '室内（カラスの声）', category: '火・屋内', credit: 'VSQ plus+ (VSQSE_1008_room_ambient_04)' },
  // ── 生き物 ─────────────────────────────────────────────
  { id: 'higurashi', label: 'ヒグラシ', category: '生き物', credit: 'VSQ plus+ (VSQSE_0821_rice_field_06)' },
  { id: 'insects-morning', label: '朝の虫の声', category: '生き物', credit: 'VSQ plus+ (VSQSE_0824_morning_countryside_01)' },
  { id: 'uguisu', label: 'ウグイス', category: '生き物', credit: 'VSQ plus+ (VSQSE_0848_Japanese_nightingale_02)' },
  { id: 'uguisu-2', label: 'ウグイス（2）', category: '生き物', credit: 'VSQ plus+ (VSQSE_1187_Japanese_nightingale_04)' },
  { id: 'city-birds', label: '街と鳥の声', category: '生き物', credit: 'VSQ plus+ (VSQSE_0586_city_bird)' },
  // ── 自然 ───────────────────────────────────────────────
  { id: 'rice-field', label: '田んぼ', category: '自然', credit: 'VSQ plus+ (VSQSE_0920_rice_field_11)' },
  { id: 'pastoral', label: '田園', category: '自然', credit: 'VSQ plus+ (VSQSE_1078_pastoral_landscape_03)' },
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
