# 環境_ローカルツール_AI用

このマシン（Windows 11 / `C:\Users\<user>`）で CLI から使えるコマンドの一覧。`winget list` と `choco list` および PATH の突き合わせで作成（2026-07-23 時点）。

## 言語・ランタイム・ビルド
| コマンド | 内容 |
| --- | --- |
| `node` / `npm` / `npx` | Node.js 24.16 LTS |
| `python` / `py` | Python 3.14・3.12（Python Install Manager 経由） |
| `uv` | Python パッケージ／仮想環境管理・`uv run` |
| `cargo` / `rustc` / `rustup` | Rust（Tauri ビルド用） |
| `dotnet` | .NET SDK 10 |
| `java` | JDK 17 (Temurin) |
| `gcc` / `g++` / `gdb` / `mingw32-make` / `ar` / `ld` | MinGW-w64 15.2 |
| `wsl` | Linux 環境 |

## Git・コード
| コマンド | 内容 |
| --- | --- |
| `git` | 2.55 |
| `gh` | GitHub CLI 2.96（PR・Issue 操作） |
| `delta` | `git diff` の色付き表示 |
| `rg` | ripgrep 15.2（PCRE2 有効） |
| `fd` | ファイル検索 |
| `ast-grep` | 構文木ベースの検索・置換 |
| `typos` | スペルミス検出 |
| `gitleaks` | 秘密情報の混入検査 |
| `just` | タスクランナー（`justfile`） |

## データ・ファイル
| コマンド | 内容 |
| --- | --- |
| `jq` | JSON 整形・抽出 |
| `yq` | YAML/JSON 変換 |
| `sqlite3` / `sqldiff` / `sqlite3_analyzer` / `sqlite3_rsync` | SQLite 3.53 |
| `psql` | PostgreSQL 16 クライアント |
| `hexyl` | 16進ダンプ（PNG の tEXt チャンク調査など） |
| `7z` | 圧縮・展開 |
| `tar` / `curl` | Windows 内蔵 |
| `restic` | バックアップ |

## メディア
| コマンド | 内容 |
| --- | --- |
| `ffmpeg` / `ffprobe` / `ffplay` | 8.1.1 |
| `yt-dlp` | 動画取得 |

## その他
| コマンド | 内容 |
| --- | --- |
| `pwsh` | PowerShell 7.6（既定シェル） |
| `docker` | Docker Desktop CLI |
| `tailscale` | VPN |
| `code` | VS Code（`code -d a b` で差分） |
| `winget` / `choco` | パッケージ管理 |
| `claude` / `opencode` | AI コーディング CLI |
| Sysinternals Suite | `handle` / `procexp` / `pslist` 等（ファイルロック調査） |

## 対話用（エージェントからは非推奨）
`fzf` / `bat` / `eza` / `zoxide` — 対話 UI 前提で出力がパイプに向かない。

## 未インストール
`magick`（ImageMagick）— chocolatey の `lib\imagemagick.app` に `.chocolateyPending` が残ったままで実体（`magick.exe`）が存在しない＝**インストール未完了**。画像処理は `ffmpeg` かブラウザ側 canvas（`src/lib/avatarGen.ts`）で行う。

`pnpm` / `pandoc` / `hyperfine` も未インストール。
