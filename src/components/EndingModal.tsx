import { useStore } from '../store'
import ModalShell from './ModalShell'
import { Icon } from './icons'

interface Props {
  onClose: () => void
}

/**
 * 終わり方の提案（F4・`docs/設計_物語の簡素化.md` §2.7）。
 *
 * **世界観は結末を定義しない。** いつでも「今の状況からどう終わりうるか」を AI に考えさせ、
 * ユーザーは ①目標として保持する ②その場で確定して終わる ③何も選ばない のいずれかを選ぶ。
 * コードは到達判定を一切しない＝**提案の主体は AI、選ぶ主体はプレイヤー**。
 */
export default function EndingModal({ onClose }: Props) {
  const {
    sessions,
    activeId,
    endingProposals,
    isProposingEndings,
    proposeEndings,
    setEndingGoal,
    concludeStory,
    clearEndingProposals,
  } = useStore()
  const session = sessions.find((s) => s.id === activeId)
  if (!session) return null

  const goal = session.endingGoal
  const close = () => {
    clearEndingProposals()
    onClose()
  }

  return (
    <ModalShell
      title="どんな終わり方があり得るか"
      onClose={close}
      wide
      scrollableBody
      footer={
        <>
          <button className="btn" onClick={close}>
            何も選ばない
          </button>
          <button className="btn primary" onClick={() => proposeEndings()} disabled={isProposingEndings}>
            <Icon name="sparkles" size={14} />{' '}
            {isProposingEndings ? '考え中…' : endingProposals ? '別の案を出す' : '提案してもらう'}
          </button>
        </>
      }
    >
      {goal && (
        <div className="field">
          <label>いま目指している結末</label>
          <div className="ending-goal">
            <strong>{goal.title}</strong>
            <p className="desc">{goal.outline}</p>
            <button className="link" onClick={() => setEndingGoal(null)}>
              目標を解除する
            </button>
          </div>
        </div>
      )}

      {!endingProposals && !isProposingEndings && (
        <p className="desc">
          ここまでの物語を読ませて、あり得る終わり方をいくつか考えてもらいます。
          選んだ案は「目指す結末」としてゆるい方向づけに使われるだけで、
          <strong>いつ終えるかを決めるのはあなたです</strong>。
        </p>
      )}

      {isProposingEndings && <p className="desc">ここまでの物語を読んでいます…</p>}

      {endingProposals?.map((p, i) => (
        <div key={i} className="field ending-proposal">
          <label>{p.title}</label>
          <p className="desc">{p.outline}</p>
          <div className="row">
            <button className="btn" onClick={() => setEndingGoal(p)}>
              <Icon name="flag" size={13} /> この結末を目指す
            </button>
            <button
              className="btn danger"
              onClick={async () => {
                onClose()
                await concludeStory(p)
              }}
              title="いまエピローグを書いて完結させます（分岐で戻せます）"
            >
              <Icon name="check" size={13} /> これで終える
            </button>
          </div>
        </div>
      ))}
    </ModalShell>
  )
}
