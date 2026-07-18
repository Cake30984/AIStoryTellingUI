import { useEffect, useMemo, useState } from 'react'
import { applyReviewToState, checkEndings, useStore } from '../store'
import { advanceTimeline, timeLabelOf } from '../lib/timeline'
import type {
  CounterEvent,
  NextSceneSuggestion,
  RelationUpdate,
  SceneReview,
  StatChange,
  WorldGrowth,
} from '../types'
import ModalShell from './ModalShell'
import CsvInput from './CsvInput'
import { Icon } from './icons'

/** 編集用 draft はストアの review から分離した深コピー（編集途中で元を汚さない。FB5-C） */
const cloneReview = (r: SceneReview): SceneReview => JSON.parse(JSON.stringify(r))

/** 配列の i 番目だけを部分更新した新配列を返す */
const mapAt = <T,>(arr: T[], i: number, patch: Partial<T>): T[] =>
  arr.map((x, j) => (j === i ? { ...x, ...patch } : x))

export default function SceneReviewModal() {
  const {
    sceneReview,
    confirmSceneReview,
    updateSceneReview,
    cancelReview,
    isReviewing,
    isRegenSuggestions,
    sessions,
    activeId,
    worlds,
    stopReview,
  } = useStore()
  const review = sceneReview!
  const session = sessions.find((s) => s.id === activeId)
  const isPastScene = !!session && review.sceneId !== session.currentSceneId
  const world = session ? worlds.find((w) => w.id === session.worldId) : undefined

  // 次シーンで進む時間帯（現在シーン確定時のみ。タイムライン有効時）
  const nextTimeLabel =
    session && session.timeline.enabled && !isPastScene
      ? timeLabelOf(advanceTimeline(session.timeline))
      : null

  // 表示・編集・プレビューはすべて draft を読む（FB5-C）。ストアの review は候補再生成まで不変
  const [draft, setDraft] = useState<SceneReview>(() => cloneReview(review))
  const [editMode, setEditMode] = useState(false)
  // 「自分で決める」の直接記入（記入があれば AI 候補と同じ扱いで確定に渡す）
  const [customTitle, setCustomTitle] = useState('')
  const [customNote, setCustomNote] = useState('')

  const [pick, setPick] = useState<number>(review.suggestions.length > 0 ? 0 : -1)
  const [charSel, setCharSel] = useState<Set<number>>(
    new Set(review.characterGrowth.map((_, i) => i)),
  )
  const [worldSel, setWorldSel] = useState<Set<number>>(
    new Set(review.worldGrowth.map((_, i) => i)),
  )
  const [relUpdSel, setRelUpdSel] = useState<Set<number>>(
    new Set(review.relationUpdates.map((_, i) => i)),
  )
  const [statSel, setStatSel] = useState<Set<number>>(
    new Set(review.statChanges.map((_, i) => i)),
  )
  const [counterSel, setCounterSel] = useState<Set<number>>(
    new Set(review.counterEvents.map((_, i) => i)),
  )
  const [moodSel, setMoodSel] = useState<Set<number>>(
    new Set(review.moodChanges.map((_, i) => i)),
  )
  // 到達エンディングへ「進む」か（auto は選択なし＝常に進む。既定は保守側＝まだ続ける／満了時は進む）
  const [endingGo, setEndingGo] = useState(false)

  // 到達プレビュー（E2）。選択を確定した場合の次 state を applyReviewToState で計算し、
  // checkEndings＋満了判定でどの結末に到達するかを求める。編集後の値と一致させるため
  // 選択 index は draft の配列にマップする（FB5-C。確定側も updateSceneReview で同じ値を読む）。
  const endingPreview = useMemo(() => {
    if (!session || isPastScene || session.ending) return null
    const endings = world?.endings ?? []
    if (endings.length === 0) return null
    const sel = {
      relationUpdates: [...relUpdSel].map((i) => draft.relationUpdates[i]).filter(Boolean),
      statChanges: [...statSel].map((i) => draft.statChanges[i]).filter(Boolean),
      counterEvents: [...counterSel].map((i) => draft.counterEvents[i]).filter(Boolean),
      moodChanges: [...moodSel].map((i) => draft.moodChanges[i]).filter(Boolean),
    }
    const applied = applyReviewToState(session.state, world, session.characterIds, sel)
    const matched = checkEndings(endings, applied.state, world, session.characterIds)
    const tlNext = session.timeline.enabled ? advanceTimeline(session.timeline) : null
    const isExpiry = !!(
      tlNext &&
      session.timeline.totalDays != null &&
      tlNext.currentDay > session.timeline.totalDays
    )
    const fallback = endings.find((e) => e.fallback)
    // 候補は ①条件成立の最上位 → ②（満了時のみ）fallback
    const candidate = matched ?? (isExpiry ? fallback : undefined)
    if (!candidate) return null
    return {
      candidate,
      auto: !!candidate.auto && !candidate.fallback,
      isExpiry,
      isFallback: !!candidate.fallback,
    }
  }, [session, isPastScene, world, draft, relUpdSel, statSel, counterSel, moodSel])

  // 候補が変わったら既定選択を更新（満了時は「進む」・通常は「まだ続ける」を既定にする）
  useEffect(() => {
    if (endingPreview && !endingPreview.auto) setEndingGo(endingPreview.isExpiry)
  }, [endingPreview?.candidate.id, endingPreview?.isExpiry, endingPreview?.auto])

  // 別のレビュー（別シーン）に切り替わったときだけ全体をリセット。
  // 候補だけ再生成した場合は編集中の内容を保持する。
  useEffect(() => {
    setDraft(cloneReview(review))
    setEditMode(false)
    setCustomTitle('')
    setCustomNote('')
    setCharSel(new Set(review.characterGrowth.map((_, i) => i)))
    setWorldSel(new Set(review.worldGrowth.map((_, i) => i)))
    setRelUpdSel(new Set(review.relationUpdates.map((_, i) => i)))
    setStatSel(new Set(review.statChanges.map((_, i) => i)))
    setCounterSel(new Set(review.counterEvents.map((_, i) => i)))
    setMoodSel(new Set(review.moodChanges.map((_, i) => i)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review.sceneId])

  // 候補が変わったら suggestions だけ差し替えて選択をリセット（他の編集・自分で決めるの記入は保持。FB5-C）
  useEffect(() => {
    setDraft((d) => ({ ...d, suggestions: cloneReview(review).suggestions }))
    setPick(review.suggestions.length > 0 ? 0 : -1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review.suggestions])

  const toggle = (set: Set<number>, setFn: (s: Set<number>) => void, i: number) => {
    const next = new Set(set)
    next.has(i) ? next.delete(i) : next.add(i)
    setFn(next)
  }

  // draft の部分更新ヘルパ
  const updSuggestion = (i: number, patch: Partial<NextSceneSuggestion>) =>
    setDraft((d) => ({ ...d, suggestions: mapAt(d.suggestions, i, patch) }))
  const updGrowth = (i: number, addition: string) =>
    setDraft((d) => ({ ...d, characterGrowth: mapAt(d.characterGrowth, i, { addition }) }))
  const updWorldG = (i: number, patch: Partial<WorldGrowth>) =>
    setDraft((d) => ({ ...d, worldGrowth: mapAt(d.worldGrowth, i, patch) }))
  const updRel = (i: number, patch: Partial<RelationUpdate>) =>
    setDraft((d) => ({ ...d, relationUpdates: mapAt(d.relationUpdates, i, patch) }))
  const updRelAspect = (i: number, ai: number, note: string) =>
    setDraft((d) => ({
      ...d,
      relationUpdates: d.relationUpdates.map((u, j) =>
        j === i ? { ...u, aspects: u.aspects.map((a, k) => (k === ai ? { ...a, note } : a)) } : u,
      ),
    }))
  const updStat = (i: number, patch: Partial<StatChange>) =>
    setDraft((d) => ({ ...d, statChanges: mapAt(d.statChanges, i, patch) }))
  const updCounter = (i: number, patch: Partial<CounterEvent>) =>
    setDraft((d) => ({ ...d, counterEvents: mapAt(d.counterEvents, i, patch) }))
  const updMood = (i: number, mood: string) =>
    setDraft((d) => ({ ...d, moodChanges: mapAt(d.moodChanges, i, { mood }) }))

  // エンディングへ進むか（auto は強制。それ以外は endingGo で選択）
  const goEnding = !!endingPreview && (endingPreview.auto || endingGo)

  const hasCustom = !!(customTitle.trim() || customNote.trim())

  const confirm = () => {
    const customSug: NextSceneSuggestion | undefined = hasCustom
      ? { title: customTitle.trim(), note: customNote.trim() }
      : undefined
    // 編集内容をストアへ書き戻してから確定する（confirm 側は store の review を index で読むため。FB5-C）
    updateSceneReview(draft)
    confirmSceneReview({
      summary: draft.summary,
      suggestion: pick >= 0 ? draft.suggestions[pick] : customSug,
      characterGrowthIdx: [...charSel],
      worldGrowthIdx: [...worldSel],
      relationUpdateIdx: [...relUpdSel],
      statChangeIdx: [...statSel],
      counterEventIdx: [...counterSel],
      moodChangeIdx: [...moodSel],
      endingDefId: goEnding ? endingPreview!.candidate.id : undefined,
    })
  }

  return (
    <ModalShell
      title={
        <span className="review-title-row">
          シーン終了レビュー
          {!isReviewing && (
            <button
              className={'btn review-edit-toggle' + (editMode ? ' on' : '')}
              onClick={() => setEditMode((v) => !v)}
              title={editMode ? '編集を終えて選択に戻る' : '各項目を直接編集する'}
            >
              {editMode ? (
                <>
                  <Icon name="check" size={12} /> 編集を終える
                </>
              ) : (
                <>
                  <Icon name="pencil" size={12} /> 編集
                </>
              )}
            </button>
          )}
        </span>
      }
      onClose={cancelReview}
      dirty
      discardMessage="生成済みのレビューを破棄しますか？"
      wide
      footer={
        <>
          <button className="btn" onClick={cancelReview}>
            キャンセル
          </button>
          <button
            className="btn primary"
            onClick={confirm}
            disabled={isReviewing || isRegenSuggestions}
          >
            {isPastScene ? '要約を更新' : goEnding ? '🏁 エンディングへ進む' : '確定して次のシーンへ'}
          </button>
        </>
      }
    >
          {isReviewing ? (
            <div className="reviewing-placeholder">要約を生成中...</div>
          ) : (
            <>
              {/* あらすじ（編集モードでのみ入力可。FB5-C） */}
              <div className="field">
                <label>📝 このシーンのあらすじ</label>
                {editMode ? (
                  <textarea
                    rows={6}
                    value={draft.summary}
                    onChange={(e) => setDraft((d) => ({ ...d, summary: e.target.value }))}
                  />
                ) : (
                  <div className="review-static-text">
                    {draft.summary || '（要約なし。「✎ 編集」から記入できます）'}
                  </div>
                )}
              </div>

              {/* 到達エンディングのプレビュー（E2）。選択した状態で成立する結末を予告する */}
              {endingPreview && (
                <div className="field">
                  <label>🏁 エンディング</label>
                  {endingPreview.auto ? (
                    <div className="desc">
                      エンディング「<strong>{endingPreview.candidate.name || '無名'}</strong>」に到達します。
                      確定するとエピローグに入ります。
                    </div>
                  ) : (
                    <>
                      <div className="desc">
                        エンディング「<strong>{endingPreview.candidate.name || '無名'}</strong>」に到達できます。
                        {endingPreview.isExpiry && (
                          <span className="event-badge" style={{ marginLeft: 6 }}>
                            ⏰ 期間満了
                          </span>
                        )}
                        {endingPreview.isFallback && (
                          <span className="growth-keys">（満了時の受け皿エンディング）</span>
                        )}
                      </div>
                      <div className="review-cards">
                        <button
                          className={'review-card' + (endingGo ? ' on' : '')}
                          onClick={() => setEndingGo(true)}
                        >
                          <div className="review-card-title">エンディングへ進む</div>
                          <div className="review-card-note">エピローグに入って物語を締めくくります。</div>
                        </button>
                        <button
                          className={'review-card' + (!endingGo ? ' on' : '')}
                          onClick={() => setEndingGo(false)}
                        >
                          <div className="review-card-title">まだ続ける</div>
                          <div className="review-card-note">
                            通常どおり次のシーンへ進みます（条件を満たし続ければまた提示されます）。
                          </div>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* 特別イベントの発生（FB3-C。世界観イベントに一本化・自動発生の告知のみ） */}
              {review.scheduledEventName && (
                <div className="field">
                  <label>🎬 次シーンの方向</label>
                  <div className="director-row">
                    <span className="event-badge">特別イベント: {review.scheduledEventName}</span>
                  </div>
                </div>
              )}

              {/* 次シーン提案 */}
              <div className="field">
                <label>➡ 次のシーン</label>
                <div className="desc">
                  各案はこのシーン終了時点からの並列の候補です。いずれかを選ぶと、その方向で次のシーンを用意します。
                </div>
                {nextTimeLabel && (
                  <div className="review-next-time">
                    <span className="event-badge">⏰ 時間帯が進む → {nextTimeLabel}</span>
                  </div>
                )}
                {isRegenSuggestions && (
                  <div className="choices-loading">
                    次シーンの候補を生成中…
                    <button className="link" style={{ marginLeft: 8 }} onClick={stopReview}>
                      中止
                    </button>
                  </div>
                )}
                <div className="review-cards" style={isRegenSuggestions ? { opacity: 0.5 } : undefined}>
                  {draft.suggestions.map((s, i) =>
                    editMode ? (
                      <div
                        key={i}
                        className={'review-card review-card-edit' + (pick === i ? ' on' : '')}
                        onClick={() => setPick(i)}
                      >
                        <input
                          value={s.title}
                          placeholder={`案 ${i + 1} の見出し`}
                          onChange={(e) => updSuggestion(i, { title: e.target.value })}
                        />
                        <textarea
                          rows={2}
                          value={s.note}
                          placeholder="次のシーンの状況・方向性"
                          onChange={(e) => updSuggestion(i, { note: e.target.value })}
                        />
                      </div>
                    ) : (
                      <button
                        key={i}
                        className={'review-card' + (pick === i ? ' on' : '')}
                        onClick={() => setPick(i)}
                      >
                        <div className="review-card-title">{s.title || `案 ${i + 1}`}</div>
                        <div className="review-card-note">{s.note}</div>
                      </button>
                    ),
                  )}
                  {editMode ? (
                    <div
                      className={'review-card review-card-edit' + (pick === -1 ? ' on' : '')}
                      onClick={() => setPick(-1)}
                    >
                      <div className="review-card-title">自分で決める</div>
                      <input
                        value={customTitle}
                        placeholder="次のシーンのタイトル（任意）"
                        onChange={(e) => setCustomTitle(e.target.value)}
                      />
                      <textarea
                        rows={2}
                        value={customNote}
                        placeholder="次のシーンの状況・方向性（記入すると AI 候補と同じ扱いで導入生成に使われます）"
                        onChange={(e) => setCustomNote(e.target.value)}
                      />
                    </div>
                  ) : (
                    <button
                      className={'review-card' + (pick === -1 ? ' on' : '')}
                      onClick={() => setPick(-1)}
                    >
                      <div className="review-card-title">
                        {hasCustom ? customTitle.trim() || '自分で決める' : '自分で決める'}
                      </div>
                      <div className="review-card-note">
                        {hasCustom
                          ? customNote.trim() || '（見出しのみ指定。この見出しで次のシーンを用意します）'
                          : '空のシーンを作成し、自由に始めます。「✎ 編集」で内容を直接記入できます。'}
                      </div>
                    </button>
                  )}
                </div>
              </div>

              {/* キャラ成長 */}
              {draft.characterGrowth.length > 0 && (
                <div className="field">
                  <label>
                    🎭 キャラクターの成長{editMode ? '（内容を編集）' : '（チェックした項目を設定に追記）'}
                  </label>
                  <div className="growth-list">
                    {draft.characterGrowth.map((g, i) =>
                      editMode ? (
                        <div key={i} className="growth-item editing">
                          <strong>{g.name}</strong>
                          <textarea
                            rows={2}
                            value={g.addition}
                            onChange={(e) => updGrowth(i, e.target.value)}
                          />
                        </div>
                      ) : (
                        <label key={i} className="growth-item">
                          <input
                            type="checkbox"
                            checked={charSel.has(i)}
                            onChange={() => toggle(charSel, setCharSel, i)}
                          />
                          <span>
                            <strong>{g.name}</strong>：{g.addition}
                          </span>
                        </label>
                      ),
                    )}
                  </div>
                </div>
              )}

              {/* 世界設定追加 */}
              {draft.worldGrowth.length > 0 && (
                <div className="field">
                  <label>
                    🌍 世界設定の追加{editMode ? '（内容を編集）' : '（チェックした項目をロアに追加）'}
                  </label>
                  <div className="growth-list">
                    {draft.worldGrowth.map((g, i) =>
                      editMode ? (
                        <div key={i} className="growth-item editing">
                          <CsvInput
                            value={g.keys}
                            onChange={(keys) => updWorldG(i, { keys })}
                            placeholder="トリガー語（カンマ区切り・任意）"
                          />
                          <textarea
                            rows={2}
                            value={g.content}
                            onChange={(e) => updWorldG(i, { content: e.target.value })}
                          />
                        </div>
                      ) : (
                        <label key={i} className="growth-item">
                          <input
                            type="checkbox"
                            checked={worldSel.has(i)}
                            onChange={() => toggle(worldSel, setWorldSel, i)}
                          />
                          <span>
                            {g.keys.length > 0 && <span className="growth-keys">[{g.keys.join(', ')}] </span>}
                            {g.content}
                          </span>
                        </label>
                      ),
                    )}
                  </div>
                </div>
              )}

              {/* 関係性の更新（現在シーン確定時のみ反映。prose を書き直す） */}
              {!isPastScene && draft.relationUpdates.length > 0 && (
                <div className="field">
                  <label>
                    💗 関係性の更新{editMode ? '（内容を編集）' : '（チェックした関係を書き直し）'}
                  </label>
                  <div className="growth-list">
                    {draft.relationUpdates.map((u, i) =>
                      editMode ? (
                        <div key={i} className="growth-item editing">
                          <strong>
                            {u.fromName} → {u.toName}
                          </strong>
                          <textarea
                            rows={2}
                            value={u.stance}
                            placeholder="関係の現在地（全文書き直し）"
                            onChange={(e) => updRel(i, { stance: e.target.value })}
                          />
                          {u.aspects.map((a, ai) => (
                            <div key={a.aspectId} className="rel-aspect-edit">
                              <span className="sub-label">{a.name}</span>
                              <textarea
                                rows={2}
                                value={a.note}
                                onChange={(e) => updRelAspect(i, ai, e.target.value)}
                              />
                            </div>
                          ))}
                          <CsvInput
                            value={u.flagsAdd}
                            onChange={(flagsAdd) => updRel(i, { flagsAdd })}
                            placeholder="追加する恒久フラグ（カンマ区切り・任意）"
                          />
                        </div>
                      ) : (
                        <label key={i} className="growth-item">
                          <input
                            type="checkbox"
                            checked={relUpdSel.has(i)}
                            onChange={() => toggle(relUpdSel, setRelUpdSel, i)}
                          />
                          <span>
                            <strong>{u.fromName} → {u.toName}</strong>：{u.stance}
                            {u.aspects.map((a) => (
                              <span key={a.aspectId} className="rel-aspect">
                                <em>{a.name}</em> {a.note}
                              </span>
                            ))}
                            {u.flagsAdd.length > 0 && (
                              <span className="growth-keys">＋{u.flagsAdd.join('・')}</span>
                            )}
                          </span>
                        </label>
                      ),
                    )}
                  </div>
                </div>
              )}

              {/* 事実の数の変化（現在シーン確定時のみ反映） */}
              {!isPastScene && draft.statChanges.length > 0 && (
                <div className="field">
                  <label>
                    📊 ステータスの変化{editMode ? '（数値を編集）' : '（チェックした項目を加算）'}
                  </label>
                  <div className="growth-list">
                    {draft.statChanges.map((c, i) =>
                      editMode ? (
                        <div key={i} className="growth-item editing">
                          <div className="growth-edit-row">
                            <strong>
                              {c.charName && `${c.charName} の `}
                              {c.name}
                            </strong>
                            <input
                              type="number"
                              className="num"
                              value={c.delta}
                              onChange={(e) => updStat(i, { delta: Number(e.target.value) || 0 })}
                            />
                          </div>
                          <input
                            value={c.reason}
                            placeholder="変化の理由（任意）"
                            onChange={(e) => updStat(i, { reason: e.target.value })}
                          />
                        </div>
                      ) : (
                        <label key={i} className="growth-item">
                          <input
                            type="checkbox"
                            checked={statSel.has(i)}
                            onChange={() => toggle(statSel, setStatSel, i)}
                          />
                          <span>
                            {c.charName && <strong>{c.charName} の </strong>}
                            <strong>{c.name}</strong>{' '}
                            <span className={c.delta >= 0 ? 'delta-up' : 'delta-down'}>
                              {c.delta >= 0 ? `+${c.delta}` : c.delta}
                            </span>
                            {c.reason && <span className="growth-keys">（{c.reason}）</span>}
                          </span>
                        </label>
                      ),
                    )}
                  </div>
                </div>
              )}

              {/* 行動カウンター（現在シーン確定時のみ反映） */}
              {!isPastScene && draft.counterEvents.length > 0 && (
                <div className="field">
                  <label>
                    🔢 行動カウンター{editMode ? '（回数を編集）' : '（チェックした回数を累計）'}
                  </label>
                  <div className="growth-list">
                    {draft.counterEvents.map((c, i) =>
                      editMode ? (
                        <div key={i} className="growth-item editing">
                          <div className="growth-edit-row">
                            <strong>
                              {c.charName && `${c.charName} の `}
                              {c.name}
                            </strong>
                            <input
                              type="number"
                              className="num"
                              min={0}
                              value={c.amount}
                              onChange={(e) =>
                                updCounter(i, {
                                  amount: Math.max(0, Math.round(Number(e.target.value) || 0)),
                                })
                              }
                            />
                          </div>
                          <input
                            value={c.reason}
                            placeholder="該当する行動（任意）"
                            onChange={(e) => updCounter(i, { reason: e.target.value })}
                          />
                        </div>
                      ) : (
                        <label key={i} className="growth-item">
                          <input
                            type="checkbox"
                            checked={counterSel.has(i)}
                            onChange={() => toggle(counterSel, setCounterSel, i)}
                          />
                          <span>
                            {c.charName && <strong>{c.charName} の </strong>}
                            <strong>{c.name}</strong>{' '}
                            <span className="delta-up">+{c.amount}</span>
                            {c.reason && <span className="growth-keys">（{c.reason}）</span>}
                          </span>
                        </label>
                      ),
                    )}
                  </div>
                </div>
              )}

              {/* 気分の更新（チェックした項目のみ確定時に上書き） */}
              {!isPastScene && draft.moodChanges.length > 0 && (
                <div className="field">
                  <label>
                    🎭 気分の更新{editMode ? '（内容を編集）' : '（チェックした項目を上書き）'}
                  </label>
                  <div className="growth-list">
                    {draft.moodChanges.map((m, i) =>
                      editMode ? (
                        <div key={i} className="growth-item editing">
                          <strong>{m.name}</strong>
                          <input value={m.mood} onChange={(e) => updMood(i, e.target.value)} />
                        </div>
                      ) : (
                        <label key={i} className="growth-item">
                          <input
                            type="checkbox"
                            checked={moodSel.has(i)}
                            onChange={() => toggle(moodSel, setMoodSel, i)}
                          />
                          <span>
                            <strong>{m.name}</strong>：{m.mood}
                          </span>
                        </label>
                      ),
                    )}
                  </div>
                </div>
              )}
            </>
          )}
    </ModalShell>
  )
}
