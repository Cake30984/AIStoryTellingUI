import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import {
  currentScene,
  reviewModelOf,
  storeActions,
  useStore,
} from '../store'
import {
  isMarkerContent,
  sceneCharsOf,
  SCENE_START_PROMPT,
  illustrationContextUser,
  isDirective,
} from '../lib/prompts'
import { lengthLevel } from '../lib/tokens'
import { formatSessionUsage } from '../lib/cost'
import { getImage, useImageUrl } from '../lib/imageStore'
import { downloadBlob } from '../lib/io'
import { hasStructuredLines, plainTextOf } from '../lib/structured'
import { appConfirm } from '../lib/dialogs'
import { isImageSetupDismissed } from '../lib/imageSetup'
import ImageGenModal from './ImageGenModal'
import type {
  Character,
  DockTab,
  Message,
  Scene,
  SceneIllustration,
  Session,
  SessionMode,
} from '../types'
import EndingModal from './EndingModal'
import InterludePanel from './InterludePanel'
import SessionEditor from './SessionEditor'
import SceneEditor from './SceneEditor'
import StoryLogModal from './StoryLogModal'
import StoryExportModal from './StoryExportModal'
import StatusPanel from './StatusPanel'
import DiscoveryPanel, { type DiscoveryScope } from './DiscoveryPanel'
import CharacterDraftModal from './CharacterDraftModal'
import CassetteEditor from './CassetteEditor'
import EntityAvatar from './EntityAvatar'
import ContextDock from './ContextDock'
import ReaderSettings from './ReaderSettings'
import { StructuredChatBody, StructuredNovelBody } from './StructuredMessage'
import ZoomOverlay from './ZoomOverlay'
import { PromptCaption } from './GalleryModal'
import { Icon } from './icons'
import MenuPopover from './MenuPopover'
import ActivityIndicator from './ActivityIndicator'

interface Props {
  sessionId: string
}

/**
 * 本文の描画へ渡すセッションの読み取り専用スライス（P2b）。**`messages` を含めない**——
 * ストリーミング中に変わるのは `messages` だけなので、ここを安定させておけば
 * シーン・メッセージの `React.memo` が効き、描き直しが末尾の1件に収まる。
 */
interface SessionMeta {
  id: string
  mode: SessionMode
  /** セッションの顔ぶれ全員（CS1）。**既に書かれた本文の話者解決**に使う */
  cast: Character[]
  /** 中心人物（F3） */
  focus?: Character
  focusCharacterId: string
  /** ライブラリのキャラクター全員（？バッジの抑止判定に使う） */
  libraryCharacters: Character[]
  currentSceneId: string | null
  novel: boolean
  /** いま居合わせている人物の id（幕間の候補の並べ替え） */
  presentIds: string[]
  /** 完結済み（続きの導線を出さない） */
  concluded: boolean
}

/**
 * 本文1件ぶんの操作。**参照が変わらない**ように `ChatPanelBody` が `useMemo` で1つ作り、
 * メッセージ・シーンへそのまま配る（`React.memo` を壊さないため）。
 */
interface MessageActions {
  startEdit: (messageId: string) => void
  cancelEdit: () => void
  saveEdit: (messageId: string, text: string) => Promise<void>
  remove: (messageId: string) => void
  regenerateFrom: (messageId: string) => void
  branchFrom: (messageId: string) => void
  defineSpeaker: (name: string) => void
  illustrate: (sceneId: string, messageId: string) => void
  removeIllustration: (sceneId: string, illId: string) => void
  regenerateIllustration: (
    sceneId: string,
    messageId: string | undefined,
    prompt: string,
    negative?: string,
  ) => void
  pickDirection: () => void
  toggleScene: (sceneId: string) => void
  regenerateSummary: (sceneId: string) => void
}

