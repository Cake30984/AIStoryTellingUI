import { Fragment, useMemo, type ReactNode } from 'react'
import { matchCharacterByName, parseStructured, type StructuredLine } from '../lib/structured'
import type { AmbientPin, Character } from '../types'
import EntityAvatar from './EntityAvatar'
import { Icon } from './icons'

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

/** 未確定行（ストリーミング中の書きかけ）の生テキストを取り出す（D-4。話者等はパースしない） */
function rawTextOf(line: StructuredLine): string {
  return line.kind === 'dialogue' ? line.raw : line.text
}

interface BodyProps {
  content: string
  participants: Character[]
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
  /**
   * 未解決の話者（参加キャラのどれにも解決できない名前）をキャラクター化する導線（発見キャラ・FB7-E）。
   * 渡すとその話者チップの隣にバッジが出て、クリックで呼ばれる。未指定ならバッジを描かない。
   */
  onDefineSpeaker?: (name: string) => void
  /**
   * ライブラリに既にいるキャラクター（**このセッションの参加者とは限らない**）。
   * ここに名前が当たる話者には「新規キャラクターにする」バッジを出さない
   * ——押せば同名のキャラクターが二重に作られるだけで、必要なのは作成ではなく参加させること。
   */
  libraryCharacters?: { id: string; name: string }[]
}

/**
 * 未解決話者のバッジ（発見キャラ・FB7-E）。この人物はまだキャラクターとして定義されていない、を示す。
 * ラベル省略はアイコン単独可の例外に当たらないので tooltip を必須にする（FB8-E2 の規約）。
 */
function UnknownSpeakerBadge({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      className="st-unknown-speaker"
      title={`「${name}」はまだキャラクターとして定義されていません。クリックして定義します`}
      onClick={onClick}
    >
      <Icon name="user-plus" size={12} />
    </button>
  )
}

/**
 * 名前解決・アイコン表示に使う話者リスト（参加キャラ。中心人物もこの中に居る＝F3）。
 * id/name/avatar のみ参照。
 */
function useSpeakers(participants: Character[]) {
  return useMemo(() => participants, [participants])
}

/**
 * 「新規キャラクターにする」バッジを出してよいかの判定。
 * 話者が未解決でも、**同じ名前のキャラクターがライブラリに既にいるなら出さない**
 * （押しても同名の重複が増えるだけ。参加させるのはセッション設定の仕事）。
 * 照合は話者解決と同じ `matchCharacterByName`＝表記ゆれの扱いを一致させる。
 */
function useCanDefine(libraryCharacters?: { id: string; name: string }[]) {
  return useMemo(() => {
    const lib = libraryCharacters ?? []
    return (name: string) => !matchCharacterByName(name, lib)
  }, [libraryCharacters])
}

/** 小説形式: 地の文はそのまま流し込み、セリフ行は話者チップ付きの行として表示する */
export function StructuredNovelBody({
  content,
  participants,
  pending,
  pinsByLine,
  dropTarget,
  renderPins,
  onDefineSpeaker,
  libraryCharacters,
}: BodyProps) {
  const speakers = useSpeakers(participants)
  const canDefine = useCanDefine(libraryCharacters)
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
          <div className="st-dialogue" key={i}>
            {pinsAt(i)}
            <EntityAvatar
              className="st-speaker"
              avatar={speakers.find((c) => c.id === line.characterId)?.avatar ?? { color: '#666' }}
              name={line.name}
            />
            {!line.characterId && onDefineSpeaker && canDefine(line.name) && (
              <UnknownSpeakerBadge name={line.name} onClick={() => onDefineSpeaker(line.name)} />
            )}
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
export function StructuredChatBody({
  content,
  participants,
  pending,
  onDefineSpeaker,
  libraryCharacters,
}: BodyProps) {
  const speakers = useSpeakers(participants)
  const canDefine = useCanDefine(libraryCharacters)
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
              <div className="name">
                {g.name}
                {!g.characterId && onDefineSpeaker && canDefine(g.name) && (
                  <UnknownSpeakerBadge name={g.name} onClick={() => onDefineSpeaker(g.name)} />
                )}
              </div>
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
