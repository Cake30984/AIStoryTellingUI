import { useEffect, useRef, useState } from 'react'
import { currentScene, knownSpeakersOf, newCharacter, reviewModelOf, useStore } from '../store'
import { streamChat } from '../lib/openrouter'
import { parseModelRef } from '../lib/providers'
import { extractJson } from '../lib/json'
import { CHARACTER_DRAFT_SCHEMA, jsonModeFor } from '../lib/jsonSchemas'
import { characterDraftContextUser, characterDraftSystem } from '../lib/prompts'
import { plainTextOf } from '../lib/structured'
import type { Character, Session } from '../types'
import ModalShell from './ModalShell'
import CharacterEditor from './library/CharacterEditor'

/** 起案へ渡す本文の文字数予算（挿絵起案と同じ考え方＝末尾から遡って詰める） */
const CONTEXT_BUDGET = 8000

interface Props {
  session: Session
  /** 本文で見つかった名前（話者チップ or レビューの newCharacters） */
  name: string
  /** レビュー経路のみ: その人物について分かっていること */
  note?: string
  onClose: () => void
}

/**
 * 発見キャラのキャラ化モーダル（FB7-E）。
 *
 * 起案（裏方 LLM が本文からキャラ JSON を作る）→ そのまま `CharacterEditor` の draft として開き、
 * ユーザーが確認・編集して保存する。保存先は**ライブラリの通常キャラ**＋現在セッションの参加キャラ
 * （`addDiscoveredCharacter`）＝セッション内に埋め込まないので、カセット定義は汚れず、
 * カード書き出し・他セッションでの再利用もそのまま効く。
 *
 * 裏方モデルはレビュー用（`reviewModelOf`）を流用する。
 */
export default function CharacterDraftModal({ session, name, note, onClose }: Props) {
  const { characters, personas, worlds, providers, modelsByProvider, recordUsage, addDiscoveredCharacter } =
    useStore()
  const [draft, setDraft] = useState<Character | null>(null)
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  // 対象が変わらない限り起案は1回だけ（StrictMode の二重実行・再描画で投げ直さない）
  const startedRef = useRef('')

  useEffect(() => {
    const key = `${session.id}:${name}`
    if (startedRef.current === key) return
    startedRef.current = key
    const controller = new AbortController()
    abortRef.current = controller
    let canceled = false

    const run = async () => {
      const modelRef = reviewModelOf(session)
      const { provider, model } = parseModelRef(modelRef, providers)
      // 起案に失敗しても空の下書きは開ける（手書きで定義したい人を止めない）
      const blank = (): Character => ({ ...newCharacter(), name, tags: ['発見'] })
      if (!provider?.apiKey.trim() || !model) {
        setError('起案に使うモデルの API キーが未設定です。空の下書きから記入できます。')
        setDraft(blank())
        return
      }
      const scene = currentScene(session)
      const world = worlds.find((w) => w.id === session.worldId)
      // 本文は現在シーンの末尾から予算ぶん遡る（裏方文脈なので `plainTextOf` で自然表記へ整流）
      const recent: string[] = []
      let used = 0
      const pool = session.messages.filter((m) => m.content.trim() && (!scene || !m.sceneId || m.sceneId === scene.id))
      for (let i = pool.length - 1; i >= 0; i--) {
        const text = plainTextOf(pool[i].content)
        if (used + text.length > CONTEXT_BUDGET && recent.length > 0) break
        recent.unshift(text)
        used += text.length
      }
      try {
        const t0 = performance.now()
        const res = await streamChat(
          {
            provider,
            model,
            messages: [
              { role: 'system', content: characterDraftSystem() },
              {
                role: 'user',
                content: characterDraftContextUser({
                  name,
                  note,
                  worldName: world?.name,
                  worldDescription: world?.description,
                  sceneTitle: scene?.title,
                  knownNames: knownSpeakersOf(session, characters, personas).map((c) => c.name),
                  recentMessages: recent,
                }),
              },
            ],
            temperature: 0.7,
            maxTokens: 2000,
            signal: controller.signal,
            jsonSchema: CHARACTER_DRAFT_SCHEMA,
            jsonMode: jsonModeFor(model, modelsByProvider[provider.id]),
          },
          () => {},
        )
        recordUsage({
          kind: 'characterDraft',
          modelRef,
          upstream: res.usage?.upstream,
          promptTokens: res.usage?.promptTokens ?? 0,
          cachedTokens: res.usage?.cachedTokens ?? 0,
          completionTokens: res.usage?.completionTokens ?? 0,
          cost: res.usage?.cost,
          ms: performance.now() - t0,
          sessionId: session.id,
        })
        if (canceled) return
        const json = extractJson<Record<string, unknown>>(res.text)
        const pick = (key: string) => (typeof json?.[key] === 'string' ? (json[key] as string).trim() : '')
        if (!json) {
          setError('起案結果を読み取れませんでした。空の下書きから記入できます。')
          setDraft(blank())
          return
        }
        setDraft({
          ...blank(),
          // 名前だけは検出した表記を優先する（本文の呼び名と食い違うとバッジが消えない）
          name: pick('name') || name,
          persona: pick('persona'),
          speechStyle: pick('speechStyle'),
          appearance: pick('appearance'),
          greeting: pick('greeting'),
        })
      } catch (e) {
        if (canceled || (e as Error).name === 'AbortError') return
        setError(`起案に失敗しました: ${(e as Error).message}　空の下書きから記入できます。`)
        setDraft(blank())
      }
    }
    void run()
    return () => {
      canceled = true
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, name])

  if (!draft) {
    return (
      <ModalShell
        title={`「${name}」をキャラクターにする`}
        onClose={onClose}
        footer={
          <button className="btn" onClick={onClose}>
            中止
          </button>
        }
      >
        <div className="field">
          <div className="desc">
            ここまでの本文をもとに、この人物の設定を起案しています。生成が終わると編集画面が開きます。
          </div>
        </div>
        <div className="reviewing-placeholder">設定を起案中…</div>
      </ModalShell>
    )
  }

  return (
    <CharacterEditor
      character={draft}
      draft
      draftNotice={
        error ||
        `本文から起案した下書きです。内容を確認・編集して保存すると、キャラクターライブラリに加わり、このセッションにも参加します。`
      }
      onSaved={(c) => addDiscoveredCharacter(session.id, c)}
      onClose={onClose}
    />
  )
}
