import { useRef, useState } from 'react'
import { useStore } from '../store'
import { downloadBundle, parseBundle } from '../lib/io'
import { parseCardPng, attachCardImage } from '../lib/cards'
import { PROVIDER_PRESETS, newProvider } from '../lib/providers'
import ImageProviderSettings from './ImageProviderSettings'
import type { Provider } from '../types'

interface Props {
  onClose: () => void
}

export default function SettingsModal({ onClose }: Props) {
  const {
    providers,
    upsertProvider,
    deleteProvider,
    loadModels,
    modelsLoadingFor,
    exportBundle,
    importBundle,
    importCharacterCard,
    importWorldCard,
    importPersonaCard,
    gcUnusedImages,
  } = useStore()

  // API キーはローカルバッファに保持し「保存」ボタンで確定
  const [localKeys, setLocalKeys] = useState<Record<string, string>>(
    () => Object.fromEntries(providers.map((p) => [p.id, p.apiKey])),
  )
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [notice, setNotice] = useState('')

  // 追加フォーム用
  const [showAddForm, setShowAddForm] = useState(false)
  const [addPresetIdx, setAddPresetIdx] = useState(0)
  const [addLabel, setAddLabel] = useState(PROVIDER_PRESETS[0].label)
  const [addBaseUrl, setAddBaseUrl] = useState(PROVIDER_PRESETS[0].baseUrl)
  const [addKind, setAddKind] = useState<'openrouter' | 'openai'>(PROVIDER_PRESETS[0].kind)
  const [addKey, setAddKey] = useState('')
  const [showAddKey, setShowAddKey] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)

  const saveKey = (p: Provider) => {
    upsertProvider({ ...p, apiKey: localKeys[p.id] ?? '' })
    setNotice('API キーを保存しました。')
  }

  const toggleShowKey = (id: string) =>
    setShowKeys((s) => ({ ...s, [id]: !s[id] }))

  const onPresetChange = (idx: number) => {
    setAddPresetIdx(idx)
    const preset = PROVIDER_PRESETS[idx]
    setAddLabel(preset.label)
    setAddBaseUrl(preset.baseUrl)
    setAddKind(preset.kind)
  }

  const addProviderSubmit = () => {
    const p = newProvider()
    p.label = addLabel.trim()
    p.kind = addKind
    p.baseUrl = addBaseUrl.trim()
    p.apiKey = addKey
    upsertProvider(p)
    setLocalKeys((k) => ({ ...k, [p.id]: addKey }))
    setAddKey('')
    setShowAddForm(false)
    setNotice('接続先を追加しました。')
  }

  const onExport = () => {
    downloadBundle(exportBundle())
    setNotice('全データをエクスポートしました。')
  }

  const onImportFile = async (file: File) => {
    const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')
    try {
      if (isPng) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const parsed = parseCardPng(bytes)
        if (!parsed) throw new Error('カード情報が見つかりません。')
        if (parsed.kind === 'character') {
          const withImage = await attachCardImage(parsed.character, bytes)
          importCharacterCard(withImage)
          setNotice(`カードから「${withImage.name || '無名'}」を追加しました。`)
        } else if (parsed.kind === 'persona') {
          const withImage = await attachCardImage(parsed.persona, bytes)
          importPersonaCard(withImage)
          setNotice(`カードから「${withImage.name || '無名'}」を追加しました。`)
        } else {
          importWorldCard(parsed.world)
          setNotice(`カードから「${parsed.world.name || '無名の世界'}」を追加しました。`)
        }
      } else {
        const bundle = parseBundle(await file.text())
        const { added } = importBundle(bundle)
        setNotice(`インポート完了：${added} 件を追加しました（既存は保持）。`)
      }
    } catch (e) {
      setNotice(`インポート失敗：${(e as Error).message}`)
    }
  }

  const inputStyle = {
    width: '100%',
    background: 'var(--bg-elev2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text)',
    padding: '9px 11px',
    outline: 'none',
    fontSize: 14,
    marginBottom: 6,
  } as const

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>設定・データ管理</h3>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">

          {/* 接続先（プロバイダ）管理 */}
          <div className="field">
            <label>接続先（API プロバイダ）</label>
            <div className="desc">
              API キーはこのブラウザ内にのみ保存され、外部送信はされません（API リクエストを除く）。
              OpenRouter は多くのモデルをまとめて利用できる便利なサービスです（
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--accent)' }}
              >
                openrouter.ai/keys
              </a>
              ）。
            </div>

            {providers.map((p) => (
              <div key={p.id} className="lore-entry" style={{ marginBottom: 10 }}>
                {/* ヘッダ行：名前・種別・削除 */}
                <div className="lore-entry-top">
                  <input
                    style={{ ...inputStyle, flex: 1, width: 'auto', marginBottom: 0 }}
                    placeholder="接続先の名前"
                    value={p.label}
                    onChange={(e) => upsertProvider({ ...p, label: e.target.value })}
                  />
                  <span className="badge" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {p.kind === 'openrouter' ? 'OpenRouter' : 'OpenAI互換'}
                  </span>
                  <button
                    className="icon-btn small"
                    onClick={() => deleteProvider(p.id)}
                    disabled={providers.length <= 1}
                    title={providers.length <= 1 ? '最後の接続先は削除できません' : '削除'}
                    style={{ flexShrink: 0 }}
                  >
                    🗑
                  </button>
                </div>

                {/* Base URL */}
                <input
                  style={inputStyle}
                  placeholder="Base URL（例: https://openrouter.ai/api/v1）"
                  value={p.baseUrl}
                  onChange={(e) => upsertProvider({ ...p, baseUrl: e.target.value })}
                />

                {/* API キー（ローカルバッファ＋保存ボタン） */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <input
                    type={showKeys[p.id] ? 'text' : 'password'}
                    style={{ ...inputStyle, flex: 1, width: 'auto', marginBottom: 0 }}
                    placeholder="API キー（sk-or-v1-... など）"
                    value={localKeys[p.id] ?? ''}
                    onChange={(e) => setLocalKeys((k) => ({ ...k, [p.id]: e.target.value }))}
                  />
                  <button className="btn" style={{ whiteSpace: 'nowrap' }} onClick={() => toggleShowKey(p.id)}>
                    {showKeys[p.id] ? '隠す' : '表示'}
                  </button>
                  <button className="btn primary" style={{ whiteSpace: 'nowrap' }} onClick={() => saveKey(p)}>
                    保存
                  </button>
                </div>

                {/* モデル一覧読込 */}
                <button
                  className="btn"
                  style={{ fontSize: 12, padding: '5px 12px' }}
                  onClick={() => {
                    loadModels(p.id)
                    setNotice(`「${p.label}」のモデル一覧を取得中…`)
                  }}
                  disabled={modelsLoadingFor === p.id}
                >
                  {modelsLoadingFor === p.id ? '読込中…' : '🔄 モデル一覧を読込'}
                </button>
              </div>
            ))}

            {/* 接続先追加フォーム */}
            {showAddForm ? (
              <div className="lore-entry">
                <div style={{ marginBottom: 8 }}>
                  <span className="sub-label">プリセットから選択</span>
                  <select
                    style={{ ...inputStyle, marginBottom: 0 }}
                    value={addPresetIdx}
                    onChange={(e) => onPresetChange(Number(e.target.value))}
                  >
                    {PROVIDER_PRESETS.map((preset, i) => (
                      <option key={i} value={i}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  style={inputStyle}
                  placeholder="接続先の名前"
                  value={addLabel}
                  onChange={(e) => setAddLabel(e.target.value)}
                />
                <input
                  style={inputStyle}
                  placeholder="Base URL（例: https://openrouter.ai/api/v1）"
                  value={addBaseUrl}
                  onChange={(e) => setAddBaseUrl(e.target.value)}
                />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <input
                    type={showAddKey ? 'text' : 'password'}
                    style={{ ...inputStyle, flex: 1, width: 'auto', marginBottom: 0 }}
                    placeholder="API キー"
                    value={addKey}
                    onChange={(e) => setAddKey(e.target.value)}
                  />
                  <button className="btn" style={{ whiteSpace: 'nowrap' }} onClick={() => setShowAddKey((s) => !s)}>
                    {showAddKey ? '隠す' : '表示'}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" onClick={() => setShowAddForm(false)}>
                    キャンセル
                  </button>
                  <button
                    className="btn primary"
                    onClick={addProviderSubmit}
                    disabled={!addLabel.trim() || !addBaseUrl.trim()}
                  >
                    追加
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="btn"
                style={{ width: '100%' }}
                onClick={() => setShowAddForm(true)}
              >
                ＋ 接続先を追加
              </button>
            )}
          </div>

          <hr className="divider" />

          {/* 画像生成の接続先 */}
          <ImageProviderSettings />

          <hr className="divider" />

          {/* データのバックアップ */}
          <div className="field">
            <label>データのバックアップ</label>
            <div className="desc">
              キャラ・世界観・ペルソナ・セッションをまとめて JSON で保存／復元します。
              localStorage はブラウザ消去で失われるため、定期的なエクスポートを推奨します。
              キャラ・世界観・ペルソナは単体を PNG カード（画像1枚に情報を埋め込み）でも入出力できます
              （キャラクターは SillyTavern 互換）。
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={onExport}>
                ⬇ エクスポート
              </button>
              <button className="btn" onClick={() => fileRef.current?.click()}>
                ⬆ インポート
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json,image/png,.png"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onImportFile(f)
                  e.target.value = ''
                }}
              />
            </div>
          </div>

          <hr className="divider" />

          {/* 画像の整理 */}
          <div className="field">
            <label>アバター画像の整理</label>
            <div className="desc">
              キャラ・ペルソナのどこからも参照されなくなった画像をブラウザ内のストレージから削除します。
            </div>
            <button
              className="btn"
              onClick={async () => {
                const removed = await gcUnusedImages()
                setNotice(`未使用の画像を ${removed} 件削除しました。`)
              }}
            >
              🧹 未使用画像を整理
            </button>
          </div>

          {notice && <p className="notice">{notice}</p>}
        </div>
        <div className="modal-foot">
          <button className="btn primary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
