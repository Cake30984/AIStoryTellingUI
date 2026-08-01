import { ambientSoundById } from './ambientSounds'

/**
 * 環境音の再生エンジン（AM1）。React 非依存のモジュールレベル状態（`imageJobs.ts` の
 * AbortController Map と同じ作法）。呼び出し側は「いま各音をどれくらいの音量で鳴らしたいか」
 * だけを渡し、実際の追従・生成・破棄はここが持つ。
 *
 * `<audio loop>` ではなく Web Audio を使う理由: `<audio>` のループはブラウザ差で継ぎ目に
 * ギャップが出るのと、多重再生時の音量制御が粗いため。
 *
 * 設計は `docs/設計_環境音ピン.md` §5。
 */

/** 目標音量への追従速度（毎秒。0→1 に約 2.5 秒 ＝ スクロールの微動で音量がヒクつかない） */
const RATE = 0.4
/** 実測音量が 0 のままこの時間続いたら source を止めて捨てる（画面外を鳴らし続けない） */
const STOP_AFTER_SILENT_MS = 1500
/** 目標にこれ以下まで近づいたら 0 とみなす */
const EPS = 0.001

interface Voice {
  src: AudioBufferSourceNode
  gain: GainNode
  /** いま実際に出している音量（0..1・master 適用前） */
  cur: number
  /** 0 になった時刻（まだ 0 でなければ null） */
  zeroSince: number | null
}

let ctx: AudioContext | null = null
let master: GainNode | null = null
let masterVolume = 0.6
let lastTick = 0
const buffers = new Map<string, AudioBuffer>()
const loading = new Map<string, Promise<AudioBuffer | null>>()
const failed = new Set<string>()
const voices = new Map<string, Voice>()

/**
 * AudioContext を用意する。**ユーザー操作の中から呼ぶこと**（ブラウザ／WebView の
 * 自動再生ポリシーで、操作前に作った context は suspended のまま鳴らない）。
 * 既に生成済みなら resume だけ試みる。
 */
export function ensureAudio(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return false
      ctx = new Ctor()
      master = ctx.createGain()
      master.gain.value = masterVolume
      master.connect(ctx.destination)
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return true
  } catch {
    return false
  }
}

/** 音が出せる状態か（context があり suspended でない） */
export function isAudioReady(): boolean {
  return !!ctx && ctx.state === 'running'
}

export function setMasterVolume(v: number): void {
  masterVolume = Math.min(1, Math.max(0, v))
  if (ctx && master) master.gain.setTargetAtTime(masterVolume, ctx.currentTime, 0.05)
}

/** 音源を読み込んでデコードする。失敗した id は以後スキップ（1回だけ warn） */
async function bufferOf(soundId: string): Promise<AudioBuffer | null> {
  if (buffers.has(soundId)) return buffers.get(soundId)!
  if (failed.has(soundId)) return null
  const existing = loading.get(soundId)
  if (existing) return existing
  const def = ambientSoundById(soundId)
  if (!def || !ctx) return null
  const p = (async () => {
    try {
      const res = await fetch(def.url)
      const buf = await ctx!.decodeAudioData(await res.arrayBuffer())
      buffers.set(soundId, buf)
      return buf
    } catch (e) {
      failed.add(soundId)
      console.warn(`[ambient] 音源を読み込めませんでした: ${soundId}`, e)
      return null
    } finally {
      loading.delete(soundId)
    }
  })()
  loading.set(soundId, p)
  return p
}

function startVoice(soundId: string, buf: AudioBuffer): Voice | null {
  if (!ctx || !master) return null
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = true
  const gain = ctx.createGain()
  gain.gain.value = 0
  src.connect(gain)
  gain.connect(master)
  // ループ位置をずらして始める＝同じ音を再訪しても毎回同じ所から鳴らない
  src.start(0, Math.random() * buf.duration)
  const v: Voice = { src, gain, cur: 0, zeroSince: null }
  voices.set(soundId, v)
  return v
}

function stopVoice(soundId: string, v: Voice): void {
  try {
    v.src.stop()
  } catch {
    /* 既に停止済み */
  }
  v.src.disconnect()
  v.gain.disconnect()
  voices.delete(soundId)
}

/**
 * 「いま鳴らしたい音量」の一覧を反映する。目標へは一定速度で追従させる（＝スクロールを
 * 止めて読んでいる間は距離が変わらないので音量も動かない）。
 * 一覧に無い soundId は目標 0 として扱う。
 */
