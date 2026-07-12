import { useState } from 'react'
import { castingIssueLabel, findCastingRefs, validateCasting } from '../lib/casting'
import { useStore } from '../store'
import type { RoleAssignment } from '../types'
import CastingFields from './CastingFields'
import ModalShell from './ModalShell'

interface Props {
  sessionId: string
}

/** 開始時に未配役をその場で埋め、設定画面へ戻らず物語を開始するモーダル */
export default function CastingModal({ sessionId }: Props) {
  const { sessions, worlds, characters, personas, updateSession, startStory } = useStore()
  const session = sessions.find((candidate) => candidate.id === sessionId)
  const [assignments, setAssignments] = useState<RoleAssignment[]>(session?.roleAssignments ?? [])
  const [personaId, setPersonaId] = useState<string | null>(session?.personaId ?? null)
  if (!session) return null
  const world = worlds.find((candidate) => candidate.id === session.worldId)
  // @ペルソナ を使う導入文はモーダル内でペルソナも選べるようにし、設定画面への往復を無くす
  const usesPersona = findCastingRefs(session.story.opening, world?.roles).usesPersona
  const draft = { ...session, roleAssignments: assignments, personaId }
  const issues = validateCasting(draft, world, characters, personas)
  const canStart = issues.length === 0
  const close = () => useStore.setState({ castingSessionId: null })

  const begin = async () => {
    if (!canStart) return
    updateSession(session.id, { roleAssignments: assignments, personaId })
    close()
    await startStory()
  }

  return (
    <ModalShell
      title="配役を決める"
      onClose={close}
      footer={
        <>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={close}>キャンセル</button>
          <button className="btn primary" onClick={() => void begin()} disabled={!canStart}>
            配役して物語をはじめる
          </button>
        </>
      }
    >
      <p className="desc" style={{ marginTop: 0 }}>
        導入文や開始条件で必要な役が未配役です。ここで配役すると、そのまま物語を開始します。
      </p>
      {issues.length > 0 && <p className="notice">{issues.map(castingIssueLabel).join(' ')}</p>}
      {usesPersona && (
        <div className="casting-persona-pick">
          <label>@ペルソナ に使う人物</label>
          <select
            value={personaId ?? ''}
            onChange={(event) => setPersonaId(event.target.value || null)}
          >
            <option value="">（未選択）</option>
            {personas.map((persona) => (
              <option key={persona.id} value={persona.id}>
                {persona.name || '無名のペルソナ'}
              </option>
            ))}
          </select>
        </div>
      )}
      <CastingFields
        session={draft}
        world={world}
        characters={characters}
        personas={personas}
        onChange={setAssignments}
      />
      {issues.some((issue) => issue.kind === 'missing-persona') && personas.length === 0 && (
        <p className="desc">ペルソナがまだありません。ライブラリでペルソナを作成してから開始してください。</p>
      )}
    </ModalShell>
  )
}
