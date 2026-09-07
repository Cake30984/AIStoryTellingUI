import { useRef, useState } from 'react'
import {
  newAchievementDef,
  newEndingDef,
  newLoreEntry,
  newRelationAspect,
  uid,
  useStore,
} from '../../store'
import type {
  AchievementDef,
  EndingDef,
  LoreEntry,
  RelationAspectDef,
  ScheduledEvent,
  World,
  WorldRole,
  WorldStartPreset,
} from '../../types'
import CsvInput from '../CsvInput'
import HelpDetails from '../HelpDetails'
import IntroTagDefEditor from '../IntroTagDefEditor'
import NumberInput from '../NumberInput'
import { exportWorldCard } from '../../lib/cards'
import { appConfirm } from '../../lib/dialogs'
import { advanceTimeline, timeLabelOf } from '../../lib/timeline'
import { Icon } from '../icons'
import { NARRATION_NAMES } from '../../lib/structured'

type Section =
  | 'basic'
  | 'start'
  | 'roles'
  | 'lore'
  | 'events'
  | 'aspects'
  | 'achievements'
  | 'endings'

/** ナビのグループ見出し（FB8-E3。10セクションのフラット並びに意味のまとまりを付ける） */
const SECTION_GROUPS: { heading: string; items: { id: Section; label: string }[] }[] = [
  {
    heading: '世界の中身',
    items: [
      { id: 'basic', label: '基本' },
      { id: 'lore', label: 'ロア' },
      { id: 'events', label: '特別イベント' },
    ],
  },
  {
    heading: '登場のしくみ',
    items: [
      { id: 'roles', label: '配役' },
      { id: 'aspects', label: '関係性の次元' },
    ],
  },
  {
    heading: 'ゴール',
    items: [
      { id: 'achievements', label: '実績' },
      { id: 'endings', label: 'エンディング' },
    ],
  },
  {
    heading: 'セッションの雛形',
    items: [{ id: 'start', label: '開始テンプレート' }],
  },
]

interface Props {
  world: World
  onClose: () => void
}

