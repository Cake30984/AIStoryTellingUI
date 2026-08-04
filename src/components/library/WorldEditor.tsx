import { useRef, useState } from 'react'
import {
  newAchievementDef,
  newClause,
  newCounterDef,
  newEndingDef,
  newGroupSubClause,
  newLoreEntry,
  newRelationAspect,
  newStatDef,
  uid,
  useStore,
} from '../../store'
import type {
  AchievementDef,
  Clause,
  Condition,
  CounterDef,
  EndingDef,
  GroupSubClause,
  LoreEntry,
  Op,
  Quantifier,
  RelationAspectDef,
  ScheduledEvent,
  StatDef,
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

const OPS: Op[] = ['>=', '>', '<=', '<', '==', '!=']

/** 比較演算子の日本語ラベル（FB8-E3。条件行を「〜が 2 以上」と文で読めるようにする） */
const OP_LABELS: Record<Op, string> = {
  '>=': '以上',
  '>': 'を超える',
  '<=': '以下',
  '<': '未満',
  '==': 'と等しい',
  '!=': 'と等しくない',
}

type Section =
  | 'basic'
  | 'start'
  | 'roles'
  | 'lore'
  | 'events'
  | 'aspects'
  | 'stats'
  | 'counters'
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
    heading: '数値と記録',
    items: [
      { id: 'stats', label: 'ステータス' },
      { id: 'counters', label: 'カウンター' },
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

/** Condition から節配列・モードを取り出す（all/any の判別） */
const clausesOf = (cond: Condition): Clause[] => ('all' in cond ? cond.all : cond.any)
const modeOf = (cond: Condition): 'all' | 'any' => ('all' in cond ? 'all' : 'any')

/** group 節の下位条件（GroupSubClause）1件の編集行。ロールの各メンバーに課す（キャラ限定） */
function GroupSubClauseRow({
  sub,
  world,
  onChange,
  onRemove,
}: {
  sub: GroupSubClause
  world: World
  onChange: (c: GroupSubClause) => void
  onRemove: () => void
}) {
  return (
    <div className="lore-entry-top" style={{ marginTop: 4, marginLeft: 20 }}>
      <select
        value={sub.kind}
        style={{ background: 'var(--bg)' }}
        onChange={(e) => onChange(newGroupSubClause(e.target.value as GroupSubClause['kind'], world))}
      >
        <option value="stat">ステータス</option>
        <option value="counter">カウンター</option>
      </select>

      {(sub.kind === 'stat' || sub.kind === 'counter') && (
        <>
          <select
            value={sub.defId}
            style={{ background: 'var(--bg)' }}
            onChange={(e) => onChange({ ...sub, defId: e.target.value })}
          >
            <option value="">（未選択）</option>
            {(sub.kind === 'stat' ? world.stats : world.counters)
              .filter((d) => d.scope === 'character')
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name || '無名'}
                </option>
              ))}
          </select>
          <span className="clause-joint">が</span>
          <NumberInput
            value={sub.value}
            style={{ width: 80, background: 'var(--bg)' }}
            onChange={(value) => onChange({ ...sub, value })}
          />
          {/* カウンターは回数なので単位を出す＝「告白した が 1回 以上」と読める（FB9-C） */}
          {sub.kind === 'counter' && <span className="clause-joint">回</span>}
          <select
            value={sub.op}
            style={{ background: 'var(--bg)' }}
            onChange={(e) => onChange({ ...sub, op: e.target.value as Op })}
          >
            {OPS.map((op) => (
              <option key={op} value={op}>
                {OP_LABELS[op]}
              </option>
            ))}
          </select>
        </>
      )}

      <button className="icon-btn small" onClick={onRemove} title="下位条件を削除">
        <Icon name="x" size={14} />
      </button>
    </div>
  )
}

/**
 * 条件節（Clause）1件の編集行。achievementId は実績の、eventId は特別イベントの自己参照を
 * 除外するため（それぞれ自分の条件エディタからのみ渡す。他の画面では未指定）。
 */
