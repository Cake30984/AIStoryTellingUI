import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { currentScene, reviewModelOf, useStore } from '../store'
import {
  CONTINUE_PROMPT,
  SCENE_START_PROMPT,
  backgroundContextUser,
  backgroundPromptSystem,
  illustrationContextUser,
  illustrationPromptSystem,
} from '../lib/prompts'
import { sceneTokensOf, tokenLevel } from '../lib/tokens'
import { modelRefLabel } from '../lib/providers'
import { getImage, useImageUrl } from '../lib/imageStore'
import { downloadBlob } from '../lib/io'
import { hasStructuredLines, plainTextOf } from '../lib/structured'
import { appConfirm } from '../lib/dialogs'
import ImageGenModal from './ImageGenModal'
import ModalShell from './ModalShell'
import type { DockTab, Message, Scene, SceneIllustration, Session } from '../types'
import ModelPicker from './ModelPicker'
import SessionEditor from './SessionEditor'
import SceneEditor from './SceneEditor'
import StoryLogModal from './StoryLogModal'
import StatusPanel from './StatusPanel'
import DiscoveryPanel, { type DiscoveryScope } from './DiscoveryPanel'
import CassetteEditor from './CassetteEditor'
import EntityAvatar from './EntityAvatar'
import StageBackdrop from './StageBackdrop'
import ContextDock from './ContextDock'
import ReaderSettings from './ReaderSettings'
import { StructuredChatBody, StructuredNovelBody } from './StructuredMessage'
import ZoomOverlay from './ZoomOverlay'
import { Icon } from './icons'
import MenuPopover from './MenuPopover'
import ActivityIndicator from './ActivityIndicator'

interface Props {
  session: Session
}

/** 挿絵1枚の表示（保存・削除・クリック拡大） */
function IllustrationView({ ill, onRemove }: { ill: SceneIllustration; onRemove: () => void }) {
  const url = useImageUrl(ill.imageId)
  const [zoom, setZoom] = useState(false)
  if (!url) return null
  return (
    <figure className="illustration">
      <img src={url} alt={ill.prompt} title={ill.prompt} onClick={() => setZoom(true)} />
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
      {zoom && <ZoomOverlay url={url} onClose={() => setZoom(false)} />}
    </figure>
  )
}

