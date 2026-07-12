import { useState } from 'react'
import {
  newAchievementDef,
  newClause,
  newCounterDef,
  newLoreEntry,
  newRelationAspect,
  newStatDef,
  uid,
  useStore,
  WORLD_PRESETS,
} from '../../store'
import type {
  AchievementDef,
  Clause,
  Condition,
  CounterDef,
  LoreEntry,
  Op,
  RelationAspectDef,
  ScheduledEvent,
  StatDef,
  World,
  WorldStartPreset,
} from '../../types'
import CsvInput from '../CsvInput'
import { exportWorldCard } from '../../lib/cards'
import { appConfirm } from '../../lib/dialogs'
import { advanceTimeline, timeLabelOf } from '../../lib/timeline'
import { Icon } from '../icons'

const OPS: Op[] = ['>=', '>', '<=', '<', '==', '!=']

type Section = 'basic' | 'start' | 'lore' | 'events' | 'aspects' | 'stats' | 'counters' | 'achievements'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'basic', label: '基本' },
  { id: 'start', label: '開始テンプレート' },
  { id: 'lore', label: 'ロア' },
  { id: 'events', label: '特別イベント' },
  { id: 'aspects', label: '関係性の次元' },
  { id: 'stats', label: 'ステータス' },
  { id: 'counters', label: 'カウンター' },
  { id: 'achievements', label: '実績' },
]

/** Condition から節配列・モードを取り出す（all/any の判別） */
const clausesOf = (cond: Condition): Clause[] => ('all' in cond ? cond.all : cond.any)
const modeOf = (cond: Condition): 'all' | 'any' => ('all' in cond ? 'all' : 'any')

