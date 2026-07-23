# 環境_ローカルツール_AI用

このマシン（Windows 11 / `C:\Users\<user>`）に**実際にインストール済み**で、AI エージェント（Claude Code 等）が CLI から使えるツールの一覧。`winget list` と PATH（Machine/User/Process）の突き合わせで作成。

- 作成日: 2026-07-23
- 更新方法: `winget list` を再実行し、本ファイルの表を作り直す（下記「棚卸しコマンド」参照）
- **バージョンは作成時点のもの**。挙動が怪しい時は `<tool> --version` で実物を確認する

---

## 最重要: PATH が古いシェルでは `rg` 等が「見つからない」

winget の各パッケージは **ユーザー PATH** に個別ディレクトリとして追加されている。一方、長時間起動しているエディタ／エージェントから起動されたシェルは **起動時点の PATH を引き継ぐ**ため、後から入れたツールが `Get-Command rg` で見つからないことがある（2026-07-23 時点の実測でまさにこの状態だった）。

対処は次のいずれか。

1. **フルパスで叩く**（最も確実。下表の「フルパス」列をそのまま使う）
2. セッション先頭で PATH を作り直す:

```bash
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
```

3. エディタ／ターミナルを再起動する（ユーザー操作が必要なので最後の手段）

なお `rg`（ripgrep）は Claude Code の Grep ツールが内部で使うため、**通常の検索は Grep / Glob ツールを使えばよく、素の `rg` を呼ぶ必要はほぼ無い**。

---

## PATH に載っていてそのまま呼べるもの

