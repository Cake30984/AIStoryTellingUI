import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import ModalShell from './ModalShell'
import { Icon } from './icons'
import { AMBIENT_DEFAULT_RADIUS, AMBIENT_RADIUS_CHOICES } from '../lib/ambient'
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
 * 環境音ピンの追加・削除（AM1）。
 *
 * 段落（＝本文の行）は `content.split('\n')` の**原文の行**で選ばせる。レンダリング上の
 * 折り返し行ではないので、ウィンドウ幅・文字サイズが変わっても位置が壊れない。
 * 選択肢には空行を出さないが、保存するのは生の行番号（レンダラ側の索引と一致させるため）。
 */
export default function AmbientPinModal({ sessionId, scene, message, onClose }: Props) {
  const { addAmbientPin, removeAmbientPin } = useStore()
  const pins = scene.ambientPins ?? []
  const minePins = pins.filter((p) => p.messageId === message.id)

  // 空行を除いた「選べる行」。value は原文の行番号
  const lines = useMemo(() => {
    return message.content
      .split('\n')
      .map((raw, index) => ({ index, text: plainTextOf(raw).trim() }))
      .filter((l) => l.text.length > 0)
  }, [message.content])

  const [lineIndex, setLineIndex] = useState<number>(lines[0]?.index ?? 0)
  const [soundId, setSoundId] = useState<string>(AMBIENT_SOUNDS[0]?.id ?? '')
  const [radius, setRadius] = useState<number>(AMBIENT_DEFAULT_RADIUS)
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
      createdAt: Date.now(),
    }
    addAmbientPin(sessionId, scene.id, pin)
    stopPreview()
    onClose()
  }

  return (
    <ModalShell
      title="環境音を置く"
      onClose={() => {
        stopPreview()
        onClose()
      }}
      scrollableBody
      footer={
        <>
          <button
            className="link"
            onClick={() => {
              stopPreview()
              onClose()
            }}
          >
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
        <>
          <div className="ap-section">どの段落に置くか</div>
          {lines.length === 0 ? (
            <p className="desc">この本文には段落がありません。</p>
          ) : (
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
          )}

          <div className="ap-section">どの音を鳴らすか（クリックで試聴）</div>
          {AMBIENT_CATEGORIES.map((cat) => (
            <div key={cat}>
              <div className="ap-section">{cat}</div>
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

          <div className="ap-section">どこまで届くか（到達半径）</div>
          <div className="ap-radius">
            {AMBIENT_RADIUS_CHOICES.map((r) => (
              <button
                key={r.value}
                className={'scene-btn' + (radius === r.value ? ' on' : '')}
                onClick={() => setRadius(r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>

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
                    外す
                  </button>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </ModalShell>
  )
}
