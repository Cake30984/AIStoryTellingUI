import { useState } from 'react'
import {
  newLoreEntry,
  newRelationAspect,
  useStore,
} from '../../store'
import type {
  LoreEntry,
  RelationAspectDef,
  World,
  WorldStartPreset,
} from '../../types'
import CsvInput from '../CsvInput'
import IntroTagDefEditor from '../IntroTagDefEditor'
import { exportWorldCard } from '../../lib/cards'
import { appConfirm } from '../../lib/dialogs'
import { Icon } from '../icons'

type Section =
  | 'basic'
  | 'start'
  | 'lore'
  | 'aspects'

/** ナビのグループ見出し（FB8-E3。10セクションのフラット並びに意味のまとまりを付ける） */
const SECTION_GROUPS: { heading: string; items: { id: Section; label: string }[] }[] = [
  {
    heading: '世界の中身',
    items: [
      { id: 'basic', label: '基本' },
      { id: 'lore', label: 'ロア' },
    ],
  },
  {
    heading: '登場のしくみ',
    items: [{ id: 'aspects', label: '関係性の次元' }],
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

  // 関係性の次元（aspect）
  const aspects = d.relationAspects ?? []
  const updateAspect = (id: string, p: Partial<RelationAspectDef>) =>
    patch({ relationAspects: aspects.map((a) => (a.id === id ? { ...a, ...p } : a)) })
  const addAspect = () => patch({ relationAspects: [...aspects, newRelationAspect()] })
  const removeAspect = (id: string) =>
    patch({ relationAspects: aspects.filter((a) => a.id !== id) })

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
              <div className="field">
                <label>暦の書き方（任意）</label>
                <div className="desc">
                  この世界で日時をどう書くかの見本です。シーンが終わるたびに AI が現在時刻を記録するとき、
                  体裁を揃えるためだけに使います（<strong>粒度は縛りません</strong>——見本が「◯月◯日」でも
                  「6月半ば」や「翌年の春」と書いてかまいません）。
                </div>
                <input
                  value={d.calendarFormat ?? ''}
                  placeholder="例: ◯月◯日／朝・昼・夕・夜　第三紀・◯の月・◯日"
                  onChange={(e) => patch({ calendarFormat: e.target.value })}
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
                <label>開始時点の日時（任意）</label>
                <div className="desc">
                  物語がいつから始まるか。空欄なら AI が本文から決めます。書き方は自由です（例:「4月7日 朝」「第三紀・霜の月・三日」）。
                </div>
                <input
                  value={sp.startNow ?? ''}
                  placeholder="例: 4月7日 朝"
                  onChange={(e) => patchPreset({ startNow: e.target.value })}
                />
              </div>
              <div className="field">
                <label>最初から控えている予定（任意）</label>
                <div className="desc">
                  物語の開始時点で決まっている予定。「いつ」は日時でも条件でも書けます（例:「3日目の夜」「雨がやんだとき」）。
                  <strong>「来週水曜」のような相対表現は避けてください</strong>（基準日が無く解釈できません）。
                </div>
                {(sp.initialPending ?? []).map((x, idx) => (
                  <div key={idx} className="row2" style={{ marginBottom: 6 }}>
                    <input
                      value={x.when}
                      placeholder="いつ（例: 3日目の夜）"
                      onChange={(e) => {
                        const next = [...(sp.initialPending ?? [])]
                        next[idx] = { ...next[idx], when: e.target.value }
                        patchPreset({ initialPending: next })
                      }}
                    />
                    <input
                      value={x.what}
                      placeholder="なに（例: 町で祭りがある）"
                      onChange={(e) => {
                        const next = [...(sp.initialPending ?? [])]
                        next[idx] = { ...next[idx], what: e.target.value }
                        patchPreset({ initialPending: next })
                      }}
                    />
                    <button
                      className="icon-btn small"
                      title="削除"
                      onClick={() =>
                        patchPreset({
                          initialPending: (sp.initialPending ?? []).filter((_, k) => k !== idx),
                        })
                      }
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                ))}
                <button
                  className="btn"
                  onClick={() =>
                    patchPreset({ initialPending: [...(sp.initialPending ?? []), { when: '', what: '' }] })
                  }
                >
                  <Icon name="plus" size={13} />予定を追加
                </button>
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

        </div>
      </div>
    </div>
  )
}
