import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import ModalShell from './ModalShell'
import { Icon } from './icons'
import { AMBIENT_DEFAULT_RADIUS } from '../lib/ambient'
import AmbientRadiusField from './AmbientRadiusField'
import { AMBIENT_CATEGORIES, AMBIENT_SOUNDS, ambientSoundLabel } from '../lib/ambientSounds'
import { ensureAudio, previewSound, previewingSound, stopPreview } from '../lib/ambientAudio'
import { plainTextOf } from '../lib/structured'
import type { AmbientPin, Message, Scene } from '../types'

interface Props {
  sessionId: string
  scene: Scene
  message: Message
  onClose: () => void
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

/**
 * 環境音ピンの追加（AM1・AM2でレイアウト刷新）。
 *
 * 段落は `content.split('\n')` の**原文の行**で選ばせる。レンダリング上の折り返し行ではないので、
 * ウィンドウ幅・文字サイズが変わっても位置が壊れない。選択肢に空行は出さないが、保存するのは
 * 生の行番号（レンダラ側の索引と一致させるため）。
 *
 * 置いたあとは本文右側のスピーカーを**上下にドラッグ**して位置を変えられるので、
 * ここでの段落選びは「だいたいの位置」で足りる。
 */
export default function AmbientPinModal({ sessionId, scene, message, onClose }: Props) {
  const { addAmbientPin, removeAmbientPin } = useStore()
  const minePins = (scene.ambientPins ?? []).filter((p) => p.messageId === message.id)

  const rawLines = useMemo(() => message.content.split('\n'), [message.content])
  // 空行を除いた「選べる行」。value は原文の行番号
  const lines = useMemo(
    () =>
      rawLines
        .map((raw, index) => ({ index, text: plainTextOf(raw).trim() }))
        .filter((l) => l.text.length > 0),
    [rawLines],
  )

  const [lineIndex, setLineIndex] = useState<number>(lines[0]?.index ?? 0)
  const [soundId, setSoundId] = useState<string>(AMBIENT_SOUNDS[0]?.id ?? '')
  const [radius, setRadius] = useState<number>(AMBIENT_DEFAULT_RADIUS)
  const [maxGain, setMaxGain] = useState<number>(1)
  const [playing, setPlaying] = useState<string | null>(null)

  // モーダルを閉じたら試聴を止める（開いたまま本編の音と重なるのを防ぐ）
  useEffect(() => stopPreview, [])

  const togglePreview = async (id: string) => {
    ensureAudio()
    await previewSound(id)
    setPlaying(previewingSound())
  }

  const add = () => {
    if (!soundId) return
    const pin: AmbientPin = {
      id: uid(),
      soundId,
      messageId: message.id,
      lineIndex,
      radius,
      ...(maxGain < 1 ? { maxGain } : {}),
      createdAt: Date.now(),
    }
    addAmbientPin(sessionId, scene.id, pin)
    stopPreview()
    onClose()
  }

  const close = () => {
    stopPreview()
    onClose()
  }

  // 置く場所のプレビュー（前後1行ぶん）。「ここに入る」を実際の文面の中に見せる
  const preview = useMemo(() => {
    const from = Math.max(0, lineIndex - 1)
    return rawLines.slice(from, lineIndex + 2).map((raw, i) => ({
      text: plainTextOf(raw),
      here: from + i === lineIndex,
    }))
  }, [rawLines, lineIndex])

  return (
    <ModalShell
      title="環境音を置く"
      onClose={close}
      wide
      scrollableBody
      footer={
        <>
          <button className="link" onClick={close}>
            閉じる
          </button>
          <button className="primary" onClick={add} disabled={!soundId || lines.length === 0}>
            この位置に置く
          </button>
        </>
      }
    >
      {AMBIENT_SOUNDS.length === 0 ? (
        <p className="desc">同梱されている環境音がありません（音源ファイルが未配置です）。</p>
      ) : (
        <div className="ap-grid">
          <div className="ap-col">
            <div className="ap-section">どこに置くか</div>
            {lines.length === 0 ? (
              <p className="desc">この本文には段落がありません。</p>
            ) : (
              <>
                <div className="ap-preview-box">
                  {preview.map((p, i) => (
                    <div key={i}>
                      {p.here && (
                        <span className="ap-here">
                          <Icon name="volume-2" size={11} /> ここに入る
                        </span>
                      )}
                      {p.text || '　'}
                    </div>
                  ))}
                </div>
                <div className="ap-section">段落を選ぶ</div>
                <div className="ap-lines">
                  {lines.map((l) => (
                    <button
                      key={l.index}
                      className={'ap-line' + (l.index === lineIndex ? ' on' : '')}
                      onClick={() => setLineIndex(l.index)}
                    >
                      <span className="ap-line-no">{l.index + 1}</span>
                      <span className="ap-line-text">{l.text}</span>
                    </button>
                  ))}
                </div>
                <p className="ap-hint" style={{ padding: '8px 0 0' }}>
                  置いたあとは本文右側のスピーカーを上下にドラッグして動かせます。
                </p>
              </>
            )}
          </div>

          <div className="ap-col">
            <div className="ap-section">どの音を鳴らすか（クリックで試聴）</div>
            <div className="ap-scroll">
              {AMBIENT_CATEGORIES.map((cat) => (
                <div key={cat}>
                  <div className="ap-cat">{cat}</div>
                  <div className="ap-sounds">
                    {AMBIENT_SOUNDS.filter((s) => s.category === cat).map((s) => (
                      <button
                        key={s.id}
                        className={
                          'ap-sound' + (s.id === soundId ? ' on' : '') + (playing === s.id ? ' playing' : '')
                        }
                        onClick={() => {
                          setSoundId(s.id)
                          void togglePreview(s.id)
                        }}
                        title={s.credit}
                      >
                        <span className="ap-preview">
                          <Icon name={playing === s.id ? 'square' : 'play'} size={12} />
                        </span>
                        <span className="ap-sound-name">{s.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="ap-section">音量の上限（ピーク位置での大きさ）</div>
            <div className="ambient-menu-row" style={{ padding: 0 }}>
              <input
                type="range"
                min={5}
                max={100}
                step={5}
                value={Math.round(maxGain * 100)}
                onChange={(e) => setMaxGain(Number(e.target.value) / 100)}
                style={{ width: '100%' }}
                aria-label="音量の上限"
              />
              <div className="ap-hint" style={{ padding: '2px 0 0' }}>
                {Math.round(maxGain * 100)}%（素材ごとの主張の強さをここで抑える）
              </div>
            </div>

            <div className="ap-section">どこまで届くか（到達半径）</div>
            <AmbientRadiusField value={radius} onChange={setRadius} />

            {minePins.length > 0 && (
              <>
                <div className="ap-section">この本文に置いてある環境音</div>
                {minePins.map((p) => (
                  <div className="ap-existing" key={p.id}>
                    <Icon name="volume-2" size={13} />
                    <span className="ap-existing-name">
                      {ambientSoundLabel(p.soundId)}（{p.lineIndex + 1} 段落目）
                    </span>
                    <button className="link" onClick={() => removeAmbientPin(sessionId, scene.id, p.id)}>
                      削除
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </ModalShell>
  )
}
