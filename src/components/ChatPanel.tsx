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
import { estimateTokens, tokenLevel } from '../lib/tokens'
import { modelRefLabel } from '../lib/providers'
import { getImage, useImageUrl } from '../lib/imageStore'
import { downloadBlob } from '../lib/io'
import ImageGenModal from './ImageGenModal'
import ImageJobsPanel from './ImageJobsPanel'
import type { Message, Scene, SceneIllustration, Session } from '../types'
import ModelPicker from './ModelPicker'
import SessionEditor from './SessionEditor'
import SceneEditor from './SceneEditor'
import StoryLogModal from './StoryLogModal'
import StatusPanel from './StatusPanel'
import DiscoveryPanel from './DiscoveryPanel'
import GalleryModal from './GalleryModal'
import BranchTreeModal from './BranchTreeModal'
import EntityAvatar from './EntityAvatar'
import StageBackdrop from './StageBackdrop'

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
          ⬇
        </button>
        <button
          className="icon-btn small"
          title="挿絵を削除"
          onClick={() => {
            if (confirm('この挿絵を削除しますか？')) onRemove()
          }}
        >
          🗑
        </button>
      </div>
      {zoom && (
        <div className="overlay" onClick={() => setZoom(false)}>
          <img src={url} alt="" style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 'var(--radius)' }} />
        </div>
      )}
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
  } = useStore()

  const [text, setText] = useState('')
  const [showModels, setShowModels] = useState(false)
  const [showEditor, setShowEditor] = useState(false)
  const [showSceneEditor, setShowSceneEditor] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [showStatus, setShowStatus] = useState(false)
  const [showDiscovery, setShowDiscovery] = useState(false)
  const [showGallery, setShowGallery] = useState(false)
  const [showBranchTree, setShowBranchTree] = useState(false)
  const [showImageGen, setShowImageGen] = useState(false)
  const [showBgGen, setShowBgGen] = useState(false)
  const [showImageJobs, setShowImageJobs] = useState(false)
  const [speaker, setSpeaker] = useState<string | undefined>(undefined)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  // 選択肢の連打による二重加点を防ぐ（適用済みメッセージ id を同期的に記録）
  const choiceLockRef = useRef<string | null>(null)

  const scene = currentScene(session)
  const castIds = scene && scene.activeCharacterIds.length > 0 ? scene.activeCharacterIds : session.characterIds

  const participants = useMemo(
    () =>
      castIds
        .map((id) => characters.find((c) => c.id === id))
        .filter((c): c is NonNullable<typeof c> => !!c),
    [castIds, characters],
  )
  const world = worlds.find((w) => w.id === session.worldId)
  const stageOn = session.spritesEnabled ?? true // 未設定は ON（コンテンツが無ければ何も描かれない）
  const persona = personas.find((p) => p.id === session.personaId)
  const novel = session.narrativeStyle === 'novel'
  const groupMode = session.mode === 'roleplay' && participants.length > 1 && !novel
  const effectiveSpeaker = groupMode ? speaker : participants[0]?.id

  // 現在シーンのおおよそのトークン量（締め時の目安）
  const sceneTokens = useMemo(
    () =>
      estimateTokens(
        session.messages
          .filter((m) => m.sceneId === scene?.id)
          .map((m) => m.content)
          .join('\n'),
      ),
    [session.messages, scene?.id],
  )
  const tokLvl = tokenLevel(sceneTokens)

  useEffect(() => {
    anchorRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [session.messages, isStreaming])

  // メッセージ列が変わって再レンダーされたらロック解除（削除して選び直す等の正当な再選択を許す）
  useEffect(() => {
    choiceLockRef.current = null
  }, [session.messages])

  useEffect(() => {
    startSession()
    setSpeaker(undefined)
    setExpanded(new Set())
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

  const markerText = (content: string) =>
    content === SCENE_START_PROMPT ? '— 新しい場面 —' : '— 物語を進める —'
  const isMarker = (m: Message) =>
    m.role === 'user' && (m.content === CONTINUE_PROMPT || m.content === SCENE_START_PROMPT)

  const msgActions = (m: Message) => {
    if (isStreaming || m.pending) return null
    return (
      <div className="msg-actions">
        {!isMarker(m) && <button onClick={() => startEdit(m)}>✎ 編集</button>}
        <button onClick={() => regenerateFrom(m.id)} title="この発言以降を作り直す">
          ↻ ここから
        </button>
        <button onClick={() => deleteMessage(m.id)}>🗑 削除</button>
      </div>
    )
  }

  const renderNovelMessage = (m: Message) => {
    if (editingId === m.id) return <div className="prose-block" key={m.id}>{editBox()}</div>
    const marker = isMarker(m)
    if (m.role === 'assistant') {
      return (
        <div className="prose-block" key={m.id}>
          {renderProse(m.content)}
          {m.pending && isStreaming && <span className="cursor" />}
          {msgActions(m)}
        </div>
      )
    }
    return (
      <div className={'prose-action' + (marker ? ' continue' : '')} key={m.id}>
        {marker ? markerText(m.content) : m.content}
        {msgActions(m)}
      </div>
    )
  }

  const renderMessage = (m: Message) => {
    if (novel) return renderNovelMessage(m)
    const marker = isMarker(m)
    const av = m.role === 'assistant' ? avatarFor(m.characterId) : null
    const name = m.role === 'assistant' ? (av?.name ?? 'AI') : persona?.name || 'あなた'
    return (
      <div className="msg" key={m.id}>
        {m.role === 'assistant' ? (
          <EntityAvatar className="avatar" avatar={av!.avatar} name={av!.name} />
        ) : (
          <EntityAvatar className="avatar" avatar={persona?.avatar} name={persona?.name || 'あなた'} />
        )}
        <div className={'bubble' + (marker ? ' continue' : '')}>
          <div className="name">{name}</div>
          {editingId === m.id ? (
            editBox()
          ) : (
            <>
              <div className="content">
                {marker ? markerText(m.content) : m.content}
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
    return (
      <>
        {msgs.map((m) => (
          <Fragment key={m.id}>
            {renderMessage(m)}
            {(byMessage.get(m.id) ?? []).map(illView)}
          </Fragment>
        ))}
        {orphans.map(illView)}
      </>
    )
  }

  return (
    <div className={'main' + (stageOn ? ' stage-on' : '')}>
      <div className="topbar">
        <input
          className="session-title"
          value={session.title}
          onChange={(e) => updateSession(session.id, { title: e.target.value })}
        />
        <button className="model-chip" onClick={() => setShowModels(true)} title="モデルを変更">
          {modelRefLabel(session.model, providers) || session.model}
        </button>
        <button className="icon-btn" onClick={() => setShowLog(true)} title="あらすじ一覧">
          📜
        </button>
        <button className="icon-btn" onClick={() => setShowStatus(true)} title="状態（関係性・ステータス）">
          📊
        </button>
        <button className="icon-btn" onClick={() => setShowDiscovery(true)} title="発見ログ（このセッションで見つかった設定）">
          📖
        </button>
        <button className="icon-btn" onClick={() => setShowGallery(true)} title="画像ギャラリー">
          🖼
        </button>
        <button className="icon-btn" onClick={() => setShowBranchTree(true)} title="分岐ツリー（セーブ/ロード）">
          🕘
        </button>
        <button
          className={'icon-btn' + (stageOn ? ' on' : '')}
          onClick={() => updateSession(session.id, { spritesEnabled: !stageOn })}
          title="背景・立ち絵の表示（立ち絵はキャラクター編集の「🎭 立ち絵セット」で生成できます）"
        >
          🎭
        </button>
        <button
          className="icon-btn"
          onClick={() => setShowImageGen(true)}
          disabled={!scene}
          title={scene ? 'この場面の挿絵を生成' : '物語を開始すると挿絵を生成できます'}
        >
          🎨
        </button>
        <button
          className="icon-btn"
          onClick={() => setShowBgGen(true)}
          disabled={!scene}
          title={scene ? 'この場面の背景を生成' : '物語を開始すると背景を生成できます'}
        >
          🏞
        </button>
        {imageJobs.length > 0 && (
          <button
            className="icon-btn"
            onClick={() => setShowImageJobs(true)}
            title="画像生成ジョブ（進行中・選択待ち）"
          >
            ⏳ {imageJobs.length}
          </button>
        )}
        <button className="icon-btn" onClick={() => setShowEditor(true)} title="セッション設定">
          ⚙
        </button>
        <button
          className="icon-btn"
          onClick={() => {
            if (confirm('このセッションを削除しますか？')) deleteSession(session.id)
          }}
          title="削除"
        >
          🗑
        </button>
      </div>

      {/* バックドロップは .main 直下（topbar 以下全体）に敷き、コンポーザーの背面にも透けるようにする（V5d） */}
      {stageOn && <StageBackdrop session={session} scene={scene} participants={participants} />}
      <div className="chat-wrap">
        <div className="chat">
          <div className="chat-inner">
            {session.messages.length === 0 && (
              <div className="chat-hint">
                {!isConfigured ? (
                  <p>
                    右上の ⚙ から
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
              // 複数シーンがある時だけ仕切りを表示
              const showDivider = session.scenes.length > 1
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
                          🔄 再生成
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
          {/* シーンバー */}
          <div className="scene-bar">
            <span className="scene-bar-title">📖 {scene?.title ?? 'シーン'}</span>
            {participants.length > 0 && (
              <span className="scene-bar-cast">
                登場: {participants.map((c) => c.name || '無名').join('・')}
              </span>
            )}
            <span className={'token-badge ' + tokLvl} title="現在シーンのおおよそのトークン量">
              ~{sceneTokens.toLocaleString()} tok{tokLvl === 'high' ? ' ・締め時' : ''}
            </span>
            <div style={{ flex: 1 }} />
            <button className="scene-btn" onClick={() => setShowSceneEditor(true)}>
              登場キャラ・シーン編集
            </button>
            <button
              className="scene-btn end"
              onClick={() => (isReviewing ? stopReview() : prepareSceneReview())}
              disabled={isStreaming}
              title={isReviewing ? 'レビュー生成を中止' : 'このシーンを振り返って次のシーンへ'}
            >
              {isReviewing ? '◼ レビュー作成中…（中止）' : '✓ このシーンを終える'}
            </button>
          </div>

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

          {session.mode === 'story' &&
            (session.messages.filter((m) => m.sceneId === scene?.id).length === 0 ? (
              <div className="story-actions">
                <button className="primary" onClick={() => startStory()} disabled={isStreaming}>
                  ▶ 物語をはじめる
                </button>
              </div>
            ) : (
              <div className="story-actions">
                <button
                  className="primary"
                  onClick={() => continueStory(effectiveSpeaker)}
                  disabled={isStreaming}
                >
                  ⏩ 続ける
                </button>
                {session.messages.some((m) => m.role === 'assistant') && (
                  <button onClick={() => regenerate(effectiveSpeaker)} disabled={isStreaming}>
                    ↻ やり直す
                  </button>
                )}
              </div>
            ))}

          {groupMode && session.messages.some((m) => m.role === 'assistant') && (
            <div className="story-actions">
              <button onClick={() => regenerate(effectiveSpeaker)} disabled={isStreaming}>
                ↻ 直前をやり直す
              </button>
            </div>
          )}

          {!isStreaming && lastMsg?.role === 'assistant' && lastMsg.truncated && (
            <div className="story-actions">
              <button onClick={() => continueLast()} title="上限で途中で切れた続きを生成">
                ⤵ 続きを生成
              </button>
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
          {/* 選択肢が出ない時の手動生成（モデル出力が想定外でも復旧できる） */}
          {!isStreaming &&
            !isGeneratingChoices &&
            session.choiceMode !== 'off' &&
            lastMsg?.role === 'assistant' &&
            !!lastMsg.content.trim() &&
            (!lastMsg.choices || lastMsg.choices.length === 0) && (
              <div className="story-actions">
                <button onClick={() => regenChoices()} title="この応答の選択肢を生成し直す">
                  🔁 選択肢を生成
                </button>
              </div>
            )}

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
                ◼
              </button>
            ) : (
              <button className="send-btn" onClick={submit} disabled={!text.trim()} title="送信">
                ↑
              </button>
            )}
          </div>
          <div className="hint">
            {groupMode
              ? '「次に話す」で発言者を選べます。登場キャラはシーン編集で絞れます。'
              : session.mode === 'story'
                ? '入力ありで介入、空のまま「続ける」で自動進行します。'
                : 'キャラになりきって応答します。設定は右上の ⚙ から。'}
          </div>
        </div>
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
      {showDiscovery && (
        <DiscoveryPanel session={session} onClose={() => setShowDiscovery(false)} />
      )}
      {showGallery && <GalleryModal session={session} onClose={() => setShowGallery(false)} />}
      {showBranchTree && <BranchTreeModal session={session} onClose={() => setShowBranchTree(false)} />}
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
                  const c = sceneMsgs[i].content
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
                .map((m) => m.content),
            }),
            modelRef: reviewModelOf(session),
          }}
          defaultSizeIdx={1}
          target={{ type: 'scene-background', sessionId: session.id, sceneId: scene.id }}
          label={`背景: ${scene.title || 'シーン'}`}
          onClose={() => setShowBgGen(false)}
        />
      )}
      {showImageJobs && <ImageJobsPanel onClose={() => setShowImageJobs(false)} />}
    </div>
  )
}
