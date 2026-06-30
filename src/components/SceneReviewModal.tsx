import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { advanceTimeline, timeLabelOf } from '../lib/timeline'

export default function SceneReviewModal() {
  const {
    sceneReview,
    confirmSceneReview,
    cancelReview,
    setReviewNextType,
    rerollReviewType,
    isReviewing,
    isRegenSuggestions,
    sceneTypes,
    sessions,
    activeId,
  } = useStore()
  const review = sceneReview!
  const session = sessions.find((s) => s.id === activeId)
  const isPastScene = !!session && review.sceneId !== session.currentSceneId
  const pool = (session?.director.typeIds ?? [])
    .map((id) => sceneTypes.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => !!t)

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

  // 別のレビュー（別シーン）に切り替わったときだけ全体をリセット。
  // 候補だけ再生成した場合は編集中の要約を保持する。
  useEffect(() => {
    setSummary(review.summary)
    setCharSel(new Set(review.characterGrowth.map((_, i) => i)))
    setWorldSel(new Set(review.worldGrowth.map((_, i) => i)))
    setRelUpdSel(new Set(review.relationUpdates.map((_, i) => i)))
    setStatSel(new Set(review.statChanges.map((_, i) => i)))
    setCounterSel(new Set(review.counterEvents.map((_, i) => i)))
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

  const confirm = () => {
    confirmSceneReview({
      summary,
      suggestion: pick >= 0 ? review.suggestions[pick] : undefined,
      characterGrowthIdx: [...charSel],
      worldGrowthIdx: [...worldSel],
      relationUpdateIdx: [...relUpdSel],
      statChangeIdx: [...statSel],
      counterEventIdx: [...counterSel],
    })
  }

  return (
    <div className="overlay" onClick={cancelReview}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>シーン終了レビュー</h3>
          <button className="icon-btn" onClick={cancelReview}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {isReviewing ? (
            <div className="reviewing-placeholder">要約を生成中...</div>
          ) : (
            <>
              {/* あらすじ */}
              <div className="field">
                <label>📝 このシーンのあらすじ（編集可）</label>
                <textarea rows={6} value={summary} onChange={(e) => setSummary(e.target.value)} />
              </div>

              {/* 次シーンの方向（ディレクター） */}
              {(review.scheduledEventName || review.nextTypeName || pool.length > 0) && (
                <div className="field">
                  <label>🎬 次シーンの方向</label>
                  {review.scheduledEventName ? (
                    <div className="director-row">
                      <span className="event-badge">特別イベント: {review.scheduledEventName}</span>
                      <button
                        className="btn"
                        onClick={() => setReviewNextType(null)}
                        disabled={isRegenSuggestions}
                      >
                        解除
                      </button>
                    </div>
                  ) : (
                    <div className="director-row">
                      <select
                        value={review.nextTypeId ?? ''}
                        onChange={(e) => setReviewNextType(e.target.value || null)}
                        disabled={isRegenSuggestions}
                      >
                        <option value="">指定なし（自由）</option>
                        {pool.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                      {pool.length > 0 && (
                        <button
                          className="btn"
                          onClick={rerollReviewType}
                          disabled={isRegenSuggestions}
                          title="抽選し直して候補も作り直す"
                        >
                          🎲 引き直す
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 次シーン提案 */}
              <div className="field">
                <label>➡ 次のシーン</label>
                <div className="desc">
                  各案はこのシーン終了時点からの並列の候補です。いずれかを選ぶと、その方向で次のシーンを用意します。
                  {nextTimeLabel && (
                    <>
                      {' '}
                      <span className="event-badge">⏰ 時間帯が進む → {nextTimeLabel}</span>
                    </>
                  )}
                </div>
                {isRegenSuggestions && (
                  <div className="choices-loading">次シーンの候補を生成中…</div>
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

              {/* 気分の更新（確定時に上書き） */}
              {!isPastScene && review.moodChanges.length > 0 && (
                <div className="field">
                  <label>🎭 気分の更新</label>
                  <div className="desc">
                    {review.moodChanges.map((m) => `${m.name}: ${m.mood}`).join(' ／ ')}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={cancelReview}>
            キャンセル
          </button>
          <button
            className="btn primary"
            onClick={confirm}
            disabled={isReviewing || isRegenSuggestions}
          >
            {isPastScene ? '要約を更新' : '確定して次のシーンへ'}
          </button>
        </div>
      </div>
    </div>
  )
}
