import { useState } from 'react'
import { currentScene, hasStartPreset, startPresetPatch, useStore } from '../store'
import { advanceTimeline, timeLabelOf } from '../lib/timeline'
import { modelRefLabel } from '../lib/providers'
import { appConfirm } from '../lib/dialogs'
import type { Session } from '../types'
import CsvInput from './CsvInput'
import ModelPicker from './ModelPicker'
import EntityAvatar from './EntityAvatar'
import CassetteEditor from './CassetteEditor'
import ModalShell from './ModalShell'
import { Icon, type IconName } from './icons'
import NumberInput from './NumberInput'
import IntroTagDefEditor from './IntroTagDefEditor'
import IntroTagFields from './IntroTagFields'

type PickerTarget = 'main' | 'review' | 'choices'
/** FB8-E3: 「基本＝誰と・どの世界で」「物語＝どう始まるか」「進行」「AIと出力」の4タブ */
type Tab = 'basic' | 'story' | 'progress' | 'ai'

interface Props {
  session: Session
  onClose: () => void
}

export default function SessionEditor({ session, onClose }: Props) {
  const { updateSession, characters, worlds, personas, providers, setView } = useStore()
  const [d, setD] = useState<Session>(session)
  const [tab, setTab] = useState<Tab>('basic')
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null)
  const [showCardModal, setShowCardModal] = useState(false)
  const [dirty, setDirty] = useState(false)
  const patch = (p: Partial<Session>) => {
    setD((s) => ({ ...s, ...p }))
    setDirty(true)
  }

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
    // 現在シーンの時刻ラベルだけ追従させる（顔ぶれはセッション側で持つ＝CS1）
    const cur = live ? currentScene(live) : currentScene(d)
    const label = d.timeline.enabled ? timeLabelOf(d.timeline) : undefined
    const scenes =
      cur && label
        ? liveScenes.map((sc) => (sc.id === cur.id ? { ...sc, timeLabel: label } : sc))
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
      introBindings: d.introBindings,
      authorNote: d.authorNote,
      story: d.story,
      scenes,
      timeline,
      choiceMode: d.choiceMode,
      narrativeStyle: d.narrativeStyle,
      structuredOutput: d.structuredOutput,
      reviewSplit: d.reviewSplit,
      // 本編モデル。**裏方2つだけ書いて本編を落とすと、変更が保存されず元に戻る**
      model: d.model,
      reviewModel: d.reviewModel,
      choicesModel: d.choicesModel,
      eventAutoFire: d.eventAutoFire,
      newCharacterPolicy: d.newCharacterPolicy,
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
      wide
      scrollableBody
      bodyClassName="session-editor-body"
      footer={
        <>
          <button className="btn" onClick={() => setShowCardModal(true)} title="この設定を種にゲームカセットを作る">
            <Icon name="library-big" size={14} /> カセットにする…
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
          {/* FB2-C案: 左セクションナビ＋右パネル（WorldEditor と同じ操作感） */}
          <div className="se-navlayout">
            <nav className="se-nav">
              {(
                [
                  { key: 'basic', label: '基本', icon: 'settings' },
                  ...(d.mode === 'story' ? [{ key: 'story', label: '物語', icon: 'book-open' }] : []),
                  { key: 'progress', label: '進行', icon: 'hourglass' },
                  { key: 'ai', label: 'AIと出力', icon: 'layers' },
                ] as { key: Tab; label: string; icon: IconName }[]
              ).map(({ key, label, icon }) => (
                <button
                  key={key}
                  className={'se-nav-btn' + (tab === key ? ' on' : '')}
                  onClick={() => setTab(key)}
                >
                  <Icon name={icon} size={16} />
                  {label}
                </button>
              ))}
            </nav>
            <div className="se-panel">

          {tab === 'basic' && (
            <>
              <div className="field">
                <label>タイトル</label>
                <input value={d.title} onChange={(e) => patch({ title: e.target.value })} />
              </div>

              {/* 登場キャラクター（複数） */}
              <div className="field">
                <label>
                  登場キャラクター {d.mode === 'roleplay' ? '（複数選択でグループ会話）' : ''}
                </label>
                {characters.length === 0 ? (
                  <p className="inline-empty">
                    キャラクターがありません。
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
                        キャラ別モデルの一括設定は「AIと出力」タブから行えます。
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
                              'この世界の開始テンプレートで、ジャンル・あらすじ・導入・最初の方向付け・固定メモ・タイムラインを上書きしますか？（テンプレートに値がある項目のみ）',
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

              {/* 固定メモ（ロールプレイでは基本タブに置く。物語モードは「物語」タブ側） */}
              {d.mode === 'roleplay' && (
                <div className="field">
                  <label>固定メモ（常に踏まえる重要事項・任意）</label>
                  <div className="desc">
                    毎回「常に踏まえる重要事項」として AI に渡されます。文体・禁則などの指示向きです。
                    毎ターン送り直されるので短く保ってください。「頼まれても簡単には引き受けない人物」のような
                    人物の芯は、ここよりキャラクターの人格欄に書く方がよく効きます。
                    「人の出入りが多い場所」のような登場の作法もここに書けます（誰がその場に居るかは
                    シーンの状況メモが持つので、ここには世界ぜんたいの傾向だけを書きます）。
                  </div>
                  <textarea
                    rows={2}
                    value={d.authorNote}
                    placeholder="例: 残酷描写は避ける。主人公の心情を勝手に確定しない。"
                    onChange={(e) => patch({ authorNote: e.target.value })}
                  />
                </div>
              )}
            </>
          )}

          {/* 物語タブ（FB8-E3: 物語モード固有＝どう始まり・何を守るか） */}
          {tab === 'story' && d.mode === 'story' && (
            <>
                  <div className="field">
                    <label>ジャンル・トーン</label>
                    <div className="desc">
                      作風・温度感を一言で。毎回「物語設定」として AI に渡されます。
                    </div>
                    <input
                      value={d.story.genre}
                      placeholder="例: 切なく静かなダークファンタジー"
                      onChange={(e) => patch({ story: { ...d.story, genre: e.target.value } })}
                    />
                  </div>
                  <div className="field">
                    <label>あらすじ・前提</label>
                    <div className="desc">
                      この物語で何が起きるかの前提。世界そのものの説明は世界観素材へ、絶対に守らせたい指示は固定メモへ。
                    </div>
                    <textarea
                      rows={3}
                      value={d.story.premise}
                      placeholder="例: 滅びかけた王国。記憶を失った剣士が..."
                      onChange={(e) => patch({ story: { ...d.story, premise: e.target.value } })}
                    />
                  </div>
                  <div className="field">
                    <label>最初の方向付け（非表示・任意）</label>
                    <div className="desc">
                      最初のシーンの間だけ AI に渡される非表示の指示です。チャットには表示されません。
                      序盤の展開・出会わせ方など立ち上がりの方向付けに（2シーン目からは効かなくなります）。
                    </div>
                    <textarea
                      rows={3}
                      value={d.story.initialDirective ?? ''}
                      placeholder="例: 最初のシーンでは謎の少女と出会わせ、事件の予兆だけを見せる。正体はまだ明かさない。"
                      onChange={(e) => patch({ story: { ...d.story, initialDirective: e.target.value } })}
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
                  <IntroTagDefEditor
                    tags={d.story.introTags ?? []}
                    onChange={(introTags) => patch({ story: { ...d.story, introTags } })}
                    opening={d.story.opening}
                    onOpeningChange={(opening) => patch({ story: { ...d.story, opening } })}
                  />
                  <IntroTagFields
                    session={d}
                    characters={characters}
                    personas={personas}
                    onChange={(introBindings) => patch({ introBindings })}
                  />

              <div className="field">
                <label>固定メモ（常に踏まえる重要事項・任意）</label>
                <div className="desc">
                  毎回「常に踏まえる重要事項」として AI に渡されます。文体・禁則などの指示向きです。
                  毎ターン送り直されるので短く保ってください。「頼まれても簡単には引き受けない人物」のような
                  人物の芯は、ここよりキャラクターの人格欄に書く方がよく効きます。
                  「人の出入りが多い場所」のような登場の作法もここに書けます（誰がその場に居るかは
                  シーンの状況メモが持つので、ここには世界ぜんたいの傾向だけを書きます）。
                </div>
                <textarea
                  rows={2}
                  value={d.authorNote}
                  placeholder="例: 残酷描写は避ける。主人公の心情を勝手に確定しない。"
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
                <fieldset className="timeline-box" disabled={!d.timeline.enabled}>
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
                        <NumberInput
                          min={1}
                          integer
                          value={d.timeline.currentDay}
                          onChange={(currentDay) => patch({ timeline: { ...d.timeline, currentDay } })}
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
                    <div className="desc timeline-preview">
                      {d.messages.length === 0 ? '開始' : '現在'}: {timeLabelOf(d.timeline)}
                      {' → 次のシーンで: '}
                      {timeLabelOf(advanceTimeline(d.timeline))}
                    </div>
                </fieldset>
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

              {/* 世界観イベントの自動発生（FB3-C。演出ディレクターは廃止し、世界観に定義した特別イベントに一本化） */}
              <div className="field">
                <label>
                  <input
                    type="checkbox"
                    checked={d.eventAutoFire !== false}
                    onChange={(e) => patch({ eventAutoFire: e.target.checked })}
                    style={{ width: 'auto', marginRight: 8 }}
                  />
                  世界観の特別イベントを自動的に発生させる
                </label>
                <div className="desc" style={{ marginTop: 4 }}>
                  世界観に定義した特別イベント（日付指定）を、シーンの切り替わり時にコードが自動判定して発生させます。オフにすると自動発生しません。
                </div>
              </div>

              {/* 新しい登場人物の登場ポリシー（発見キャラ・FB7-E） */}
              <div className="field">
                <label>新しい登場人物</label>
                <div className="desc">
                  登場キャラクターに登録していない人物を AI が新しく出してよいかを指示します。
                  出てきた人物は本文の話者に付く印から、あるいはシーン終了レビューの提案から、
                  キャラクターとして登録できます。
                </div>
                <div className="seg">
                  {(
                    [
                      { key: 'allow', label: '出してよい' },
                      { key: 'avoid', label: '出さない' },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.key}
                      className={(d.newCharacterPolicy ?? 'allow') === o.key ? 'on' : ''}
                      onClick={() => patch({ newCharacterPolicy: o.key })}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === 'ai' && (
            <>
              {/* 本編モデル（FB8-E3: メニューの「モデル:」項目から設定画面へ一本化） */}
              <div className="field">
                <label>本編モデル</label>
                <div className="desc">
                  物語本文の生成に使うモデル。未設定なら「設定・データ管理」の既定モデルを使います。
                </div>
                <div className="model-chip-row">
                  <button className="model-chip grow" onClick={() => setPickerTarget('main')}>
                    {d.model ? modelRefLabel(d.model, providers) || d.model : '既定モデルを使用'}
                  </button>
                  {d.model && (
                    <button className="btn" onClick={() => patch({ model: '' })}>
                      クリア
                    </button>
                  )}
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
                    <div className="model-chip-row">
                      {/* 生の参照（`providerId::model`）ではなくラベルで出す。
                          カスタム接続先の providerId は UUID なので、そのまま出すと桁外れに長くなる */}
                      <button className="model-chip grow" onClick={() => setPickerTarget('review')}>
                        {d.reviewModel ? modelRefLabel(d.reviewModel, providers) || d.reviewModel : '本編と同じ'}
                      </button>
                      {d.reviewModel && (
                        <button className="btn" onClick={() => patch({ reviewModel: '' })}>
                          クリア
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="sub-label" style={{ marginBottom: 5 }}>選択肢用（行動候補の生成）</div>
                    <div className="model-chip-row">
                      <button className="model-chip grow" onClick={() => setPickerTarget('choices')}>
                        {d.choicesModel ? modelRefLabel(d.choicesModel, providers) || d.choicesModel : '本編と同じ'}
                      </button>
                      {d.choicesModel && (
                        <button className="btn" onClick={() => patch({ choicesModel: '' })}>
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
                  セリフを @名前「…」の行形式で書かせ、話者アイコン付きの表示に使います。
                  対応が不安定なモデルでは OFF に。OFF でも本文は従来方式で表示されます。
                </div>
              </div>

              {/* レビューの分割並列（PC-A A-2。undefined=ON） */}
              <div className="field">
                <label className="chk">
                  <input
                    type="checkbox"
                    checked={d.reviewSplit !== false}
                    onChange={(e) => patch({ reviewSplit: e.target.checked })}
                  />
                  レビューを2本に分けて並列実行する
                </label>
                <div className="desc">
                  待ち時間が約半分になります。入力コストは約2倍になります。
                </div>
              </div>
            </>
          )}
            </div>
          </div>
    </ModalShell>
      {showCardModal && <CassetteEditor seedSession={session} onClose={() => setShowCardModal(false)} />}
      {pickerTarget === 'main' && (
        <ModelPicker
          current={d.model}
          onPick={(ref) => patch({ model: ref })}
          onClose={() => setPickerTarget(null)}
        />
      )}
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
    </>
  )
}