export default function WorldEditor({ world, onClose }: Props) {
  const { upsertWorld, deleteWorld } = useStore()
  const [d, setD] = useState<World>(world)
  const [exporting, setExporting] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [section, setSection] = useState<Section>('basic')
  const [roleError, setRoleError] = useState('')
  const patch = (p: Partial<World>) => {
    setD((w) => ({ ...w, ...p }))
    setDirty(true)
  }

  const back = async () => {
    if (dirty && !(await appConfirm({ message: '編集内容を破棄しますか？', okLabel: '破棄', danger: true }))) return
    onClose()
  }

  const exportCard = async () => {
    setExporting(true)
    try {
      await exportWorldCard(d)
    } finally {
      setExporting(false)
    }
  }

  // 開始テンプレート（W1）。セッション設定で世界を選んだ時にコピーされる推奨初期設定
  const sp = d.startPreset ?? {}
  const patchPreset = (p: Partial<WorldStartPreset>) => patch({ startPreset: { ...sp, ...p } })
  const timelineDraftRef = useRef<NonNullable<WorldStartPreset['timeline']>>(
    sp.timeline ?? { slots: ['朝', '昼', '夜'], totalDays: null, spanLabel: '' },
  )
  if (sp.timeline) timelineDraftRef.current = sp.timeline
  const timelineDraft = sp.timeline ?? timelineDraftRef.current
  const patchTimeline = (p: Partial<NonNullable<WorldStartPreset['timeline']>>) => {
    const timeline = { ...timelineDraft, ...p }
    timelineDraftRef.current = timeline
    patchPreset({ timeline })
  }

  const roles = d.roles ?? []
  const updateRole = (id: string, p: Partial<WorldRole>) => {
    setRoleError('')
    patch({ roles: roles.map((role) => (role.id === id ? { ...role, ...p } : role)) })
  }
  const addRole = () => {
    setRoleError('')
    patch({ roles: [...roles, { id: uid(), name: '', description: '' }] })
  }
  const removeRole = (id: string) => {
    setRoleError('')
    patch({ roles: roles.filter((role) => role.id !== id) })
  }
  const roleValidationError = (): string | undefined => {
    const seen = new Set<string>()
    for (const role of roles) {
      const name = role.name.trim()
      if (!name) return 'ロール名が空です。名前を入力するか、不要な行を削除してください。'
      const key = name.toLowerCase()
      if (seen.has(key)) return `ロール名「${name}」が重複しています。`
      if (key === 'ペルソナ' || NARRATION_NAMES.has(key)) {
        return `ロール名「${name}」は予約語のため使えません。`
      }
      seen.add(key)
    }
    return undefined
  }

  const updateEntry = (id: string, p: Partial<LoreEntry>) =>
    patch({ entries: d.entries.map((e) => (e.id === id ? { ...e, ...p } : e)) })

  const addEntry = () => patch({ entries: [...d.entries, newLoreEntry(d.entries.length)] })

  const removeEntry = (id: string) => patch({ entries: d.entries.filter((e) => e.id !== id) })

  const events = d.scheduledEvents ?? []
  const eventSlots = d.startPreset?.timeline?.slots.length
    ? d.startPreset.timeline.slots
    : ['朝', '昼', '夜']
  const updateEvent = (id: string, p: Partial<ScheduledEvent>) =>
    patch({ scheduledEvents: events.map((e) => (e.id === id ? { ...e, ...p } : e)) })
  const addEvent = () =>
    patch({ scheduledEvents: [...events, { id: uid(), day: 1, name: '', note: '' }] })
  const removeEvent = (id: string) =>
    patch({ scheduledEvents: events.filter((e) => e.id !== id) })

  // 関係性の次元（aspect）
  const aspects = d.relationAspects ?? []
  const updateAspect = (id: string, p: Partial<RelationAspectDef>) =>
    patch({ relationAspects: aspects.map((a) => (a.id === id ? { ...a, ...p } : a)) })
  const addAspect = () => patch({ relationAspects: [...aspects, newRelationAspect()] })
  const removeAspect = (id: string) =>
    patch({ relationAspects: aspects.filter((a) => a.id !== id) })

  // 実績定義（達成条件はコードが自動判定）
  const achievements = d.achievements ?? []
  const updateAchievement = (id: string, p: Partial<AchievementDef>) =>
    patch({ achievements: achievements.map((a) => (a.id === id ? { ...a, ...p } : a)) })
  const addAchievement = () => patch({ achievements: [...achievements, newAchievementDef()] })
  const removeAchievement = (id: string) =>
    patch({ achievements: achievements.filter((a) => a.id !== id) })
  // エンディング定義（E1。配列順=優先度＝上が優先。到達判定はコードが自動で行う）
  const endings = d.endings ?? []
  const updateEnding = (id: string, p: Partial<EndingDef>) =>
    patch({ endings: endings.map((e) => (e.id === id ? { ...e, ...p } : e)) })
  const addEnding = () => patch({ endings: [...endings, newEndingDef()] })
  const removeEnding = (id: string) => patch({ endings: endings.filter((e) => e.id !== id) })
  const moveEnding = (idx: number, dir: -1 | 1) => {
    const to = idx + dir
    if (to < 0 || to >= endings.length) return
    const next = endings.slice()
    ;[next[idx], next[to]] = [next[to], next[idx]]
    patch({ endings: next })
  }
  const save = () => {
    const problem = roleValidationError()
    if (problem) {
      setRoleError(problem)
      setSection('roles')
      return
    }
    // order を現在の並びで振り直して保存
    upsertWorld({ ...d, entries: d.entries.map((e, i) => ({ ...e, order: i })) })
    onClose()
  }

  return (
    <div className="library world-page">
      <div className="page-head">
        <button className="btn" onClick={back}>
          ← 戻る
        </button>
        <h2>{d.name || '無名の世界'}</h2>
        <button
          className="btn danger"
          onClick={async () => {
            if (await appConfirm({ message: 'この世界観を削除しますか？', danger: true })) {
              deleteWorld(d.id)
              onClose()
            }
          }}
        >
          削除
        </button>
        <button className="btn" onClick={exportCard} disabled={exporting}>
          {exporting ? (
            '書き出し中…'
          ) : (
            <>
              <Icon name="credit-card" size={14} /> カードとして保存
            </>
          )}
        </button>
        <button className="btn primary" onClick={save}>
          保存
        </button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 0, marginBottom: 16 }}>
        素材の編集・保存はすべてのセッション・すべての分岐に共有されます（分岐を戻しても巻き戻りません）。
      </p>

      <div className="page-body">
        <div className="section-nav nav-vertical">
          {SECTION_GROUPS.map((g) => (
            <div className="nav-group" key={g.heading}>
              <div className="nav-group-heading">{g.heading}</div>
              {g.items.map((s) => (
                <button
                  key={s.id}
                  className={'nav-btn' + (section === s.id ? ' on' : '')}
                  onClick={() => setSection(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="section-content">
          {section === 'basic' && (
            <>
              <div className="field">
                <label>名称</label>
                <input
                  value={d.name}
                  placeholder="例: アルカディア王国"
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </div>
              <div className="field">
                <label>概要（常時注入）</label>
                <div className="desc">世界の基本設定。会話に常に添付されます。簡潔に。</div>
                <textarea
                  rows={3}
                  value={d.description}
                  placeholder="例: 魔法が衰退した中世風世界。3つの大国が均衡を保っている。"
                  onChange={(e) => patch({ description: e.target.value })}
                />
              </div>
            </>
          )}

          {section === 'start' && (
            <>
              <div className="lore-head">
                <label>セッション開始テンプレート</label>
                <div className="desc">
                  セッション設定でこの世界を選んだ時、空欄の項目へ自動でコピーされる推奨初期設定です（入力済みの項目は壊しません）。
                  コピー後はセッション側で自由に書き換えられ、この世界観素材は変更されません。
                  ジャンル・あらすじ・導入は物語モードのセッションでのみ使われます。
                </div>
              </div>
              <div className="field">
                <label>ジャンル・トーン</label>
                <div className="desc">
                  作風・温度感を一言で。毎回「物語設定」として AI に渡されます。
                </div>
                <input
                  value={sp.genre ?? ''}
                  placeholder="例: 切なく静かなダークファンタジー"
                  onChange={(e) => patchPreset({ genre: e.target.value })}
                />
              </div>
              <div className="field">
                <label>あらすじ・前提</label>
                <div className="desc">
                  この物語で何が起きるかの前提。世界そのものの説明は世界観の「基本」へ、絶対に守らせたい指示は固定メモへ。
                </div>
                <textarea
                  rows={3}
                  value={sp.premise ?? ''}
                  placeholder="例: 滅びかけた王国。記憶を失った剣士が..."
                  onChange={(e) => patchPreset({ premise: e.target.value })}
                />
              </div>
              <div className="field">
                <label>導入（最初のシーン）</label>
                <div className="desc">
                  入力すると、この世界で始める物語の書き出しをそのまま掲載します（開始の1回きり・AI 生成なし）。
                </div>
                <input
                  value={sp.openingTitle ?? ''}
                  placeholder="導入シーンの見出し（例: 前夜の凶報）"
                  style={{ marginBottom: 6 }}
                  onChange={(e) => patchPreset({ openingTitle: e.target.value })}
                />
                <textarea
                  rows={3}
                  value={sp.opening ?? ''}
                  placeholder="例: 城が焼け落ちた前夜のことだった——"
                  onChange={(e) => patchPreset({ opening: e.target.value })}
                />
              </div>
              <IntroTagDefEditor
                tags={sp.introTags ?? []}
                onChange={(introTags) => patchPreset({ introTags })}
                opening={sp.opening ?? ''}
                onOpeningChange={(opening) => patchPreset({ opening })}
              />
              <div className="field">
                <label>最初の方向付け（非表示・任意）</label>
                <div className="desc">
                  最初のシーンの間だけ AI に渡される非表示の指示です。チャットには表示されません。
                  序盤の展開・出会わせ方など立ち上がりの方向付けに（2シーン目からは効かなくなります）。
                </div>
                <textarea
                  rows={3}
                  value={sp.initialDirective ?? ''}
                  placeholder="例: 最初のシーンでは謎の少女と出会わせ、事件の予兆だけを見せる。正体はまだ明かさない。"
                  onChange={(e) => patchPreset({ initialDirective: e.target.value })}
                />
              </div>
              {/* 開始シーンの状況メモ（CS2）。2シーン目以降はレビューが書く */}
              <div className="field">
                <label>開始シーンの状況メモ（任意）</label>
                <div className="desc">
                  最初のシーンの「時・場所・その場に居る人物」です。ここに書いた顔ぶれが、開始直後に
                  登場する人物の目安になります（2シーン目以降はシーンを終えるたびに自動で書かれます）。
                </div>
                <textarea
                  rows={2}
                  value={sp.openingSceneNote ?? ''}
                  placeholder="例: 入学式の翌朝、教室。主人公と幼馴染の二人だけ。"
                  onChange={(e) => patchPreset({ openingSceneNote: e.target.value })}
                />
              </div>
              {/* 新しい登場人物の登場ポリシー（発見キャラ・FB7-E） */}
              <div className="field">
                <label>新しい登場人物</label>
                <div className="desc">
                  登場キャラクターに登録していない人物を AI が新しく出してよいか。
                  「指定しない」ならセッション側の設定（既定＝出してよい）に従います。
                </div>
                <div className="seg">
                  {(
                    [
                      { key: '', label: '指定しない' },
                      { key: 'allow', label: '出してよい' },
                      { key: 'avoid', label: '出さない' },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.key || 'none'}
                      className={(sp.newCharacterPolicy ?? '') === o.key ? 'on' : ''}
                      onClick={() => patchPreset({ newCharacterPolicy: o.key || undefined })}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>固定メモ（常に踏まえる重要事項）</label>
                <div className="desc">
                  毎回「常に踏まえる重要事項」として AI に渡されます。文体・禁則などの指示向きで、ロールプレイモードでも有効です。
                  毎ターン送り直されるので短く保ってください。「頼まれても簡単には引き受けない人物」のような
                  人物の芯は、ここよりキャラクターの人格欄に書く方がよく効きます。
                  「人の出入りが多い場所」のような登場の作法もここに書けます（誰がその場に居るかは
                  シーンの状況メモが持つので、ここには世界ぜんたいの傾向だけを書きます）。
                </div>
                <textarea
                  rows={2}
                  value={sp.authorNote ?? ''}
                  placeholder="例: 残酷描写は避ける。主人公の心情を勝手に確定しない。"
                  onChange={(e) => patchPreset({ authorNote: e.target.value })}
                />
              </div>
              <div className="field">
                <label>
                  <input
                    type="checkbox"
                    checked={!!sp.timeline}
                    onChange={(e) => {
                      if (!e.target.checked) timelineDraftRef.current = timelineDraft
                      patchPreset({ timeline: e.target.checked ? timelineDraftRef.current : undefined })
                    }}
                    style={{ width: 'auto', marginRight: 8 }}
                  />
                  タイムライン定義を含める（期間・区切り・開始時点）
                </label>
                <fieldset className="timeline-box" disabled={!sp.timeline}>
                    <div className="sub-field">
                      <span className="sub-label">期間の呼称</span>
                      <input
                        value={timelineDraft.spanLabel}
                        placeholder="例: 1学年（入学〜卒業）"
                        onChange={(e) =>
                          patchTimeline({ spanLabel: e.target.value })
                        }
                      />
                    </div>
                    <div className="sub-field">
                      <span className="sub-label">総日数（任意）</span>
                      <input
                        type="number"
                        min={0}
                        value={timelineDraft.totalDays ?? ''}
                        placeholder="例: 90"
                        onChange={(e) =>
                          patchTimeline({ totalDays: e.target.value ? Number(e.target.value) : null })
                        }
                      />
                    </div>
                    <div className="sub-field">
                      <span className="sub-label">区切り単位（カンマ区切り）</span>
                      <CsvInput
                        value={timelineDraft.slots}
                        placeholder="例: 朝, 昼, 夜"
                        onChange={(slots) =>
                          patchTimeline({
                            slots,
                            startSlot: Math.min(
                              timelineDraft.startSlot ?? 0,
                              Math.max(0, slots.length - 1),
                            ),
                          })
                        }
                      />
                    </div>
                    <div className="row2">
                      <div className="sub-field">
                        <span className="sub-label">開始する日</span>
                        <NumberInput
                          min={1}
                          integer
                          value={timelineDraft.startDay ?? 1}
                          onChange={(startDay) => patchTimeline({ startDay })}
                        />
                      </div>
                      {timelineDraft.slots.length > 1 && (
                        <div className="sub-field">
                          <span className="sub-label">開始する時間帯</span>
                          <select
                            value={timelineDraft.startSlot ?? 0}
                            onChange={(e) =>
                              patchTimeline({ startSlot: Number(e.target.value) })
                            }
                          >
                            {timelineDraft.slots.map((slot, i) => (
                              <option key={i} value={i}>
                                {slot}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                    {timelineDraft.slots.length > 0 && (() => {
                      const startTimeline = {
                        enabled: true,
                        slots: timelineDraft.slots,
                        totalDays: timelineDraft.totalDays,
                        spanLabel: timelineDraft.spanLabel,
                        currentDay: Math.max(1, timelineDraft.startDay ?? 1),
                        currentSlot: Math.min(
                          Math.max(0, timelineDraft.startSlot ?? 0),
                          timelineDraft.slots.length - 1,
                        ),
                      }
                      return (
                        <div className="desc timeline-preview">
                          開始: {timeLabelOf(startTimeline)}
                          {' → 次のシーンで: '}
                          {timeLabelOf(advanceTimeline(startTimeline))}
                        </div>
                      )
                    })()}
                </fieldset>
              </div>
            </>
          )}

          {section === 'roles' && (
            <>
              <div className="lore-head">
                <label>配役（ロールグループ）</label>
                <div className="desc">
                  この世界で必要な立ち位置をグループとして定義します。説明には「宿屋の主人。旅人に情報を売る」のような立場を書き、性格はキャラクター側に書いてください。
                  1つのロールに複数人を配役でき（例: ヒロイン全員）、1人が複数ロールを兼任することもできます。
                  プロンプトへは毎ターン【配役】として実名で注入されます（導入文の @名前 置換は「開始テンプレート」の置換タグが担当します）。
                </div>
              </div>
              {roleError && <p className="notice">{roleError}</p>}
              {roles.length === 0 && (
                <p className="inline-empty">ロールはまだありません。世界に必要な登場人物の立ち位置を追加できます。</p>
              )}
              {roles.map((role) => (
                <div key={role.id} className="lore-entry">
                  <div className="lore-entry-top">
                    <input
                      className="lore-keys"
                      value={role.name}
                      placeholder="ロール名（例: ライバル）"
                      onChange={(event) => updateRole(role.id, { name: event.target.value })}
                    />
                    <label className="chk">
                      <input
                        type="checkbox"
                        checked={role.required ?? false}
                        onChange={(event) => updateRole(role.id, { required: event.target.checked || undefined })}
                      />
                      開始に必須
                    </label>
                    <button className="icon-btn small" onClick={() => removeRole(role.id)} title="ロールを削除">
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    className="lore-content"
                    value={role.description}
                    placeholder="立場の説明（例: 宿屋の主人。旅人に情報を売る）"
                    onChange={(event) => updateRole(role.id, { description: event.target.value })}
                  />
                </div>
              ))}
              <button className="btn" style={{ marginTop: 8 }} onClick={addRole}>
                <Icon name="plus" size={13} />ロールを追加
              </button>
            </>
          )}

          {section === 'lore' && (
            <>
          <div className="lore-head">
            <label>ロア項目</label>
            <div className="desc">
              キーワードが会話に登場した時だけ注入されます（トークン節約）。「常時」をオンにすると常に注入。
            </div>
          </div>

          {d.entries.length === 0 && (
            <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>
              項目がありません。地名・組織・用語・人物などを追加しましょう。
            </p>
          )}

          {d.entries.map((e) => (
            <div key={e.id} className={'lore-entry' + (e.enabled ? '' : ' disabled')}>
              <div className="lore-entry-top">
                {e.addedInStory && <span className="added-badge">展開で追加</span>}
                {/* トリガー語が空で「常時」もオフ＝どちらの経路にも乗らず永久に注入されない（CG2）。
                    黙って死ぬ設定なので、作者が気付けるよう明示する */}
                {e.enabled && !e.alwaysOn && !e.keys.some((k) => k.trim()) && (
                  <span className="dead-badge" title="トリガー語を入れるか「常時」をオンにしてください">
                    注入されません
                  </span>
                )}
                <CsvInput
                  className="lore-keys"
                  value={e.keys}
                  placeholder="トリガー語（カンマ区切り）例: 王都, アルカディア城"
                  onChange={(keys) => updateEntry(e.id, { keys })}
                />
                <label className="chk" title="常に注入">
                  <input
                    type="checkbox"
                    checked={e.alwaysOn}
                    onChange={(ev) => updateEntry(e.id, { alwaysOn: ev.target.checked })}
                  />
                  常時
                </label>
                <label className="chk" title="有効/無効">
                  <input
                    type="checkbox"
                    checked={e.enabled}
                    onChange={(ev) => updateEntry(e.id, { enabled: ev.target.checked })}
                  />
                  有効
                </label>
                <button className="icon-btn small" onClick={() => removeEntry(e.id)} title="削除">
                  <Icon name="x" size={14} />
                </button>
              </div>
              <textarea
                rows={2}
                className="lore-content"
                value={e.content}
                placeholder="この語が出たときに注入する設定内容"
                onChange={(ev) => updateEntry(e.id, { content: ev.target.value })}
              />
            </div>
          ))}

          <button className="btn" style={{ marginTop: 8 }} onClick={addEntry}>
            <Icon name="plus" size={13} />ロア項目を追加
          </button>
            </>
          )}

          {section === 'events' && (
            <>
          <div className="lore-head">
            <label>特別イベント（日付・時間帯指定）</label>
            <div className="desc">
              タイムラインの指定日時に到来すると、次のシーンで最優先に発生します（体育祭・クリスマスなど）。
            </div>
            <HelpDetails>
              <p>
                指定日時が到来したら発生します（承認は不要）。日付・時間帯とも空欄なら常に候補になります。
              </p>
              <p>
                「グループ条件」で「主要登場人物にする」を付けたロールのメンバー名は、内容の{' '}
                <code>@ロール名</code> / <code>@相手</code> がその人の名前に置き換わります。イベントは自動発火のため
                選択画面は無く、「N人ぴったり」は満たした先頭 n 人が主要登場人物になります。判定にだけ使う条件の
                ロールには「主要登場人物にする」を付けないでください。
              </p>
            </HelpDetails>
          </div>

          {events.map((e) => {
            return (
              <div key={e.id} className="lore-entry">
                <div className="lore-entry-top">
                  <label className="chk" title="発生する日（空欄＝日付条件なし）">
                    Day
                    <input
                      type="number"
                      min={1}
                      value={e.day ?? ''}
                      placeholder="任意"
                      style={{ width: 64, background: 'var(--bg)' }}
                      onChange={(ev) =>
                        updateEvent(e.id, {
                          day: ev.target.value === '' ? undefined : Math.max(1, Number(ev.target.value)),
                        })
                      }
                    />
                  </label>
                  <label className="chk" title="発生する時間帯（空欄＝時間帯条件なし）">
                    時間帯
                    <select
                      value={e.slot ?? ''}
                      style={{ background: 'var(--bg)' }}
                      onChange={(ev) => updateEvent(e.id, { slot: ev.target.value || undefined })}
                    >
                      <option value="">指定なし</option>
                      {e.slot && !eventSlots.includes(e.slot) && (
                        <option value={e.slot}>{e.slot}（区切りに無し）</option>
                      )}
                      {eventSlots.map((slot) => (
                        <option key={slot} value={slot}>{slot}</option>
                      ))}
                    </select>
                  </label>
                  <input
                    className="lore-keys"
                    value={e.name}
                    placeholder="イベント名（例: 体育祭）"
                    onChange={(ev) => updateEvent(e.id, { name: ev.target.value })}
                  />
                  <button className="icon-btn small" onClick={() => removeEvent(e.id)} title="削除">
                    <Icon name="x" size={14} />
                  </button>
                </div>
                <textarea
                  rows={2}
                  className="lore-content"
                  value={e.note}
                  placeholder="状況・方向性（例: 全校で盛り上がる体育祭。応援や勝負を通じて関係が動く。）"
                  onChange={(ev) => updateEvent(e.id, { note: ev.target.value })}
                />
                <div className="desc" style={{ marginTop: 4 }}>
                  指定日時で判定します（両方空欄なら常に候補）。
                </div>
              </div>
            )
          })}

          <button className="btn" style={{ marginTop: 8 }} onClick={addEvent}>
            <Icon name="plus" size={13} />特別イベントを追加
          </button>
            </>
          )}

          {section === 'aspects' && (
            <>
          <div className="lore-head">
            <label>状態システム</label>
            <div className="desc">
              このワールドのゲームシステムを定義します。新規ワールドには「信頼」と「好感度」が1つずつ入っています（不要なら削除・自由に追加できます）。
            </div>
          </div>

          <div className="lore-head" style={{ marginTop: 12 }}>
            <label>関係性の次元</label>
            <div className="desc">
              キャラ→主人公の関係を「言葉」で追う次元（例: 信頼 / 恋愛）。数値ではなく記述で持ちます。
            </div>
          </div>
          {aspects.map((a) => (
            <div key={a.id} className="lore-entry">
              <div className="lore-entry-top">
                <input
                  className="lore-keys"
                  value={a.name}
                  placeholder="次元名（例: 信頼）"
                  onChange={(e) => updateAspect(a.id, { name: e.target.value })}
                />
                <button className="icon-btn small" onClick={() => removeAspect(a.id)} title="削除">
                  <Icon name="x" size={14} />
                </button>
              </div>
              <textarea
                rows={2}
                className="lore-content"
                value={a.guidance ?? ''}
                placeholder="レビューへの指示（任意。例: 相手の言動の何を信じ何を疑うか）"
                onChange={(e) => updateAspect(a.id, { guidance: e.target.value })}
              />
            </div>
          ))}
          <button className="btn" style={{ marginTop: 8 }} onClick={addAspect}>
            <Icon name="plus" size={13} />次元を追加
          </button>
            </>
          )}

          {section === 'achievements' && (
            <>
          <div className="lore-head">
            <label>実績</label>
            <div className="desc">
              物語の道中の出来事を残す記録です。
            </div>
            <HelpDetails>
              <p>
                自動解除の条件は廃止されました（状態パネルから手動で切り替えます）。
              </p>
              <p>
                「グループ条件」を使うと、ロール（配役）のメンバーに対して「全員」「N人以上」の条件を課せます。
                実績は自動解除で人を選べないため、「N人ぴったり」は「N人以上」と同じ扱い
                （満たした全員が主要登場人物）になります。
              </p>
              <p>
                「主要登場人物にする」を付けたロールのメンバー名は、実績名・内容の <code>@ロール名</code> /{' '}
                <code>@相手</code> がその人の名前に置き換わります。主要登場人物の組ごとに独立して解除されます
                （A で解除→後日 A・B の組でも同じ実績が解除）。判定にだけ使う条件のロールには
                「主要登場人物にする」を付けないでください。
              </p>
            </HelpDetails>
          </div>
          {achievements.map((a) => {
            return (
              <div key={a.id} className="lore-entry">
                <div className="lore-entry-top">
                  <input
                    className="lore-keys"
                    value={a.name}
                    placeholder="実績名（例: 初めてのデート）"
                    onChange={(e) => updateAchievement(a.id, { name: e.target.value })}
                  />
                  <label className="chk" title="未達成時は名前・内容を隠す">
                    <input
                      type="checkbox"
                      checked={!!a.hidden}
                      onChange={(e) => updateAchievement(a.id, { hidden: e.target.checked })}
                    />
                    未達成時は隠す
                  </label>
                  <button className="icon-btn small" onClick={() => removeAchievement(a.id)} title="削除">
                    <Icon name="x" size={14} />
                  </button>
                </div>
                <textarea
                  rows={2}
                  className="lore-content"
                  value={a.description}
                  placeholder="内容（例: 主人公と2人きりで出かけた）"
                  onChange={(e) => updateAchievement(a.id, { description: e.target.value })}
                />
              </div>
            )
          })}
          <button className="btn" style={{ marginTop: 8 }} onClick={addAchievement}>
            <Icon name="plus" size={13} />実績を追加
          </button>
            </>
          )}

          {section === 'endings' && (
            <>
          <div className="lore-head">
            <label>エンディング</label>
            <div className="desc">
              期間満了時に「満了時の受け皿（fallback）」の結末へ到達し、エピローグシーンに入ります。
            </div>
            <HelpDetails>
              <p>
                到達判定は、シーン終了レビューを確定したときに条件から自動で行われます（本文の文章は読みません）。
                複数のエンディングが同時に成立した場合は、一覧の上にあるものが選ばれます。
              </p>
              <p>
                「期間満了の受け皿」は、最終日までどの条件も成立しなかったときに使われるエンディングに付けます
                （条件は不要です）。
              </p>
              <p>
                「グループ条件」を使うと、ロール（配役）のメンバーに対して「全員」「N人以上」「N人ぴったり」の条件を
                課せます。「主要登場人物にする」を付けたロールは条件を満たした人が結末の主役になり、
                エンディング名・エピローグ指針の <code>@ロール名</code> / <code>@相手</code> がその人の名前に
                置き換わります。「N人ぴったり」で満たした人が多すぎる場合は、レビュー画面で誰にするかを選べます。
              </p>
              <p>
                勝敗の判定にだけ使う条件（ラスボス撃破など）のロールには「主要登場人物にする」を付けないでください。
              </p>
            </HelpDetails>
          </div>
          {endings.map((e, idx) => {
            return (
              <div key={e.id} className="lore-entry">
                <div className="lore-entry-top">
                  <span className="sub-label" style={{ minWidth: 28, textAlign: 'center' }}>
                    {idx + 1}
                  </span>
                  <input
                    className="lore-keys"
                    value={e.name}
                    placeholder="エンディング名（例: 卒業の約束）"
                    onChange={(ev) => updateEnding(e.id, { name: ev.target.value })}
                  />
                  <button
                    className="icon-btn small"
                    onClick={() => moveEnding(idx, -1)}
                    disabled={idx === 0}
                    title="優先度を上げる"
                  >
                    ↑
                  </button>
                  <button
                    className="icon-btn small"
                    onClick={() => moveEnding(idx, 1)}
                    disabled={idx === endings.length - 1}
                    title="優先度を下げる"
                  >
                    ↓
                  </button>
                  <button className="icon-btn small" onClick={() => removeEnding(e.id)} title="削除">
                    <Icon name="x" size={14} />
                  </button>
                </div>
                <textarea
                  rows={2}
                  className="lore-content"
                  value={e.description}
                  placeholder="説明（一覧・到達時に表示。条件そのものは書かない）"
                  onChange={(ev) => updateEnding(e.id, { description: ev.target.value })}
                />
                <div className="sub-field" style={{ marginTop: 6 }}>
                  <span className="sub-label">エピローグ指針</span>
                  <textarea
                    rows={3}
                    className="lore-content"
                    value={e.epilogueGuidance}
                    placeholder="結末のトーン・締め方（到達後にのみ本編へ注入。プレイ中はリークしない）"
                    onChange={(ev) => updateEnding(e.id, { epilogueGuidance: ev.target.value })}
                  />
                </div>
                <div className="lore-entry-top" style={{ marginTop: 6, flexWrap: 'wrap' }}>
                  <label className="chk" title="条件成立で強制突入する（「まだ続ける」を出さない。バッドエンド向け）">
                    <input
                      type="checkbox"
                      checked={!!e.auto}
                      disabled={!!e.fallback}
                      onChange={(ev) => updateEnding(e.id, { auto: ev.target.checked })}
                    />
                    自動突入（auto）
                  </label>
                  <label className="chk" title="未到達時は名前・内容を隠す">
                    <input
                      type="checkbox"
                      checked={!!e.hidden}
                      onChange={(ev) => updateEnding(e.id, { hidden: ev.target.checked })}
                    />
                    未到達時は隠す
                  </label>
                  <label className="chk" title="期間満了時、条件成立エンディングが無い場合の受け皿（条件・自動突入は持たない）">
                    <input
                      type="checkbox"
                      checked={!!e.fallback}
                      onChange={(ev) =>
                        updateEnding(e.id, {
                          fallback: ev.target.checked,
                          // fallback は条件・auto を持たない（判定側も無視する）
                          ...(ev.target.checked ? { auto: false } : {}),
                        })
                      }
                    />
                    満了時の受け皿（fallback）
                  </label>
                </div>
              </div>
            )
          })}
          <button className="btn" style={{ marginTop: 8 }} onClick={addEnding}>
            <Icon name="plus" size={13} />エンディングを追加
          </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
