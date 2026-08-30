import { newClause, newGroupSubClause } from '../store'
import type { Clause, Condition, GroupSubClause, Op, Quantifier, World } from '../types'
import NumberInput from './NumberInput'
import { Icon } from './icons'

/**
 * 条件式（Condition）の編集 UI。`WorldEditor`（実績・エンディング・特別イベント・ロアの解禁条件）と
 * `SessionEditor`（キャラの登場条件・CG1）が共有する。世界の定義（stats/counters/achievements/
 * scheduledEvents/roles）を参照するため `world` が要る。
 */

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

/** Condition から節配列・モードを取り出す（all/any の判別） */
export const clausesOf = (cond: Condition): Clause[] => ('all' in cond ? cond.all : cond.any)
export const modeOf = (cond: Condition): 'all' | 'any' => ('all' in cond ? 'all' : 'any')

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
export function ClauseRow({
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

/**
 * 条件式まるごとの編集 UI（all/any の切替＋節の追加・編集・削除）。
 * `condition` が undefined なら「条件なし」。節を1つも持たない条件は `onChange(undefined)` で消す
 * （空の節リストは `matchGroups` が不成立を返すため、残すと恒久ロックになる）。
 */
export default function ConditionEditor({
  condition,
  world,
  label,
  addLabel = '条件を追加',
  onChange,
}: {
  condition: Condition | undefined
  world: World
  label: string
  addLabel?: string
  onChange: (c: Condition | undefined) => void
}) {
  const clauses = condition ? clausesOf(condition) : []
  const mode = condition ? modeOf(condition) : 'all'
  const rebuild = (m: 'all' | 'any', cs: Clause[]) =>
    onChange(cs.length === 0 ? undefined : m === 'all' ? { all: cs } : { any: cs })

  return (
    <>
      <div className="row2" style={{ marginTop: 6, alignItems: 'center' }}>
        <span className="sub-label">{label}</span>
        {clauses.length > 0 && (
          <select
            value={mode}
            style={{ background: 'var(--bg)' }}
            onChange={(e) => rebuild(e.target.value as 'all' | 'any', clauses)}
          >
            <option value="all">すべて満たす</option>
            <option value="any">いずれか満たす</option>
          </select>
        )}
      </div>
      {clauses.map((c, i) => (
        <ClauseRow
          key={i}
          clause={c}
          world={world}
          onChange={(nc) => rebuild(mode, clauses.map((x, j) => (j === i ? nc : x)))}
          onRemove={() => rebuild(mode, clauses.filter((_, j) => j !== i))}
        />
      ))}
      <button className="btn" style={{ marginTop: 6 }} onClick={() => rebuild(mode, [...clauses, newClause('stat', world)])}>
        <Icon name="plus" size={13} />
        {addLabel}
      </button>
    </>
  )
}
