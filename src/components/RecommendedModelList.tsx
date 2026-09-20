import { useEffect, useState } from 'react'
import { fetchModels } from '../lib/openrouter'
import {
  formatPerMillion,
  isRecommendedModel,
  joinWithLiveModels,
  type LiveRecommendedModel,
} from '../lib/recommendedModels'
import type { Provider } from '../types'

const inputStyle = {
  width: '100%',
  background: 'var(--bg-elev2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text)',
  padding: '9px 11px',
  outline: 'none',
  fontSize: 14,
}

type LiveState =
  | { status: 'loading' }
  | { status: 'ready'; models: LiveRecommendedModel[] }
  | { status: 'error'; message: string }

/**
 * OpenRouter の推奨モデルを一言説明と価格つきで並べ、1 つ選ばせる（P7 A-1）。
 *
 * - 価格は**表示のたびに `/models` から取り直す**（定数に持たない）
 * - 一覧に**無くなった推奨モデルは出さない**。全部無ければ「その他」だけになる
 * - 一覧に無い id を使いたい人向けに「その他」を置く。**選ばれた id が表示中の推奨に無ければ「その他」扱い**
 *   （状態を別に持たない。空文字も「その他」＝入力欄が出る）
 */
export default function RecommendedModelList({
  provider,
  value,
  onChange,
  onOpenPicker,
}: {
  /** 一覧を取りに行く接続先（キーは無くてもよい。`/models` は公開エンドポイント） */
  provider: Provider
  value: string
  onChange: (modelId: string) => void
  /** 「一覧から選ぶ」（ModelPicker）を開く。呼び出し側がモーダルを持つ */
  onOpenPicker: () => void
}) {
  const [live, setLive] = useState<LiveState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setLive({ status: 'loading' })
    fetchModels(provider)
      .then((list) => {
        if (alive) setLive({ status: 'ready', models: joinWithLiveModels(list) })
      })
      .catch((e) => {
        if (alive) setLive({ status: 'error', message: (e as Error).message })
      })
    return () => {
      alive = false
    }
    // 取り直すのは接続先（Base URL）が変わった時と明示の再試行だけ。キーの入力中に毎回叩かない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.baseUrl, reloadKey])

  const shown = live.status === 'ready' ? live.models : []
  const shownIds = shown.map((m) => m.id)

  // 初期選択（推奨の先頭）が一覧から消えていたら、表示できる先頭へ寄せる。
  // これは接続テスト前の「選べる値に直す」だけで、失敗時の自動切り替えではない
  useEffect(() => {
    if (live.status !== 'ready') return
    if (isRecommendedModel(value) && !shownIds.includes(value)) onChange(shownIds[0] ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.status])

  // 取得中は推奨 id を「その他」に落とさない（入力欄が一瞬出て消えるのを避ける）。
  // 取得失敗時は表示できる推奨が無いので、選択中の id をそのまま入力欄に出す（見えない選択のまま進ませない）
  const custom = live.status === 'loading' ? !isRecommendedModel(value) : !shownIds.includes(value)

  return (
    <div>
      {live.status === 'loading' && <p className="desc">OpenRouter のモデル一覧と価格を取得しています…</p>}
      {live.status === 'error' && (
        <p className="notice" style={{ color: 'var(--danger)' }}>
          モデル一覧を取得できなかったため、推奨モデルを表示できません（{live.message}）。
          <button type="button" className="btn" style={{ marginLeft: 8 }} onClick={() => setReloadKey((k) => k + 1)}>
            再試行
          </button>
        </p>
      )}
      {live.status === 'ready' && shown.length === 0 && (
        <p className="notice">推奨モデルは現在 OpenRouter の一覧にありません。「その他のモデル」から選んでください。</p>
      )}
      {shown.length > 0 && (
        <p className="desc" style={{ margin: '0 0 6px' }}>価格は OpenRouter の現在値（1M トークン＝100 万トークンあたり、米ドル）。</p>
      )}
      {shown.map((m) => {
        const selected = value === m.id
        return (
          <button
            key={m.id}
            type="button"
            className={'model-row' + (selected ? ' selected' : '')}
            style={{ width: '100%', textAlign: 'left', color: 'var(--text)', background: selected ? undefined : 'transparent' }}
            aria-pressed={selected}
            onClick={() => onChange(m.id)}
          >
            <div className="m-name">
              <div className="n">{m.name}</div>
              <div className="desc" style={{ margin: '2px 0', whiteSpace: 'normal' }}>{m.desc}</div>
              <div className="id">{m.id}</div>
            </div>
            {/* 単位は行ごとに書く（見出しを読まなくても入力・出力・1M トークンあたりと分かるように） */}
            <div className="m-ctx" style={{ whiteSpace: 'nowrap', textAlign: 'right', lineHeight: 1.5 }}>
              <div>入力 {formatPerMillion(m.promptPerMillion)}</div>
              <div>出力 {formatPerMillion(m.completionPerMillion)}</div>
              <div style={{ color: 'var(--text-faint)' }}>1M トークンあたり</div>
            </div>
          </button>
        )
      })}
      <button
        type="button"
        className={'model-row' + (custom ? ' selected' : '')}
        style={{ width: '100%', textAlign: 'left', color: 'var(--text)', background: custom ? undefined : 'transparent' }}
        aria-pressed={custom}
        onClick={() => {
          if (!custom) onChange('')
        }}
      >
        <div className="m-name">
          <div className="n">その他のモデル</div>
          <div className="desc" style={{ margin: '2px 0', whiteSpace: 'normal' }}>
            OpenRouter にあるモデルを自分で指定する
          </div>
        </div>
      </button>
      {custom && (
        <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            placeholder="モデル id（例: anthropic/claude-opus-5）"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoFocus
          />
          <button type="button" className="btn" onClick={onOpenPicker}>
            一覧から選ぶ
          </button>
        </div>
      )}
    </div>
  )
}
