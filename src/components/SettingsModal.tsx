import { useRef, useState } from 'react'
import { useStore } from '../store'
import { downloadBundle, downloadBlob } from '../lib/io'
import { PROVIDER_PRESETS, modelRefLabel, newProvider } from '../lib/providers'
import ImageProviderSettings from './ImageProviderSettings'
import ModelPicker from './ModelPicker'
import { appConfirm } from '../lib/dialogs'
import type { LlmRequestKind, Provider, UsageRecord } from '../types'
import { Icon } from './icons'
import HelpDetails from './HelpDetails'
import { AMBIENT_CATEGORIES, AMBIENT_SOUNDS } from '../lib/ambientSounds'

/** モデル使用状況（計測。PC0）の種別表示順・ラベル */
const USAGE_KIND_ORDER: LlmRequestKind[] = ['main', 'choices', 'review', 'nextScene', 'imageDraft']
const USAGE_KIND_LABELS: Record<LlmRequestKind, string> = {
  main: '本編',
  choices: '選択肢',
  review: 'レビュー',
  nextScene: '次シーン候補',
  imageDraft: '画像起案',
}

/** System ページ（設定・データ管理）の中身。UI-5でモーダルからページ化するため抽出。ロジックは無変更 */
export function SettingsBody() {
  const {
    providers,
    upsertProvider,
    deleteProvider,
    loadModels,
    modelsLoadingFor,
    exportBundle,
    importAnyFile,
    gcUnusedImages,
    defaultModelRef,
    setDefaultModelRef,
    usageLog,
    clearUsageLog,
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
  const [includeImages, setIncludeImages] = useState(true)
  const [showDefaultPicker, setShowDefaultPicker] = useState(false)

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

  const onExport = async () => {
    const bundle = await exportBundle(includeImages)
    if (bundle.images && bundle.images.length > 0) {
      const bytes = bundle.images.reduce((sum, img) => sum + img.dataBase64.length * 0.75, 0)
      const mb = (bytes / (1024 * 1024)).toFixed(1)
      if (!(await appConfirm(`画像 ${bundle.images.length} 件を含めます（概算 ${mb} MB）。書き出しますか？`))) return
    }
    downloadBundle(bundle)
    setNotice('全データをエクスポートしました。')
  }

  const onImportFile = async (file: File) => {
    try {
      setNotice(await importAnyFile(file))
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
    <>
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
                    <Icon name="trash-2" size={14} />
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
                  {modelsLoadingFor === p.id ? (
                    '読込中…'
                  ) : (
                    <>
                      <Icon name="refresh-cw" size={12} /> モデル一覧を読込
                    </>
                  )}
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
                <Icon name="plus" size={14} /> 接続先を追加
              </button>
            )}
          </div>

          {/* 新規セッションの既定モデル */}
          <div className="field">
            <label>新しい物語の既定モデル</label>
            <div className="desc">
              新しいセッションの作成時とカセット開始時に、最初からこのモデルが選択された状態になります
              （セッションごとの変更は今までどおり可能です）。
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="model-chip" style={{ flex: 1 }} onClick={() => setShowDefaultPicker(true)}>
                {defaultModelRef
                  ? modelRefLabel(defaultModelRef, providers) || defaultModelRef
                  : '未設定（OpenRouter におまかせ）'}
              </button>
              {defaultModelRef && (
                <button className="btn" style={{ whiteSpace: 'nowrap' }} onClick={() => setDefaultModelRef('')}>
                  クリア
                </button>
              )}
            </div>
          </div>

          <hr className="divider" />

          {/* 画像生成の接続先 */}
          <ImageProviderSettings />

          <hr className="divider" />

          {/* データのバックアップ */}
          <div className="field">
            <label>データのバックアップ</label>
            <div className="desc">
              キャラクター・世界観・ペルソナ・セッションをまとめて JSON で保存／復元します。
              localStorage はブラウザ消去で失われるため、定期的なエクスポートを推奨します。
              キャラクター・世界観・ペルソナは単体を PNG カード（画像1枚に情報を埋め込み）でも入出力できます
              （キャラクターは SillyTavern 互換）。インポートはセッションカード・ゲームカセットの PNG も受け付けます。
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={includeImages}
                onChange={(e) => setIncludeImages(e.target.checked)}
              />
              画像も含める（アバター・挿絵。容量が大きくなる場合があります）
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={onExport}>
                <Icon name="download" size={14} /> エクスポート
              </button>
              <button className="btn" onClick={() => fileRef.current?.click()}>
                <Icon name="upload" size={14} /> インポート
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
            <label>未使用画像の整理</label>
            <div className="desc">
              どのキャラクター・セッション・分岐チェックポイントからも参照されなくなった画像（アバター・挿絵）を
              ストレージから完全に削除し、容量を空けます。使用中の画像が消えることはありません。
            </div>
            <button
              className="btn"
              onClick={async () => {
                const removed = await gcUnusedImages()
                setNotice(`未使用の画像を ${removed} 件削除しました。`)
              }}
            >
              <Icon name="broom" size={14} /> 未使用画像を削除
            </button>
          </div>

          {notice && <p className="notice">{notice}</p>}

          <hr className="divider" />

          {/* モデル使用状況（計測。PC0） */}
          <div className="field">
            <label>モデル使用状況（計測）</label>
            <div className="desc">
              このセッション中の LLM 呼び出しの実コスト・キャッシュヒット率・所要時間を記録します
              （リロードで消えます。ブラウザに保存されません）。
            </div>
            <HelpDetails summary={`内訳を表示（${usageLog.length}件）`}>
              <UsageLogSummary usageLog={usageLog} onClear={clearUsageLog} />
            </HelpDetails>
          </div>

          <hr className="divider" />

          {/* 同梱素材のクレジット（AM3）。CC0/規約上は表示義務が無くても、
              何を同梱しているか・出所はどこかを利用者が確認できる場所を1つ持つ */}
          <div className="field">
            <label>同梱素材のクレジット</label>
            <div className="desc">
              環境音は {AMBIENT_SOUNDS.length} 音を同梱しています（すべて VSQ plus+ の素材）。
            </div>
            <HelpDetails summary="同梱している環境音の一覧">
              <p className="desc">
                出所: VSQ plus+（https://vsq.co.jp/plus/）。
                商用・非商用を問わず利用可能な素材を、ループ再生用に切り出し・音量調整・
                継ぎ目のクロスフェード加工のうえ同梱しています。クレジット表記は任意です。
              </p>
              {AMBIENT_CATEGORIES.map((cat) => (
                <div key={cat} className="credit-group">
                  <div className="credit-cat">{cat}</div>
                  {AMBIENT_SOUNDS.filter((s) => s.category === cat).map((s) => (
                    <div className="credit-row" key={s.id}>
                      <span className="credit-name">{s.label}</span>
                      <span className="credit-src">{s.credit}</span>
                    </div>
                  ))}
                </div>
              ))}
            </HelpDetails>
          </div>

          {/* アプリ名はサイドバーから撤去し、ここに控えめに置く（F3/R19） */}
          <p className="desc" style={{ marginTop: 32, textAlign: 'center' }}>
            AI Storytelling Studio
          </p>

          {showDefaultPicker && (
            <ModelPicker
              current={defaultModelRef ?? ''}
              onPick={(ref) => setDefaultModelRef(ref)}
              onClose={() => setShowDefaultPicker(false)}
            />
          )}
    </>
  )
}

