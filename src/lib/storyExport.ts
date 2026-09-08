// R10: 物語の書き出し（集客の本体）。docs/設計_公開前実装.md R10 参照。
//
// 要件は「出力できること」ではなく「貼りたくなる出力であること」——
// ①そのまま貼れる（プレーン/Markdown）②画像1枚で完結する形も出せる③挿絵つき
// ④出典が自然に入る（宣伝臭くならない範囲で）⑤プレイヤーの選択が見える。
//
// 新しい保存経路は作らない（既存の io.ts の saveBlob に乗せる）。構造化出力のマークアップは
// structured.ts の plainTextOf で剥がす（話者名は地の文に馴染む形へ）。

import type { Character, Message, Scene, SceneIllustration, Session } from '../types'
import { plainTextOf } from './structured'
import { isDirective, isMarkerContent } from './prompts'
import { blobToBase64, getImage } from './imageStore'
import { checkpointStore } from './platform'
import { gunzipText } from './checkpoint'

export type ExportFormat = 'plain' | 'markdown'
export type ExportUnit = { kind: 'session' } | { kind: 'scene'; sceneId: string }

/**
 * 書き出しに載せない舞台裏のメッセージか。
 * system・進行マーカーに加え、**書き手への指示**（IN1）も落とす＝要件は「貼りたくなる出力」であって
 * 制作過程の記録ではない。
 */
function isBackstage(m: Message): boolean {
  return m.role === 'system' || isMarkerContent(m.content) || isDirective(m)
}

/** そのメッセージが属するシーン id（未確定＝進行中シーンのぶんは currentSceneId を補う） */
function effectiveSceneId(m: Message, session: Session): string | undefined {
  return m.sceneId ?? (session.currentSceneId ?? undefined)
}

/** assistant メッセージの話者名（構造化出力 ON なら plainTextOf 側で行内に出るためここでは付けない） */
function assistantSpeakerOf(m: Message, session: Session, characters: Character[]): string | undefined {
  if (session.structuredOutput) return undefined
  if (!m.characterId) return undefined
  return characters.find((c) => c.id === m.characterId)?.name
}

/**
 * 別視点の幕間（F6）の書き出し行。**そのシーンの本文の後ろ**にまとめて添える。
 * 非正典（読み物）なので、本編と混ざらないよう見出しで明示的に隔てる。
 */
function interludeLines(
  scene: Scene | undefined,
  characters: Character[],
  format: ExportFormat,
): string[] {
  const items = scene?.interludes ?? []
  if (items.length === 0) return []
  const lines: string[] = []
  for (const it of items) {
    const who = characters.find((c) => c.id === it.characterId)?.name ?? 'ある人物'
    lines.push(format === 'markdown' ? `### 幕間 ―― ${who}の視点` : `―― 幕間: ${who}の視点 ――`)
    lines.push('')
    lines.push(it.text.trim())
    lines.push('')
  }
  return lines
}

/**
 * 本文をテキストへ書き出す（要件①⑤）。scope で対象シーンを絞る。
 * user 発言は「プレイヤーが選んだこと」として中心人物名（`focusName`）を話者名に立てる。
 */
export function sessionToText(
  session: Session,
  characters: Character[],
  focusName: string,
  format: ExportFormat,
  unit: ExportUnit,
): string {
  const heading = (text: string) => (format === 'markdown' ? `## ${text}` : `◆ ${text}`)
  const speakerLine = (name: string) => (format === 'markdown' ? `**${name}**` : `■${name}`)
  const chosenLine = (name: string, text: string) =>
    format === 'markdown' ? `> **${name}：** ${text}` : `【${name}の選択】${text}`

  const scenesInScope =
    unit.kind === 'scene' ? session.scenes.filter((s) => s.id === unit.sceneId) : session.scenes
  const showHeadings = unit.kind === 'session' && scenesInScope.length > 1

  const lines: string[] = []
  let lastSceneId: string | undefined = undefined
  let sceneSeen = false

  for (const m of session.messages) {
    if (isBackstage(m)) continue
    const sceneId = effectiveSceneId(m, session)
    if (unit.kind === 'scene' && sceneId !== unit.sceneId) continue

    if (sceneId !== lastSceneId) {
      // 直前のシーンの幕間を、そのシーンの末尾へ流してから次の見出しへ進む（F6）
      lines.push(...interludeLines(session.scenes.find((s) => s.id === lastSceneId), characters, format))
      const scene = session.scenes.find((s) => s.id === sceneId)
      if (showHeadings && scene) {
        if (sceneSeen) lines.push('')
        lines.push(heading(scene.title || 'シーン'))
        lines.push('')
      }
      lastSceneId = sceneId
    }
    sceneSeen = true

    const text = plainTextOf(m.content).trim()
    if (!text) continue

    if (m.role === 'user') {
      lines.push(chosenLine(focusName, text))
    } else {
      const speaker = assistantSpeakerOf(m, session, characters)
      if (speaker) lines.push(speakerLine(speaker))
      lines.push(text)
    }
    lines.push('')
  }
  // 最後のシーンぶん（F6）
  lines.push(...interludeLines(session.scenes.find((s) => s.id === lastSceneId), characters, format))

  return lines.join('\n').trim()
}

