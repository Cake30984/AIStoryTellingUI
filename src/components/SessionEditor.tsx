import { useState } from 'react'
import { currentScene, hasStartPreset, startPresetPatch, useStore } from '../store'
import { timeLabelOf } from '../lib/timeline'
import { appConfirm } from '../lib/dialogs'
import type { Session } from '../types'
import CsvInput from './CsvInput'
import ModelPicker from './ModelPicker'
import EntityAvatar from './EntityAvatar'
import SessionCardModal from './SessionCardModal'
import ModalShell from './ModalShell'
import { Icon } from './icons'

type PickerTarget = 'review' | 'choices' | 'bulk'
type Tab = 'basic' | 'progress' | 'model' | 'output'

interface Props {
  session: Session
  onClose: () => void
}

export default function SessionEditor({ session, onClose }: Props) {
  const { updateSession, characters, worlds, personas, sceneTypes, setView, bulkSetCharacterModel } = useStore()
  const [d, setD] = useState<Session>(session)
  const [tab, setTab] = useState<Tab>('basic')
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null)
  const [showCardModal, setShowCardModal] = useState(false)
  const [dirty, setDirty] = useState(false)
  const patch = (p: Partial<Session>) => {
    setD((s) => ({ ...s, ...p }))
    setDirty(true)
  }

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
    // 未開始（メッセージ0件）なら、現在位置を「開始時点」として記録する。
    // カセット初期化（freshSessionOf）やチェックポイントのルートがここへ戻れるようにするため（FB2-B）
    const notStarted = (live?.messages.length ?? d.messages.length) === 0
    const timeline = notStarted
      ? { ...d.timeline, startDay: d.timeline.currentDay, startSlot: d.timeline.currentSlot }
      : d.timeline
    updateSession(session.id, {
      title: d.title,
      characterIds: d.characterIds,
      worldId: d.worldId,
      personaId: d.personaId,
      authorNote: d.authorNote,
      story: d.story,
      scenes,
      timeline,
      choiceMode: d.choiceMode,
      narrativeStyle: d.narrativeStyle,
      structuredOutput: d.structuredOutput,
      reviewModel: d.reviewModel,
      choicesModel: d.choicesModel,
      director: d.director,
      temperature: d.temperature,
      maxTokens: d.maxTokens,
    })
    onClose()
  }

  return (
    <>
    <ModalShell
      title="セッション設定"
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <button className="btn" onClick={() => setShowCardModal(true)} title="会話・状態・素材・画像を1枚のPNGに埋め込んで共有">
            <Icon name="credit-card" size={14} /> セッションをカード化
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
          <div className="seg" style={{ marginBottom: 14 }}>
            {(
              [
                ['basic', '基本'],
                ['progress', '進行'],
                ['model', 'モデル'],
                ['output', '出力'],
              ] as const
            ).map(([t, label]) => (
              <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {label}
              </button>
            ))}
          </div>

          {tab === 'basic' && (
            <>
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
                          <EntityAvatar className="dot-avatar" avatar={c.avatar} name={c.name || '無名'} />
                          {c.name || '無名'}
                        </button>
                      ))}
                    </div>
                    {d.characterIds.length > 0 && d.narrativeStyle === 'chat' && (
                      <div className="desc" style={{ marginTop: 8 }}>
                        キャラ別モデルの一括設定は「モデル」タブから行えます。
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
                  onChange={(e) => {
                    const worldId = e.target.value || null
                    const world = worlds.find((w) => w.id === worldId)
                    // 世界を選んだら開始テンプレートを空欄の項目のみへコピー（入力済みは壊さない。W1）
                    patch({ worldId, ...(world ? startPresetPatch(d, world, false) : {}) })
                  }}
                >
                  <option value="">なし</option>
                  {worlds.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name || '無名の世界'}
                    </option>
                  ))}
                </select>
                {(() => {
                  const world = worlds.find((w) => w.id === d.worldId)
                  if (!world || !hasStartPreset(world)) return null
                  return (
                    <div className="desc" style={{ marginTop: 6 }}>
                      <button
                        className="link"
                        onClick={async () => {
                          if (
                            !(await appConfirm(
                              'この世界の開始テンプレートで、ジャンル・あらすじ・導入・固定メモ・タイムラインを上書きしますか？（テンプレートに値がある項目のみ）',
                            ))
                          )
                            return
                          patch(startPresetPatch(d, world, true))
                        }}
                      >
                        開始テンプレートを読み込む（入力済みの項目も上書き）
                      </button>
                    </div>
                  )
                })()}
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
                    <div className="desc">
                      物語の背景・世界の状況。毎ターン AI に注入され続ける前提情報です。
                    </div>
                    <textarea
                      rows={3}
                      value={d.story.premise}
                      placeholder="例: 滅びかけた王国。記憶を失った剣士が..."
                      onChange={(e) => patch({ story: { ...d.story, premise: e.target.value } })}
                    />
                  </div>
                  <div className="field">
                    <label>導入（最初のシーン・任意）</label>
                    <div className="desc">
                      物語の書き出しをこちらで用意します。入力すると「物語をはじめる」で AI に生成させず、
                      この文章がそのまま最初の本文として表示されます（開始の1回きり。空なら従来どおり AI が導入を生成）。
                    </div>
                    <input
                      value={d.story.openingTitle}
                      placeholder="導入シーンの見出し（例: 前夜の凶報）"
                      style={{ marginBottom: 6 }}
                      onChange={(e) => patch({ story: { ...d.story, openingTitle: e.target.value } })}
                    />
                    <textarea
                      rows={4}
                      value={d.story.opening}
                      placeholder="例: 城が焼け落ちた前夜のことだった。あなたは血の匂いの残る廊下で目を覚ます——"
                      onChange={(e) => patch({ story: { ...d.story, opening: e.target.value } })}
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
            </>
          )}

          {tab === 'progress' && (
            <>
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
                        <span className="sub-label">{d.messages.length === 0 ? '開始する日' : '現在の日'}</span>
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
                    {d.timeline.slots.length > 1 && (
                      <div className="sub-field">
                        <span className="sub-label">
                          {d.messages.length === 0 ? '開始する時間帯' : '現在の時間帯'}
                        </span>
                        <select
                          value={d.timeline.currentSlot}
                          onChange={(e) =>
                            patch({ timeline: { ...d.timeline, currentSlot: Number(e.target.value) } })
                          }
                        >
                          {d.timeline.slots.map((slot, i) => (
                            <option key={i} value={i}>
                              {slot}
                            </option>
                          ))}
                        </select>
                        {d.messages.length === 0 && (
                          <div className="desc" style={{ marginTop: 4 }}>
                            物語をこの時間帯から始められます（例: 前日の夜から）。
                          </div>
                        )}
                      </div>
                    )}
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
            </>
          )}

          {tab === 'model' && (
            <>
              {d.characterIds.length > 0 && d.narrativeStyle === 'chat' && (
                <div className="field">
                  <label>参加キャラの一括モデル設定</label>
                  <div className="desc">会話劇の参加キャラ全員に同じモデルをまとめて設定します。</div>
                  <button className="btn" style={{ fontSize: 12 }} onClick={() => setPickerTarget('bulk')}>
                    参加キャラに一括でモデルを設定
                  </button>
                </div>
              )}

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
                      max={32768}
                      step={256}
                      value={d.maxTokens}
                      onChange={(e) => patch({ maxTokens: Number(e.target.value) })}
                    />
                    <span className="val">{d.maxTokens.toLocaleString()}</span>
                  </div>
                  <div className="desc">
                    出力の打ち切り上限。モデルは書き終われば自然に止まるため、大きめに設定しても無駄な出力やコスト増にはならない（途中切れ防止には余裕を推奨）
                  </div>
                </div>
              </div>
            </>
          )}

          {tab === 'output' && (
            <>
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

              {/* 構造化出力（ST1） */}
              <div className="field">
                <label className="chk">
                  <input
                    type="checkbox"
                    checked={d.structuredOutput ?? false}
                    onChange={(e) => patch({ structuredOutput: e.target.checked })}
                  />
                  構造化出力
                </label>
                <div className="desc">
                  セリフを @名前(感情)「…」の行形式で書かせ、立ち絵の表情切替・話者表示に使います。
                  対応が不安定なモデルでは OFF に。OFF でも表示・立ち絵は従来方式で動作します。
                </div>
              </div>
            </>
          )}
    </ModalShell>
      {showCardModal && <SessionCardModal session={session} onClose={() => setShowCardModal(false)} />}
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
    </>
  )
}
