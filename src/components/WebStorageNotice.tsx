import { storeActions } from '../store'
import ModalShell from './ModalShell'
import HelpDetails from './HelpDetails'

/**
 * ブラウザ版の保存先の案内（P5）。**初回に1回だけ**出す（`storageNoticeSeen`）。
 * デスクトップ版では出さない（保存先がファイルなので `%APPDATA%` の説明が README にある）。
 *
 * 言いたいことは3つだけ: どこにあるか／どうすると消えるか／どう持ち出すか。
 */
export default function WebStorageNotice({ onClose }: { onClose: () => void }) {
  const { markStorageNoticeSeen } = storeActions()

  const close = () => {
    markStorageNoticeSeen()
    onClose()
  }

  return (
    <ModalShell
      title="データの保存先について"
      onClose={close}
      footer={
        <button className="btn primary" onClick={close}>
          わかりました
        </button>
      }
    >
      <p className="desc" style={{ marginTop: 0 }}>
        物語・キャラクター・世界観・画像は、<strong>このブラウザでのみ保存されます</strong>
        （生成のリクエストは、選択された提供元へ直接送られます）。
      </p>
      <p className="desc">
        Cookie とサイトデータを削除するなどの操作によって失われます。時々書き出して手元に置いてください
        （設定 &gt; データ入出力 &gt;「全データをエクスポート」）。
      </p>
      <HelpDetails summary="消える条件・引き継げない条件">
        <ul>
          <li>ブラウザの「閲覧データの削除」で<strong>Cookie とサイトデータ</strong>を消したとき</li>
          <li>プライベートウィンドウ（シークレット）で開いたとき。窓を閉じると残りません</li>
          <li>端末の空き容量が足りなくなったとき。ブラウザが古いサイトのデータから削ることがあります</li>
          <li>
            <strong>別のブラウザ・別の端末では見えません。</strong>同じ端末でも、アドレスが変わると
            （別のドメインやパスへ移した場合）別のデータとして扱われます
          </li>
        </ul>
        <p>
          持ち出し・引き継ぎは書き出したファイル（JSON バンドル）で行います。同じ画面から取り込めます。
          デスクトップ版は保存先がファイルなので、これらの条件はありません。
        </p>
      </HelpDetails>
    </ModalShell>
  )
}
