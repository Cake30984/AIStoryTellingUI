import { useState } from 'react'
import { useStore } from '../store'
import { newImageProvider, testImageProvider } from '../lib/imageGen'
import type { ImageProvider } from '../types'

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

/** SettingsBody（System ページ）内の「画像生成の接続先」管理セクション */
export default function ImageProviderSettings() {
  const { imageProviders, upsertImageProvider, deleteImageProvider } = useStore()
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [testResults, setTestResults] = useState<Record<string, string>>({})
  const [testingId, setTestingId] = useState<string | null>(null)

  const runTest = async (p: ImageProvider) => {
    setTestingId(p.id)
    try {
      const { ok, message } = await testImageProvider(p)
      setTestResults((r) => ({ ...r, [p.id]: (ok ? '✅ ' : '⚠️ ') + message }))
    } finally {
      setTestingId(null)
    }
  }

  return (
    <div className="field">
      <label>画像生成の接続先</label>
      <div className="desc">
        アバター・挿絵の生成に使います。ComfyUI はローカル起動時に CORS 許可が必要です（例:{' '}
        <code>python main.py --enable-cors-header '*'</code>）。API キーはこのブラウザ内にのみ保存されます。
      </div>

      {imageProviders.map((p) => (
        <div key={p.id} className="lore-entry" style={{ marginBottom: 10 }}>
          <div className="lore-entry-top">
            <input
              style={{ ...inputStyle, flex: 1, width: 'auto', marginBottom: 0 }}
              placeholder="接続先の名前"
              value={p.label}
              onChange={(e) => upsertImageProvider({ ...p, label: e.target.value })}
            />
            <span className="badge" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
              {p.kind === 'comfyui' ? 'ComfyUI' : '画像API'}
            </span>
            <button
              className="icon-btn small"
              onClick={() => deleteImageProvider(p.id)}
              title="削除"
              style={{ flexShrink: 0 }}
            >
              🗑
            </button>
          </div>

          <input
            style={inputStyle}
            placeholder={p.kind === 'comfyui' ? 'Base URL（例: http://127.0.0.1:8188）' : 'Base URL（例: https://api.openai.com/v1）'}
            value={p.baseUrl}
            onChange={(e) => upsertImageProvider({ ...p, baseUrl: e.target.value })}
          />

          {p.kind === 'openai-image' && (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <input
                  type={showKeys[p.id] ? 'text' : 'password'}
                  style={{ ...inputStyle, flex: 1, width: 'auto', marginBottom: 0 }}
                  placeholder="API キー"
                  value={p.apiKey}
                  onChange={(e) => upsertImageProvider({ ...p, apiKey: e.target.value })}
                />
                <button
                  className="btn"
                  style={{ whiteSpace: 'nowrap' }}
                  onClick={() => setShowKeys((s) => ({ ...s, [p.id]: !s[p.id] }))}
                >
                  {showKeys[p.id] ? '隠す' : '表示'}
                </button>
              </div>
              <input
                style={inputStyle}
                placeholder="モデル名（例: dall-e-3 / grok-2-image）"
                value={p.model}
                onChange={(e) => upsertImageProvider({ ...p, model: e.target.value })}
              />
            </>
          )}

          {p.kind === 'comfyui' && (
            <>
              <div className="desc" style={{ marginBottom: 4 }}>
                workflow（API Format）。%PROMPT% / %NEGATIVE% / "%SEED%" / "%WIDTH%" / "%HEIGHT%"
                がプレースホルダとして置換されます。ckpt_name はご自身の環境のモデル名に書き換えてください。
              </div>
              <textarea
                rows={6}
                style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12 }}
                value={p.workflowJson}
                onChange={(e) => upsertImageProvider({ ...p, workflowJson: e.target.value })}
              />
            </>
          )}

          <div className="desc" style={{ marginBottom: 4 }}>
            デフォルトタグ: 生成のたびにプロンプトの先頭へ自動で結合されます（品質・画風・LoRA トリガー等。
            生成モーダルのプロンプト欄には表示されません）。
          </div>
          <textarea
            rows={2}
            style={inputStyle}
            placeholder="デフォルトプロンプト（例: masterpiece, best quality, very aesthetic）"
            value={p.defaultPositive ?? ''}
            onChange={(e) => upsertImageProvider({ ...p, defaultPositive: e.target.value })}
          />
          {p.kind === 'comfyui' && (
            <textarea
              rows={2}
              style={inputStyle}
              placeholder="デフォルトネガティブ（例: low quality, worst quality, bad anatomy）"
              value={p.defaultNegative ?? ''}
              onChange={(e) => upsertImageProvider({ ...p, defaultNegative: e.target.value })}
            />
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              className="btn"
              style={{ fontSize: 12, padding: '5px 12px' }}
              onClick={() => runTest(p)}
              disabled={testingId === p.id}
            >
              {testingId === p.id ? 'テスト中…' : '🔌 接続テスト'}
            </button>
            {testResults[p.id] && <span style={{ fontSize: 12.5 }}>{testResults[p.id]}</span>}
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" style={{ flex: 1 }} onClick={() => upsertImageProvider(newImageProvider('comfyui'))}>
          ＋ ComfyUI を追加
        </button>
        <button
          className="btn"
          style={{ flex: 1 }}
          onClick={() => upsertImageProvider(newImageProvider('openai-image'))}
        >
          ＋ 画像 API を追加
        </button>
      </div>
    </div>
  )
}
