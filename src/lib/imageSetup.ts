/**
 * 画像生成の初回セットアップ案内を「今はしない」で断ったかどうか。
 *
 * **永続化しない**（アプリを起動している間だけ）。挿絵は任意機能なので、断った人には
 * その場で黙って引き下がるが、次に立ち上げたときは機会を1度だけ作り直す
 * （docs/設計_画像生成の簡易化.md §7.1）。
 *
 * store に置かないのは、これが「今この画面で案内を出すか」だけの一時状態で、
 * エクスポート・セッション・チェックポイントのどれとも関係しないため。
 */
let dismissed = false

export function isImageSetupDismissed(): boolean {
  return dismissed
}

export function dismissImageSetup(): void {
  dismissed = true
}