export default function ChatPanel({ session }: Props) {
  const {
    isStreaming,
    isReviewing,
    isGeneratingChoices,
    send,
    continueStory,
    regenerate,
    stop,
    stopChoices,
    stopReview,
    prepareSceneReview,
    finalizeStory,
    startStory,
    continueLast,
    regenChoices,
    applyChoiceEffects,
    editMessage,
    deleteMessage,
    regenerateFrom,
    updateSession,
    deleteSession,
    startSession,
    removeIllustration,
    imageJobs,
    characters,
    personas,
    providers,
    worlds,
    ui,
    setUiPrefs,
  } = useStore()

  const [text, setText] = useState('')
  const [showModels, setShowModels] = useState(false)
  const [showEditor, setShowEditor] = useState(false)
  const [showSceneEditor, setShowSceneEditor] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [showStatus, setShowStatus] = useState(false)
  const [discoveryScope, setDiscoveryScope] = useState<DiscoveryScope | null>(null)
  const [showImageGen, setShowImageGen] = useState(false)
  const [showBgGen, setShowBgGen] = useState(false)
  const [showCassetteEditor, setShowCassetteEditor] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [showFinale, setShowFinale] = useState(false)
  const [speaker, setSpeaker] = useState<string | undefined>(undefined)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  // 自動スクロールは「自分の操作直後の1回」だけ（生成中は追従しない。FB3-A3）
  const lastScrolledRef = useRef<string | null>(null)
  // 選択肢の連打による二重加点を防ぐ（適用済みメッセージ id を同期的に記録）
  const choiceLockRef = useRef<string | null>(null)
  // ドックタブのトグル（同じタブを再クリックで閉じる。UI-3）
  const toggleDock = (tab: DockTab) => setUiPrefs({ dockTab: ui.dockTab === tab ? null : tab })

  const scene = currentScene(session)
  // エピローグ滞在中か／物語が完結済みか（設計_エンディング.md。完結は別フラグを持たず ending＋endedAt から導出）
  const isEpilogue = !!session.ending && scene?.id === session.ending.epilogueSceneId
  const epilogueScene = session.ending
    ? session.scenes.find((sc) => sc.id === session.ending!.epilogueSceneId)
    : undefined
  const isFinalized = !!session.ending && !!epilogueScene?.endedAt
  const castIds = scene && scene.activeCharacterIds.length > 0 ? scene.activeCharacterIds : session.characterIds

  const participants = useMemo(
    () =>
      castIds
        .map((id) => characters.find((c) => c.id === id))
        .filter((c): c is NonNullable<typeof c> => !!c),
    [castIds, characters],
  )
  const world = worlds.find((w) => w.id === session.worldId)
  const endingDef = session.ending
    ? world?.endings?.find((e) => e.id === session.ending!.defId)
    : undefined
  const stageOn = session.spritesEnabled ?? true // 未設定は ON（コンテンツが無ければ何も描かれない）
  const persona = personas.find((p) => p.id === session.personaId)
  const novel = session.narrativeStyle === 'novel'
  const groupMode = session.mode === 'roleplay' && participants.length > 1 && !novel
  const effectiveSpeaker = groupMode ? speaker : participants[0]?.id

  // 現在シーンのおおよそのトークン量（締め時の目安。prompts.ts のペース制御ナッジと共通判定）
  const sceneTokens = useMemo(() => sceneTokensOf(session), [session])
  const tokLvl = tokenLevel(sceneTokens)

  // 締め時の提案チップ（FB5-①c）。自動でレビューは開かず、シーン単位で閉じられる
  const [wrapHintHiddenFor, setWrapHintHiddenFor] = useState<string | null>(null)
  const showWrapHint =
    tokLvl === 'high' &&
    !isEpilogue &&
    !isFinalized &&
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

  // メッセージ列が変わって再レンダーされたらロック解除（削除して選び直す等の正当な再選択を許す）
  useEffect(() => {
    choiceLockRef.current = null
  }, [session.messages])

  useEffect(() => {
    startSession()
    setSpeaker(undefined)
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
    await send(t, effectiveSpeaker)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  const toggleScene = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

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

  const avatarFor = (characterId?: string) => {
    const c = characters.find((x) => x.id === characterId) ?? participants[0]
    return c
      ? { avatar: c.avatar, name: c.name || 'AI' }
      : { avatar: { color: '#7c5cff' }, name: session.mode === 'story' ? '物語' : 'AI' }
  }

  // 小説形式: 地の文と「」セリフを分けて軽く装飾
  const renderProse = (text: string) =>
    text.split(/(「[^」]*」)/g).map((p, i) =>
      p.startsWith('「') ? (
        <span key={i} className="dialogue">
          {p}
        </span>
      ) : (
        <span key={i}>{p}</span>
      ),
    )

  const startEdit = (m: Message) => {
    setEditingId(m.id)
    setEditText(m.content)
  }
  const saveEdit = () => {
    if (editingId) editMessage(editingId, editText)
    setEditingId(null)
  }

  const editBox = () => (
    <div className="edit-box">
      <textarea
        rows={4}
        value={editText}
        autoFocus
        onChange={(e) => setEditText(e.target.value)}
      />
      <div className="edit-actions">
        <button className="btn" onClick={() => setEditingId(null)}>
          キャンセル
        </button>
        <button className="btn primary" onClick={saveEdit}>
          保存
        </button>
      </div>
    </div>
  )

  const isMarker = (m: Message) =>
    m.role === 'user' && (m.content === CONTINUE_PROMPT || m.content === SCENE_START_PROMPT)

  const msgActions = (m: Message) => {
    if (isStreaming || m.pending) return null
    return (
      <div className="msg-actions">
        <button onClick={() => startEdit(m)}>
          <Icon name="pencil" size={13} /> 編集
        </button>
        <button onClick={() => regenerateFrom(m.id)} title="この発言以降を作り直す">
          <Icon name="rotate-ccw" size={13} /> ここから
        </button>
        <button onClick={() => deleteMessage(m.id)}>
          <Icon name="trash-2" size={13} /> 削除
        </button>
        {/* 末尾のアシスタント本文にだけ「選択肢を生成」（FB3-A6） */}
        {m.id === lastAssistantId && session.choiceMode !== 'off' && (
          <button
            onClick={() => regenChoices()}
            disabled={isGeneratingChoices}
            title="この応答の選択肢を生成する"
          >
            <Icon name="refresh-cw" size={13} /> 選択肢を生成
          </button>
        )}
      </div>
    )
  }

  const renderNovelMessage = (m: Message) => {
    if (editingId === m.id) return <div className="prose-block" key={m.id}>{editBox()}</div>
    if (m.role === 'assistant') {
      const structured = hasStructuredLines(m.content, participants)
      return (
        <div className="prose-block" key={m.id}>
          {structured ? (
            <StructuredNovelBody
              content={m.content}
              participants={participants}
              persona={persona}
              pending={!!m.pending && isStreaming}
            />
          ) : (
            <>
              {renderProse(m.content)}
              {m.pending && isStreaming && <span className="cursor" />}
            </>
          )}
          {msgActions(m)}
        </div>
      )
    }
    return (
      <div className="prose-action" key={m.id}>
        {m.content}
        {msgActions(m)}
      </div>
    )
  }

  const renderMessage = (m: Message) => {
    if (novel) return renderNovelMessage(m)
    if (m.role === 'assistant' && editingId !== m.id && hasStructuredLines(m.content, participants)) {
      return (
        <div className="st-message" key={m.id}>
          <StructuredChatBody
            content={m.content}
            participants={participants}
            persona={persona}
            pending={!!m.pending && isStreaming}
          />
          {msgActions(m)}
        </div>
      )
    }
    const av = m.role === 'assistant' ? avatarFor(m.characterId) : null
    const name = m.role === 'assistant' ? (av?.name ?? 'AI') : persona?.name || 'あなた'
    return (
      <div className="msg" key={m.id}>
        {m.role === 'assistant' ? (
          <EntityAvatar className="avatar" avatar={av!.avatar} name={av!.name} />
        ) : (
          <EntityAvatar className="avatar" avatar={persona?.avatar} name={persona?.name || 'あなた'} />
        )}
        <div className="bubble">
          <div className="name">{name}</div>
          {editingId === m.id ? (
            editBox()
          ) : (
            <>
              <div className="content">
                {m.content}
                {m.pending && isStreaming && <span className="cursor" />}
              </div>
              {msgActions(m)}
            </>
          )}
        </div>
      </div>
    )
  }

  /** メッセージ＋挿絵をアンカー順に描画（アンカー消失分はシーン末尾に集約） */
  const renderSceneContent = (sc: Scene, msgs: Message[]) => {
    const ills = sc.illustrations ?? []
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
      <IllustrationView key={ill.id} ill={ill} onRemove={() => removeIllustration(session.id, sc.id, ill.id)} />
    )
    // マーカーは本文を持たず、ターンの境目に薄い水平線（.gen-divider）だけを描く。
    // 小説形式ではユーザー入力の前にも線を1本入れる。シーン先頭（＝直前に本文が無い）では線を出さない（A2）
    let seenContent = false
    const out: JSX.Element[] = []
    for (const m of msgs) {
      const marker = isMarker(m)
      const isSceneStart = m.content === SCENE_START_PROMPT
      const boundary = seenContent && !isSceneStart && (marker || (novel && m.role === 'user'))
      if (boundary) out.push(<div className="gen-divider" key={m.id + '-div'} />)
      if (marker) {
        seenContent = true
        continue
      }
      out.push(
        <Fragment key={m.id}>
          {renderMessage(m)}
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

  return (
    <div className={'main' + (stageOn ? ' stage-on' : '')}>
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
          <button className="scene-chip" onClick={() => setShowSceneEditor(true)} title="登場キャラ・シーン編集">
            <Icon name="book-open" size={14} />
            <span className="scene-chip-title">
              {scene.title}
              {scene.timeLabel ? `・${scene.timeLabel}` : ''}
            </span>
            <span className={'token-badge ' + tokLvl} title="現在シーンのおおよそのトークン量">
              ~{sceneTokens.toLocaleString()} tok{tokLvl === 'high' ? ' ・締め時' : ''}
            </span>
          </button>
        )}

        {isFinalized && session.ending && (
          <button
            className="badge accent"
            style={{ cursor: 'pointer' }}
            onClick={() => setShowFinale(true)}
            title="この物語は完結しています（続きは分岐ツリーから復元できます）"
          >
            🏁 完結：{session.ending.name}
          </button>
        )}

        <ActivityIndicator />

        <div className="topbar-group">
          <button
            className={'icon-btn' + (ui.dockTab === 'status' ? ' on' : '')}
            onClick={() => toggleDock('status')}
            title="状態（関係性・ステータス）"
          >
            <Icon name="bar-chart-3" />
          </button>
          <button
            className={'icon-btn' + (ui.dockTab === 'discovery' ? ' on' : '')}
            onClick={() => toggleDock('discovery')}
            title="発見ログ（このセッションで見つかった設定）"
          >
            <Icon name="book-open" />
          </button>
          <button
            className={'icon-btn' + (ui.dockTab === 'gallery' ? ' on' : '')}
            onClick={() => toggleDock('gallery')}
            title="画像ギャラリー"
          >
            <Icon name="image" />
          </button>
          <button
            className={'icon-btn' + (ui.dockTab === 'branch' ? ' on' : '')}
            onClick={() => toggleDock('branch')}
            title="分岐ツリー（セーブ/ロード）"
          >
            <Icon name="git-branch" />
          </button>
          <button
            className={'icon-btn' + (ui.dockTab === 'jobs' ? ' on' : '')}
            onClick={() => toggleDock('jobs')}
            title="画像生成ジョブ（進行中・選択待ち）"
          >
            <Icon name="hourglass" />
            {imageJobs.length > 0 && <span className="icon-badge">{imageJobs.length}</span>}
          </button>
        </div>

        <ReaderSettings session={session} />

        <div className="menu-anchor">
          <button className="icon-btn" onClick={() => setShowMenu((v) => !v)} title="メニュー">
            <Icon name="more-horizontal" />
          </button>
          {showMenu && (
            <MenuPopover onClose={() => setShowMenu(false)}>
              <button
                className="menu-item"
                onClick={() => {
                  setShowMenu(false)
                  setShowModels(true)
                }}
              >
                モデル: {modelRefLabel(session.model, providers) || session.model}
              </button>
              <div className="menu-sep" />
              <button
                className="menu-item"
                onClick={() => {
                  setShowMenu(false)
                  setShowLog(true)
                }}
              >
                <Icon name="scroll-text" size={15} /> あらすじ
              </button>
              <button
                className="menu-item"
                disabled={!scene}
                onClick={() => {
                  setShowMenu(false)
                  setShowImageGen(true)
                }}
              >
                <Icon name="palette" size={15} /> 挿絵を生成
              </button>
              <button
                className="menu-item"
                disabled={!scene}
                onClick={() => {
                  setShowMenu(false)
                  setShowBgGen(true)
                }}
              >
                <Icon name="mountain" size={15} /> 背景を生成
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
          {/* バックドロップは play-col 直下に敷き、コンポーザーの背面にも透けるようにする（V5d・UI-3で.main直下からplay-colへ移設） */}
          {stageOn && <StageBackdrop session={session} scene={scene} participants={participants} />}
          <div className="chat-wrap">
            <div className="chat">
              <div className="chat-inner">
                {session.messages.length === 0 && (
                  <div className="chat-hint">
                    {!isConfigured ? (
                      <p>
                        右上の ⋯ メニュー →「セッション設定」から
                        {session.mode === 'roleplay' ? '参加キャラ' : '物語の前提'}を設定しましょう。
                      </p>
                    ) : session.mode === 'roleplay' ? (
                      <p>下の入力欄から話しかけてみましょう。</p>
                    ) : (
                      <p>「物語をはじめる」を押すか、最初の状況を入力してください。</p>
                    )}
                  </div>
                )}

                {session.scenes.map((sc) => {
                  const isCurrent = sc.id === session.currentSceneId
                  const msgs = session.messages.filter(
                    (m) => m.sceneId === sc.id || (isCurrent && !m.sceneId),
                  )
                  if (msgs.length === 0 && !sc.summary && !isCurrent) return null
                  const open = isCurrent || expanded.has(sc.id)
                  const castNames = sc.activeCharacterIds
                    .map((id) => characters.find((c) => c.id === id)?.name)
                    .filter(Boolean)
                  // シーンに本文（マーカー以外）か要約があれば1シーン目でも見出しを表示（FB3-A1）
                  const hasRealContent = msgs.some((m) => m.content.trim() && m.content !== CONTINUE_PROMPT && m.content !== SCENE_START_PROMPT)
                  const showDivider = hasRealContent || !!sc.summary || session.scenes.length > 1
                  return (
                    <Fragment key={sc.id}>
                      {showDivider && (
                        <div className="scene-divider">
                          <span className="scene-title">📖 {sc.title}</span>
                          {castNames.length > 0 && (
                            <span className="scene-cast">{castNames.join('・')}</span>
                          )}
                          {!isCurrent && msgs.length > 0 && (
                            <button className="scene-toggle" onClick={() => toggleScene(sc.id)}>
                              {open ? '会話を隠す' : '会話を表示'}
                            </button>
                          )}
                        </div>
                      )}
                      {!isCurrent && sc.summary && (
                        <div className="scene-summary">
                          <div className="scene-summary-label">
                            あらすじ
                            <button
                              className="scene-summary-regen"
                              onClick={() => prepareSceneReview(sc.id)}
                              disabled={isStreaming || isReviewing}
                              title="このシーンの要約と次シーンの方針を再生成する"
                            >
                              <Icon name="refresh-cw" size={12} /> 再生成
                            </button>
                          </div>
                          <div className="scene-summary-body">{sc.summary}</div>
                        </div>
                      )}
                      {open && renderSceneContent(sc, msgs)}
                    </Fragment>
                  )
                })}
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
                    🎲 おまかせ
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
                      onClick={() => {
                        if (choiceLockRef.current === lastMsg.id) return
                        choiceLockRef.current = lastMsg.id
                        if (c.effects?.length) applyChoiceEffects(c.effects)
                        send(c.text, effectiveSpeaker)
                      }}
                      disabled={isStreaming}
                    >
                      <span className="choice-num">{i + 1}</span>
                      {c.text}
                      {!!c.effects?.length && (
                        <span className="choice-effects">
                          {c.effects.map((e, j) => (
                            <span key={j} className="choice-effect-badge">
                              {e.delta > 0 ? '+' : ''}
                              {e.delta} {e.name}
                            </span>
                          ))}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {/* 締め時の提案チップ（FB5-①c）。ペース制御ナッジと同じ閾値で「このシーンを終える」を後押しする */}
              {showWrapHint && scene && (
                <div className="scene-wrap-hint">
                  <span className="scene-wrap-hint-text">
                    シーンが長くなってきました（~{sceneTokens.toLocaleString()} tok）。区切りの良いところで締めるのがおすすめです。
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
              {/* コンポーザーの操作行（常時レンダリング。高さが跳ねないよう左右にツールをまとめる） */}
              <div className="composer-tools">
                {session.mode === 'story' &&
                  (storyStarted ? (
                    <button className="btn primary" onClick={() => continueStory(effectiveSpeaker)} disabled={isStreaming}>
                      <Icon name="fast-forward" size={14} /> 続ける
                    </button>
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
                {/* 選択肢が出ない時の手動生成（モデル出力が想定外でも復旧できる） */}
                {!isStreaming &&
                  !isGeneratingChoices &&
                  session.choiceMode !== 'off' &&
                  lastMsg?.role === 'assistant' &&
                  !!lastMsg.content.trim() &&
                  (!lastMsg.choices || lastMsg.choices.length === 0) && (
                    <button
                      className="composer-tool-btn"
                      onClick={() => regenChoices()}
                      title="この応答の選択肢を生成し直す"
                    >
                      <Icon name="refresh-cw" size={14} /> 選択肢を生成
                    </button>
                  )}
                <div style={{ flex: 1 }} />
                {/* 挿絵・背景生成は「進行しながら使う」操作なので入力欄付近にも置く（⋯メニューとも両導線。F3/R9） */}
                <button
                  className="composer-tool-btn"
                  disabled={!scene}
                  title={scene ? 'この場面の挿絵を生成' : '物語を開始すると生成できます'}
                  onClick={() => setShowImageGen(true)}
                >
                  <Icon name="palette" size={14} />
                </button>
                <button
                  className="composer-tool-btn"
                  disabled={!scene}
                  title={scene ? 'この場面の背景を生成' : '物語を開始すると生成できます'}
                  onClick={() => setShowBgGen(true)}
                >
                  <Icon name="mountain" size={14} />
                </button>
                <button className="composer-tool-btn" onClick={() => setShowSceneEditor(true)}>
                  <Icon name="pencil" size={14} /> シーン編集
                </button>
                {isEpilogue && !isFinalized ? (
                  <button
                    className="scene-btn end"
                    onClick={() => {
                      finalizeStory()
                      setShowFinale(true)
                    }}
                    disabled={isStreaming}
                    title="エピローグを締めて物語を完結する"
                  >
                    🏁 物語を完結する
                  </button>
                ) : (
                  <button
                    className="scene-btn end"
                    onClick={() => (isReviewing ? stopReview() : prepareSceneReview())}
                    disabled={isStreaming || isFinalized}
                    title={
                      isFinalized
                        ? 'この物語は完結しています'
                        : isReviewing
                          ? 'レビュー生成を中止'
                          : 'このシーンを振り返って次のシーンへ'
                    }
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

              <div className="input-row">
                <textarea
                  ref={taRef}
                  rows={1}
                  value={text}
                  placeholder={
                    session.mode === 'roleplay'
                      ? 'メッセージや行動を入力（Enter で送信 / Shift+Enter で改行）'
                      : '物語への介入や方向づけを入力（任意）'
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
                  <button className="send-btn" onClick={submit} disabled={!text.trim()} title="送信">
                    <Icon name="arrow-up" size={16} />
                  </button>
                )}
              </div>
              {/* ヒントは会話開始前のみ（常時表示だと本文を1行ぶん間延びさせる。F0/A2） */}
              {session.messages.length === 0 && (
                <div className="hint">
                  {groupMode
                    ? '「次に話す」で発言者を選べます。登場キャラはシーン編集で絞れます。'
                    : session.mode === 'story'
                      ? '入力ありで介入、空のまま「続ける」で自動進行します。'
                      : 'キャラになりきって応答します。設定は右上の ⋯ メニューから。'}
                </div>
              )}
            </div>
          </div>
        </div>
        <ContextDock
          session={session}
          onEditStatus={() => setShowStatus(true)}
          onEditDiscovery={(scope) => setDiscoveryScope(scope)}
        />
      </div>

      {showModels && (
        <ModelPicker
          current={session.model}
          onPick={(id) => updateSession(session.id, { model: id })}
          onClose={() => setShowModels(false)}
        />
      )}
      {showEditor && <SessionEditor session={session} onClose={() => setShowEditor(false)} />}
      {showSceneEditor && scene && (
        <SceneEditor session={session} scene={scene} onClose={() => setShowSceneEditor(false)} />
      )}
      {showLog && <StoryLogModal session={session} onClose={() => setShowLog(false)} />}
      {showStatus && <StatusPanel session={session} onClose={() => setShowStatus(false)} />}
      {discoveryScope && (
        <DiscoveryPanel
          session={session}
          scope={discoveryScope}
          onClose={() => setDiscoveryScope(null)}
        />
      )}
      {showImageGen && scene && (
        <ImageGenModal
          title="この場面の挿絵を生成"
          draftContext={{
            system: illustrationPromptSystem(),
            user: illustrationContextUser({
              sceneTitle: scene.title,
              sceneNote: scene.note,
              timeLabel: scene.timeLabel,
              characters: participants.map((c) => ({
                name: c.name,
                appearance: c.appearance,
                imagePrompt: c.imagePrompt,
              })),
              recentMessages: (() => {
                // 現在シーンのメッセージのみ（旧データは sceneId 無しがあるため || !m.sceneId を維持）
                const sceneMsgs = session.messages.filter(
                  (m) => (m.sceneId === scene.id || !m.sceneId) && !isMarker(m) && m.content.trim(),
                )
                // 末尾から文字数予算でキャップ（推定 8,000 文字 ≒ 4,000〜5,000 トークン程度）
                const budget = 8000
                const recent: string[] = []
                let used = 0
                for (let i = sceneMsgs.length - 1; i >= 0; i--) {
                  const c = plainTextOf(sceneMsgs[i].content)
                  if (used + c.length > budget && recent.length > 0) break
                  recent.unshift(c)
                  used += c.length
                }
                return recent
              })(),
            }),
            modelRef: reviewModelOf(session),
          }}
          initialPrompt={participants.map((c) => c.imagePrompt).filter(Boolean).join(', ')}
          target={{
            type: 'scene-illustration',
            sessionId: session.id,
            sceneId: scene.id,
            messageId: (() => {
              const sceneMsgs = session.messages.filter((m) => m.sceneId === scene.id || !m.sceneId)
              return sceneMsgs[sceneMsgs.length - 1]?.id
            })(),
          }}
          label={`挿絵: ${scene.title || 'シーン'}`}
          onClose={() => setShowImageGen(false)}
        />
      )}
      {showBgGen && scene && (
        <ImageGenModal
          title="場面の背景を生成"
          draftContext={{
            system: backgroundPromptSystem(),
            user: backgroundContextUser({
              sceneTitle: scene.title,
              sceneNote: scene.note,
              timeLabel: scene.timeLabel,
              worldDescription: world?.description,
              recentMessages: session.messages
                .filter((m) => (m.sceneId === scene.id || !m.sceneId) && m.content.trim())
                .slice(-6)
                .map((m) => plainTextOf(m.content)),
            }),
            modelRef: reviewModelOf(session),
          }}
          defaultSizeIdx={1}
          target={{ type: 'scene-background', sessionId: session.id, sceneId: scene.id }}
          label={`背景: ${scene.title || 'シーン'}`}
          onClose={() => setShowBgGen(false)}
        />
      )}
      {showCassetteEditor && (
        <CassetteEditor seedSession={session} onClose={() => setShowCassetteEditor(false)} />
      )}

      {/* 完結オーバーレイ（簡素な演出。将来ここにエンディング CG・スタッフロールを足せる） */}
      {showFinale && session.ending && (
        <ModalShell
          title="🏁 物語の完結"
          onClose={() => setShowFinale(false)}
          footer={
            <button className="btn primary" onClick={() => setShowFinale(false)}>
              閉じる
            </button>
          }
        >
          <div className="field" style={{ textAlign: 'center', padding: '12px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🏁</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
              {session.ending.name}
            </div>
            {endingDef?.description && (
              <p className="desc" style={{ maxWidth: 420, margin: '0 auto' }}>
                {endingDef.description}
              </p>
            )}
            <p className="desc" style={{ marginTop: 16 }}>
              おつかれさまでした。読み返し・別の結末を狙う周回は、分岐ツリーからいつでも再開できます。
            </p>
          </div>
        </ModalShell>
      )}
    </div>
  )
}