/**
 * 挿絵つき Markdown（要件③）。挿絵は base64 データ URI で埋め込む＝ファイル1個で完結する
 * （画像を別添えにすると貼り付け先で参照切れになるため）。挿絵はその生成元メッセージの直後に挿す。
 */
export async function sessionToIllustratedMarkdown(
  session: Session,
  characters: Character[],
  focusName: string,
  unit: ExportUnit,
): Promise<string> {
  const scenesInScope =
    unit.kind === 'scene' ? session.scenes.filter((s) => s.id === unit.sceneId) : session.scenes
  const showHeadings = unit.kind === 'session' && scenesInScope.length > 1

  const illustrationsAfter = new Map<string, SceneIllustration[]>()
  for (const scene of scenesInScope) {
    for (const ill of scene.illustrations ?? []) {
      if (!ill.messageId) continue
      const arr = illustrationsAfter.get(ill.messageId) ?? []
      arr.push(ill)
      illustrationsAfter.set(ill.messageId, arr)
    }
  }

  const lines: string[] = []
  let lastSceneId: string | undefined = undefined
  let sceneSeen = false

  for (const m of session.messages) {
    if (isBackstage(m)) continue
    const sceneId = effectiveSceneId(m, session)
    if (unit.kind === 'scene' && sceneId !== unit.sceneId) continue

    if (sceneId !== lastSceneId) {
      lines.push(...interludeLines(session.scenes.find((s) => s.id === lastSceneId), characters, 'markdown'))
      const scene = session.scenes.find((s) => s.id === sceneId)
      if (showHeadings && scene) {
        if (sceneSeen) lines.push('')
        lines.push(`## ${scene.title || 'シーン'}`)
        lines.push('')
      }
      lastSceneId = sceneId
    }
    sceneSeen = true

    const text = plainTextOf(m.content).trim()
    if (text) {
      if (m.role === 'user') {
        lines.push(`> **${focusName}：** ${text}`)
      } else {
        const speaker = assistantSpeakerOf(m, session, characters)
        if (speaker) lines.push(`**${speaker}**`)
        lines.push(text)
      }
      lines.push('')
    }

    for (const ill of illustrationsAfter.get(m.id) ?? []) {
      const blob = await getImage(ill.imageId)
      if (!blob) continue
      const b64 = await blobToBase64(blob)
      lines.push(`![挿絵](data:${blob.type || 'image/png'};base64,${b64})`)
      lines.push('')
    }
  }
  lines.push(...interludeLines(session.scenes.find((s) => s.id === lastSceneId), characters, 'markdown'))

  return lines.join('\n').trim()
}

/** 末尾に添える出典（要件④）。「宣伝臭くならない範囲で」1行だけ・製品名＋（あれば）カセット名 */
export function attributionFooter(workTitle: string, format: ExportFormat): string {
  const line = `デリスト『${workTitle}』より`
  return format === 'markdown' ? `\n\n---\n\n*${line}*\n` : `\n\n――${line}――\n`
}

/**
 * 分岐（チェックポイント）単位の書き出し用に、特定ノード時点の `Session` を読み込む（読み取り専用。
 * `restoreCheckpoint` と違い state は一切書き換えない＝現在の進行を壊さずに過去の分岐を書き出せる）。
 */
export async function loadSessionSnapshot(sessionId: string, nodeId: string): Promise<Session | null> {
  const raw = await checkpointStore.get(sessionId, nodeId)
  if (!raw) return null
  const parsed = JSON.parse(await gunzipText(raw)) as { v: number; session: Session }
  return parsed.session
}

/** 書き出す本文の対象になり得るシーン（本文があるもののみ）。UI の範囲選択に使う */
export function exportableScenes(session: Session): Scene[] {
  const idsWithContent = new Set(
    session.messages
      .filter((m) => !isBackstage(m) && plainTextOf(m.content).trim())
      .map((m) => effectiveSceneId(m, session))
      .filter((id): id is string => !!id),
  )
  return session.scenes.filter((s) => idsWithContent.has(s.id))
}

/** 画像カード（要件②）に使う抜粋。指定シーン（無ければ最後に本文があるシーン）の assistant 発言から先頭を切り出す */
export function excerptOf(session: Session, sceneId: string | undefined, maxChars = 220): string {
  const scenesWithContent = exportableScenes(session)
  const targetSceneId = sceneId ?? scenesWithContent[scenesWithContent.length - 1]?.id
  const texts = session.messages
    .filter((m) => m.role === 'assistant' && effectiveSceneId(m, session) === targetSceneId)
    .map((m) => plainTextOf(m.content).trim())
    .filter(Boolean)
  const joined = texts.join('\n')
  if (joined.length <= maxChars) return joined
  return joined.slice(0, maxChars).trimEnd() + '…'
}
