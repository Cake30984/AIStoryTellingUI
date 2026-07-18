import { useEffect, useMemo, useState } from 'react'
import { applyReviewToState, checkEndings, useStore } from '../store'
import { advanceTimeline, timeLabelOf } from '../lib/timeline'
import ModalShell from './ModalShell'

export default function SceneReviewModal() {
  const {
    sceneReview,
    confirmSceneReview,
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

  const [summary, setSummary] = useState(review.summary)
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
  // checkEndings＋満了判定でどの結末に到達するかを求める。純関数なので選択変更ごとに再計算。
  const endingPreview = useMemo(() => {
    if (!session || isPastScene || session.ending) return null
    const endings = world?.endings ?? []
    if (endings.length === 0) return null
    const sel = {
      relationUpdates: [...relUpdSel].map((i) => review.relationUpdates[i]).filter(Boolean),
      statChanges: [...statSel].map((i) => review.statChanges[i]).filter(Boolean),
      counterEvents: [...counterSel].map((i) => review.counterEvents[i]).filter(Boolean),
      moodChanges: [...moodSel].map((i) => review.moodChanges[i]).filter(Boolean),
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
  }, [session, isPastScene, world, review, relUpdSel, statSel, counterSel, moodSel])

  // 候補が変わったら既定選択を更新（満了時は「進む」・通常は「まだ続ける」を既定にする）
  useEffect(() => {
    if (endingPreview && !endingPreview.auto) setEndingGo(endingPreview.isExpiry)
  }, [endingPreview?.candidate.id, endingPreview?.isExpiry, endingPreview?.auto])

  // 別のレビュー（別シーン）に切り替わったときだけ全体をリセット。
  // 候補だけ再生成した場合は編集中の要約を保持する。
  useEffect(() => {
    setSummary(review.summary)
    setCharSel(new Set(review.characterGrowth.map((_, i) => i)))
    setWorldSel(new Set(review.worldGrowth.map((_, i) => i)))
    setRelUpdSel(new Set(review.relationUpdates.map((_, i) => i)))
    setStatSel(new Set(review.statChanges.map((_, i) => i)))
    setCounterSel(new Set(review.counterEvents.map((_, i) => i)))
    setMoodSel(new Set(review.moodChanges.map((_, i) => i)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review.sceneId])

  // 候補が変わったら選択をリセット（先頭を選ぶ）
  useEffect(() => {
    setPick(review.suggestions.length > 0 ? 0 : -1)
  }, [review.suggestions])

  const toggle = (set: Set<number>, setFn: (s: Set<number>) => void, i: number) => {
    const next = new Set(set)
    next.has(i) ? next.delete(i) : next.add(i)
    setFn(next)
  }

  // エンディングへ進むか（auto は強制。それ以外は endingGo で選択）
  const goEnding = !!endingPreview && (endingPreview.auto || endingGo)

  const confirm = () => {
    confirmSceneReview({
      summary,
      suggestion: pick >= 0 ? review.suggestions[pick] : undefined,
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
      title="シーン終了レビュー"
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
              {/* あらすじ */}
              <div className="field">
                <label>📝 このシーンのあらすじ（編集可）</label>
                <textarea rows={6} value={summary} onChange={(e) => setSummary(e.target.value)} />
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
                  {review.suggestions.map((s, i) => (
                    <button
                      key={i}
                      className={'review-card' + (pick === i ? ' on' : '')}
                      onClick={() => setPick(i)}
                    >
                      <div className="review-card-title">{s.title || `案 ${i + 1}`}</div>
                      <div className="review-card-note">{s.note}</div>
                    </button>
                  ))}
                  <button
                    className={'review-card' + (pick === -1 ? ' on' : '')}
                    onClick={() => setPick(-1)}
                  >
                    <div className="review-card-title">自分で決める</div>
                    <div className="review-card-note">空のシーンを作成し、自由に始めます。</div>
                  </button>
                </div>
              </div>

              {/* キャラ成長 */}
              {review.characterGrowth.length > 0 && (
                <div className="field">
                  <label>🎭 キャラクターの成長（チェックした項目を設定に追記）</label>
                  <div className="growth-list">
                    {review.characterGrowth.map((g, i) => (
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
                    ))}
                  </div>
                </div>
              )}

              {/* 世界設定追加 */}
              {review.worldGrowth.length > 0 && (
                <div className="field">
                  <label>🌍 世界設定の追加（チェックした項目をロアに追加）</label>
                  <div className="growth-list">
                    {review.worldGrowth.map((g, i) => (
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
                    ))}
                  </div>
                </div>
              )}

              {/* 関係性の更新（現在シーン確定時のみ反映。prose を書き直す） */}
              {!isPastScene && review.relationUpdates.length > 0 && (
                <div className="field">
                  <label>💗 関係性の更新（チェックした関係を書き直し）</label>
                  <div className="growth-list">
                    {review.relationUpdates.map((u, i) => (
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
                    ))}
                  </div>
                </div>
              )}

              {/* 事実の数の変化（現在シーン確定時のみ反映） */}
              {!isPastScene && review.statChanges.length > 0 && (
                <div className="field">
                  <label>📊 ステータスの変化（チェックした項目を加算）</label>
                  <div className="growth-list">
                    {review.statChanges.map((c, i) => (
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
                    ))}
                  </div>
                </div>
              )}

              {/* 行動カウンター（現在シーン確定時のみ反映） */}
              {!isPastScene && review.counterEvents.length > 0 && (
                <div className="field">
                  <label>🔢 行動カウンター（チェックした回数を累計）</label>
                  <div className="growth-list">
                    {review.counterEvents.map((c, i) => (
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
                    ))}
                  </div>
                </div>
              )}

              {/* 気分の更新（チェックした項目のみ確定時に上書き） */}
              {!isPastScene && review.moodChanges.length > 0 && (
                <div className="field">
                  <label>🎭 気分の更新（チェックした項目を上書き）</label>
                  <div className="growth-list">
                    {review.moodChanges.map((m, i) => (
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
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
    </ModalShell>
  )
}