export function applyTargets(targets: { soundId: string; gain: number }[]): void {
  if (!ctx || !master) return
  const now = performance.now()
  const dt = lastTick ? Math.min(0.5, (now - lastTick) / 1000) : 0
  lastTick = now
  const step = RATE * dt

  const wanted = new Map<string, number>()
  for (const t of targets) {
    const g = Math.min(1, Math.max(0, t.gain))
    // 同じ音の複数ピンは max で1本に畳む（二重再生で音量が跳ねないように）
    wanted.set(t.soundId, Math.max(wanted.get(t.soundId) ?? 0, g))
  }

  for (const [soundId, target] of wanted) {
    if (voices.has(soundId)) continue
    if (target <= EPS) continue
    // 未再生かつ鳴らしたい → 読み込んで開始（デコード完了までは無音）
    void bufferOf(soundId).then((buf) => {
      if (buf && !voices.has(soundId)) startVoice(soundId, buf)
    })
  }

  for (const [soundId, v] of [...voices]) {
    const target = wanted.get(soundId) ?? 0
    if (dt > 0) {
      const diff = target - v.cur
      v.cur = Math.abs(diff) <= step ? target : v.cur + Math.sign(diff) * step
    }
    if (v.cur < EPS) v.cur = 0
    // setTargetAtTime で当てる（値を直接代入するとステップのクリック音が出る）
    v.gain.gain.setTargetAtTime(v.cur, ctx.currentTime, 0.05)
    if (v.cur === 0 && target === 0) {
      v.zeroSince ??= now
      if (now - v.zeroSince > STOP_AFTER_SILENT_MS) stopVoice(soundId, v)
    } else {
      v.zeroSince = null
    }
  }
}

/** 全部止める（セッション切替・機能 OFF・アンマウント時）。試聴も含めて無音にする */
export function stopAll(): void {
  for (const [soundId, v] of [...voices]) stopVoice(soundId, v)
  lastTick = 0
  stopPreview()
}

/**
 * 試聴は**ピンの再生とは別チャンネル**で持つ（`voices` に相乗りしない）。
 * 相乗りすると、同じ音のピンが鳴っている最中に試聴すると互いの音量を奪い合い、
 * 試聴を止めるとピンの音まで切れる。
 */
let preview: { soundId: string; src: AudioBufferSourceNode; gain: GainNode } | null = null
/**
 * 試聴の世代。`previewSound` は音源のデコードで await するので、その隙間に次のクリックや
 * モーダルを閉じる操作が入りうる。**開始直前に世代が変わっていたら破棄する**ことで、
 * 「連続でクリックすると前の音が止まらなくなる」不具合を防ぐ。
 */
let previewGen = 0

function killPreview(): void {
  if (!preview) return
  try {
    preview.src.stop()
  } catch {
    /* 既に停止済み */
  }
  preview.src.disconnect()
  preview.gain.disconnect()
  preview = null
}

/**
 * カタログからの試聴（追加 UI 用）。指定の音だけを master 音量で鳴らす。
 * 同じ id をもう一度呼ぶと停止（トグル）。
 */
export async function previewSound(soundId: string): Promise<void> {
  const wasPlaying = preview?.soundId === soundId
  // 何が起きても、まず今鳴っている試聴は止める（世代も進めて進行中の開始を無効化する）
  previewGen++
  killPreview()
  if (wasPlaying) return
  if (!ensureAudio() || !ctx || !master) return

  const gen = previewGen
  const buf = await bufferOf(soundId)
  // await の間に別の音が押された／モーダルが閉じられたなら、もう鳴らさない
  if (!buf || gen !== previewGen || !ctx || !master) return

  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = true
  const gain = ctx.createGain()
  gain.gain.value = 0
  src.connect(gain)
  gain.connect(master)
  src.start(0, Math.random() * buf.duration)
  gain.gain.setTargetAtTime(1, ctx.currentTime, 0.08)
  preview = { soundId, src, gain }
}

/** 試聴中の音があれば止める（モーダルを閉じた時） */
export function stopPreview(): void {
  previewGen++
  killPreview()
}

/** 試聴中の soundId（UI のトグル表示用） */
export function previewingSound(): string | null {
  return preview?.soundId ?? null
}
