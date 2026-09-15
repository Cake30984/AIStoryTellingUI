import { useEffect, useRef, useState } from 'react'
import { storeActions, useStore } from '../store'
import ModalShell from './ModalShell'
import SessionEditor from './SessionEditor'
import { Icon } from './icons'

/** 前提の書き方を見せるための例文（押すと入力欄へ入る）。計画 P4 の3つをそのまま使う */
const EXAMPLES = [
  '廃校寸前の高校の写真部',
  '辺境の駅の小さな食堂',
  '魔女の弟子の最初の一年',
]

interface Props {
  onClose: () => void
}

/**
 * 一行から始める（P4）。
 *
 * 一行の前提 → `kickoffStory`（世界・登場人物・導入を1呼び出しで起案）→ **そのまま
 * `SessionEditor` を開いた状態で見せる**。起案は下書きで、直してから「保存」で始める
 * ＝ここで生成は始めない（`CharacterDraftModal` → `CharacterEditor` と同じ流儀）。
 *
 * 起案に失敗しても空のセッションの設定画面を開く（理由は冒頭の案内に出す）。
 */
export default function StoryKickoffModal({ onClose }: Props) {
  const { kickoffStory } = storeActions()
  const [premise, setPremise] = useState('')
  const [running, setRunning] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const controllerRef = useRef<AbortController | null>(null)

  // 閉じられたら起案を中断する（中断できた場合は素材もセッションも作らない）
  useEffect(() => () => controllerRef.current?.abort(), [])

  const session = useStore((st) => (sessionId ? st.sessions.find((s) => s.id === sessionId) : undefined))

  const run = async () => {
    if (running || !premise.trim()) return
    const controller = new AbortController()
    controllerRef.current = controller
    setRunning(true)
    const res = await kickoffStory(premise, controller.signal)
    controllerRef.current = null
    if (controller.signal.aborted || !res.sessionId) return
    setNotice(
      res.error ||
        '一行から起案した下書きです。世界観・登場人物・導入は「保存」する前に直せます（保存した素材はライブラリに「起案」タグ付きで残ります）。',
    )
    setSessionId(res.sessionId)
    setRunning(false)
  }

  // 起案が終わったらセッション設定へ引き継ぐ（＝ここから先は通常の編集画面）
  if (session) return <SessionEditor session={session} notice={notice} onClose={onClose} />

  return (
    <ModalShell
      title="一行から始める"
      onClose={onClose}
      footer={
        <>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            {running ? '中止' : 'キャンセル'}
          </button>
          <button className="btn primary" onClick={() => void run()} disabled={running || !premise.trim()}>
            <Icon name="sparkles" size={14} /> {running ? '起案中…' : '起案する'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>どんな物語？</label>
        <div className="desc">
          一行でかまいません。ここから世界観・登場人物・最初の一場面を起案します（1〜2分ほどかかります）。
        </div>
        <textarea
          rows={3}
          autoFocus
          placeholder="例: 廃校寸前の高校の写真部"
          value={premise}
          disabled={running}
          onChange={(e) => setPremise(e.target.value)}
        />
      </div>
      <div className="field">
        <label>書き出しの例</label>
        <div className="pick-grid">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="pick-chip" disabled={running} onClick={() => setPremise(ex)}>
              {ex}
            </button>
          ))}
        </div>
      </div>
      {running && <div className="reviewing-placeholder">世界と登場人物を起案中…</div>}
    </ModalShell>
  )
}
