import { useState } from 'react'
import { useStore } from '../../store'
import type { Character } from '../../types'
import { modelRefLabel } from '../../lib/providers'
import AvatarField from './AvatarField'
import SpriteSetField from './SpriteSetField'
import CsvInput from '../CsvInput'
import ModelPicker from '../ModelPicker'
import { exportCharacterCard } from '../../lib/cards'
import { appConfirm } from '../../lib/dialogs'
import ModalShell from '../ModalShell'

interface Props {
  character: Character
  onClose: () => void
}

export default function CharacterEditor({ character, onClose }: Props) {
  const { characters, upsertCharacter, deleteCharacter, providers } = useStore()
  const [d, setD] = useState<Character>(character)
  // 未保存の新規キャラ（store にまだ id が無い）は立ち絵生成を無効化する
  const savedExists = characters.some((c) => c.id === d.id)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [dirty, setDirty] = useState(false)
  const patch = (p: Partial<Character>) => {
    setD((c) => ({ ...c, ...p }))
    setDirty(true)
  }

  const exportCard = async () => {
    setExporting(true)
    try {
      await exportCharacterCard(d)
    } finally {
      setExporting(false)
    }
  }

  const save = () => {
    upsertCharacter(d)
    onClose()
  }

  return (
    <>
    <ModalShell
      title="キャラクター"
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <button
            className="btn danger"
            onClick={async () => {
              if (await appConfirm({ message: 'このキャラを削除しますか？', danger: true })) {
                deleteCharacter(d.id)
                onClose()
              }
            }}
          >
            削除
          </button>
          <button className="btn" onClick={exportCard} disabled={exporting}>
            {exporting ? '書き出し中…' : '🖼 カードとして保存'}
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
          <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 0, marginBottom: 10 }}>
            素材の編集・保存はすべてのセッション・すべての分岐に共有されます（分岐を戻しても巻き戻りません）。
          </p>
          <div className="field">
            <label>アバター</label>
            <AvatarField
              avatar={d.avatar}
              name={d.name}
              genContext={{ name: d.name, appearance: d.appearance, imagePrompt: d.imagePrompt }}
              target={{ type: 'character-avatar', characterId: d.id }}
              onChange={(avatar) => patch({ avatar })}
            />
          </div>
          <div className="field">
            <label>名前</label>
            <input value={d.name} placeholder="例: 沙耶" onChange={(e) => patch({ name: e.target.value })} />
          </div>
          <div className="field">
            <label>人格・性格・背景</label>
            <div className="desc">価値観、過去、動機など。詳しいほど一貫します。</div>
            <textarea
              rows={4}
              value={d.persona}
              placeholder="例: 物静かだが芯が強い。本が好きで..."
              onChange={(e) => patch({ persona: e.target.value })}
            />
          </div>
          <div className="field">
            <label>口調・話し方</label>
            <textarea
              rows={2}
              value={d.speechStyle}
              placeholder="例: 丁寧な敬語混じり。一人称は「私」。"
              onChange={(e) => patch({ speechStyle: e.target.value })}
            />
          </div>
          <div className="field">
            <label>外見</label>
            <textarea
              rows={2}
              value={d.appearance}
              placeholder="例: 長い黒髪、眼鏡、制服。"
              onChange={(e) => patch({ appearance: e.target.value })}
            />
          </div>
          <div className="field">
            <label>セリフ例（few-shot）</label>
            <div className="desc">口調の再現精度が上がります。1行1セリフでOK。</div>
            <textarea
              rows={3}
              value={d.exampleDialogues}
              placeholder={'例:\n「……別に、あなたのためじゃないですから」\n「もう少しだけ、ここにいてもいいですか」'}
              onChange={(e) => patch({ exampleDialogues: e.target.value })}
            />
          </div>
          <div className="field">
            <label>最初のセリフ（任意）</label>
            <textarea
              rows={2}
              value={d.greeting}
              placeholder="例: あら、こんなところで奇遇ですね。"
              onChange={(e) => patch({ greeting: e.target.value })}
            />
          </div>
          {d.developments.length > 0 && (
            <div className="field">
              <label>展開で判明した設定（成長ログ）</label>
              <div className="desc">
                物語の進行でレビュー承認した追記。チェックを外すとプロンプトに含めません。
              </div>
              <div className="growth-list">
                {d.developments.map((dev) => (
                  <div key={dev.id} className="growth-edit">
                    <input
                      type="checkbox"
                      checked={dev.enabled}
                      title="適用/不適用"
                      onChange={(e) =>
                        patch({
                          developments: d.developments.map((x) =>
                            x.id === dev.id ? { ...x, enabled: e.target.checked } : x,
                          ),
                        })
                      }
                    />
                    <textarea
                      rows={2}
                      value={dev.text}
                      className={dev.enabled ? '' : 'dimmed'}
                      onChange={(e) =>
                        patch({
                          developments: d.developments.map((x) =>
                            x.id === dev.id ? { ...x, text: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <button
                      className="icon-btn small"
                      onClick={() =>
                        patch({ developments: d.developments.filter((x) => x.id !== dev.id) })
                      }
                      title="削除"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="field">
            <label>タグ（カンマ区切り・任意）</label>
            <CsvInput
              value={d.tags}
              placeholder="例: 学園, クール, ヒロイン"
              onChange={(tags) => patch({ tags })}
            />
          </div>

          <div className="field">
            <label>画像生成タグ（英語・任意）</label>
            <div className="desc">
              LoRA トリガーや髪色などの固定タグ。挿絵・アバター生成時に自動で使われ、カードにも含まれます。
            </div>
            <input
              value={d.imagePrompt ?? ''}
              placeholder="例: <lora:mychar:0.8>, 1girl, long black hair, glasses"
              onChange={(e) => patch({ imagePrompt: e.target.value || undefined })}
            />
          </div>

          <SpriteSetField
            characterId={savedExists ? d.id : ''}
            name={d.name}
            appearance={d.appearance}
            imagePrompt={d.imagePrompt}
          />

          <div className="field">
            <label>専用モデル（任意・会話劇の話者確定時のみ有効）</label>
            <div className="desc">
              会話劇でこのキャラが話者として確定した場合のみ使用。小説形式・おまかせ生成はセッション本編モデルを使います。
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="model-chip" style={{ flex: 1 }} onClick={() => setShowModelPicker(true)}>
                {d.model ? modelRefLabel(d.model, providers) : '未設定（セッション本編モデルを使用）'}
              </button>
              {d.model && (
                <button className="btn" style={{ whiteSpace: 'nowrap' }} onClick={() => patch({ model: undefined })}>
                  クリア
                </button>
              )}
            </div>
          </div>
    </ModalShell>
      {showModelPicker && (
        <ModelPicker
          current={d.model ?? ''}
          onPick={(ref) => patch({ model: ref || undefined })}
          onClose={() => setShowModelPicker(false)}
        />
      )}
    </>
  )
}
