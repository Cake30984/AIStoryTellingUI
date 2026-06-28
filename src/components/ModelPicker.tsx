import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { makeModelRef, splitRef } from '../lib/providers'

interface Props {
  current: string
  onPick: (ref: string) => void
  onClose: () => void
}

export default function ModelPicker({ current, onPick, onClose }: Props) {
  const {
    providers,
    modelsByProvider,
    modelsLoadingFor,
    loadModels,
    favoriteModels,
    toggleFavorite,
  } = useStore()

  // current から初期プロバイダを決定
  const { providerId: curProviderId, model: curModelId } = splitRef(current)
  const initialProviderId =
    providers.find((p) => p.id === curProviderId)?.id ?? providers[0]?.id ?? ''

  const [selectedProviderId, setSelectedProviderId] = useState(initialProviderId)
  const [q, setQ] = useState('')

  // プロバイダ切替時にモデル一覧が未取得なら自動取得
  useEffect(() => {
    if (selectedProviderId && !modelsByProvider[selectedProviderId]) {
      loadModels(selectedProviderId)
    }
  }, [selectedProviderId, modelsByProvider, loadModels])

  const models = modelsByProvider[selectedProviderId] ?? []
  const isLoading = modelsLoadingFor === selectedProviderId

  const filtered = useMemo(() => {
    const term = q.toLowerCase().trim()
    const match = (m: { id: string; name: string }) =>
      !term || m.id.toLowerCase().includes(term) || m.name.toLowerCase().includes(term)
    const list = models.filter(match)
    // お気に入りを上に
    return [...list].sort((a, b) => {
      const fa = favoriteModels.includes(a.id) ? 0 : 1
      const fb = favoriteModels.includes(b.id) ? 0 : 1
      return fa - fb
    })
  }, [models, q, favoriteModels])

  // 現在選択中のプロバイダ・モデルと一致するか
  const effectiveCurProviderId = curProviderId ?? providers[0]?.id
  const isSelected = (modelId: string) =>
    modelId === curModelId && selectedProviderId === effectiveCurProviderId

  const handlePick = (modelId: string) => {
    onPick(makeModelRef(selectedProviderId, modelId))
    onClose()
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>モデルを選択</h3>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {/* 接続先セレクタ */}
          {providers.length > 1 && (
            <div style={{ marginBottom: 12 }}>
              <div className="seg" style={{ display: 'flex', width: '100%', borderRadius: 'var(--radius-sm)' }}>
                {providers.map((p) => (
                  <button
                    key={p.id}
                    className={selectedProviderId === p.id ? 'on' : ''}
                    style={{ flex: 1, borderRadius: 'var(--radius-sm)' }}
                    onClick={() => setSelectedProviderId(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {providers.length === 1 && (
            <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-faint)' }}>
              接続先: {providers[0].label}
            </div>
          )}

          <input
            className="model-search"
            placeholder="モデル名や ID で検索（例: claude, gpt, gemini, free）"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          {isLoading && <p style={{ color: 'var(--text-dim)' }}>モデルを読み込み中…</p>}
          {!isLoading && models.length === 0 && (
            <p style={{ color: 'var(--text-dim)' }}>
              モデル一覧を取得できませんでした。設定で API キーを確認するか再試行してください。
            </p>
          )}
          <div className="model-list">
            {filtered.map((m) => {
              const fav = favoriteModels.includes(m.id)
              const ctx = m.context_length
                ? `${Math.round(m.context_length / 1000)}K`
                : ''
              return (
                <div
                  key={m.id}
                  className={'model-row' + (isSelected(m.id) ? ' selected' : '')}
                  onClick={() => handlePick(m.id)}
                >
                  <button
                    className={'star' + (fav ? ' on' : '')}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleFavorite(m.id)
                    }}
                    title="お気に入り"
                  >
                    {fav ? '★' : '☆'}
                  </button>
                  <div className="m-name">
                    <div className="n">{m.name}</div>
                    <div className="id">{m.id}</div>
                  </div>
                  {ctx && <span className="m-ctx">{ctx}</span>}
                </div>
              )
            })}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => loadModels(selectedProviderId)}>
            再読み込み
          </button>
          <button className="btn primary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