/** 条件節（Clause）1件の編集行。achievementId は実績の自己参照を除外するため（イベントでは未指定） */
function ClauseRow({
  clause,
  world,
  achievementId,
  onChange,
  onRemove,
}: {
  clause: Clause
  world: World
  achievementId?: string
  onChange: (c: Clause) => void
  onRemove: () => void
}) {
  return (
    <div className="lore-entry-top" style={{ marginTop: 6 }}>
      <select
        value={clause.kind}
        style={{ background: 'var(--bg)' }}
        onChange={(e) => onChange(newClause(e.target.value as Clause['kind'], world))}
      >
        <option value="stat">スタット</option>
        <option value="counter">カウンター</option>
        <option value="relationFlag">関係フラグ</option>
        <option value="achievement">実績</option>
      </select>

      {(clause.kind === 'stat' || clause.kind === 'counter') && (
        <>
          <select
            value={clause.defId}
            style={{ background: 'var(--bg)' }}
            onChange={(e) => onChange({ ...clause, defId: e.target.value })}
          >
            <option value="">（未選択）</option>
            {(clause.kind === 'stat' ? world.stats : world.counters).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name || '無名'}
              </option>
            ))}
          </select>
          <select
            value={clause.op}
            style={{ background: 'var(--bg)' }}
            onChange={(e) => onChange({ ...clause, op: e.target.value as Op })}
          >
            {OPS.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={clause.value}
            style={{ width: 80, background: 'var(--bg)' }}
            onChange={(e) => onChange({ ...clause, value: Number(e.target.value) })}
          />
        </>
      )}

      {clause.kind === 'relationFlag' && (
        <>
          <input
            value={clause.flag}
            placeholder="フラグ名（例: 命を救われた）"
            className="lore-keys"
            onChange={(e) => onChange({ ...clause, flag: e.target.value })}
          />
          <select
            value={clause.have ? 'have' : 'not'}
            style={{ background: 'var(--bg)' }}
            onChange={(e) => onChange({ ...clause, have: e.target.value === 'have' })}
          >
            <option value="have">持っている</option>
            <option value="not">持っていない</option>
          </select>
        </>
      )}

      {clause.kind === 'achievement' && (
        <>
          <select
            value={clause.defId}
            style={{ background: 'var(--bg)' }}
            onChange={(e) => onChange({ ...clause, defId: e.target.value })}
          >
            <option value="">（未選択）</option>
            {world.achievements
              .filter((a) => a.id !== achievementId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || '無名'}
                </option>
              ))}
          </select>
          <select
            value={clause.have ? 'have' : 'not'}
            style={{ background: 'var(--bg)' }}
            onChange={(e) => onChange({ ...clause, have: e.target.value === 'have' })}
          >
            <option value="have">達成済み</option>
            <option value="not">未達成</option>
          </select>
        </>
      )}

      <button className="icon-btn small" onClick={onRemove} title="条件を削除">
        ✕
      </button>
    </div>
  )
}

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

  // イベントの発火条件（未指定＝ day のみで判定）
  const addEventClause = (e: ScheduledEvent) => {
    const mode = e.condition ? modeOf(e.condition) : 'all'
    const clauses = [...(e.condition ? clausesOf(e.condition) : []), newClause('stat', d)]
    updateEvent(e.id, { condition: mode === 'all' ? { all: clauses } : { any: clauses } })
  }
  const updateEventClause = (e: ScheduledEvent, idx: number, clause: Clause) => {
    if (!e.condition) return
    const mode = modeOf(e.condition)
    const clauses = clausesOf(e.condition).map((c, i) => (i === idx ? clause : c))
    updateEvent(e.id, { condition: mode === 'all' ? { all: clauses } : { any: clauses } })
  }
  const removeEventClause = (e: ScheduledEvent, idx: number) => {
    if (!e.condition) return
    const mode = modeOf(e.condition)
    const clauses = clausesOf(e.condition).filter((_, i) => i !== idx)
    // 条件が空になったら条件そのものを外す（day のみの判定に戻る）
    const condition = clauses.length ? (mode === 'all' ? { all: clauses } : { any: clauses }) : undefined
    updateEvent(e.id, { condition })
  }
  const setEventMode = (e: ScheduledEvent, mode: 'all' | 'any') => {
    if (!e.condition) return
    updateEvent(e.id, { condition: mode === 'all' ? { all: clausesOf(e.condition) } : { any: clausesOf(e.condition) } })
  }

  // 関係性の次元（aspect）
  const aspects = d.relationAspects ?? []
  const updateAspect = (id: string, p: Partial<RelationAspectDef>) =>
    patch({ relationAspects: aspects.map((a) => (a.id === id ? { ...a, ...p } : a)) })
  const addAspect = () => patch({ relationAspects: [...aspects, newRelationAspect()] })
  const removeAspect = (id: string) =>
    patch({ relationAspects: aspects.filter((a) => a.id !== id) })

  // ステータス定義（事実の数）
  const stats = d.stats ?? []
  const updateStat = (id: string, p: Partial<StatDef>) =>
    patch({ stats: stats.map((s) => (s.id === id ? { ...s, ...p } : s)) })
  const addStat = () => patch({ stats: [...stats, newStatDef()] })
  const removeStat = (id: string) => patch({ stats: stats.filter((s) => s.id !== id) })

  // 行動カウンター定義
  const counters = d.counters ?? []
  const updateCounter = (id: string, p: Partial<CounterDef>) =>
    patch({ counters: counters.map((c) => (c.id === id ? { ...c, ...p } : c)) })
  const addCounter = () => patch({ counters: [...counters, newCounterDef()] })
  const removeCounter = (id: string) => patch({ counters: counters.filter((c) => c.id !== id) })

  // 実績定義（達成条件はコードが自動判定）
  const achievements = d.achievements ?? []
  const updateAchievement = (id: string, p: Partial<AchievementDef>) =>
    patch({ achievements: achievements.map((a) => (a.id === id ? { ...a, ...p } : a)) })
  const addAchievement = () => patch({ achievements: [...achievements, newAchievementDef()] })
  const removeAchievement = (id: string) =>
    patch({ achievements: achievements.filter((a) => a.id !== id) })
  const setCondition = (id: string, mode: 'all' | 'any', clauses: Clause[]) =>
    updateAchievement(id, { condition: mode === 'all' ? { all: clauses } : { any: clauses } })
  const addClause = (a: AchievementDef) =>
    setCondition(a.id, modeOf(a.condition), [...clausesOf(a.condition), newClause('stat', d)])
  const updateClause = (a: AchievementDef, idx: number, clause: Clause) =>
    setCondition(
      a.id,
      modeOf(a.condition),
      clausesOf(a.condition).map((c, i) => (i === idx ? clause : c)),
    )
  const removeClause = (a: AchievementDef, idx: number) =>
    setCondition(
      a.id,
      modeOf(a.condition),
      clausesOf(a.condition).filter((_, i) => i !== idx),
    )

  // プリセット：既存と重複しない次元・スタット・カウンターを追記
  const applyPreset = (presetId: string) => {
    const p = WORLD_PRESETS.find((x) => x.id === presetId)
    if (!p) return
    patch({
      relationAspects: [
        ...aspects,
        ...p.aspects
          .filter((n) => !aspects.some((a) => a.name === n))
          .map((n) => newRelationAspect(n)),
      ],
      stats: [
        ...stats,
        ...p.stats
          .filter((sd) => !stats.some((s) => s.name === sd.name))
          .map((sd) => ({ id: uid(), ...sd })),
      ],
      counters: [
        ...counters,
        ...p.counters
          .filter((cd) => !counters.some((c) => c.name === cd.name))
          .map((cd) => ({ id: uid(), ...cd })),
      ],
    })
  }

  const save = () => {
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
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={'nav-btn' + (section === s.id ? ' on' : '')}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
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
                <input
                  value={sp.genre ?? ''}
                  placeholder="例: ダークファンタジー"
                  onChange={(e) => patchPreset({ genre: e.target.value })}
                />
              </div>
              <div className="field">
                <label>あらすじ・前提</label>
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
              <div className="field">
                <label>固定メモ（常に踏まえる重要事項）</label>
                <textarea
                  rows={2}
                  value={sp.authorNote ?? ''}
                  placeholder="例: 二人は幼馴染。物語は入学式の朝から始まる。"
                  onChange={(e) => patchPreset({ authorNote: e.target.value })}
                />
              </div>
              <div className="field">
                <label>
                  <input
                    type="checkbox"
                    checked={!!sp.timeline}
                    onChange={(e) =>
                      patchPreset({
                        timeline: e.target.checked
                          ? { slots: ['朝', '昼', '夜'], totalDays: null, spanLabel: '' }
                          : undefined,
                      })
                    }
                    style={{ width: 'auto', marginRight: 8 }}
                  />
                  タイムライン定義を含める（期間・区切り・開始時点）
                </label>
                {sp.timeline && (
                  <div className="timeline-box">
                    <div className="sub-field">
                      <span className="sub-label">期間の呼称</span>
                      <input
                        value={sp.timeline.spanLabel}
                        placeholder="例: 1学年（入学〜卒業）"
                        onChange={(e) =>
                          patchPreset({ timeline: { ...sp.timeline!, spanLabel: e.target.value } })
                        }
                      />
                    </div>
                    <div className="sub-field">
                      <span className="sub-label">総日数（任意）</span>
                      <input
                        type="number"
                        min={0}
                        value={sp.timeline.totalDays ?? ''}
                        placeholder="例: 90"
                        onChange={(e) =>
                          patchPreset({
                            timeline: {
                              ...sp.timeline!,
                              totalDays: e.target.value ? Number(e.target.value) : null,
                            },
                          })
                        }
                      />
                    </div>
                    <div className="sub-field">
                      <span className="sub-label">区切り単位（カンマ区切り）</span>
                      <CsvInput
                        value={sp.timeline.slots}
                        placeholder="例: 朝, 昼, 夜"
                        onChange={(slots) =>
                          patchPreset({
                            timeline: {
                              ...sp.timeline!,
                              slots,
                              startSlot: Math.min(
                                sp.timeline!.startSlot ?? 0,
                                Math.max(0, slots.length - 1),
                              ),
                            },
                          })
                        }
                      />
                    </div>
                    <div className="row2">
                      <div className="sub-field">
                        <span className="sub-label">開始する日</span>
                        <input
                          type="number"
                          min={1}
                          value={sp.timeline.startDay ?? 1}
                          onChange={(e) =>
                            patchPreset({
                              timeline: { ...sp.timeline!, startDay: Math.max(1, Number(e.target.value)) },
                            })
                          }
                        />
                      </div>
                      {sp.timeline.slots.length > 1 && (
                        <div className="sub-field">
                          <span className="sub-label">開始する時間帯</span>
                          <select
                            value={sp.timeline.startSlot ?? 0}
                            onChange={(e) =>
                              patchPreset({
                                timeline: { ...sp.timeline!, startSlot: Number(e.target.value) },
                              })
                            }
                          >
                            {sp.timeline.slots.map((slot, i) => (
                              <option key={i} value={i}>
                                {slot}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                    {sp.timeline.slots.length > 0 && (() => {
                      const startTimeline = {
                        enabled: true,
                        slots: sp.timeline!.slots,
                        totalDays: sp.timeline!.totalDays,
                        spanLabel: sp.timeline!.spanLabel,
                        currentDay: Math.max(1, sp.timeline!.startDay ?? 1),
                        currentSlot: Math.min(
                          Math.max(0, sp.timeline!.startSlot ?? 0),
                          sp.timeline!.slots.length - 1,
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
                  </div>
                )}
              </div>
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
                  ✕
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
            ＋ ロア項目を追加
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
          </div>

          {events.map((e) => {
            const mode = e.condition ? modeOf(e.condition) : 'all'
            const clauses = e.condition ? clausesOf(e.condition) : []
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
                    ✕
                  </button>
                </div>
                <textarea
                  rows={2}
                  className="lore-content"
                  value={e.note}
                  placeholder="状況・方向性（例: 全校で盛り上がる体育祭。応援や勝負を通じて関係が動く。）"
                  onChange={(ev) => updateEvent(e.id, { note: ev.target.value })}
                />
                {clauses.length > 0 && (
                  <div className="row2" style={{ marginTop: 6, alignItems: 'center' }}>
                    <span className="sub-label">発火条件</span>
                    <select
                      value={mode}
                      style={{ background: 'var(--bg)' }}
                      onChange={(ev) => setEventMode(e, ev.target.value as 'all' | 'any')}
                    >
                      <option value="all">すべて満たす</option>
                      <option value="any">いずれか満たす</option>
                    </select>
                  </div>
                )}
                {clauses.map((c, i) => (
                  <ClauseRow
                    key={i}
                    clause={c}
                    world={d}
                    onChange={(nc) => updateEventClause(e, i, nc)}
                    onRemove={() => removeEventClause(e, i)}
                  />
                ))}
                <button className="btn" style={{ marginTop: 6 }} onClick={() => addEventClause(e)}>
                  ＋ 発火条件を追加
                </button>
                <div className="desc" style={{ marginTop: 4 }}>
                  {clauses.length > 0
                    ? '条件を満たし、指定日時も到来していれば自動的に発火します（承認不要）。'
                    : '指定日時で判定します（両方空欄なら常に候補）。'}
                </div>
              </div>
            )
          })}

          <button className="btn" style={{ marginTop: 8 }} onClick={addEvent}>
            ＋ 特別イベントを追加
          </button>
            </>
          )}

          {section === 'aspects' && (
            <>
          <div className="lore-head">
            <label>状態システム（プリセット）</label>
            <div className="desc">
              このワールドのゲームシステムを定義します。プリセットで素早く投入できます（後から編集可）。
            </div>
            <div className="pick-grid">
              {WORLD_PRESETS.map((p) => (
                <button key={p.id} className="pick-chip" onClick={() => applyPreset(p.id)}>
                  ＋ {p.label}
                </button>
              ))}
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
                  ✕
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
            ＋ 次元を追加
          </button>
            </>
          )}

          {section === 'stats' && (
            <>
          <div className="lore-head">
            <label>ステータス定義</label>
            <div className="desc">
              好感度・レベル・所持金など「事実の数」。イベント/行動で加減算され、条件にも使えます。
            </div>
          </div>
          {stats.map((s) => (
            <div key={s.id} className="lore-entry">
              <div className="lore-entry-top">
                <input
                  className="lore-keys"
                  value={s.name}
                  placeholder="名称（例: 好感度 / レベル / 所持金）"
                  onChange={(e) => updateStat(s.id, { name: e.target.value })}
                />
                <button className="icon-btn small" onClick={() => removeStat(s.id)} title="削除">
                  ✕
                </button>
              </div>
              <div className="row2" style={{ marginTop: 6 }}>
                <label className="chk" title="対象">
                  対象
                  <select
                    value={s.scope}
                    style={{ background: 'var(--bg)' }}
                    onChange={(e) => updateStat(s.id, { scope: e.target.value as StatDef['scope'] })}
                  >
                    <option value="character">キャラ別</option>
                    <option value="global">主人公/全体</option>
                  </select>
                </label>
                <label className="chk" title="本編プロンプトに現在値を渡す">
                  <input
                    type="checkbox"
                    checked={s.inject}
                    onChange={(e) => updateStat(s.id, { inject: e.target.checked })}
                  />
                  本編に注入
                </label>
              </div>
              <div className="row2" style={{ marginTop: 6 }}>
                <label className="chk">
                  初期
                  <input
                    type="number"
                    value={s.default}
                    style={{ width: 72, background: 'var(--bg)' }}
                    onChange={(e) => updateStat(s.id, { default: Number(e.target.value) })}
                  />
                </label>
                <label className="chk">
                  最小
                  <input
                    type="number"
                    value={s.min ?? ''}
                    style={{ width: 72, background: 'var(--bg)' }}
                    onChange={(e) =>
                      updateStat(s.id, {
                        min: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="chk">
                  最大
                  <input
                    type="number"
                    value={s.max ?? ''}
                    style={{ width: 72, background: 'var(--bg)' }}
                    onChange={(e) =>
                      updateStat(s.id, {
                        max: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
            </div>
          ))}
          <button className="btn" style={{ marginTop: 8 }} onClick={addStat}>
            ＋ ステータスを追加
          </button>
            </>
          )}

          {section === 'counters' && (
            <>
          <div className="lore-head">
            <label>行動カウンター</label>
            <div className="desc">
              累計回数（例: デート回数 / 戦闘回数）。レビューで起きた行動を加算し、条件に使えます。
            </div>
          </div>
          {counters.map((c) => (
            <div key={c.id} className="lore-entry">
              <div className="lore-entry-top">
                <input
                  className="lore-keys"
                  value={c.name}
                  placeholder="名称（例: デート回数）"
                  onChange={(e) => updateCounter(c.id, { name: e.target.value })}
                />
                <label className="chk" title="対象">
                  <select
                    value={c.scope}
                    style={{ background: 'var(--bg)' }}
                    onChange={(e) => updateCounter(c.id, { scope: e.target.value as CounterDef['scope'] })}
                  >
                    <option value="character">キャラ別</option>
                    <option value="global">全体</option>
                  </select>
                </label>
                <label className="chk" title="本編プロンプトに現在値を渡す">
                  <input
                    type="checkbox"
                    checked={c.inject}
                    onChange={(e) => updateCounter(c.id, { inject: e.target.checked })}
                  />
                  注入
                </label>
                <button className="icon-btn small" onClick={() => removeCounter(c.id)} title="削除">
                  ✕
                </button>
              </div>
            </div>
          ))}
          <button className="btn" style={{ marginTop: 8 }} onClick={addCounter}>
            ＋ カウンターを追加
          </button>
            </>
          )}

          {section === 'achievements' && (
            <>
          <div className="lore-head">
            <label>実績</label>
            <div className="desc">
              スタット・カウンター・関係フラグ・他の実績のしきい値を満たすと、承認なしで自動的に解除されます。
            </div>
          </div>
          {achievements.map((a) => {
            const mode = modeOf(a.condition)
            const clauses = clausesOf(a.condition)
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
                    ✕
                  </button>
                </div>
                <textarea
                  rows={2}
                  className="lore-content"
                  value={a.description}
                  placeholder="内容（例: 主人公と2人きりで出かけた）"
                  onChange={(e) => updateAchievement(a.id, { description: e.target.value })}
                />
                <div className="row2" style={{ marginTop: 6, alignItems: 'center' }}>
                  <span className="sub-label">達成条件</span>
                  <select
                    value={mode}
                    style={{ background: 'var(--bg)' }}
                    onChange={(e) => setCondition(a.id, e.target.value as 'all' | 'any', clauses)}
                  >
                    <option value="all">すべて満たす</option>
                    <option value="any">いずれか満たす</option>
                  </select>
                </div>
                {clauses.map((c, i) => (
                  <ClauseRow
                    key={i}
                    clause={c}
                    world={d}
                    achievementId={a.id}
                    onChange={(nc) => updateClause(a, i, nc)}
                    onRemove={() => removeClause(a, i)}
                  />
                ))}
                <button className="btn" style={{ marginTop: 6 }} onClick={() => addClause(a)}>
                  ＋ 条件を追加
                </button>
              </div>
            )
          })}
          <button className="btn" style={{ marginTop: 8 }} onClick={addAchievement}>
            ＋ 実績を追加
          </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
