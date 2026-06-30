import { useState } from 'react'
import {
  newCounterDef,
  newLoreEntry,
  newRelationAspect,
  newStatDef,
  uid,
  useStore,
  WORLD_PRESETS,
} from '../../store'
import type {
  CounterDef,
  LoreEntry,
  RelationAspectDef,
  ScheduledEvent,
  StatDef,
  World,
} from '../../types'
import CsvInput from '../CsvInput'

interface Props {
  world: World
  onClose: () => void
}

export default function WorldEditor({ world, onClose }: Props) {
  const { upsertWorld, deleteWorld } = useStore()
  const [d, setD] = useState<World>(world)
  const patch = (p: Partial<World>) => setD((w) => ({ ...w, ...p }))

  const updateEntry = (id: string, p: Partial<LoreEntry>) =>
    patch({ entries: d.entries.map((e) => (e.id === id ? { ...e, ...p } : e)) })

  const addEntry = () => patch({ entries: [...d.entries, newLoreEntry(d.entries.length)] })

  const removeEntry = (id: string) => patch({ entries: d.entries.filter((e) => e.id !== id) })

  const events = d.scheduledEvents ?? []
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
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>🌍 世界観（ロアブック）</h3>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
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

          <hr className="divider" />

          <div className="lore-head">
            <label>特別イベント（日付指定）</label>
            <div className="desc">
              タイムラインの指定日に到来すると、シーン演出で最優先に発生します（体育祭・クリスマスなど）。
            </div>
          </div>

          {events.map((e) => (
            <div key={e.id} className="lore-entry">
              <div className="lore-entry-top">
                <label className="chk" title="発生する日">
                  Day
                  <input
                    type="number"
                    min={1}
                    value={e.day}
                    style={{ width: 64, background: 'var(--bg)' }}
                    onChange={(ev) => updateEvent(e.id, { day: Math.max(1, Number(ev.target.value)) })}
                  />
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
            </div>
          ))}

          <button className="btn" style={{ marginTop: 8 }} onClick={addEvent}>
            ＋ 特別イベントを追加
          </button>

          <hr className="divider" />

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

          <div className="lore-head" style={{ marginTop: 12 }}>
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

          <div className="lore-head" style={{ marginTop: 12 }}>
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
        </div>
        <div className="modal-foot">
          <button
            className="btn danger"
            onClick={() => {
              if (confirm('この世界観を削除しますか？')) {
                deleteWorld(d.id)
                onClose()
              }
            }}
          >
            削除
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn primary" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
