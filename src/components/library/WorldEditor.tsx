import { useState } from 'react'
import { newLoreEntry, uid, useStore } from '../../store'
import type { LoreEntry, ScheduledEvent, World } from '../../types'
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