/** 小説形式: 地の文と「」セリフを分けて軽く装飾 */
function renderProse(text: string) {
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

const isMarker = (m: Message) => m.role === 'user' && isMarkerContent(m.content)

/** 本文を持たないシーンへ配る空配列（毎回新しい配列を作ると memo が効かない） */
const EMPTY_MESSAGES: Message[] = []

/** 本文の編集ボックス。入力中の文字は編集中の1件が持つ（P2b で ChatPanel の state から分離） */
function EditBox({
  initial,
  onCancel,
  onSave,
}: {
  initial: string
  onCancel: () => void
  onSave: (text: string) => void
}) {
  const [text, setText] = useState(initial)
  return (
    <div className="edit-box">
      <textarea rows={4} value={text} autoFocus onChange={(e) => setText(e.target.value)} />
      <div className="edit-actions">
        <button className="btn" onClick={onCancel}>
          キャンセル
        </button>
        <button className="btn primary" onClick={() => onSave(text)}>
          保存
        </button>
      </div>
    </div>
  )
}

/** 挿絵1枚の表示（保存・削除・クリック拡大・再生成） */
function IllustrationView({
  ill,
  onRemove,
  onRegenerate,
}: {
  ill: SceneIllustration
  onRemove: () => void
  onRegenerate: () => void
}) {
  const url = useImageUrl(ill.imageId)
  const [zoom, setZoom] = useState(false)
  if (!url) return null
  return (
    <figure className="illustration">
      <img
        src={url}
        alt={ill.prompt}
        title={ill.negative ? `${ill.prompt}\nネガティブ: ${ill.negative}` : ill.prompt}
        onClick={() => setZoom(true)}
      />
      <div className="illustration-actions">
        <button
          className="icon-btn small"
          title="画像を保存"
          onClick={async () => {
            const blob = await getImage(ill.imageId)
            if (blob) downloadBlob(blob, `illustration_${ill.id}.png`)
          }}
        >
          <Icon name="download" size={14} />
        </button>
        <button
          className="icon-btn small"
          title="本文から外す"
          onClick={async () => {
            if (
              await appConfirm({
                message: 'この挿絵を本文から外しますか？\n（ギャラリーの「すべての記録」には残ります）',
                danger: true,
              })
            )
              onRemove()
          }}
        >
          <Icon name="trash-2" size={14} />
        </button>
      </div>
      {zoom && (
        <ZoomOverlay
          url={url}
          onClose={() => setZoom(false)}
          caption={
            <PromptCaption
              prompt={ill.prompt}
              negative={ill.negative}
              createdAt={ill.createdAt}
              onRegenerate={() => {
                setZoom(false)
                onRegenerate()
              }}
            />
          }
        />
      )}
    </figure>
  )
}

/**
 * メッセージ1件の描画（P2b で `ChatPanel` から切り出し）。
 *
 * **`React.memo` を壊さないこと。** props はすべて「ストリーミング中に変わらないもの」か
 * 「このメッセージ自身」にしてある。ここへセッションや配列を丸ごと渡すと、1チャンクごとに
 * 全メッセージが描き直る元の姿へ戻る。
 */
interface MessageRowProps {
  m: Message
  meta: SessionMeta
  isStreaming: boolean
  isGeneratingChoices: boolean
  /** この行を編集中か */
  editing: boolean
  /** 末尾のアシスタント本文か（〈展開を選ぶ〉を出す対象。FB3-A6） */
  isLastAssistant: boolean
  showIllustButtons: boolean
  act: MessageActions
}

const MessageRow = memo(function MessageRow({
  m,
  meta,
  isStreaming,
  isGeneratingChoices,
  editing,
  isLastAssistant,
  showIllustButtons,
  act,
}: MessageRowProps) {
  const editBox = () => (
    <EditBox
      initial={m.content}
      onCancel={act.cancelEdit}
      onSave={(text) => void act.saveEdit(m.id, text)}
    />
  )

  /**
   * メッセージ操作行。書き手への指示（IN1）では本文に紐づく操作を出さない——
   * 挿絵は「本文の一点」に紐づく機能で、指示行に置く意味がないため。
   */
  const msgActions = () => {
    if (isStreaming || m.pending) return null
    if (isDirective(m)) {
      return (
        <div className="msg-actions">
          <button onClick={() => act.startEdit(m.id)}>
            <Icon name="pencil" size={13} /> 編集
          </button>
          <button onClick={() => act.regenerateFrom(m.id)} title="この指示以降を作り直す">
            <Icon name="rotate-ccw" size={13} /> ここから
          </button>
          <button
            onClick={() => act.branchFrom(m.id)}
            title="今の続きを分岐として残してから、ここから作り直す"
          >
            <Icon name="git-branch" size={13} /> 分岐
          </button>
          <button onClick={() => act.remove(m.id)}>
            <Icon name="trash-2" size={13} /> 削除
          </button>
        </div>
      )
    }
    const sceneId = m.sceneId ?? meta.currentSceneId
    return (
      <div className="msg-actions">
        <button onClick={() => act.startEdit(m.id)}>
          <Icon name="pencil" size={13} /> 編集
        </button>
        <button onClick={() => act.regenerateFrom(m.id)} title="この発言以降を作り直す">
          <Icon name="rotate-ccw" size={13} /> ここから
        </button>
        {/* ⑂ 明示分岐（FB6-C）: 今の続きに名前を付けて残してから、ここから作り直す。
            完結後も出す（唯一の続きを描く導線）が、一番最後の生成文からは分岐させない（FB9-A） */}
        <button
          onClick={() => act.branchFrom(m.id)}
          title="今の続きを分岐として残してから、ここから作り直す"
        >
          <Icon name="git-branch" size={13} /> 分岐
        </button>
        <button onClick={() => act.remove(m.id)}>
          <Icon name="trash-2" size={13} /> 削除
        </button>
        {/* 任意のメッセージをアンカーに後付け生成（過去シーンも可。FB6-B） */}
        {showIllustButtons && sceneId && (
          <button
            onClick={() => act.illustrate(sceneId, m.id)}
            title="このメッセージの直後に挿絵を生成"
          >
            <Icon name="palette" size={13} /> 挿絵
          </button>
        )}
        {/* 末尾のアシスタント本文にだけ〈展開を選ぶ〉（F4。オンデマンド生成＝設計 §3.4）。
            完結後は続きが無いので出さない */}
        {isLastAssistant && !meta.concluded && (
          <button
            onClick={() => act.pickDirection()}
            disabled={isGeneratingChoices}
            title="この続きの展開の候補を出す"
          >
            <Icon name="git-branch" size={13} /> 展開を選ぶ
          </button>
        )}
      </div>
    )
  }

  /**
   * 書き手への指示（IN1）。地の文でもセリフでもないことがひと目で分かる形で描く。
   * **文体（novel / chat）では見た目を変えない**——文体は物語の描き方の設定であって、
   * 舞台裏の表示を変える理由がないため。
   */
  if (isDirective(m)) {
    return (
      <div className="prose-directive" data-msg-id={m.id}>
        <div className="directive-label">
          <Icon name="clapperboard" size={12} /> 書き手への指示
        </div>
        {editing ? editBox() : <div className="directive-body">{m.content}</div>}
        {msgActions()}
      </div>
    )
  }

  if (meta.novel) {
    if (editing) return <div className="prose-block" data-msg-id={m.id}>{editBox()}</div>
    if (m.role === 'assistant') {
      const structured = hasStructuredLines(m.content, meta.cast)
      return (
        <div className="prose-block" data-msg-id={m.id}>
          {structured ? (
            <StructuredNovelBody
              content={m.content}
              participants={meta.cast}
              pending={!!m.pending && isStreaming}
              onDefineSpeaker={act.defineSpeaker}
              libraryCharacters={meta.libraryCharacters}
            />
          ) : (
            <>
              {renderProse(m.content)}
              {m.pending && isStreaming && <span className="cursor" />}
            </>
          )}
          {msgActions()}
        </div>
      )
    }
    return (
      <div className="prose-action" data-msg-id={m.id}>
        {m.content}
        {msgActions()}
      </div>
    )
  }

  if (m.role === 'assistant' && !editing && hasStructuredLines(m.content, meta.cast)) {
    return (
      <div className="st-message" data-msg-id={m.id}>
        <StructuredChatBody
          content={m.content}
          participants={meta.cast}
          pending={!!m.pending && isStreaming}
          onDefineSpeaker={act.defineSpeaker}
          libraryCharacters={meta.libraryCharacters}
        />
        {msgActions()}
      </div>
    )
  }

  const speaker =
    m.role === 'assistant'
      ? (meta.libraryCharacters.find((x) => x.id === m.characterId) ?? meta.cast[0])
      : undefined
  const av =
    m.role === 'assistant'
      ? speaker
        ? { avatar: speaker.avatar, name: speaker.name || 'AI' }
        : { avatar: { color: '#7c5cff' }, name: meta.mode === 'story' ? '物語' : 'AI' }
      : null
  const name = m.role === 'assistant' ? (av?.name ?? 'AI') : meta.focus?.name || 'あなた'
  return (
    <div className="msg" data-msg-id={m.id}>
      {m.role === 'assistant' ? (
        <EntityAvatar className="avatar" avatar={av!.avatar} name={av!.name} />
      ) : (
        <EntityAvatar className="avatar" avatar={meta.focus?.avatar} name={meta.focus?.name || 'あなた'} />
      )}
      <div className="bubble">
        <div className="name">{name}</div>
        {editing ? (
          editBox()
        ) : (
          <>
            <div className="content">
              {m.content}
              {m.pending && isStreaming && <span className="cursor" />}
            </div>
            {msgActions()}
          </>
        )}
      </div>
    </div>
  )
})

/**
 * シーン1つぶんの描画（見出し・あらすじ・本文・幕間）。P2b で `React.memo` 化した。
 * ストリーミング中に描き直るのは、末尾の pending メッセージを含む**現在シーンだけ**になる。
 */
interface SceneBlockProps {
  scene: Scene
  /** このシーンに属する本文（`ChatPanelBody` が1回の走査で作った Map から渡す） */
  msgs: Message[]
  meta: SessionMeta
  isCurrent: boolean
  open: boolean
  isStreaming: boolean
  isReviewing: boolean
  isGeneratingChoices: boolean
  editingId: string | null
  lastAssistantId: string | null
  showIllustButtons: boolean
  act: MessageActions
}

const SceneBlock = memo(function SceneBlock({
  scene,
  msgs,
  meta,
  isCurrent,
  open,
  isStreaming,
  isReviewing,
  isGeneratingChoices,
  editingId,
  lastAssistantId,
  showIllustButtons,
  act,
}: SceneBlockProps) {
  if (msgs.length === 0 && !scene.summary && !isCurrent) return null
  // シーンに本文（マーカー以外）か要約があれば見出しを表示（FB3-A1）。
  // 「複数シーンあれば無条件で見出し」は、本文を全削除した空シーンでもタイトルだけ残る
  // 原因だったので外した（FB8-A #4）。健全なシーンは本文か要約を必ず持つのでこれで十分。
  const hasRealContent = msgs.some((m) => m.content.trim() && !isMarkerContent(m.content))
  const showDivider = hasRealContent || !!scene.summary

  return (
    <>
      {showDivider && (
        <div className="scene-divider">
          <span className="scene-title">
            <Icon name="book-open" size={13} className="scene-title-icon" /> {scene.title}
          </span>
          {!isCurrent && msgs.length > 0 && (
            <button className="scene-toggle" onClick={() => act.toggleScene(scene.id)}>
              {open ? '会話を隠す' : '会話を表示'}
            </button>
          )}
        </div>
      )}
      {!isCurrent && scene.summary && (
        <div className="scene-summary">
          <div className="scene-summary-label">
            あらすじ
            <button
              className="scene-summary-regen"
              onClick={() => act.regenerateSummary(scene.id)}
              disabled={isStreaming || isReviewing}
              title="このシーンの要約と次シーンの方針を再生成する"
            >
              <Icon name="refresh-cw" size={12} /> 再生成
            </button>
          </div>
          <div className="scene-summary-body">{scene.summary}</div>
        </div>
      )}
      {open &&
        (isCurrent ? (
          <SceneContent
            scene={scene}
            msgs={msgs}
            meta={meta}
            isStreaming={isStreaming}
            isGeneratingChoices={isGeneratingChoices}
            editingId={editingId}
            lastAssistantId={lastAssistantId}
            showIllustButtons={showIllustButtons}
            act={act}
          />
        ) : (
          // 過去シーンは右側の縦スパイン（] ブラケット）でどこからでも折りたためる（FB8-D #7）
          <div className="scene-block">
            <button
              className="scene-spine"
              onClick={() => act.toggleScene(scene.id)}
              title="クリックで会話を隠す"
              aria-label="会話を隠す"
            />
            <SceneContent
              scene={scene}
              msgs={msgs}
              meta={meta}
              isStreaming={isStreaming}
              isGeneratingChoices={isGeneratingChoices}
              editingId={editingId}
              lastAssistantId={lastAssistantId}
              showIllustButtons={showIllustButtons}
              act={act}
            />
          </div>
        ))}
      {/* 別視点の幕間（F6・設計 §2.9）。本文の後ろに置く＝読み物であって本編ではない */}
      {meta.mode === 'story' && hasRealContent && (
        <InterludePanel
          scene={scene}
          cast={meta.cast}
          focusCharacterId={meta.focusCharacterId}
          presentIds={meta.presentIds}
          closed={!!scene.endedAt || !isCurrent}
        />
      )}
    </>
  )
})

/** メッセージ＋挿絵をアンカー順に描画（アンカー消失分はシーン末尾に集約） */
function SceneContent({
  scene,
  msgs,
  meta,
  isStreaming,
  isGeneratingChoices,
  editingId,
  lastAssistantId,
  showIllustButtons,
  act,
}: Omit<SceneBlockProps, 'isCurrent' | 'open' | 'isReviewing'>) {
  const ills = scene.illustrations ?? []
  const msgIds = new Set(msgs.map((m) => m.id))
  const byMessage = new Map<string, SceneIllustration[]>()
  const orphans: SceneIllustration[] = []
  for (const ill of ills) {
    if (ill.messageId && msgIds.has(ill.messageId)) {
      const list = byMessage.get(ill.messageId) ?? []
      list.push(ill)
      byMessage.set(ill.messageId, list)
    } else {
      orphans.push(ill)
    }
  }
  const illView = (ill: SceneIllustration) => (
    <IllustrationView
      key={ill.id}
      ill={ill}
      onRemove={() => act.removeIllustration(scene.id, ill.id)}
      onRegenerate={() =>
        act.regenerateIllustration(scene.id, ill.messageId, ill.prompt, ill.negative)
      }
    />
  )
  // マーカーは本文を持たず、ターンの境目に薄い水平線（.gen-divider）だけを描く。
  // 小説形式ではユーザー入力の前にも線を1本入れる。シーン先頭（＝直前に本文が無い）では線を出さない（A2）
  let seenContent = false
  const out: JSX.Element[] = []
  for (const m of msgs) {
    const marker = isMarker(m)
    const isSceneStart = m.content === SCENE_START_PROMPT
    const boundary = seenContent && !isSceneStart && (marker || (meta.novel && m.role === 'user'))
    if (boundary) out.push(<div className="gen-divider" key={m.id + '-div'} />)
    if (marker) {
      seenContent = true
      continue
    }
    out.push(
      <Fragment key={m.id}>
        <MessageRow
          m={m}
          meta={meta}
          isStreaming={isStreaming}
          isGeneratingChoices={isGeneratingChoices}
          editing={editingId === m.id}
          isLastAssistant={m.id === lastAssistantId}
          showIllustButtons={showIllustButtons}
          act={act}
        />
        {(byMessage.get(m.id) ?? []).map(illView)}
      </Fragment>,
    )
    seenContent = true
  }
  return (
    <>
      {out}
      {orphans.map(illView)}
    </>
  )
}

/**
 * 本編セッションの購読はここで閉じる（P2b）。**`App` へ `session` を持ち上げない**——
 * 持ち上げるとストリーミングの1チャンクごとに `App` が描き直り、レール・サイドバーまで
 * 巻き添えになる。
 */
export default function ChatPanel({ sessionId }: Props) {
  const session = useStore((st) => st.sessions.find((s) => s.id === sessionId))
  if (!session) return null
  return <ChatPanelBody session={session} />
}

function ChatPanelBody({ session }: { session: Session }) {
  const isStreaming = useStore((st) => st.isStreaming)
  const isReviewing = useStore((st) => st.isReviewing)
  const isGeneratingChoices = useStore((st) => st.isGeneratingChoices)
  const imageJobCount = useStore((st) => st.imageJobs.length)
  const characters = useStore((st) => st.characters)
  const ui = useStore((st) => st.ui)
  const scrollTarget = useStore((st) => st.scrollTarget)
  const characterDraftQueue = useStore((st) => st.characterDraftQueue)
  const {
    send,
    continueStory,
    regenerate,
    stop,
    stopChoices,
    stopReview,
    prepareSceneReview,
    startStory,
    continueLast,
    pickDirection,
    updateSession,
    deleteSession,
    startSession,
    setUiPrefs,
    dismissCharacterDraft,
  } = storeActions()

  const [text, setText] = useState('')
  /**
   * 入力の種類（IN1）。`speech`＝主人公のセリフ・行動／`directive`＝書き手 AI への指示。
   * セッションを切り替えたら `speech` に戻す（前の物語の気分を引きずらせない）。
   */
  /**
   * ロールプレイだけが持つ入力の二分化（IN1）。**物語モードでは廃止した**（F4・読者モデル）＝
   * すべての入力は書き手への指示で、ユーザーはその世界の住人としてロールプレイしない（設計 §3）。
   */
  const [rpInputMode, setRpInputMode] = useState<'speech' | 'directive'>('speech')
  const [showEditor, setShowEditor] = useState(false)
  /** 終わり方の提案モーダル（F4・設計 §2.7） */
  const [showEnding, setShowEnding] = useState(false)
  const [showSceneEditor, setShowSceneEditor] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [showStatus, setShowStatus] = useState(false)
  const [discoveryScope, setDiscoveryScope] = useState<DiscoveryScope | null>(null)
  // 挿絵の生成対象（FB6-B。null=閉。過去シーン・任意メッセージをアンカーに後付け生成できる）
  const [illustGenFor, setIllustGenFor] = useState<
    { sceneId: string; messageId?: string; regenPrompt?: string; regenNegative?: string } | null
  >(null)
  /*
   * 挿絵ボタンは**未設定でも出す**（機能の存在を知らせる価値がある）。押した先の案内を
   * 「今はしない」で断った人にだけ、以後このアプリ起動中は出さない（§7.1）。
   * `illustGenFor` の開閉で再評価されるので購読は不要。
   */
  const showIllustButtons = useStore((s) => s.imageProviders.length > 0) || !isImageSetupDismissed()
  const [showCassetteEditor, setShowCassetteEditor] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [speaker, setSpeaker] = useState<string | undefined>(undefined)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  // 自動スクロールは「自分の操作直後の1回」だけ（生成中は追従しない。FB3-A3）
  const lastScrolledRef = useRef<string | null>(null)
  // パネル開閉（FB8-E4 A案: タブ切替はドック側。最後に開いていたタブを覚えて再開する）
  const lastDockTabRef = useRef<DockTab>('status')
  useEffect(() => {
    if (ui.dockTab) lastDockTabRef.current = ui.dockTab
  }, [ui.dockTab])
  const toggleDock = () =>
    setUiPrefs({ dockTab: ui.dockTab ? null : lastDockTabRef.current })

  const scene = currentScene(session)
  // 顔ぶれは2種類ある。**混ぜてはいけない**（CG1 §1.4 の原則＝「AI に渡すもの」だけをゲートし、
  // 「アプリが同一性を判定するために持つもの」はゲートしない）。
  //
  // - `knownCast` … セッションの顔ぶれ全員（CS1）。**既に書かれた本文の話者解決**に使う。
  //   ここをゲートすると、まだ解禁されていない人物が出てくる導入文や、分岐で解禁前へ戻った
  //   過去シーンの本文が、未解決話者（？バッジ＝発見キャラの導線）になってしまう
  // - `participants` … そこから未解禁を落としたもの。**これから作るもの**（話者チップ・「次に話す」・
  //   後付け画像生成の対象）に使う。
  const knownCast = useMemo(
    () =>
      session.characterIds
        .map((id) => characters.find((c) => c.id === id))
        .filter((c): c is NonNullable<typeof c> => !!c),
    [session.characterIds, characters],
  )
  const participants = knownCast
  const novel = session.narrativeStyle === 'novel'
  // 発見キャラ（FB7-E）: 未解決話者の ？バッジ → キャラ化待ちへ積む。
  // 先頭1件だけモーダルを開く（複数承認された時は保存/中止のたびに次が出る）
  const pendingDraft = characterDraftQueue.find((q) => q.sessionId === session.id)
  const groupMode = session.mode === 'roleplay' && participants.length > 1 && !novel
  /**
   * この入力を「書き手への指示」として送るか。**物語モードは常に true**（読者モデル・F4）。
   * ロールプレイだけがチップで切り替える。
   */
  const asDirective = session.mode === 'story' || rpInputMode === 'directive'
  const effectiveSpeaker = groupMode ? speaker : participants[0]?.id

  // --- 本文描画へ渡すもの（P2b）。ここから下は「参照が変わらないこと」が仕様の一部 ---

  /** 本文の描画が読むセッションの断片。`messages` を含めない＝1チャンクごとに変わらない */
  const meta = useMemo<SessionMeta>(
    () => ({
      id: session.id,
      mode: session.mode,
      cast: knownCast,
      focus: knownCast.find((c) => c.id === session.focusCharacterId),
      focusCharacterId: session.focusCharacterId,
      libraryCharacters: characters,
      currentSceneId: session.currentSceneId,
      novel,
      presentIds: session.state?.presentIds ?? [],
      concluded: !!session.ending,
    }),
    [
      session.id,
      session.mode,
      session.focusCharacterId,
      session.currentSceneId,
      session.state?.presentIds,
      session.ending,
      knownCast,
      characters,
      novel,
    ],
  )

  /**
   * sceneId → 本文メッセージ の対応表（1回の走査で作る。旧コードはシーンごとに
   * `messages.filter` を回していた＝シーン数×発言数）。
   * **内容の変わらないシーンは前回の配列をそのまま返す**——ここで参照が変わると
   * `SceneBlock` の `React.memo` が全滅する。
   */
  const prevByScene = useRef<Map<string, Message[]>>(new Map())
  const messagesByScene = useMemo(() => {
    const next = new Map<string, Message[]>()
    for (const m of session.messages) {
      // 旧データの sceneId 無しメッセージは現在シーンへ入れる
      const key = m.sceneId ?? session.currentSceneId ?? ''
      const list = next.get(key)
      if (list) list.push(m)
      else next.set(key, [m])
    }
    for (const [key, list] of next) {
      const prev = prevByScene.current.get(key)
      if (prev && prev.length === list.length && prev.every((m, i) => m === list[i]))
        next.set(key, prev)
    }
    prevByScene.current = next
    return next
  }, [session.messages, session.currentSceneId])

  /** 本文1件ぶんの操作。参照を固定して `React.memo` の子へ配る */
  const act = useMemo<MessageActions>(() => {
    const st = storeActions()
    return {
      startEdit: (id) => setEditingId(id),
      cancelEdit: () => setEditingId(null),
      // 上書きガード（FB6-C）を通すため await（キャンセル時は本文が変わらないまま編集ボックスを閉じる）
      saveEdit: async (id, textValue) => {
        await st.editMessage(id, textValue)
        setEditingId(null)
      },
      remove: (id) => void st.deleteMessage(id),
      regenerateFrom: (id) => void st.regenerateFrom(id),
      branchFrom: (id) => void st.branchFromMessage(id),
      defineSpeaker: (name) => st.queueCharacterDrafts(session.id, [{ name, note: '' }]),
      illustrate: (sceneId, messageId) => setIllustGenFor({ sceneId, messageId }),
      removeIllustration: (sceneId, illId) => st.removeIllustration(session.id, sceneId, illId),
      regenerateIllustration: (sceneId, messageId, prompt, negative) =>
        setIllustGenFor({ sceneId, messageId, regenPrompt: prompt, regenNegative: negative }),
      pickDirection: () => void st.pickDirection(),
      toggleScene: (id) =>
        setExpanded((prev) => {
          const nextSet = new Set(prev)
          nextSet.has(id) ? nextSet.delete(id) : nextSet.add(id)
          return nextSet
        }),
      regenerateSummary: (sceneId) => void st.prepareSceneReview(sceneId),
    }
  }, [session.id])

  // 右ドックへ渡すコールバック（参照を固定して ContextDock の memo を効かせる）
  const onEditStatus = useCallback(() => setShowStatus(true), [])
  const onEditDiscovery = useCallback((scope: DiscoveryScope) => setDiscoveryScope(scope), [])
  const onRegenerateIllustration = useCallback(
    (sceneId: string, messageId: string | undefined, prompt: string, negative?: string) =>
      setIllustGenFor({ sceneId, messageId, regenPrompt: prompt, regenNegative: negative }),
    [],
  )

  // 締め時の目安（prompts.ts のペース制御ナッジと共通判定）
  // ユーザーに見せる分量は文字数（F5・設計 §2.8）。トークンはコストと文脈窓の管理にだけ使う
  const sceneChars = useMemo(() => sceneCharsOf(session), [session])
  const lenLvl = lengthLevel(sceneChars)
  // このセッションの累計（P3）。使っていなければ null＝バッジごと出さない
  const usageLine = formatSessionUsage(session.usage)

  // 締め時の提案チップ（FB5-①c）。自動でレビューは開かず、シーン単位で閉じられる
  const [wrapHintHiddenFor, setWrapHintHiddenFor] = useState<string | null>(null)
  const showWrapHint =
    lenLvl === 'high' &&
    !isStreaming &&
    !isReviewing &&
    !!scene &&
    wrapHintHiddenFor !== scene.id

  // ストリーミングの毎チャンクでは追従しない。末尾がユーザー発言（送信・続ける・選択肢クリック）に
  // 変わった直後にだけ1回スクロールする（FB3-A3）
  useEffect(() => {
    const last = session.messages[session.messages.length - 1]
    if (last && last.role === 'user' && lastScrolledRef.current !== last.id) {
      lastScrolledRef.current = last.id
      anchorRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [session.messages])

  // ツリー行クリックの本文スクロール（FB7-B）。復元直後の末尾自動スクロール（上）より後に消化して勝たせる
  useEffect(() => {
    if (!scrollTarget || scrollTarget.sessionId !== session.id) return
    const { messageId } = scrollTarget
    const msg = session.messages.find((m) => m.id === messageId)
    // 末尾 user メッセージへの自動スクロール（FB3-A3）は消費済み扱いにして抑止する
    const last = session.messages[session.messages.length - 1]
    if (last) lastScrolledRef.current = last.id

    let cancelled = false
    let raf1 = 0
    let raf2 = 0
    let recenterTimer = 0
    const scrollToTarget = () => {
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          if (cancelled) return
          // マーカー等で DOM に無い id は直前の描画メッセージへ、それも無ければ末尾へフォールバック
          const idx = session.messages.findIndex((m) => m.id === messageId)
          let el: Element | null = null
          for (let i = idx; i >= 0 && !el; i--) {
            el = document.querySelector(`[data-msg-id="${session.messages[i].id}"]`)
          }
          if (el) {
            const target = el
            target.scrollIntoView({ block: 'center' })
            target.classList.add('msg-flash')
            window.setTimeout(() => target.classList.remove('msg-flash'), 2000)
            // 挿絵などが後から読み込まれて上のレイアウトが伸びると中央からずれるので、
            // 少し置いてもう一度だけ中央合わせして補正する（FB8-A #9）
            recenterTimer = window.setTimeout(() => {
              if (!cancelled) target.scrollIntoView({ block: 'center' })
            }, 240)
          } else {
            anchorRef.current?.scrollIntoView()
          }
          useStore.setState({ scrollTarget: null })
        })
      })
    }

    if (msg?.sceneId && msg.sceneId !== session.currentSceneId) {
      const sceneId = msg.sceneId
      // 対象メッセージの属するシーンが畳まれていれば展開してから。flushSync はレンダリング中に
      // 呼ぶと React の警告（無視できない）になるため、現在のコミットが終わるマイクロタスクへ逃がし、
      // 直後の rAF での DOM 検索が「展開前」の古い DOM を見てしまう競合を防ぐ
      queueMicrotask(() => {
        if (cancelled) return
        flushSync(() => {
          setExpanded((prev) => (prev.has(sceneId) ? prev : new Set([...prev, sceneId])))
        })
        scrollToTarget()
      })
    } else {
      scrollToTarget()
    }

    return () => {
      cancelled = true
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      window.clearTimeout(recenterTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTarget])

  useEffect(() => {
    startSession()
    setSpeaker(undefined)
    setRpInputMode('speech')
    setExpanded(new Set())
    // セッションを開いた直後は最新地点を表示（自分でセッションを開く操作の直後の1回）
    lastScrolledRef.current = null
    anchorRef.current?.scrollIntoView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  const autoGrow = () => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  const submit = async () => {
    if (isStreaming) return
    const t = text
    setText('')
    requestAnimationFrame(autoGrow)
    // 指示も送信でそのまま生成が走る（＝方向づけ付きの「続ける」。IN1）
    await send(t, effectiveSpeaker, asDirective ? 'directive' : undefined)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  const isConfigured =
    participants.length > 0 || (session.mode === 'story' && !!session.story.premise)

  const lastMsg = session.messages[session.messages.length - 1]
  // 「選択肢を生成」を出す対象＝末尾のアシスタント本文（FB3-A6）
  const lastAssistantId = useMemo(() => {
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const m = session.messages[i]
      if (m.role === 'assistant' && m.content.trim()) return m.id
    }
    return null
  }, [session.messages])
  const storyStarted = session.messages.filter((m) => m.sceneId === scene?.id).length > 0
  const hasAssistantMsg = session.messages.some((m) => m.role === 'assistant')
  const showRegen = (session.mode === 'story' && hasAssistantMsg) || (groupMode && hasAssistantMsg)
  const showChoices =
    !isStreaming &&
    !isGeneratingChoices &&
    lastMsg?.role === 'assistant' &&
    !!lastMsg.choices &&
    lastMsg.choices.length > 0


  /**
   * 対象シーンの本文メッセージ（マーカー・空を除く）をアンカーまで返す（FB6-B）。
   * アンカー未指定・見つからない場合はシーン全体（＝従来のシーン末尾までの文脈）。
   * 旧データの sceneId 無しメッセージは現在シーンにだけ含める（本文グルーピングと同じ規則）。
   */
  const sceneMessagesUpto = (sceneId: string, uptoMessageId?: string): Message[] => {
    const isCur = sceneId === session.currentSceneId
    const msgs = session.messages.filter(
      (m) =>
        (m.sceneId === sceneId || (isCur && !m.sceneId)) &&
        !isMarker(m) &&
        !isDirective(m) && // 書き手への指示は絵にする対象ではない（IN1）
        m.content.trim(),
    )
    if (!uptoMessageId) return msgs
    const idx = msgs.findIndex((m) => m.id === uptoMessageId)
    return idx >= 0 ? msgs.slice(0, idx + 1) : msgs
  }


  return (
    <div className="main">
      {/* 没入モードで topbar を隠した際、上端ホバーで呼び戻すための当たり判定（UI-4）。~ セレクタのため topbar の直前に置く */}
      {ui.immersive && <div className="top-hover" />}
      <div className="topbar">
        <div className="session-title-wrap">
          <input
            className="session-title"
            value={session.title}
            placeholder="無題（クリックで名前を編集）"
            onChange={(e) => updateSession(session.id, { title: e.target.value })}
          />
          <Icon name="pencil" size={13} className="title-pencil" />
        </div>

        {scene && (
          <button className="scene-chip" onClick={() => setShowSceneEditor(true)} title="シーン名・状況メモの編集">
            <Icon name="book-open" size={14} />
            <span className="scene-chip-title">
              {scene.title}
              {scene.timeLabel ? `・${scene.timeLabel}` : ''}
            </span>
            <span
              className={'length-badge ' + lenLvl}
              title="このシーンの本文の分量（文字数。書き手への指示・進行の合図は数えない）"
            >
              {sceneChars.toLocaleString()}字{lenLvl === 'high' ? '・締め時' : ''}
            </span>
          </button>
        )}

        {/* このセッションの累計（P3）。単位は提供元のまま（円換算しない）。
            コストを返さない接続先ではトークンだけ出る */}
        {usageLine && (
          <span
            className="usage-badge"
            title={`このセッションで使った累計（提供元が返した値のまま）。入力 ${(
              session.usage?.promptTokens ?? 0
            ).toLocaleString()} / 出力 ${(session.usage?.completionTokens ?? 0).toLocaleString()} tokens`}
          >
            累計 {usageLine}
          </span>
        )}

        <ActivityIndicator />

        {/* パネル開閉（FB8-E4 A案: 状態/発見/画像/分岐/ジョブの切替はドック内のラベル付きタブ） */}
        <button
          className={'icon-btn' + (ui.dockTab ? ' on' : '')}
          onClick={toggleDock}
          title={ui.dockTab ? 'パネルを閉じる' : 'パネルを開く（状態・発見・画像・分岐・ジョブ）'}
        >
          <Icon name="panel-right" />
          {imageJobCount > 0 && <span className="icon-badge">{imageJobCount}</span>}
        </button>

        <ReaderSettings />

        <div className="menu-anchor">
          <button className="icon-btn" onClick={() => setShowMenu((v) => !v)} title="メニュー">
            <Icon name="more-horizontal" />
          </button>
          {showMenu && (
            <MenuPopover onClose={() => setShowMenu(false)}>
              {/* FB8-E4: 参照系／管理系／破壊系の3グループに整理。モデルは「セッション設定 > AIと出力」へ、
                  挿絵はコンポーザーのボタンに一本化（重複導線を撤去） */}
              <button
                className="menu-item"
                onClick={() => {
                  setShowMenu(false)
                  setShowLog(true)
                }}
              >
                <Icon name="scroll-text" size={15} /> あらすじ
              </button>
              {session.mode === 'story' && !session.ending && (
                <button
                  className="menu-item"
                  onClick={() => {
                    setShowMenu(false)
                    setShowEnding(true)
                  }}
                >
                  <Icon name="flag" size={15} /> 終わり方を考える…
                </button>
              )}
              <button
                className="menu-item"
                onClick={() => {
                  setShowMenu(false)
                  setShowExport(true)
                }}
              >
                <Icon name="download" size={15} /> 物語を書き出す…
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  setShowMenu(false)
                  setShowCassetteEditor(true)
                }}
              >
                <Icon name="library-big" size={15} /> カセットにする…
              </button>
              <div className="menu-sep" />
              <button
                className="menu-item"
                onClick={() => {
                  setShowMenu(false)
                  updateSession(session.id, { archived: !session.archived })
                }}
              >
                <Icon name="archive" size={15} /> {session.archived ? 'アーカイブから戻す' : 'アーカイブする'}
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  setShowMenu(false)
                  setShowEditor(true)
                }}
              >
                <Icon name="settings" size={15} /> セッション設定
              </button>
              <button
                className="menu-item danger"
                onClick={async () => {
                  setShowMenu(false)
                  if (await appConfirm({ message: 'このセッションを削除しますか？', danger: true }))
                    deleteSession(session.id)
                }}
              >
                <Icon name="trash-2" size={15} /> セッションを削除
              </button>
            </MenuPopover>
          )}
        </div>
      </div>

      <div className="play-body">
        <div className="play-col">
          <div className="chat-wrap">
            <div className="chat">
              <div className="chat-inner">
                {session.messages.length === 0 && (
                  <div className="chat-hint">
                    {!isConfigured ? (
                      <p>
                        右上のメニュー →「セッション設定」から
                        {session.mode === 'roleplay' ? '登場キャラクター' : '物語の前提'}を設定しましょう。
                      </p>
                    ) : session.mode === 'roleplay' ? (
                      <p>下の入力欄から話しかけてみましょう。</p>
                    ) : (
                      <p>「物語をはじめる」を押すか、最初の状況を入力してください。</p>
                    )}
                  </div>
                )}

                {session.scenes.map((sc) => (
                  <SceneBlock
                    key={sc.id}
                    scene={sc}
                    msgs={messagesByScene.get(sc.id) ?? EMPTY_MESSAGES}
                    meta={meta}
                    isCurrent={sc.id === session.currentSceneId}
                    open={sc.id === session.currentSceneId || expanded.has(sc.id)}
                    isStreaming={isStreaming}
                    isReviewing={isReviewing}
                    isGeneratingChoices={isGeneratingChoices}
                    editingId={editingId}
                    lastAssistantId={lastAssistantId}
                    showIllustButtons={showIllustButtons}
                    act={act}
                  />
                ))}
                <div ref={anchorRef} className="scroll-anchor" />
              </div>
            </div>
          </div>

          <div className="composer-wrap">
            <div className="composer">
              {groupMode && (
                <div className="speaker-row">
                  <span className="speaker-label">次に話す:</span>
                  <button
                    className={'speaker-chip' + (speaker === undefined ? ' on' : '')}
                    onClick={() => setSpeaker(undefined)}
                  >
                    <Icon name="dice" size={13} /> おまかせ
                  </button>
                  {participants.map((c) => (
                    <button
                      key={c.id}
                      className={'speaker-chip' + (speaker === c.id ? ' on' : '')}
                      onClick={() => setSpeaker(c.id)}
                    >
                      <EntityAvatar className="dot-avatar" avatar={c.avatar} name={c.name || '無名'} />
                      {c.name || '無名'}
                    </button>
                  ))}
                </div>
              )}

              {isGeneratingChoices && (
                <div className="choices-loading">
                  選択肢を考え中…
                  <button className="link" style={{ marginLeft: 8 }} onClick={stopChoices}>
                    中止
                  </button>
                </div>
              )}
              {showChoices && (
                <div className="choices">
                  {lastMsg.choices!.map((c, i) => (
                    <button
                      key={i}
                      className="choice-btn"
                      onClick={() => send(c.text, effectiveSpeaker)}
                      disabled={isStreaming}
                    >
                      <span className="choice-num">{i + 1}</span>
                      {c.text}
                    </button>
                  ))}
                </div>
              )}
              {/* 締め時の提案チップ（FB5-①c）。ペース制御ナッジと同じ閾値で「このシーンを終える」を後押しする */}
              {showWrapHint && scene && (
                <div className="scene-wrap-hint">
                  <span className="scene-wrap-hint-text">
                    シーンが長くなってきました。区切りの良いところで締めるのがおすすめです。
                  </span>
                  <button className="link" onClick={() => prepareSceneReview()}>
                    シーン終了レビューへ
                  </button>
                  <button
                    className="icon-btn small"
                    onClick={() => setWrapHintHiddenFor(scene.id)}
                    title="このシーンでは表示しない"
                  >
                    <Icon name="x" size={12} />
                  </button>
                </div>
              )}
              {/* 完結（F4）。分岐で戻せるので「終わり」ではなく「この線の終わり」として出す */}
              {session.ending && (
                <div className="ending-banner">
                  <Icon name="flag" size={14} />
                  <span>
                    完結: <strong>{session.ending.title}</strong>
                  </span>
                  <span className="desc">
                    分岐ツリーから前の地点へ戻れば、ここから別の結末を書き直せます。
                  </span>
                </div>
              )}
              {/* 目指す結末（F4）。書き手へゆるく渡っていることをユーザーにも見せる */}
              {!session.ending && session.endingGoal && (
                <div className="ending-banner goal">
                  <Icon name="flag" size={14} />
                  <span>
                    目指す結末: <strong>{session.endingGoal.title}</strong>
                  </span>
                  <button className="link" onClick={() => setShowEnding(true)}>
                    変更・解除
                  </button>
                </div>
              )}
              {/* コンポーザーの操作行（常時レンダリング。高さが跳ねないよう左右にツールをまとめる） */}
              <div className="composer-tools">
                {session.mode === 'story' &&
                  !session.ending &&
                  (storyStarted ? (
                    <>
                      <button
                        className="btn primary"
                        onClick={() => continueStory(effectiveSpeaker)}
                        disabled={isStreaming}
                      >
                        <Icon name="fast-forward" size={14} /> 続ける
                      </button>
                      {/* 尺の指示（F4・設計 §3.2）。読者モデルではペース配分が一級市民になる */}
                      <button
                        className="composer-tool-btn"
                        onClick={() => continueStory(effectiveSpeaker, 'detail')}
                        disabled={isStreaming}
                        title="時間を進めず、この場面をじっくり描かせる"
                      >
                        <Icon name="zoom-in" size={14} /> もっと詳しく
                      </button>
                      <button
                        className="composer-tool-btn"
                        onClick={() => continueStory(effectiveSpeaker, 'skip')}
                        disabled={isStreaming}
                        title="この場面は手早くまとめ、次の出来事まで進めさせる"
                      >
                        <Icon name="skip-forward" size={14} /> 先へ飛ばす
                      </button>
                    </>
                  ) : (
                    <button className="btn primary" onClick={() => startStory()} disabled={isStreaming}>
                      <Icon name="play" size={14} /> 物語をはじめる
                    </button>
                  ))}
                {showRegen && (
                  <button
                    className="composer-tool-btn"
                    onClick={() => regenerate(effectiveSpeaker)}
                    disabled={isStreaming}
                  >
                    <Icon name="rotate-ccw" size={14} /> {groupMode ? '直前をやり直す' : 'やり直す'}
                  </button>
                )}
                {!isStreaming && lastMsg?.role === 'assistant' && lastMsg.truncated && (
                  <button
                    className="composer-tool-btn"
                    onClick={() => continueLast()}
                    title="上限で途中で切れた続きを生成"
                  >
                    <Icon name="corner-down-right" size={14} /> 続きを生成
                  </button>
                )}
                {/* 〈展開を選ぶ〉（F4・設計 §3.4）。`ChoiceMode` を廃止しオンデマンド生成だけにした＝
                    「毎回」で捨てられる選択肢のコストも、「AIが適宜」の外れ判定も無くなる */}
                {!isStreaming && !session.ending && lastMsg?.role === 'assistant' && !!lastMsg.content.trim() && (
                  <button
                    className="composer-tool-btn"
                    onClick={() => pickDirection()}
                    disabled={isGeneratingChoices}
                    title="この続きの展開の候補を出す（押した時だけ生成します）"
                  >
                    <Icon name="git-branch" size={14} />{' '}
                    {isGeneratingChoices ? '候補を考え中…' : '展開を選ぶ'}
                  </button>
                )}
                <div style={{ flex: 1 }} />
                {/* 挿絵生成は「進行しながら使う」操作なので入力欄付近にも置く（⋯メニューとも両導線。F3/R9） */}
                {showIllustButtons && (
                  <button
                    className="composer-tool-btn"
                    disabled={!scene}
                    title={scene ? 'この場面の挿絵を生成' : '物語を開始すると生成できます'}
                    onClick={() => scene && setIllustGenFor({ sceneId: scene.id })}
                  >
                    <Icon name="palette" size={14} /> 挿絵
                  </button>
                )}
                <button className="composer-tool-btn" onClick={() => setShowSceneEditor(true)}>
                  <Icon name="pencil" size={14} /> シーン編集
                </button>
                {!session.ending && (
                  <button
                    className="scene-btn end"
                    onClick={() => (isReviewing ? stopReview() : prepareSceneReview())}
                    disabled={isStreaming}
                    title={isReviewing ? 'レビュー生成を中止' : 'このシーンを振り返って次のシーンへ'}
                  >
                    {isReviewing ? (
                      <>
                        <Icon name="square" size={14} /> レビュー作成中…（中止）
                      </>
                    ) : (
                      <>
                        <Icon name="check" size={14} /> このシーンを終える
                      </>
                    )}
                  </button>
                )}
              </div>

              {(
                <>
                {/* 入力の二分化（IN1）はロールプレイだけに残る。物語モードでは読者モデルにより
                    入力の意味が1つ（＝書き手への指示）に定まったので、選ばせるものが無い（F4・設計 §3） */}
                {session.mode === 'roleplay' && (
                  <div className="input-mode-row">
                    <button
                      className={'input-mode-chip' + (rpInputMode === 'speech' ? ' on' : '')}
                      onClick={() => setRpInputMode('speech')}
                      title="書いた内容をあなたが演じる人物の発言・行動として渡します"
                    >
                      <Icon name="message-circle" size={13} /> 演じて書く
                    </button>
                    <button
                      className={'input-mode-chip' + (rpInputMode === 'directive' ? ' on' : '')}
                      onClick={() => setRpInputMode('directive')}
                      title="書いた内容を書き手 AI への指示として渡します（あなたの人物は何も言いません）"
                    >
                      <Icon name="clapperboard" size={13} /> 書き手に指示
                    </button>
                  </div>
                )}
                <div className="input-row">
                  <textarea
                    ref={taRef}
                    rows={1}
                    value={text}
                    className={asDirective ? 'directive' : undefined}
                    placeholder={
                      asDirective
                        ? '書き手への指示を入力（例: そろそろ雨を降らせて緊張感を出して）'
                        : 'メッセージや行動を入力（Enter で送信 / Shift+Enter で改行）'
                    }
                    onChange={(e) => {
                      setText(e.target.value)
                      autoGrow()
                    }}
                    onKeyDown={onKey}
                  />
                  {isStreaming ? (
                    <button className="send-btn stop" onClick={stop} title="停止">
                      <Icon name="square" size={13} />
                    </button>
                  ) : (
                    <button
                      className="send-btn"
                      onClick={submit}
                      disabled={!text.trim()}
                      title={asDirective ? '指示を送って続きを書かせる' : '送信'}
                    >
                      <Icon name="arrow-up" size={16} />
                    </button>
                  )}
                </div>
                </>
              )}
              {/* ヒントは会話開始前のみ（常時表示だと本文を1行ぶん間延びさせる。F0/A2） */}
              {session.messages.length === 0 && (
                <div className="hint">
                  {groupMode
                    ? '「次に話す」で発言者を選べます。'
                    : session.mode === 'story'
                      ? 'あなたは読者です。書いたことはすべて「書き手への指示」として渡ります。空のまま「続ける」で先へ進み、〈もっと詳しく〉〈先へ飛ばす〉で尺を、〈展開を選ぶ〉で方向を指示できます。'
                      : 'キャラクターになりきって応答します。「書き手に指示」に切り替えると、物語の方向づけだけを渡せます。'}
                </div>
              )}
            </div>
          </div>
        </div>
        <ContextDock
          sessionId={session.id}
          onEditStatus={onEditStatus}
          onEditDiscovery={onEditDiscovery}
          onRegenerateIllustration={onRegenerateIllustration}
        />
      </div>

      {showEnding && <EndingModal onClose={() => setShowEnding(false)} />}
      {showEditor && <SessionEditor session={session} onClose={() => setShowEditor(false)} />}
      {showSceneEditor && scene && (
        <SceneEditor scene={scene} onClose={() => setShowSceneEditor(false)} />
      )}
      {showLog && (
        <StoryLogModal
          session={session}
          onClose={() => setShowLog(false)}
          onGenIllustration={(sceneId) => setIllustGenFor({ sceneId })}
        />
      )}
      {showStatus && <StatusPanel session={session} onClose={() => setShowStatus(false)} />}
      {/* 発見キャラのキャラ化（FB7-E）。key で対象が変わるたびに起案をやり直させる */}
      {pendingDraft && (
        <CharacterDraftModal
          key={pendingDraft.name}
          session={session}
          name={pendingDraft.name}
          note={pendingDraft.note}
          onClose={() => dismissCharacterDraft(session.id, pendingDraft.name)}
        />
      )}
      {discoveryScope && (
        <DiscoveryPanel
          session={session}
          scope={discoveryScope}
          onClose={() => setDiscoveryScope(null)}
        />
      )}
      {illustGenFor &&
        (() => {
          // 対象シーンは現在シーンに限らない（過去シーン・任意メッセージへの後付け生成。FB6-B）
          const sc = session.scenes.find((s) => s.id === illustGenFor.sceneId)
          if (!sc) return null
          // 顔ぶれはセッション共通（CS1）。過去シーンでも同じ
          const cast = participants
          const ctxMsgs = sceneMessagesUpto(sc.id, illustGenFor.messageId)
          // アンカーから遡って文字数予算でキャップ（推定 8,000 文字 ≒ 4,000〜5,000 トークン程度）
          const budget = 8000
          const recent: string[] = []
          let used = 0
          for (let i = ctxMsgs.length - 1; i >= 0; i--) {
            const c = plainTextOf(ctxMsgs[i].content)
            if (used + c.length > budget && recent.length > 0) break
            recent.unshift(c)
            used += c.length
          }
          return (
            <ImageGenModal
              title={
                illustGenFor.regenPrompt
                  ? '同じプロンプトで挿絵を再生成'
                  : illustGenFor.messageId
                    ? 'この位置に挿絵を生成'
                    : 'この場面の挿絵を生成'
              }
              draftContext={{
                user: illustrationContextUser({
                  sceneTitle: sc.title,
                  sceneNote: sc.note,
                  timeLabel: sc.timeLabel,
                  characters: cast.map((c) => ({
                    name: c.name,
                    appearance: c.appearance,
                    imagePrompt: c.imagePrompt,
                  })),
                  recentMessages: recent,
                }),
                modelRef: reviewModelOf(session),
              }}
              initialPrompt={
                illustGenFor.regenPrompt ?? cast.map((c) => c.imagePrompt).filter(Boolean).join(', ')
              }
              initialNegative={illustGenFor.regenNegative}
              target={{
                type: 'scene-illustration',
                sessionId: session.id,
                sceneId: sc.id,
                messageId: illustGenFor.messageId ?? ctxMsgs[ctxMsgs.length - 1]?.id,
              }}
              label={`挿絵: ${sc.title || 'シーン'}`}
              onClose={() => setIllustGenFor(null)}
            />
          )
        })()}
      {showCassetteEditor && (
        <CassetteEditor seedSession={session} onClose={() => setShowCassetteEditor(false)} />
      )}

      {showExport && <StoryExportModal sessionId={session.id} onClose={() => setShowExport(false)} />}

      {/* 完結オーバーレイ（簡素な演出。将来ここにエンディング CG・スタッフロールを足せる） */}
    </div>
  )
}
