import { Fragment, useMemo } from 'react'
import { parseStructured, type StructuredLine } from '../lib/structured'
import type { Character } from '../types'
import EntityAvatar from './EntityAvatar'

/** 「」を強調表示する（小説形式の地の文用。ChatPanel の renderProse と同じ規則） */
function renderProseText(text: string) {
  return text.split(/(「[^」]*」)/g).map((p, i) =>
    p.startsWith('「') ? (
      <span key={i} className="dialogue">
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  )
}

/** 未確定行（ストリーミング中の書きかけ）の生テキストを取り出す（D-4。感情等はパースしない） */
function rawTextOf(line: StructuredLine): string {
  return line.kind === 'dialogue' ? line.raw : line.text
}

interface BodyProps {
  content: string
  participants: Character[]
  /** ストリーミング中（末尾の未改行行を未確定として扱う） */
  pending: boolean
}

/** 小説形式: 地の文はそのまま流し込み、セリフ行は話者チップ付きの行として表示する */
export function StructuredNovelBody({ content, participants, pending }: BodyProps) {
  const lines = useMemo(() => parseStructured(content, participants), [content, participants])
  const endsWithNewline = content.endsWith('\n')
  const settled = pending && !endsWithNewline ? lines.slice(0, -1) : lines
  const tail = pending && !endsWithNewline ? lines[lines.length - 1] : undefined

  return (
    <>
      {settled.map((line, i) =>
        line.kind === 'narration' ? (
          <Fragment key={i}>
            {renderProseText(line.text)}
            {'\n'}
          </Fragment>
        ) : (
          <div className="st-dialogue" key={i} title={line.emotion}>
            <EntityAvatar
              className="st-speaker"
              avatar={participants.find((c) => c.id === line.characterId)?.avatar ?? { color: '#666' }}
              name={line.name}
            />
            <span className="dialogue">{line.text}</span>
          </div>
        ),
      )}
      {tail && (
        <span className="st-tail">
          {rawTextOf(tail)}
          {pending && <span className="cursor" />}
        </span>
      )}
    </>
  )
}

type ChatGroup =
  | { kind: 'narration'; text: string }
  | { kind: 'dialogue'; name: string; characterId?: string; texts: string[] }

/** 連続する同一話者の dialogue 行を1グループにまとめる（吹き出しをまとめて表示するため） */
function groupChatLines(lines: StructuredLine[]): ChatGroup[] {
  const groups: ChatGroup[] = []
  for (const line of lines) {
    if (line.kind === 'narration') {
      if (!line.text.trim()) continue // 空行（段落区切り）は吹き出し間の余白を CSS で表現するため詰める
      groups.push({ kind: 'narration', text: line.text })
      continue
    }
    const key = line.characterId ?? line.name
    const last = groups[groups.length - 1]
    if (last?.kind === 'dialogue' && (last.characterId ?? last.name) === key) {
      last.texts.push(line.text)
    } else {
      groups.push({ kind: 'dialogue', name: line.name, characterId: line.characterId, texts: [line.text] })
    }
  }
  return groups
}

/** 会話形式: 連続する同一話者のセリフを1つの吹き出しにまとめ、地の文は吹き出し間のブロックとして挟む */
export function StructuredChatBody({ content, participants, pending }: BodyProps) {
  const lines = useMemo(() => parseStructured(content, participants), [content, participants])
  const endsWithNewline = content.endsWith('\n')
  const settled = pending && !endsWithNewline ? lines.slice(0, -1) : lines
  const tail = pending && !endsWithNewline ? lines[lines.length - 1] : undefined
  const groups = useMemo(() => groupChatLines(settled), [settled])

  return (
    <>
      {groups.map((g, i) =>
        g.kind === 'narration' ? (
          <div className="st-narration" key={i}>
            {g.text}
          </div>
        ) : (
          <div className="st-group" key={i}>
            <EntityAvatar
              className="avatar"
              avatar={participants.find((c) => c.id === g.characterId)?.avatar ?? { color: '#666' }}
              name={g.name}
            />
            <div className="bubble">
              <div className="name">{g.name}</div>
              <div className="content">
                {g.texts.map((t, j) => (
                  <div key={j}>{t}</div>
                ))}
              </div>
            </div>
          </div>
        ),
      )}
      {tail && (
        <div className="st-narration st-tail">
          {rawTextOf(tail)}
          {pending && <span className="cursor" />}
        </div>
      )}
    </>
  )
}
