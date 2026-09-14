import { useEffect, useState } from 'react'
import { storeActions, useStore, type ReviewCallProgress, type ReviewCallStatus } from '../store'
import type {
  DiscoveredCharacter,
  NextSceneSuggestion,
  RelationUpdate,
  SceneReview,
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

const CALL_STATUS_LABEL: Record<ReviewCallStatus, string> = {
  waiting: '送信済み・応答待ち',
  streaming: '生成中',
  done: '完了',
  failed: '失敗',
}

/**
 * レビュー確定前の進行表示（PC-A A-1）。「シーンを終える」直後に開き、あらすじを流し込む。
 * 確定・編集はできず、中止だけが可能。
 *
 * 呼び出し1本＝1行で出す。2本に分けている時は2行が**同時に**「生成中」で文字数を伸ばす＝
 * 並列に走っていることがそのまま見える（工程の段階表示だと1本か2本か判別できなかった）。
 */
function ReviewProgressView({
  progress,
}: {
  progress: { summary: string; calls: ReviewCallProgress[] }
}) {
  const stopReview = useStore((st) => st.stopReview)
  const running = progress.calls.filter((c) => c.status === 'waiting' || c.status === 'streaming').length
  return (
    <ModalShell
      title="シーンを整理しています…"
      onClose={stopReview}
      wide
      footer={
        <button className="btn" onClick={stopReview}>
          中止
        </button>
      }
    >
      <div className="field">
        <label>
          生成中のリクエスト
          {progress.calls.length > 1 ? `（${progress.calls.length}本を並列実行）` : ''}
        </label>
        <div className="review-calls">
          {progress.calls.map((c) => (
            <div key={c.key} className={'review-call ' + c.status}>
              <span className="review-call-dot" />
              <span className="review-call-label">{c.label}</span>
              <span className="review-call-status">
                {CALL_STATUS_LABEL[c.status]}
                {c.status === 'streaming' && ` ${c.chars.toLocaleString()}字`}
                {/* 再試行は理由も一緒に出す（原因が分からないまま回数だけ見えるのを避ける） */}
                {c.attempt > 1 && c.status !== 'done' && (
                  <span className="review-call-note">
                    再試行{c.attempt}回目{c.note ? `：${c.note}` : ''}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
        {progress.calls.length > 1 && (
          <div className="desc">
            {running === progress.calls.length
              ? `${running}本とも同時に受信中です（両方の文字数が並行して増えます）。`
              : running > 0
                ? `1本が終わり、残り${running}本を待っています。`
                : 'まとめています…'}
          </div>
        )}
      </div>
      <div className="field">
        <label>このシーンのあらすじ</label>
        <div className="review-static-text review-streaming">
          {progress.summary || '…'}
          <span className="review-caret" />
        </div>
      </div>
      <div className="desc">生成が終わると、この画面で内容を確認・編集して確定できます。</div>
    </ModalShell>
  )
}

export default function SceneReviewModal() {
  const sceneReview = useStore((st) => st.sceneReview)
  const reviewProgress = useStore((st) => st.reviewProgress)
  // 確定前は進行表示のみ。確定した時点で通常のレビュー本体へ差し替わる（PC-A A-1）
  if (!sceneReview) return reviewProgress ? <ReviewProgressView progress={reviewProgress} /> : null
  return <ReviewBody />
}

function ReviewBody() {
  const sceneReview = useStore((st) => st.sceneReview)
  const isReviewing = useStore((st) => st.isReviewing)
  const isRegenSuggestions = useStore((st) => st.isRegenSuggestions)
  const session = useStore((st) => st.sessions.find((s) => s.id === st.activeId))
  const { confirmSceneReview, updateSceneReview, cancelReview, stopReview } = storeActions()
  const review = sceneReview!
  const isPastScene = !!session && review.sceneId !== session.currentSceneId

  // 次シーンの時点（第3の呼び出しが読み取った now。取れていなければ出さない）
  const nextTimeLabel = !isPastScene ? (review.tracker?.now?.trim() || null) : null

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
  const [moodSel, setMoodSel] = useState<Set<number>>(
    new Set(review.moodChanges.map((_, i) => i)),
  )
  // 発見キャラ（FB7-E）は既定でチェックを外す＝キャラ化は毎回モーダルが1枚開く操作なので、
  // 「確定を押したら知らない人物が次々に起案され始める」状態にはしない
  const [newCharSel, setNewCharSel] = useState<Set<number>>(new Set())
  // 到達エンディングへ「進む」か（auto は選択なし＝常に進む。既定は保守側＝まだ続ける／満了時は進む）
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
    setMoodSel(new Set(review.moodChanges.map((_, i) => i)))
    setNewCharSel(new Set())
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
  const updMood = (i: number, mood: string) =>
    setDraft((d) => ({ ...d, moodChanges: mapAt(d.moodChanges, i, { mood }) }))
  const updNewChar = (i: number, patch: Partial<DiscoveredCharacter>) =>
    setDraft((d) => ({ ...d, newCharacters: mapAt(d.newCharacters, i, patch) }))


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
      moodChangeIdx: [...moodSel],
      newCharacterIdx: [...newCharSel],
    })
  }

  // 到達する当事者（プレビュー表示・エンディング名の @ロール名/@相手 置換に使う）

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
            {isPastScene ? (
              '要約を更新'
            ) : (
              '確定して次のシーンへ'
            )}
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
                <label>このシーンのあらすじ</label>
                {editMode ? (
                  <textarea
                    rows={6}
                    value={draft.summary}
                    onChange={(e) => setDraft((d) => ({ ...d, summary: e.target.value }))}
                  />
                ) : (
                  <div className="review-static-text">
                    {draft.summary || '（要約なし。「編集」から記入できます）'}
                  </div>
                )}
              </div>

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
                          : '空のシーンを作成し、自由に始めます。「編集」で内容を直接記入できます。'}
                      </div>
                    </button>
                  )}
                </div>
              </div>

              {/* キャラ成長 */}
              {draft.characterGrowth.length > 0 && (
                <div className="field">
                  <label>
                    キャラクターの成長{editMode ? '（内容を編集）' : '（チェックした項目を設定に追記）'}
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
                    世界設定の追加{editMode ? '（内容を編集）' : '（チェックした項目をロアに追加）'}
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

              {/* 新しい登場人物（発見キャラ・FB7-E）。チェックした人物は確定後にキャラ化モーダルが開く */}
              {draft.newCharacters.length > 0 && (
                <div className="field">
                  <label>
                    <Icon name="user-plus" size={13} className="label-icon" /> 新しい登場人物
                    {editMode ? '（内容を編集）' : '（チェックした人物をキャラクターにする）'}
                  </label>
                  <div className="desc">
                    まだキャラクターとして登録されていない人物です。チェックして確定すると、
                    本文をもとに設定を起案した編集画面が開き、保存するとキャラクターライブラリに加わります。
                  </div>
                  <div className="growth-list">
                    {draft.newCharacters.map((c, i) =>
                      editMode ? (
                        <div key={i} className="growth-item editing">
                          <input
                            value={c.name}
                            placeholder="名前"
                            onChange={(e) => updNewChar(i, { name: e.target.value })}
                          />
                          <textarea
                            rows={2}
                            value={c.note}
                            placeholder="この人物について本文から分かること"
                            onChange={(e) => updNewChar(i, { note: e.target.value })}
                          />
                        </div>
                      ) : (
                        <label key={i} className="growth-item">
                          <input
                            type="checkbox"
                            checked={newCharSel.has(i)}
                            onChange={() => toggle(newCharSel, setNewCharSel, i)}
                          />
                          <span>
                            <strong>{c.name}</strong>
                            {c.note && `：${c.note}`}
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
                    気分の更新{editMode ? '（内容を編集）' : '（チェックした項目を上書き）'}
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
