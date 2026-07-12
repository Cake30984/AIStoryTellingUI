import { useState } from 'react'
import { useStore } from '../../store'
import type { Cassette } from '../../types'
import { parseCardPng, exportCassetteCard } from '../../lib/cards'
import { getImage, useImageUrl } from '../../lib/imageStore'
import { generateDefaultAvatar } from '../../lib/avatarGen'
import { useCardDrop } from '../../lib/useCardDrop'
import { appConfirm } from '../../lib/dialogs'
import { openingRoleLabel, validateOpeningRoles } from '../../lib/openingRoles'
import { Icon } from '../icons'
import CassetteEditor from '../CassetteEditor'

/** カセット1枚のカード（表紙・紹介文・遊ぶ/編集/書き出し/削除）。FB2-E / FB3-D */
function CassetteCard({
  cas,
  onPlay,
  onEdit,
  onExport,
  onDelete,
}: {
  cas: Cassette
  onPlay: () => void
  onEdit: () => void
  onExport: () => void
  onDelete: () => void
}) {
  const coverUrl = useImageUrl(cas.coverImageId)
  return (
    <div className="cassette-card">
      <div className="cassette-cover">
        {coverUrl ? (
          <img src={coverUrl} alt="" />
        ) : (
          <div className="cassette-cover-ph">🎮</div>
        )}
      </div>
      <div className="cassette-body">
        <div className="entity-name">{cas.title || '無題のカセット'}</div>
        <div className="entity-desc">{cas.description || '紹介文なし'}</div>
        <div className="cassette-actions">
          <button className="btn primary" onClick={onPlay}>
            <Icon name="play" size={13} /> 遊ぶ
          </button>
          <button className="btn" onClick={onEdit} title="カセットを編集">
            <Icon name="pencil" size={13} />
          </button>
          <button className="btn" onClick={onExport} title="PNGカードとして書き出す">
            <Icon name="download" size={13} />
          </button>
          <button className="btn danger" onClick={onDelete} title="棚から削除">
            <Icon name="trash-2" size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CassetteLibrary() {
  const { cassettes, characters, worlds, personas, importCassette, playCassette, deleteCassette } = useStore()
  const [notice, setNotice] = useState('')
  // null=閉じている / {}=新規 / {cassette}=編集
  const [editing, setEditing] = useState<{ cassette?: Cassette } | null>(null)

  const handleFiles = async (files: FileList) => {
    for (const file of Array.from(files)) {
      if (!file.type.includes('png') && !file.name.toLowerCase().endsWith('.png')) continue
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const parsed = parseCardPng(bytes)
        if (!parsed || parsed.kind !== 'cassette') throw new Error('ゲームカセットが見つかりません。')
        await importCassette(parsed.bundle, new Blob([bytes as BlobPart], { type: 'image/png' }))
        setNotice(`🎮「${parsed.bundle.session.title || '無題'}」を棚に登録しました。`)
      } catch (e) {
        setNotice(`読み込み失敗：${(e as Error).message}`)
      }
    }
  }
  const { dragOver, dropProps } = useCardDrop(handleFiles)

  const doExport = async (cas: Cassette) => {
    try {
      const refs = {
        characters: cas.session.characterIds
          .map((id) => characters.find((c) => c.id === id))
          .filter((c): c is NonNullable<typeof c> => !!c),
        world: worlds.find((w) => w.id === cas.session.worldId),
        persona: personas.find((p) => p.id === cas.session.personaId),
      }
      const cover =
        (cas.coverImageId ? await getImage(cas.coverImageId) : null) ??
        (await generateDefaultAvatar(cas.title || '物語', '#7c5cff'))
      await exportCassetteCard(cas.session, refs, cover, cas.description)
    } catch (e) {
      setNotice(`書き出し失敗：${(e as Error).message}`)
    }
  }

  const doDelete = async (cas: Cassette) => {
    if (
      !(await appConfirm({
        message: `カセット「${cas.title || '無題'}」を棚から削除しますか？\n（すでに始めたセッションは残ります）`,
        danger: true,
      }))
    )
      return
    deleteCassette(cas.id)
  }

  const doPlay = (cas: Cassette) => {
    const issues = validateOpeningRoles(cas.session.story.opening, cas.session, characters, personas)
    if (issues.length > 0) {
      setNotice(`導入ロールが未設定です: ${issues.map(openingRoleLabel).join('、')}。編集画面で設定してください。`)
      setEditing({ cassette: cas })
      return
    }
    playCassette(cas.id)
  }

  return (
    <div className={'library' + (dragOver ? ' drag-over' : '')} {...dropProps}>
      <div className="library-head">
        <h2>🎮 ゲームカセット</h2>
        <button className="btn primary" onClick={() => setEditing({})}>
          <Icon name="plus" size={14} /> カセットを作る
        </button>
      </div>

      <div className="desc">
        1枚で最初から遊べる配布カード（PNG）の棚です。「カセットを作る」で世界観・キャラ・ペルソナ・開始設定を
        1つにまとめて作れます。PNG をここへドラッグ＆ドロップして取り込むこともできます。「遊ぶ」でいつでも
        新しいセッションを始められます（何度でも最初から）。世界観・キャラは自動でライブラリにも登録されます。
      </div>
      {notice && <p className="notice">{notice}</p>}

      {cassettes.length === 0 ? (
        <div className="library-empty">
          <p>まだカセットがありません。「カセットを作る」か、ゲームカセットの PNG をここにドロップして登録しましょう。</p>
        </div>
      ) : (
        <div className="cassette-grid">
          {cassettes.map((cas) => (
            <CassetteCard
              key={cas.id}
              cas={cas}
              onPlay={() => doPlay(cas)}
              onEdit={() => setEditing({ cassette: cas })}
              onExport={() => doExport(cas)}
              onDelete={() => doDelete(cas)}
            />
          ))}
        </div>
      )}

      {editing && (
        <CassetteEditor cassette={editing.cassette} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}