/** モデル使用状況（計測）の集計表示（PC0）。usageLog は非永続・エクスポート対象外の生ログをそのまま渡す */
function UsageLogSummary({ usageLog, onClear }: { usageLog: UsageRecord[]; onClear: () => void }) {
  if (usageLog.length === 0) {
    return <p className="desc">まだ記録がありません。物語を進めると記録が増えます。</p>
  }

  const rows = USAGE_KIND_ORDER.map((kind) => {
    const recs = usageLog.filter((r) => r.kind === kind)
    if (recs.length === 0) return null
    const promptTokens = recs.reduce((a, r) => a + r.promptTokens, 0)
    const cachedTokens = recs.reduce((a, r) => a + r.cachedTokens, 0)
    const completionTokens = recs.reduce((a, r) => a + r.completionTokens, 0)
    const cost = recs.reduce((a, r) => a + (r.cost ?? 0), 0)
    const ms = recs.reduce((a, r) => a + r.ms, 0)
    return {
      kind,
      count: recs.length,
      promptTokens,
      cachedTokens,
      completionTokens,
      cost,
      avgSec: ms / recs.length / 1000,
      hitRate: promptTokens > 0 ? (cachedTokens / promptTokens) * 100 : 0,
    }
  }).filter((r): r is NonNullable<typeof r> => !!r)

  const total = {
    count: usageLog.length,
    promptTokens: rows.reduce((a, r) => a + r.promptTokens, 0),
    cachedTokens: rows.reduce((a, r) => a + r.cachedTokens, 0),
    completionTokens: rows.reduce((a, r) => a + r.completionTokens, 0),
    cost: rows.reduce((a, r) => a + r.cost, 0),
  }
  const totalHitRate = total.promptTokens > 0 ? (total.cachedTokens / total.promptTokens) * 100 : 0

  const upstreamCounts = usageLog.reduce<Record<string, number>>((acc, r) => {
    const key = r.upstream || '(不明)'
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

  const exportLog = async () => {
    const blob = new Blob([JSON.stringify(usageLog, null, 2)], { type: 'application/json' })
    const stamp = new Date().toISOString().slice(0, 10)
    await downloadBlob(blob, `usage-log-${stamp}.json`)
  }
  const clearLog = async () => {
    if (!(await appConfirm('実測記録をすべて削除しますか？'))) return
    onClear()
  }

  return (
    <>
      <table className="usage-table">
        <thead>
          <tr>
            <th>種別</th>
            <th>回数</th>
            <th>prompt計</th>
            <th>cached計（率）</th>
            <th>completion計</th>
            <th>cost計</th>
            <th>平均秒</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.kind}>
              <td>{USAGE_KIND_LABELS[r.kind]}</td>
              <td>{r.count}</td>
              <td>{r.promptTokens.toLocaleString()}</td>
              <td>
                {r.cachedTokens.toLocaleString()}（{r.hitRate.toFixed(1)}%）
              </td>
              <td>{r.completionTokens.toLocaleString()}</td>
              <td>{r.cost > 0 ? `$${r.cost.toFixed(4)}` : '-'}</td>
              <td>{r.avgSec.toFixed(1)}s</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>合計</td>
            <td>{total.count}</td>
            <td>{total.promptTokens.toLocaleString()}</td>
            <td>
              {total.cachedTokens.toLocaleString()}（{totalHitRate.toFixed(1)}%）
            </td>
            <td>{total.completionTokens.toLocaleString()}</td>
            <td>{total.cost > 0 ? `$${total.cost.toFixed(4)}` : '-'}</td>
            <td>-</td>
          </tr>
        </tfoot>
      </table>

      <div className="desc" style={{ marginTop: 10 }}>
        上流プロバイダの内訳:{' '}
        {Object.entries(upstreamCounts)
          .map(([name, n]) => `${name} ×${n}`)
          .join(' / ')}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn" onClick={exportLog}>
          <Icon name="download" size={14} /> JSON で書き出す
        </button>
        <button className="btn" onClick={clearLog}>
          <Icon name="broom" size={14} /> クリア
        </button>
      </div>
    </>
  )
}
