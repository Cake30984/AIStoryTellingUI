import { useState } from 'react'
import { useStore } from '../../store'
import type { Character } from '../../types'
import { modelRefLabel } from '../../lib/providers'
import AvatarField from './AvatarField'
import CsvInput from '../CsvInput'
import ModelPicker from '../ModelPicker'

interface Props {
  character: Character
  onClose: () => void
}

export default function CharacterEditor({ character, onClose }: Props) {
  const { upsertCharacter, deleteCharacter, providers } = useStore()
  const [d, setD] = useState<Character>(character)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const patch = (p: Partial<Character>) => setD((c) => ({ ...c, ...p }))

  const save = () => {
    upsertCharacter(d)
    onClose()
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>キャラクター</h3>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>アバター</label>
            <AvatarField avatar={d.avatar} onChange={(avatar) => patch({ avatar })} />
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
        </div>
        <div className="modal-foot">
          <button
            className="btn danger"
            onClick={() => {
              if (confirm('このキャラを削除しますか？')) {
                deleteCharacter(d.id)
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
      {showModelPicker && (
        <ModelPicker
          current={d.model ?? ''}
          onPick={(ref) => patch({ model: ref || undefined })}
          onClose={() => setShowModelPicker(false)}
        />
      )}
    </div>
  )
}