function ClauseRow({
  clause,
  world,
  achievementId,
  eventId,
  onChange,
  onRemove,
}: {
  clause: Clause
  world: World
  achievementId?: string
  eventId?: string
  onChange: (c: Clause) => void
  onRemove: () => void
}) {
  // 参照切れの検出：定義が消えた節は黙って発火しなくなるので、行の右に警告を出す
  const missingEvent =
    clause.kind === 'eventFired' &&
    !!clause.eventId &&
    !(world.scheduledEvents ?? []).some((e) => e.id === clause.eventId)
  return (
    <div style={{ marginTop: 6 }}>
      <div className="lore-entry-top">
        <select
          value={clause.kind}
          style={{ background: 'var(--bg)' }}
          onChange={(e) => onChange(newClause(e.target.value as Clause['kind'], world))}
        >
          <option value="stat">ステータス</option>
          <option value="counter">カウンター</option>
          <option value="achievement">実績</option>
          <option value="eventFired">特別イベント</option>
          <option value="group">グループ条件</option>
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
                  {(d.name || '無名') + (d.scope === 'character' ? '（キャラ別）' : '（全体）')}
                </option>
              ))}
            </select>
            <span className="clause-joint">が</span>
            <NumberInput
              value={clause.value}
              style={{ width: 80, background: 'var(--bg)' }}
              onChange={(value) => onChange({ ...clause, value })}
            />
            {/* カウンターは回数なので単位を出す＝「告白した が 1回 以上」と読める（FB9-C） */}
            {clause.kind === 'counter' && <span className="clause-joint">回</span>}
            <select
              value={clause.op}
              style={{ background: 'var(--bg)' }}
              onChange={(e) => onChange({ ...clause, op: e.target.value as Op })}
            >
              {OPS.map((op) => (
                <option key={op} value={op}>
                  {OP_LABELS[op]}
                </option>
              ))}
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
            <span className="clause-joint">が</span>
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

        {clause.kind === 'eventFired' && (
          <>
            <select
              value={clause.eventId}
              style={{ background: 'var(--bg)' }}
              onChange={(e) => onChange({ ...clause, eventId: e.target.value })}
            >
              <option value="">（未選択）</option>
              {(world.scheduledEvents ?? [])
                .filter((ev) => ev.id !== eventId)
                .map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name || '無名'}
                  </option>
                ))}
            </select>
            <span className="clause-joint">が</span>
            <select
              value={clause.have ? 'have' : 'not'}
              style={{ background: 'var(--bg)' }}
              onChange={(e) => onChange({ ...clause, have: e.target.value === 'have' })}
            >
              <option value="have">発生済み</option>
              <option value="not">未発生</option>
            </select>
            {missingEvent && (
              <span className="clause-joint" style={{ color: 'var(--danger)' }}>
                このイベントは存在しません
              </span>
            )}
          </>
        )}

        {clause.kind === 'group' && (
          <>
            <select
              value={clause.roleId}
              style={{ background: 'var(--bg)' }}
              onChange={(e) => onChange({ ...clause, roleId: e.target.value })}
            >
              <option value="">（ロール未選択）</option>
              {(world.roles ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || '無名'}
                </option>
              ))}
            </select>
            <span className="clause-joint">の</span>
            {clause.quantifier.kind !== 'all' && (
              <NumberInput
                min={1}
                integer
                value={clause.quantifier.n}
                style={{ width: 60, background: 'var(--bg)' }}
                onChange={(n) =>
                  onChange({ ...clause, quantifier: { ...clause.quantifier, n } as Quantifier })
                }
              />
            )}
            <select
              value={clause.quantifier.kind}
              style={{ background: 'var(--bg)' }}
              onChange={(e) => {
                const kind = e.target.value as Quantifier['kind']
                const quantifier: Quantifier =
                  kind === 'all' ? { kind: 'all' } : { kind, n: clause.quantifier.kind === 'all' ? 1 : clause.quantifier.n }
                onChange({ ...clause, quantifier })
              }}
            >
              <option value="all">全員</option>
              <option value="atLeast">人以上</option>
              <option value="exactly">人ぴったり</option>
            </select>
            <span className="clause-joint">が、下の条件をすべて満たす</span>
            <label className="chk" title="このロールのメンバーを結果の主要登場人物にする（@ロール名/@相手 置換・エピローグ注入の対象）">
              <input
                type="checkbox"
                checked={!!clause.subject}
                onChange={(e) => onChange({ ...clause, subject: e.target.checked })}
              />
              主要登場人物にする
            </label>
          </>
        )}

        <button className="icon-btn small" onClick={onRemove} title="条件を削除">
          <Icon name="x" size={14} />
        </button>
      </div>

      {clause.kind === 'group' &&
        clause.clauses.map((sub, i) => (
          <GroupSubClauseRow
            key={i}
            sub={sub}
            world={world}
            onChange={(nc) =>
              onChange({ ...clause, clauses: clause.clauses.map((c, j) => (j === i ? nc : c)) })
            }
            onRemove={() => onChange({ ...clause, clauses: clause.clauses.filter((_, j) => j !== i) })}
          />
        ))}
      {clause.kind === 'group' && (
        <button
          className="btn"
          style={{ marginTop: 4, marginLeft: 20 }}
          onClick={() => onChange({ ...clause, clauses: [...clause.clauses, newGroupSubClause('stat', world)] })}
        >
          <Icon name="plus" size={13} />メンバーの下位条件を追加
        </button>
      )}
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

  // ロアの解禁条件（G3。未指定＝条件なし＝常に通る。条件は alwaysOn より強い）
  const addEntryClause = (e: LoreEntry) => {
    const mode = e.condition ? modeOf(e.condition) : 'all'
    const clauses = [...(e.condition ? clausesOf(e.condition) : []), newClause('stat', d)]
    updateEntry(e.id, { condition: mode === 'all' ? { all: clauses } : { any: clauses } })
  }
  const updateEntryClause = (e: LoreEntry, idx: number, clause: Clause) => {
    if (!e.condition) return
    const mode = modeOf(e.condition)
    const clauses = clausesOf(e.condition).map((c, i) => (i === idx ? clause : c))
    updateEntry(e.id, { condition: mode === 'all' ? { all: clauses } : { any: clauses } })
  }
  const removeEntryClause = (e: LoreEntry, idx: number) => {
    if (!e.condition) return
    const mode = modeOf(e.condition)
    const clauses = clausesOf(e.condition).filter((_, i) => i !== idx)
    // 条件が空になったら条件そのものを外す（＝常に注入される状態へ戻す）
    const condition = clauses.length ? (mode === 'all' ? { all: clauses } : { any: clauses }) : undefined
    updateEntry(e.id, { condition })
  }
  const setEntryMode = (e: LoreEntry, mode: 'all' | 'any') => {
    if (!e.condition) return
    updateEntry(e.id, {
      condition: mode === 'all' ? { all: clausesOf(e.condition) } : { any: clausesOf(e.condition) },
    })
  }

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
  const setEndingCondition = (id: string, mode: 'all' | 'any', clauses: Clause[]) =>
    updateEnding(id, { condition: mode === 'all' ? { all: clauses } : { any: clauses } })
  const addEndingClause = (e: EndingDef) =>
    setEndingCondition(
      e.id,
      modeOf(e.condition ?? { all: [] }),
      [...clausesOf(e.condition ?? { all: [] }), newClause('stat', d)],
    )
  const updateEndingClause = (e: EndingDef, idx: number, clause: Clause) =>
    setEndingCondition(
      e.id,
      modeOf(e.condition ?? { all: [] }),
      clausesOf(e.condition ?? { all: [] }).map((c, i) => (i === idx ? clause : c)),
    )
  const removeEndingClause = (e: EndingDef, idx: number) =>
    setEndingCondition(
      e.id,
      modeOf(e.condition ?? { all: [] }),
      clausesOf(e.condition ?? { all: [] }).filter((_, i) => i !== idx),
    )

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
              <div className="field">
                <label>固定メモ（常に踏まえる重要事項）</label>
                <div className="desc">
                  毎回「常に踏まえる重要事項」として AI に渡されます。文体・禁則などの指示向きで、ロールプレイモードでも有効です。
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
              各項目の「解禁条件」を設定すると、条件を満たすまで注入されません（「常時」より強い）。
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
              {/* 解禁条件（G3）。既定は畳んでおき、設定済みなら見出しで分かるようにする */}
              {(() => {
                const cond = e.condition
                const clauses = cond ? clausesOf(cond) : []
                return (
                  <details className="help-details" open={false}>
                    <summary>解禁条件{clauses.length > 0 ? '（条件あり）' : ''}</summary>
                    <div style={{ marginTop: 6 }}>
                      <div className="desc">
                        条件を満たすまで、この設定は AI に渡されません。「常時」にしていても渡されません。
                      </div>
                      {clauses.length > 0 && (
                        <div className="row2" style={{ marginTop: 6, alignItems: 'center' }}>
                          <span className="sub-label">解禁条件</span>
                          <select
                            value={modeOf(cond!)}
                            style={{ background: 'var(--bg)' }}
                            onChange={(ev) => setEntryMode(e, ev.target.value as 'all' | 'any')}
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
                          onChange={(nc) => updateEntryClause(e, i, nc)}
                          onRemove={() => removeEntryClause(e, i)}
                        />
                      ))}
                      <button className="btn" style={{ marginTop: 6 }} onClick={() => addEntryClause(e)}>
                        <Icon name="plus" size={13} />解禁条件を追加
                      </button>
                    </div>
                  </details>
                )
              })()}
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
                発火条件を付けると「指定日時に到来し、かつ条件を満たしたとき」だけ発生します（承認は不要）。
                日付・時間帯とも空欄なら常に候補になります。
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
                    eventId={e.id}
                    onChange={(nc) => updateEventClause(e, i, nc)}
                    onRemove={() => removeEventClause(e, i)}
                  />
                ))}
                <button className="btn" style={{ marginTop: 6 }} onClick={() => addEventClause(e)}>
                  <Icon name="plus" size={13} />発火条件を追加
                </button>
                <div className="desc" style={{ marginTop: 4 }}>
                  {clauses.length > 0
                    ? '条件を満たし、指定日時も到来していれば自動的に発生します。'
                    : '指定日時で判定します（両方空欄なら常に候補）。'}
                  {clauses.some((c) => c.kind === 'eventFired') &&
                    ' イベントの連鎖は1シーンに1段ずつ進みます（発生したイベントを条件にした次のイベントは、さらに次のシーンで候補になります）。'}
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

          {section === 'stats' && (
            <>
          <div className="field">
            <label>レビュー指針（毎レビュー注入・任意）</label>
            <div className="desc">
              シーン終了レビューにそのまま渡す状態変動の方針。条件つきの方針は、レビューが観測できる事実
              （現在のステータス/カウンター値・日付・本文の描写）に紐づけて書くと機能します。
            </div>
            <textarea
              rows={8}
              value={d.reviewGuidance ?? ''}
              placeholder="例: 体力は毎シーン必ず消耗させる。フラグ『呪い』が立っている間は10〜20、外れていれば1〜5。"
              onChange={(e) => patch({ reviewGuidance: e.target.value })}
            />
          </div>
          <div className="lore-head">
            <label>ステータス定義</label>
            <div className="desc">
              好感度・レベル・所持金など「事実の数」。シーン終了レビューが実際に起きた出来事を評価して加減算し、条件にも使えます。
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
                  <Icon name="x" size={14} />
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
                  <NumberInput
                    value={s.default}
                    style={{ width: 72, background: 'var(--bg)' }}
                    onChange={(v) => updateStat(s.id, { default: v })}
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
              <div className="row2" style={{ marginTop: 6 }} title="レビュー1回で動かす場合の絶対値の下限〜上限。プロンプトの目安＋受領時のクランプに使われます（空欄=拘束なし）">
                <label className="chk">
                  変動幅/回 ±
                  <input
                    type="number"
                    min={0}
                    value={s.deltaMin ?? ''}
                    placeholder="最小"
                    style={{ width: 72, background: 'var(--bg)' }}
                    onChange={(e) =>
                      updateStat(s.id, {
                        deltaMin: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  />
                  〜
                  <input
                    type="number"
                    min={0}
                    value={s.deltaMax ?? ''}
                    placeholder="最大"
                    style={{ width: 72, background: 'var(--bg)' }}
                    onChange={(e) =>
                      updateStat(s.id, {
                        deltaMax: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
            </div>
          ))}
          <button className="btn" style={{ marginTop: 8 }} onClick={addStat}>
            <Icon name="plus" size={13} />ステータスを追加
          </button>
            </>
          )}

          {section === 'counters' && (
            <>
          <div className="lore-head">
            <label>行動カウンター</label>
            <div className="desc">
              累計回数（例: デート回数 / 戦闘回数）。レビューで起きた行動を加算し、条件に使えます。
              「告白した」のような一度きりの出来事も、1回以上の条件として書けます。
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
                  <Icon name="x" size={14} />
                </button>
              </div>
              {/* 計上条件（FB9-C）。名前だけでは AI が計上タイミングを判断できないため、
                  ここに書いた文をレビュープロンプトへそのまま渡す＝狙って条件に使えるようにする */}
              <textarea
                rows={3}
                className="lore-content"
                style={{ marginTop: 6 }}
                value={c.note ?? ''}
                placeholder="どんな時に数えるか（例: デートに出かけて最後まで一緒に過ごしたとき）"
                onChange={(e) => updateCounter(c.id, { note: e.target.value })}
              />
              <div className="row2" style={{ marginTop: 6 }} title="レビュー1回で加算する場合の下限〜上限（既定 1〜1000 の中でさらに絞る。空欄=拘束なし）">
                <label className="chk">
                  加算/回
                  <input
                    type="number"
                    min={1}
                    value={c.amountMin ?? ''}
                    placeholder="最小"
                    style={{ width: 72, background: 'var(--bg)' }}
                    onChange={(e) =>
                      updateCounter(c.id, {
                        amountMin: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  />
                  〜
                  <input
                    type="number"
                    min={1}
                    value={c.amountMax ?? ''}
                    placeholder="最大"
                    style={{ width: 72, background: 'var(--bg)' }}
                    onChange={(e) =>
                      updateCounter(c.id, {
                        amountMax: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
            </div>
          ))}
          <button className="btn" style={{ marginTop: 8 }} onClick={addCounter}>
            <Icon name="plus" size={13} />カウンターを追加
          </button>
            </>
          )}

          {section === 'achievements' && (
            <>
          <div className="lore-head">
            <label>実績</label>
            <div className="desc">
              ステータスなどのしきい値を満たすと、自動で解除される記録です（承認は不要）。
            </div>
            <HelpDetails>
              <p>
                条件にはステータス・カウンター・他の実績を使えます。判定はシーン終了レビューを
                確定したときに自動で行われます。
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
                  <Icon name="plus" size={13} />条件を追加
                </button>
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
              条件を満たすと物語がその結末へ到達し、エピローグシーンに入ります。<strong>上にあるほど優先</strong>
              されます。
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
            const cond = e.condition ?? { all: [] }
            const mode = modeOf(cond)
            const clauses = clausesOf(cond)
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
                {!e.fallback && (
                  <>
                    <div className="row2" style={{ marginTop: 6, alignItems: 'center' }}>
                      <span className="sub-label">到達条件</span>
                      <select
                        value={mode}
                        style={{ background: 'var(--bg)' }}
                        onChange={(ev) =>
                          setEndingCondition(e.id, ev.target.value as 'all' | 'any', clauses)
                        }
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
                        onChange={(nc) => updateEndingClause(e, i, nc)}
                        onRemove={() => removeEndingClause(e, i)}
                      />
                    ))}
                    <button
                      className="btn"
                      style={{ marginTop: 6 }}
                      onClick={() => addEndingClause(e)}
                    >
                      <Icon name="plus" size={13} />条件を追加
                    </button>
                  </>
                )}
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
