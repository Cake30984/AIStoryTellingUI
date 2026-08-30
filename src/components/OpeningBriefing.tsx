import type { Session } from '../types'
import { useStore } from '../store'
import { Icon } from './icons'

interface Props {
  session: Session
}

/**
 * 開始ブリーフィング（CG3。docs/設計_登場条件と目標提示.md §3）。
 * 導入文の直後に1枚だけ出す「この物語について」のカード。
 *
 * **中身は既存データの組み立てで、作者に新しい記入欄を課さない**（＝準備ゼロ。既存カセットにも効く）。
 * 材料はもともと全部あって、既定で閉じているドックの中にしか出ていなかった。
 *
 * ネタバレ方針は作者が `hidden` で宣言済みなので、それをそのまま尊重する
 * （`hidden` の結末・実績は件数だけ出し、名前も説明も出さない）。
 * 出せる材料が何も無ければ**何も描かない**（情報の無いカードを出さない）。
 */
export default function OpeningBriefing({ session }: Props) {
  const { worlds } = useStore()
  const world = worlds.find((w) => w.id === session.worldId)

  const endings = world?.endings ?? []
  const openEndings = endings.filter((e) => !e.hidden && (e.name.trim() || e.description.trim()))
  const hiddenEndings = endings.length - openEndings.length

  const achievements = world?.achievements ?? []
  const openAchievements = achievements.filter((a) => !a.hidden)

  const tl = session.timeline
  const span = tl.enabled ? [tl.spanLabel.trim(), tl.totalDays ? `全${tl.totalDays}日` : ''].filter(Boolean) : []

  // 「何を目指す物語か」を1つも言えないなら出さない
  if (endings.length === 0 && achievements.length === 0 && span.length === 0) return null

  return (
    <div className="briefing">
      <div className="briefing-head">
        <Icon name="flag" size={13} className="label-icon" />
        この物語について
      </div>

      {span.length > 0 && <div className="briefing-span">{span.join('・')}</div>}

      {openEndings.length > 0 && (
        <div className="briefing-block">
          <div className="briefing-label">たどりつける結末</div>
          {openEndings.map((e) => (
            <div key={e.id} className="briefing-item">
              <span className="briefing-item-name">{e.name || '無名'}</span>
              {e.description.trim() && <span className="briefing-item-desc">{e.description.trim()}</span>}
            </div>
          ))}
        </div>
      )}

      {(hiddenEndings > 0 || achievements.length > 0) && (
        <div className="briefing-block">
          {hiddenEndings > 0 && (
            <div className="briefing-note">
              ほかに、まだ明かされていない結末が {hiddenEndings} 件あります。
            </div>
          )}
          {achievements.length > 0 && (
            <div className="briefing-note">
              道中の出来事は実績として {achievements.length} 件記録されます
              {openAchievements.length < achievements.length &&
                `（うち ${achievements.length - openAchievements.length} 件は伏せられています）`}
              。
            </div>
          )}
        </div>
      )}

      <div className="briefing-how">
        {session.choiceMode === 'off'
          ? '下の入力欄に、主人公として言うこと・することを書いて進めます。'
          : '下の入力欄に主人公として書くか、提示される選択肢を選んで進めます。'}
        結末・実績・関係は右の「状態」パネルでいつでも確認できます。
      </div>
    </div>
  )
}
