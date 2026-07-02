import { useState } from 'react'
import { currentScene, useStore } from '../store'
import { timeLabelOf } from '../lib/timeline'
import type { Session } from '../types'
import CsvInput from './CsvInput'
import ModelPicker from './ModelPicker'

type PickerTarget = 'review' | 'choices' | 'bulk'

interface Props {
  session: Session
  onClose: () => void
}

export default function SessionEditor({ session, onClose }: Props) {
  const { updateSession, characters, worlds, personas, sceneTypes, setView, bulkSetCharacterModel } = useStore()
  const [d, setD] = useState<Session>(session)
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null)
  const patch = (p: Partial<Session>) => setD((s) => ({ ...s, ...p }))

  const toggleDirectorType = (id: string) =>
    patch({
      director: {
        ...d.director,
        typeIds: d.director.typeIds.includes(id)
          ? d.director.typeIds.filter((t) => t !== id)
          : [...d.director.typeIds, id],
      },
    })

  const toggleCharacter = (id: string) =>
    patch({
      characterIds: d.characterIds.includes(id)
        ? d.characterIds.filter((c) => c !== id)
        : [...d.characterIds, id],
    })

  const save = () => {
    // モーダルを開いている間にバックグラウンドでシーンが進行している場合に備え、
    // scenes は編集開始時のスナップショット(d.scenes)ではなく最新のライブ状態を起点にする
    // （そうしないと保存時に新しく出来たシーンや他の変更が巻き戻ってしまう）。
    const live = useStore.getState().sessions.find((x) => x.id === session.id)
    const liveScenes = live?.scenes ?? d.scenes
    // 選んだキャラを現在シーンの登場キャラにも反映（顔ぶれ＝初期の登場メンバー）
    const cur = live ? currentScene(live) : currentScene(d)
    const label = d.timeline.enabled ? timeLabelOf(d.timeline) : undefined
    const scenes = cur
      ? liveScenes.map((sc) =>
          sc.id === cur.id
            ? { ...sc, activeCharacterIds: d.characterIds, timeLabel: label ?? sc.timeLabel }
            : sc,
        )
      : liveScenes
    updateSession(session.id, {
      title: d.title,
      characterIds: d.characterIds,
      worldId: d.worldId,
      personaId: d.personaId,
      authorNote: d.authorNote,
      story: d.story,
      scenes,
      timeline: d.timeline,
      choiceMode: d.choiceMode,
      narrativeStyle: d.narrativeStyle,
      reviewModel: d.reviewModel,
      choicesModel: d.choicesModel,
      director: d.director,
      temperature: d.temperature,
      maxTokens: d.maxTokens,
    })
    onClose()
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>セッション設定</h3>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>タイトル</label>
            <input value={d.title} onChange={(e) => patch({ title: e.target.value })} />
          </div>

          {/* 参加キャラ（複数） */}
          <div className="field">
            <label>
              参加キャラ {d.mode === 'roleplay' ? '（複数選択でグループ会話）' : '（登場人物）'}
            </label>
            {characters.length === 0 ? (
              <p className="inline-empty">
                キャラがありません。
                <button className="link" onClick={() => { onClose(); setView('characters') }}>
                  キャラ管理で作成
                </button>
              </p>
            ) : (
              <>
                <div className="pick-grid">
                  {characters.map((c) => (
                    <button
                      key={c.id}
                      className={'pick-chip' + (d.characterIds.includes(c.id) ? ' on' : '')}
                      onClick={() => toggleCharacter(c.id)}
                    >
                      <span className="dot-avatar" style={{ background: c.avatar.color }}>
                        {Array.from(c.name || '無名')[0]}
                      </span>
                      {c.name || '無名'}
                    </button>
                  ))}
                </div>
                {d.characterIds.length > 0 && d.narrativeStyle === 'chat' && (
                  <div style={{ marginTop: 8 }}>
                    <button className="btn" style={{ fontSize: 12 }} onClick={() => setPickerTarget('bulk')}>
                      参加キャラに一括でモデルを設定
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 世界観 */}
          <div className="field">
            <label>世界観</label>
            <select
              value={d.worldId ?? ''}
              onChange={(e) => patch({ worldId: e.target.value || null })}
            >
              <option value="">なし</option>
              {worlds.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name || '無名の世界'}
                </option>
              ))}
            </select>
          </div>

          {/* ペルソナ */}
          <div className="field">
            <label>あなたのペルソナ</label>
            <select
              value={d.personaId ?? ''}
              onChange={(e) => patch({ personaId: e.target.value || null })}
            >
              <option value="">なし</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || '無名'}
                </option>
              ))}
            </select>
          </div>

          {/* 物語モード固有 */}
          {d.mode === 'story' && (
            <>
              <div className="field">
                <label>ジャンル・トーン</label>
                <input
                  value={d.story.genre}
                  placeholder="例: ダークファンタジー"
                  onChange={(e) => patch({ story: { ...d.story, genre: e.target.value } })}
                />
              </div>
              <div className="field">
                <label>あらすじ・前提</label>
                <textarea
                  rows={3}
                  value={d.story.premise}
                  placeholder="例: 滅びかけた王国。記憶を失った剣士が..."
                  onChange={(e) => patch({ story: { ...d.story, premise: e.target.value } })}
                />
              </div>
            </>
          )}

          <div className="field">
            <label>固定メモ（常に踏まえる重要事項・任意）</label>
            <div className="desc">関係性、約束、現在地など、AI に常に覚えさせたいこと。</div>
            <textarea
              rows={2}
              value={d.authorNote}
              placeholder="例: 二人は幼馴染。今は廃城の地下にいる。"
              onChange={(e) => patch({ authorNote: e.target.value })}
            />
          </div>

          <hr className="divider" />

          {/* 文体スタイル */}
          <div className="field">
            <label>文体スタイル</label>
            <div className="desc">
              小説形式＝地の文と「」セリフを混ぜた文章。会話劇＝キャラ別の発言（吹き出し）。
            </div>
            <div className="seg">
              {(['novel', 'chat'] as const).map((m) => (
                <button
                  key={m}
                  className={d.narrativeStyle === m ? 'on' : ''}
                  onClick={() => patch({ narrativeStyle: m })}
                >
                  {m === 'novel' ? '小説形式' : '会話劇'}
                </button>
              ))}
            </div>
          </div>

          {/* 選択肢進行 */}
          <div className="field">
            <label>選択肢で進行</label>
            <div className="desc">
              AIの応答後に行動の選択肢を提示します。クリックで物語が分岐します。
            </div>
            <div className="seg">
              {(['off', 'always', 'auto'] as const).map((m) => (
                <button
                  key={m}
                  className={d.choiceMode === m ? 'on' : ''}
                  onClick={() => patch({ choiceMode: m })}
                >
                  {m === 'off' ? 'なし' : m === 'always' ? '毎回' : 'AIが適宜'}
                </button>
              ))}
            </div>
          </div>

          {/* 裏方用モデル（役割別） */}
          <div className="field">
            <label>裏方用モデル（役割別）</label>
            <div className="desc">
              安価/高速なモデルを役割ごとに指定するとコスト削減。未指定なら本編モデルを使います。
            </div>
            <div className="row2" style={{ marginTop: 4 }}>
              <div>
                <div className="sub-label" style={{ marginBottom: 5 }}>レビュー用（シーン要約・提案）</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button className="model-chip" style={{ flex: 1 }} onClick={() => setPickerTarget('review')}>
                    {d.reviewModel || '本編と同じ'}
                  </button>
                  {d.reviewModel && (
                    <button className="btn" style={{ whiteSpace: 'nowrap' }} onClick={() => patch({ reviewModel: '' })}>
                      クリア
                    </button>
                  )}
                </div>
              </div>
              <div>
                <div className="sub-label" style={{ marginBottom: 5 }}>選択肢用（行動候補の生成）</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button className="model-chip" style={{ flex: 1 }} onClick={() => setPickerTarget('choices')}>
                    {d.choicesModel || '本編と同じ'}
                  </button>
                  {d.choicesModel && (
                    <button className="btn" style={{ whiteSpace: 'nowrap' }} onClick={() => patch({ choicesModel: '' })}>
                      クリア
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* タイムライン */}
          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={d.timeline.enabled}
                onChange={(e) => patch({ timeline: { ...d.timeline, enabled: e.target.checked } })}
                style={{ width: 'auto', marginRight: 8 }}
              />
              タイムライン（期間・区切りの自動進行）
            </label>
            {d.timeline.enabled && (
              <div className="timeline-box">
                <div className="sub-field">
                  <span className="sub-label">期間の呼称</span>
                  <input
                    value={d.timeline.spanLabel}
                    placeholder="例: 1学年（入学〜卒業）"
                    onChange={(e) =>
                      patch({ timeline: { ...d.timeline, spanLabel: e.target.value } })
                    }
                  />
                </div>
                <div className="row2">
                  <div className="sub-field">
                    <span className="sub-label">総日数（任意）</span>
                    <input
                      type="number"
                      min={0}
                      value={d.timeline.totalDays ?? ''}
                      placeholder="例: 90"
                      onChange={(e) =>
                        patch({
                          timeline: {
                            ...d.timeline,
                            totalDays: e.target.value ? Number(e.target.value) : null,
                          },
                        })
                      }
                    />
                  </div>
                  <div className="sub-field">
                    <span className="sub-label">現在の日</span>
                    <input
                      type="number"
                      min={1}
                      value={d.timeline.currentDay}
                      onChange={(e) =>
                        patch({
                          timeline: { ...d.timeline, currentDay: Math.max(1, Number(e.target.value)) },
                        })
                      }
                    />
                  </div>
                </div>
                <div className="sub-field">
                  <span className="sub-label">区切り単位</span>
                  <div className="pick-grid">
                    {[
                      { label: '朝・昼・夜', slots: ['朝', '昼', '夜'] },
                      { label: '朝・放課後・夜', slots: ['朝', '放課後', '夜'] },
                      { label: '1日ずつ', slots: ['1日'] },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        className={
                          'pick-chip' +
                          (d.timeline.slots.join(',') === preset.slots.join(',') ? ' on' : '')
                        }
                        onClick={() =>
                          patch({
                            timeline: { ...d.timeline, slots: preset.slots, currentSlot: 0 },
                          })
                        }
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <CsvInput
                    style={{ marginTop: 8 }}
                    value={d.timeline.slots}
                    placeholder="カスタム（カンマ区切り）"
                    onChange={(slots) =>
                      patch({ timeline: { ...d.timeline, slots, currentSlot: 0 } })
                    }
                  />
                </div>
              </div>
            )}
          </div>

          {/* シーン演出ディレクター */}
          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={d.director.enabled}
                onChange={(e) => patch({ director: { ...d.director, enabled: e.target.checked } })}
                style={{ width: 'auto', marginRight: 8 }}
              />
              シーン演出ディレクター（次シーンの種類を自動抽選）
            </label>
            {d.director.enabled && (
              <div className="timeline-box">
                <div className="desc" style={{ marginBottom: 8 }}>
                  抽選対象のシーン種類を選んでください（
                  <button className="link" onClick={() => { onClose(); setView('sceneTypes') }}>
                    演出で編集
                  </button>
                  ）。
                </div>
                {sceneTypes.length === 0 ? (
                  <p className="inline-empty">「演出」でシーン種類を作成してください。</p>
                ) : (
                  <div className="pick-grid">
                    {sceneTypes.map((t) => (
                      <button
                        key={t.id}
                        className={'pick-chip' + (d.director.typeIds.includes(t.id) ? ' on' : '')}
                        onClick={() => toggleDirectorType(t.id)}
                      >
                        <span className="dot-avatar" style={{ background: t.color }}>
                          🎬
                        </span>
                        {t.name || '無名'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <hr className="divider" />

          <div className="row2">
            <div className="field" style={{ marginBottom: 0 }}>
              <label>創造性 (temperature)</label>
              <div className="range-row">
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={d.temperature}
                  onChange={(e) => patch({ temperature: Number(e.target.value) })}
                />
                <span className="val">{d.temperature.toFixed(1)}</span>
              </div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>最大トークン</label>
              <div className="range-row">
                <input
                  type="range"
                  min={256}
                  max={4096}
                  step={128}
                  value={d.maxTokens}
                  onChange={(e) => patch({ maxTokens: Number(e.target.value) })}
                />
                <span className="val">{d.maxTokens}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn primary" onClick={save}>
            保存
          </button>
        </div>
      </div>
      {pickerTarget === 'review' && (
        <ModelPicker
          current={d.reviewModel}
          onPick={(ref) => patch({ reviewModel: ref })}
          onClose={() => setPickerTarget(null)}
        />
      )}
      {pickerTarget === 'choices' && (
        <ModelPicker
          current={d.choicesModel}
          onPick={(ref) => patch({ choicesModel: ref })}
          onClose={() => setPickerTarget(null)}
        />
      )}
      {pickerTarget === 'bulk' && (
        <ModelPicker
          current=""
          onPick={(ref) => {
            bulkSetCharacterModel(d.characterIds, ref)
            setPickerTarget(null)
          }}
          onClose={() => setPickerTarget(null)}
        />
      )}
    </div>
  )
}
