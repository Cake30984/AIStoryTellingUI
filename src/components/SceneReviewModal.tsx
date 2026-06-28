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
  const [relSel, setRelSel] = useState<Set<number>>(
    new Set(review.relationshipDeltas.map((_, i) => i)),
  )

  // 再生成完了時にローカル状態をリセット
  useEffect(() => {
    setSummary(review.summary)
    setPick(review.suggestions.length > 0 ? 0 : -1)
    setCharSel(new Set(review.characterGrowth.map((_, i) => i)))
    setWorldSel(new Set(review.worldGrowth.map((_, i) => i)))
    setRelSel(new Set(review.relationshipDeltas.map((_, i) => i)))
  }, [review])

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
      relationshipDeltaIdx: [...relSel],
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
                      <button className="btn" onClick={() => setReviewNextType(null)}>
                        解除
                      </button>
                    </div>
                  ) : (
                    <div className="director-row">
                      <select
                        value={review.nextTypeId ?? ''}
                        onChange={(e) => setReviewNextType(e.target.value || null)}
                      >
                        <option value="">指定なし（自由）</option>
                        {pool.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                      {pool.length > 0 && (
                        <button className="btn" onClick={rerollReviewType} title="抽選し直す">
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
                <div className="review-cards">
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

              {/* 関係値の変化（現在シーン確定時のみ反映） */}
              {!isPastScene && review.relationshipDeltas.length > 0 && (
                <div className="field">
                  <label>💗 主人公への感情の変化（チェックした項目を関係値に加算）</label>
                  <div className="growth-list">
                    {review.relationshipDeltas.map((d, i) => (
                      <label key={i} className="growth-item">
                        <input
                          type="checkbox"
                          checked={relSel.has(i)}
                          onChange={() => toggle(relSel, setRelSel, i)}
                        />
                        <span>
                          <strong>{d.name}</strong> の <strong>{d.axis}</strong>{' '}
                          <span className={d.delta >= 0 ? 'delta-up' : 'delta-down'}>
                            {d.delta >= 0 ? `+${d.delta}` : d.delta}
                          </span>
                          {d.reason && <span className="growth-keys">（{d.reason}）</span>}
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
          <button className="btn primary" onClick={confirm} disabled={isReviewing}>
            {isPastScene ? '要約を更新' : '確定して次のシーンへ'}
          </button>
        </div>
      </div>
    </div>
  )
}
