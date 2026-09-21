import { useEffect, useRef, useState } from 'react'
import { hasStartPreset, newCassette, startPresetPatch, storeActions, useStore } from '../store'
import type { Cassette, Session } from '../types'
import { appConfirm } from '../lib/dialogs'
import { putImage, useImageUrl } from '../lib/imageStore'
import { generateDefaultAvatar, normalizeImage } from '../lib/avatarGen'
import ModalShell from './ModalShell'
import EntityAvatar from './EntityAvatar'
import { Icon } from './icons'
import IntroTagDefEditor from './IntroTagDefEditor'
import IntroTagFields from './IntroTagFields'

type Tab = 'basic' | 'world' | 'cast' | 'start'

interface Props {
  /** 既存カセットの編集。未指定なら新規 */
  cassette?: Cassette
  /** 既存セッションを種に新規作成する（freshSessionOf 済みで下書き化） */
  seedSession?: Session
  onClose: () => void
}

/** カセット専用エディタ（FB3-D）。世界観・キャラ・中心人物・開始設定を1つにまとめてカセットを作る */
export default function CassetteEditor({ cassette, seedSession, onClose }: Props) {
  const characters = useStore((st) => st.characters)
  const worlds = useStore((st) => st.worlds)
  const { upsertCassette, setView } = storeActions()
  const [d, setD] = useState<Cassette>(() => cassette ?? newCassette(seedSession))
  const [tab, setTab] = useState<Tab>('basic')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const s = d.session
  const patchSession = (p: Partial<Session>) => {
    setD((prev) => ({ ...prev, session: { ...prev.session, ...p } }))
    setDirty(true)
  }
  const patch = (p: Partial<Cassette>) => {
    setD((prev) => ({ ...prev, ...p }))
    setDirty(true)
  }

  const toggleCharacter = (id: string) => {
    const on = s.characterIds.includes(id)
    patchSession({
      characterIds: on ? s.characterIds.filter((c) => c !== id) : [...s.characterIds, id],
      // 中心人物は参加キャラの1人（F3）
      focusCharacterId: on
        ? s.focusCharacterId === id
          ? ''
          : s.focusCharacterId
        : s.focusCharacterId || id,
    })
  }

  // 表紙: coverImageId があればそれ、無ければタイトルからの自動プレビュー
  const coverUrl = useImageUrl(d.coverImageId)
  const [autoUrl, setAutoUrl] = useState('')
  useEffect(() => {
    if (d.coverImageId) return
    let disposed = false
    let url = ''
    void generateDefaultAvatar(s.title || '物語', '#7c5cff').then((blob) => {
      if (disposed) return
      url = URL.createObjectURL(blob)
      setAutoUrl(url)
    })
    return () => {
      disposed = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [s.title, d.coverImageId])

  // 種セッションの挿絵（表紙候補。新規＝空）。カセットのセッションは fresh で挿絵を持たないため seed から拾う
  const seedIllustrations = seedSession?.scenes.flatMap((sc) => sc.illustrations ?? []) ?? []

  const onPickFile = async (file: File) => {
    if (!file.type.includes('image')) return
    const normalized = await normalizeImage(file, 1024)
    const id = await putImage(normalized)
    patch({ coverImageId: id })
  }

  const save = async () => {
    setBusy(true)
    try {
      // 表紙未指定ならタイトルから自動生成した画像を焼き付けて棚で見えるようにする
      let coverImageId = d.coverImageId
      if (!coverImageId) {
        const blob = await normalizeImage(await generateDefaultAvatar(s.title || '物語', '#7c5cff'), 512)
        coverImageId = await putImage(blob)
      }
      // カセット名＝セッション名に揃える（playCassette 後の表示と一致させる）
      upsertCassette({ ...d, coverImageId, title: s.title })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const world = worlds.find((w) => w.id === s.worldId)

  return (
    <ModalShell
      title={cassette ? 'カセットを編集' : 'カセットを作る'}
      onClose={onClose}
      dirty={dirty}
      wide
      footer={
        <>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? '保存中…' : '棚に保存'}
          </button>
        </>
      }
    >
      <div className="se-navlayout">
        <nav className="se-nav">
          {(
            [
              ['basic', '基本', 'settings'],
              ['world', '世界観', 'globe'],
              ['cast', '登場キャラ', 'users'],
              ['start', '開始・進行', 'hourglass'],
            ] as const
          ).map(([t, label, icon]) => (
            <button key={t} className={'se-nav-btn' + (tab === t ? ' on' : '')} onClick={() => setTab(t)}>
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
                <input value={s.title} onChange={(e) => patchSession({ title: e.target.value })} />
              </div>
              <div className="field">
                <label>紹介文（任意）</label>
                <textarea
                  rows={2}
                  value={d.description}
                  placeholder="例: 記憶を失った剣士として、滅びかけた王国を巡る物語。"
                  onChange={(e) => patch({ description: e.target.value })}
                />
              </div>
              <div className="field">
                <label>表紙</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
                  <button
                    type="button"
                    className="cover-choice"
                    onClick={() => patch({ coverImageId: undefined })}
                    title="タイトルから自動生成した画像を使う"
                    data-on={d.coverImageId ? undefined : true}
                  >
                    {autoUrl ? <img src={autoUrl} alt="" /> : <span className="cover-ph">生成中…</span>}
                    <span className="cover-cap">タイトルから自動</span>
                  </button>
                  {d.coverImageId && coverUrl && (
                    <button type="button" className="cover-choice" data-on={true} title="選択中の表紙">
                      <img src={coverUrl} alt="" />
                      <span className="cover-cap">選択中</span>
                    </button>
                  )}
                  {seedIllustrations.map((ill) => (
                    <CoverThumb
                      key={ill.id}
                      imageId={ill.imageId}
                      selected={d.coverImageId === ill.imageId}
                      onSelect={() => patch({ coverImageId: ill.imageId })}
                    />
                  ))}
                </div>
                <div style={{ marginTop: 8 }}>
                  <button className="btn" onClick={() => fileRef.current?.click()}>
                    <Icon name="image" size={13} /> 画像ファイルを選ぶ
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void onPickFile(f)
                      e.target.value = ''
                    }}
                  />
                </div>
              </div>
            </>
          )}

          {tab === 'world' && (
            <div className="field">
              <label>世界観</label>
              {worlds.length === 0 ? (
                <p className="inline-empty">
                  世界観がありません。
                  <button className="link" onClick={() => { onClose(); setView('worlds') }}>
                    世界観管理で作成
                  </button>
                </p>
              ) : (
                <select
                  value={s.worldId ?? ''}
                  onChange={(e) => {
                    const worldId = e.target.value || null
                    const w = worlds.find((x) => x.id === worldId)
                    patchSession({ worldId, ...(w ? startPresetPatch(s, w, false) : {}) })
                  }}
                >
                  <option value="">なし</option>
                  {worlds.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name || '無名の世界'}
                    </option>
                  ))}
                </select>
              )}
              {world && hasStartPreset(world) && (
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
                      patchSession(startPresetPatch(s, world, true))
                    }}
                  >
                    開始テンプレートを読み込む（入力済みの項目も上書き）
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === 'cast' && (
            <>
            <div className="field">
              <label>登場キャラ</label>
              {characters.length === 0 ? (
                <p className="inline-empty">
                  キャラクターがありません。
                  <button className="link" onClick={() => { onClose(); setView('characters') }}>
                    キャラ管理で作成
                  </button>
                </p>
              ) : (
                <div className="pick-grid">
                  {characters.map((c) => (
                    <button
                      key={c.id}
                      className={'pick-chip' + (s.characterIds.includes(c.id) ? ' on' : '')}
                      onClick={() => toggleCharacter(c.id)}
                    >
                      <EntityAvatar className="dot-avatar" avatar={c.avatar} name={c.name || '無名'} />
                      {c.name || '無名'}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* 中心人物（F3。カセットは配布物なので中心が決まっていないと開始できない） */}
            <div className="field">
              <label>中心人物</label>
              <div className="desc">
                物語がこの人物を中心に描かれます（ロールプレイではプレイヤーが演じる人物）。関係性もこの人物への向きで記録されます。
              </div>
              <select
                value={s.focusCharacterId}
                onChange={(e) => patchSession({ focusCharacterId: e.target.value })}
              >
                <option value="">未選択</option>
                {s.characterIds.map((id) => {
                  const c = characters.find((x) => x.id === id)
                  return (
                    <option key={id} value={id}>
                      {c?.name || '無名'}
                    </option>
                  )
                })}
              </select>
              {!s.focusCharacterId && (
                <div className="desc warn">中心人物を選ぶまで、このカセットは開始できません。</div>
              )}
            </div>
            </>
          )}


          {tab === 'start' && (
            <>
              <div className="field">
                <label>ジャンル・トーン</label>
                <input
                  value={s.story.genre}
                  placeholder="例: ダークファンタジー"
                  onChange={(e) => patchSession({ story: { ...s.story, genre: e.target.value } })}
                />
              </div>
              <div className="field">
                <label>あらすじ・前提</label>
                <textarea
                  rows={3}
                  value={s.story.premise}
                  placeholder="例: 滅びかけた王国。記憶を失った剣士が..."
                  onChange={(e) => patchSession({ story: { ...s.story, premise: e.target.value } })}
                />
              </div>
              <div className="field">
                <label>最初の方向付け（非表示・任意）</label>
                <div className="desc">
                  最初のシーンの間だけ AI に渡される非表示の指示。チャットには表示されません。
                </div>
                <textarea
                  rows={3}
                  value={s.story.initialDirective ?? ''}
                  placeholder="例: 最初のシーンでは謎の少女と出会わせ、事件の予兆だけを見せる。"
                  onChange={(e) => patchSession({ story: { ...s.story, initialDirective: e.target.value } })}
                />
              </div>
              <div className="field">
                <label>導入（最初のシーン・任意）</label>
                <div className="desc">
                  入力すると「物語をはじめる」で AI に生成させず、この文章がそのまま最初の本文になります。
                </div>
                <input
                  value={s.story.openingTitle}
                  placeholder="導入シーンの見出し（例: 前夜の凶報）"
                  style={{ marginBottom: 6 }}
                  onChange={(e) => patchSession({ story: { ...s.story, openingTitle: e.target.value } })}
                />
                <textarea
                  rows={4}
                  value={s.story.opening}
                  placeholder="例: 城が焼け落ちた前夜のことだった——"
                  onChange={(e) => patchSession({ story: { ...s.story, opening: e.target.value } })}
                />
              </div>
              <IntroTagDefEditor
                tags={s.story.introTags ?? []}
                onChange={(introTags) => patchSession({ story: { ...s.story, introTags } })}
                opening={s.story.opening}
                onOpeningChange={(opening) => patchSession({ story: { ...s.story, opening } })}
              />
              <IntroTagFields
                session={s}
                characters={characters}
                onChange={(introBindings) => patchSession({ introBindings })}
              />
              <div className="field">
                <label>固定メモ（常に踏まえる重要事項・任意）</label>
                <div className="desc">
                  毎回「常に踏まえる重要事項」として AI に渡されます。毎ターン送り直されるので短く保ってください。
                  「頼まれても簡単には引き受けない人物」のような人物の芯は、ここよりキャラクターの人格欄に書く方がよく効きます。
                </div>
                <textarea
                  rows={2}
                  value={s.authorNote}
                  onChange={(e) => patchSession({ authorNote: e.target.value })}
                />
              </div>
              <div className="field">
                <label>文体</label>
                <div className="seg">
                  <button
                    className={s.narrativeStyle === 'novel' ? 'on' : ''}
                    onClick={() => patchSession({ narrativeStyle: 'novel' })}
                  >
                    小説
                  </button>
                  <button
                    className={s.narrativeStyle === 'chat' ? 'on' : ''}
                    onClick={() => patchSession({ narrativeStyle: 'chat' })}
                  >
                    会話劇
                  </button>
                </div>
              </div>
              {/* 新しい登場人物の登場ポリシー（発見キャラ・FB7-E） */}
              <div className="field">
                <label>新しい登場人物</label>
                <div className="desc">
                  登場キャラクターに登録していない人物を AI が新しく出してよいか。
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
                      className={(s.newCharacterPolicy ?? 'allow') === o.key ? 'on' : ''}
                      onClick={() => patchSession({ newCharacterPolicy: o.key })}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </ModalShell>
  )
}

function CoverThumb({ imageId, selected, onSelect }: { imageId: string; selected: boolean; onSelect: () => void }) {
  const url = useImageUrl(imageId)
  if (!url) return null
  return (
    <button type="button" className="cover-choice" data-on={selected ? true : undefined} onClick={onSelect}>
      <img src={url} alt="" />
      <span className="cover-cap">挿絵</span>
    </button>
  )
}
