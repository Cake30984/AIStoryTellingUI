import { useEffect, useState } from 'react'
import { useStore } from '../store'
import ModalShell from './ModalShell'
import { Icon } from './icons'
import {
  attributionFooter,
  exportableScenes,
  excerptOf,
  loadSessionSnapshot,
  sessionToIllustratedMarkdown,
  sessionToText,
  type ExportFormat,
} from '../lib/storyExport'
import { renderStoryCard } from '../lib/storyCard'
import { getImage } from '../lib/imageStore'
import { downloadBlob } from '../lib/io'
import type { Session } from '../types'

interface Props {
  sessionId: string
  /** 指定時: この分岐（チェックポイント）時点のスナップショットを書き出す。省略時は現在の進行 */
  nodeId?: string
  onClose: () => void
}

const fieldStyle = {
  width: '100%',
  background: 'var(--bg-elev2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text)',
  padding: '9px 11px',
  outline: 'none',
  fontSize: 14,
  marginBottom: 8,
} as const

/** R10: 物語の書き出し（テキスト・挿絵つき Markdown・X 向け画像カード） */
export default function StoryExportModal({ sessionId, nodeId, onClose }: Props) {
  const { sessions, characters, personas, cassettes } = useStore()
  const liveSession = sessions.find((s) => s.id === sessionId)

  // フックはすべて早期 return より前に置く（Rules of Hooks）
  const [snapshot, setSnapshot] = useState<Session | null | undefined>(nodeId ? undefined : null)
  const [snapshotError, setSnapshotError] = useState('')
  const [unit, setUnit] = useState<'session' | 'scene'>('session')
  const [sceneId, setSceneId] = useState('')
  const [format, setFormat] = useState<ExportFormat>('markdown')
  const [includeIllustrations, setIncludeIllustrations] = useState(true)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const [copyNotice, setCopyNotice] = useState('')
  const [cardBusy, setCardBusy] = useState(false)

  useEffect(() => {
    if (!nodeId) return
    let cancelled = false
    loadSessionSnapshot(sessionId, nodeId)
      .then((s) => {
        if (!cancelled) setSnapshot(s)
      })
      .catch((e) => {
        if (!cancelled) setSnapshotError((e as Error).message)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, nodeId])

  const session = nodeId ? snapshot : liveSession
  const scenes = session ? exportableScenes(session) : []

  useEffect(() => {
    if (!sceneId && scenes.length > 0) setSceneId(scenes[scenes.length - 1].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes.length])

  if (nodeId && snapshot === undefined && !snapshotError) {
    return (
      <ModalShell title="物語を書き出す" onClose={onClose}>
        <p className="desc">読み込み中…</p>
      </ModalShell>
    )
  }
  if (snapshotError || !session) {
    return (
      <ModalShell title="物語を書き出す" onClose={onClose}>
        <p className="notice" style={{ color: 'var(--danger)' }}>
          {snapshotError || 'セッションが見つかりません。'}
        </p>
      </ModalShell>
    )
  }

  const persona = personas.find((p) => p.id === session.personaId)
  const personaName = persona?.name || 'あなた'
  const cassetteTitle = session.originCassetteId
    ? cassettes.find((c) => c.id === session.originCassetteId)?.title
    : undefined
  const workTitle = cassetteTitle || session.title || '無題の物語'
  const exportUnit = unit === 'scene' && sceneId ? ({ kind: 'scene', sceneId } as const) : ({ kind: 'session' } as const)

  const buildText = async () => {
    setBusy(true)
    setCopyNotice('')
    try {
      const body =
        format === 'markdown' && includeIllustrations
          ? await sessionToIllustratedMarkdown(session, characters, personaName, exportUnit)
          : sessionToText(session, characters, personaName, format, exportUnit)
      setText(body ? body + attributionFooter(workTitle, format) : '（この範囲には書き出せる本文がありません）')
    } finally {
      setBusy(false)
    }
  }

  const copyText = async () => {
    await navigator.clipboard.writeText(text)
    setCopyNotice('コピーしました。')
  }

  const saveText = async () => {
    const ext = format === 'markdown' ? 'md' : 'txt'
    const mime = format === 'markdown' ? 'text/markdown' : 'text/plain'
    const blob = new Blob([text], { type: `${mime};charset=utf-8` })
    await downloadBlob(blob, `${workTitle}.${ext}`)
  }

  const saveCard = async () => {
    setCardBusy(true)
    try {
      const targetSceneId = unit === 'scene' ? sceneId : scenes[scenes.length - 1]?.id
      const scene = session.scenes.find((s) => s.id === targetSceneId)
      const illustrations = scene?.illustrations
      const illustrationImageId = illustrations?.[illustrations.length - 1]?.imageId
      const illustration = illustrationImageId ? await getImage(illustrationImageId) : undefined
      const blob = await renderStoryCard({
        title: workTitle,
        excerpt: excerptOf(session, targetSceneId),
        attribution: `デリスト『${workTitle}』より`,
        illustration,
      })
      await downloadBlob(blob, `${workTitle}-card.png`)
    } finally {
      setCardBusy(false)
    }
  }

  return (
    <ModalShell title="物語を書き出す" onClose={onClose} wide>
      <p className="desc" style={{ marginTop: 0 }}>
        カクヨム・note・X にそのまま貼れる形で書き出します。挿絵は Markdown にのみ埋め込めます。
      </p>

      <label className="sub-label">範囲</label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button className={'btn' + (unit === 'session' ? ' primary' : '')} onClick={() => setUnit('session')}>
          セッション全体
        </button>
        <button
          className={'btn' + (unit === 'scene' ? ' primary' : '')}
          onClick={() => setUnit('scene')}
          disabled={scenes.length === 0}
        >
          シーン単位
        </button>
      </div>
      {unit === 'scene' && (
        <select style={fieldStyle} value={sceneId} onChange={(e) => setSceneId(e.target.value)}>
          {scenes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title || '無題のシーン'}
            </option>
          ))}
        </select>
      )}

      <label className="sub-label">形式</label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button className={'btn' + (format === 'markdown' ? ' primary' : '')} onClick={() => setFormat('markdown')}>
          Markdown
        </button>
        <button className={'btn' + (format === 'plain' ? ' primary' : '')} onClick={() => setFormat('plain')}>
          プレーンテキスト
        </button>
      </div>
      {format === 'markdown' && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={includeIllustrations}
            onChange={(e) => setIncludeIllustrations(e.target.checked)}
          />
          挿絵を埋め込む（ファイル1個で完結。容量が大きくなる場合があります）
        </label>
      )}

      <button className="btn primary" onClick={() => void buildText()} disabled={busy}>
        {busy ? '生成中…' : 'テキストを生成'}
      </button>

      {text && (
        <>
          <textarea
            readOnly
            value={text}
            rows={14}
            style={{ ...fieldStyle, marginTop: 10, fontFamily: 'inherit', resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn" onClick={() => void copyText()}>
              <Icon name="copy" size={14} /> コピー
            </button>
            <button className="btn" onClick={() => void saveText()}>
              <Icon name="download" size={14} /> ファイルに保存
            </button>
            {copyNotice && <span className="desc">{copyNotice}</span>}
          </div>
        </>
      )}

      <hr className="divider" />

      <label className="sub-label">画像カード（X 向け・1枚で完結）</label>
      <p className="desc" style={{ marginTop: 0 }}>
        選択中の範囲の挿絵（無ければテキストのみ）とタイトル・本文の抜粋を1枚の画像に合成します。
      </p>
      <button className="btn" onClick={() => void saveCard()} disabled={cardBusy}>
        {cardBusy ? (
          '生成中…'
        ) : (
          <>
            <Icon name="image" size={14} /> 画像カードを保存
          </>
        )}
      </button>
    </ModalShell>
  )
}
