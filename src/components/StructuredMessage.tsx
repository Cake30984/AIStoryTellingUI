import { Fragment, useMemo, type ReactNode } from 'react'
import { parseStructured, type StructuredLine } from '../lib/structured'
import type { AmbientPin, Character, Persona } from '../types'
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
  /** ユーザーが演じる人物。@ペルソナ名 行のアイコン解決に含める（立ち絵・感情判定には使わない） */
  persona?: Persona
  /** ストリーミング中（末尾の未改行行を未確定として扱う） */
  pending: boolean
  /**
   * 環境音ピン（AM1）。行番号 → その行の直前に差し込むマーカー。
   * パーサと同じ `content.split('\n')` の行番号なので、ここの `i` とそのまま一致する。
   * 描画は呼び出し側（`renderPins`）に任せる。
   */
  pinsByLine?: Map<number, AmbientPin[]>
  /** ドラッグ中の落とし先候補として、全行にアンカーを描くか */
  dropTarget?: boolean
  renderPins?: (pins: AmbientPin[], lineAnchor?: number) => ReactNode
}

/**
 * 名前解決・アイコン表示に使う話者リスト（参加キャラ＋ペルソナ）。
 * ペルソナは末尾に置きキャラを優先させる（前方一致の衝突時）。id/name/avatar のみ参照。
 */
function useSpeakers(participants: Character[], persona?: Persona) {
  return useMemo(
    () => (persona ? [...participants, persona] : participants),
    [participants, persona],
  )
}

/** 小説形式: 地の文はそのまま流し込み、セリフ行は話者チップ付きの行として表示する */
export function StructuredNovelBody({
  content,
  participants,
  persona,
  pending,
  pinsByLine,
  dropTarget,
  renderPins,
}: BodyProps) {
  const speakers = useSpeakers(participants, persona)
  const lines = useMemo(() => parseStructured(content, speakers), [content, speakers])
  const endsWithNewline = content.endsWith('\n')
  const settled = pending && !endsWithNewline ? lines.slice(0, -1) : lines
  const tail = pending && !endsWithNewline ? lines[lines.length - 1] : undefined
  const pinsAt = (i: number) => {
    if (!renderPins) return null
    const pins = pinsByLine?.get(i) ?? []
    if (pins.length === 0 && !dropTarget) return null
    return renderPins(pins, dropTarget ? i : undefined)
  }

  return (
    <>
      {settled.map((line, i) =>
        line.kind === 'narration' ? (
          <Fragment key={i}>
            {pinsAt(i)}
            {renderProseText(line.text)}
            {'\n'}
          </Fragment>
        ) : (
          <div className="st-dialogue" key={i} title={line.emotion}>
            {pinsAt(i)}
            <EntityAvatar
              className="st-speaker"
              avatar={speakers.find((c) => c.id === line.characterId)?.avatar ?? { color: '#666' }}
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
export function StructuredChatBody({ content, participants, persona, pending }: BodyProps) {
  const speakers = useSpeakers(participants, persona)
  const lines = useMemo(() => parseStructured(content, speakers), [content, speakers])
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
              avatar={speakers.find((c) => c.id === g.characterId)?.avatar ?? { color: '#666' }}
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
