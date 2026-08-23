; NSIS インストーラ／アンインストーラのフック（tauri.conf.json の bundle.windows.nsis.installerHooks で読み込む）
;
; **アンインストール時に OS の資格情報ストアから API キーを消す。**
; R3 でキーを state.json から資格情報マネージャーへ移した副作用として、アプリを消しても
; `data` フォルダを消してもキーだけが残る状態になっていた（2026-08-23 に T4 の検証で発覚）。
; 「アンインストールで余計なものが残るのは好ましくない」というユーザー判断により削除する。
; OpenRouter は OAuth（R4）で入れ直せるので、再設定の負担は小さいという整理。
;
; **アプリデータ（物語本文・画像）は対象外。** Tauri の既定のチェックボックス
; （`$DeleteAppDataCheckboxState`・既定オフ）に任せる。書いた物語を既定で消すのは筋が悪い。
; キーだけを常に消すのは、①秘密情報が残る方が害が大きい ②再取得が安い、の2点による。
;
; 更新（`$UpdateMode = 1`）のときは消さない。更新のたびに再認証させられるのは事故なので。

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DetailPrint "資格情報ストアから API キーを削除しています..."
    ; cmdkey の一覧から `LegacyGeneric:target=<id>.com.tokatokage.delist` を抜いて消す。
    ; ラベル（"Target:"）は環境によって訳語が変わりうるので、ラベルではなく
    ; ターゲット名そのものを正規表現で拾う。接続先の id は動的（provider:<uuid> 等）なので
    ; 静的に列挙できず、前の版が残した孤児エントリもここで一緒に片付く。
    ;
    ; **NSIS の文字列は ` で囲むこと。** ' で囲むと PowerShell 側の ' と衝突して
    ; 最初の ' で文字列が打ち切られ、コマンドが壊れたまま黙って何もしない
    ; （2026-08-23 に実際に踏んだ。アンインストールしてもキーが残った）。
    ; PowerShell の $ は NSIS で $$ と書く（$_ をそのまま書くと「不明な変数」警告が出て、
    ; 未定義の挙動〔今は素通し〕に依存することになる）。部分式 $( ) は NSIS が言語文字列として
    ; 解釈するため PowerShell 側で使わないこと。
    nsExec::ExecToLog `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "cmdkey /list | Select-String 'LegacyGeneric:target=[^\s]+com\.tokatokage\.delist' -AllMatches | ForEach-Object { $$_.Matches } | ForEach-Object { $$t = $$_.Value; cmdkey /delete:$$t | Out-Null }"`
    Pop $0
    DetailPrint "資格情報の削除: 終了コード $0"

    ; アンインストーラ自身が $INSTDIR に残ることがあるので念のため片付ける
    ; （実行中は消せないため、消せなければ再起動時に消す予約を入れる）
    Delete /REBOOTOK "$INSTDIR\uninstall.exe"
    RMDir /REBOOTOK "$INSTDIR"
  ${EndIf}
!macroend