| コマンド | 用途 | 実体 |
| --- | --- | --- |
| `git` 2.55 | バージョン管理 | `C:\Program Files\Git\cmd\git.exe` |
| `node` 24.16 / `npm` / `npx` | 本プロジェクトのビルド・開発サーバ | `C:\Program Files\nodejs\` |
| `cargo` / `rustc` / `rustup` | Tauri（`src-tauri`）のビルド | `C:\Users\<user>\.cargo\bin\` |
| `python` / `py` | スクリプト（Python Install Manager 経由・3.12 と 3.14） | `...\WindowsApps\python.exe` |
| `dotnet` | .NET SDK 10 | `C:\Program Files\dotnet\dotnet.exe` |
| `java` | JDK 17 (Temurin) | `C:\Program Files\Eclipse Adoptium\jdk-17...\bin\java.exe` |
| `docker` | Docker Desktop CLI | `C:\Program Files\Docker\Docker\resources\bin\docker.exe` |
| `wsl` | Linux 環境（POSIX ツールが要る時の逃げ道） | `C:\WINDOWS\system32\wsl.exe` |
| `psql` | PostgreSQL 16 クライアント | `C:\Program Files\PostgreSQL\16\bin\psql.exe` |
| `sqlite3` | SQLite（`sqldiff` / `sqlite3_analyzer` も同梱） | `C:\ProgramData\chocolatey\bin\sqlite3.exe` |
| `ffmpeg` / `ffprobe` / `ffplay` | 動画・音声の変換／情報取得 | `C:\ProgramData\chocolatey\bin\` |
| `yt-dlp` | 動画取得 | `C:\ProgramData\chocolatey\bin\yt-dlp.exe` |
| `7z` | 圧縮・展開（zip/7z/rar 他） | `C:\ProgramData\chocolatey\bin\7z.exe` |
| `tar` / `curl` | 標準同梱（Windows 10+ 内蔵） | `C:\WINDOWS\system32\` |
| `restic` | バックアップ | `...\WinGet\Links\restic.exe` |
| `tailscale` | VPN | `C:\Program Files\Tailscale\tailscale.exe` |
| `code` | VS Code（`code -d a b` で差分表示など） | `C:\Program Files\Microsoft VS Code\bin\code.cmd` |
| `pwsh` 7.6 | PowerShell 7（このプロジェクトの既定シェル） | WindowsApps |
| `winget` | パッケージ管理 | WindowsApps |
| `claude` | Claude Code CLI | `C:\Users\<user>\.local\bin\claude.exe` |
| `opencode` | OpenCode CLI（npm グローバル） | `C:\Users\<user>\AppData\Roaming\npm\opencode.cmd` |

## インストール済みだがシェルによっては PATH に無いもの（フルパス推奨）

`$W = 'C:\Users\<user>\AppData\Local\Microsoft\WinGet\Packages'` として、

| コマンド | 用途 | フルパス（`$W` からの相対） |
| --- | --- | --- |
| `rg` 15.2.0 | 高速検索（PCRE2 有効）。※通常は Grep ツールで足りる | `BurntSushi.ripgrep.MSVC_*\ripgrep-15.2.0-x86_64-pc-windows-msvc\rg.exe` |
| `fd` 10.4.2 | 高速ファイル検索。※通常は Glob ツールで足りる | `sharkdp.fd_*\fd-v10.4.2-x86_64-pc-windows-msvc\fd.exe` |
| `jq` 1.8.2 | JSON 整形・抽出（API レスポンス、`package.json`、カード JSON の検査に有用） | `jqlang.jq_*\jq.exe` |
| `yq` 4.53.3 | YAML/JSON 変換 | `MikeFarah.yq_*\yq.exe` |
| `ast-grep` 0.44.1 | **構文木ベースの検索・置換**。TS/TSX の機械的リファクタで正規表現より安全 | `ast-grep.ast-grep_*\ast-grep.exe` |
| `typos` 1.44.0 | スペルミス検出（コード・ドキュメント） | `Crate-CI.Typos_*\typos.exe` |
| `gitleaks` 8.30.1 | 秘密情報（APIキー等）の混入検査。**コミット前チェックに有用** | `Gitleaks.Gitleaks_*\gitleaks.exe` |
| `delta` 0.19.2 | `git diff` の見やすい表示 | `dandavison.delta_*\delta-0.19.2-x86_64-pc-windows-msvc\delta.exe` |
| `uv` 0.11.30 | Python の高速パッケージ／仮想環境管理。`uv run` で使い捨てスクリプト実行 | `astral-sh.uv_*\uv.exe` |
| `just` 1.57.0 | タスクランナー（`justfile`）。※本プロジェクトは npm scripts 運用なので未使用 | `Casey.Just_*\just.exe` |
| `hexyl` 0.17.0 | バイナリの16進ダンプ。**PNG カードの tEXt チャンク調査**に使える | `sharkdp.hexyl_*\hexyl-v0.17.0-x86_64-pc-windows-msvc\hexyl.exe` |
| `bat` / `eza` / `fzf` / `zoxide` | 対話向けの表示・移動系。**エージェントからは使わない**（人間用） | 各 `sharkdp.bat_*` 等 |
| Sysinternals Suite | `handle` / `procexp` / `pslist` 等。ファイルロック調査（Tauri ビルド失敗時など） | `Microsoft.Sysinternals.Suite_*\` |
| `gh` 2.96.0 | GitHub CLI（PR・Issue 操作） | `C:\Program Files\GitHub CLI\gh.exe` ※winget 配下ではない |

## このプロジェクトで実際に出番があるもの

- **必須**: `npm`（`npm run dev` / `npm run build` / `npx tsc --noEmit`）、`git`、`cargo`（Tauri を触る時のみ）
- **有用**: `gh`（PR）、`gitleaks`（キー混入チェック）、`ast-grep`（TSX の一括リファクタ）、`hexyl`（PNG カードのチャンク検証）、`jq`（バンドル JSON の検査）
- **人間用・エージェントは非推奨**: `fzf` / `bat` / `eza` / `zoxide`（対話 UI 前提で出力がパイプに向かない）

## GUI アプリ（CLI からは基本触らない）

参考まで。Docker Desktop / VirtualBox / VS Code / Visual Studio Community 2026 / VS Build Tools 2022（Rust の C++ リンカに必須）/ Windows SDK / GIMP / Kdenlive / Obsidian / PowerToys / SourceTree / GitHub Desktop / Tera Term / Bitwarden など。

**注意**: Visual Studio Build Tools 2022 と Windows SDK は Tauri ビルドの前提。削除すると `npm run tauri:build` が壊れる（`docs/設計_Tauri化.md`）。

---

## 棚卸しコマンド

```bash
winget list --disable-interactivity | Out-String -Width 300
```

PATH 上の解決状況を確認するには:

```bash
'rg','fd','jq','yq','ast-grep','gh','gitleaks','uv','node','cargo' | ForEach-Object { '{0}`t{1}' -f $_, ((Get-Command $_ -EA SilentlyContinue).Source ?? '-') }
```

## 未インストール（必要になったら `winget install`）

`pnpm` / `ImageMagick`（`magick`）/ `pandoc` / `ripgrep-all` / `hyperfine`。画像処理は現状 ImageMagick 無しなので、リサイズ等は `ffmpeg` かブラウザ側（`avatarGen.ts` の canvas）で行う。
