---
name: ctxlog
description: "タグ付きコンテキストログ。セッションの要約・決定・進捗を1行=1エントリのJSONLに蓄積し、セッションID/プロジェクト/kind/タグで横断検索できる依存ゼロCLI。フェーズの節目・チェックポイントで ctxlog write を打ち、新セッションは ctxlog ls + タグ検索で文脈を引き継ぐ。"
---

# ctxlog — タグ付きコンテキストログ（圧縮コンテキストの外部メモリ兼 検索基盤）

pi セッションの要約・決定・進捗を 1 行=1 エントリの JSONL に蓄積し、
**セッションID / プロジェクト / kind / タグ**で横断検索できる依存ゼロ CLI。

## このスキルの使い所（運用規約）

- **新セッション引き継ぎ**: 節目（フェーズ完了・チェックポイント）で `ctxlog write` を打ち、
  新セッションは過去ログ全文を読まず、`ctxlog ls`（最新 N 件）＋必要なタグ検索だけで文脈を掴む。
  （pi がセッション全文を自動で読むのは仕様なので「読まない」はできないが、**読む内容を要約に置き換えられる**）
- **検索**: 「あのとき UI の決定どうした？」→ `ctxlog search --tags ui,decision`。
- **セッション別**: `ctxlog get --session <id>` でそのセッションの記録だけ抽出。

## コマンド

```bash
ctxlog write "<title>" \
  --summary "要約" \
  --session <session-id> \
  --project pi-root \
  --kind decision|task|research|ui|code|bugfix|note \
  --tags tag1,tag2

ctxlog ls [--limit N] [--json]
ctxlog search [query] [--session <id>] [--project <name>] [--kind a,b] [--tags a,b] [--limit N] [--json]
ctxlog get --session <session-id> [--json]
```

- `--tags a,b` は **AND**（全部含む）、`--kind a,b` は **OR**。
- `--session` は **前方一致**（ID の先頭数文字でも引ける）。
- `--json` は AI が読むための機械可読出力（配列）。人間向けは色付きテキスト。
- 既定保存先: 実行ディレクトリの `.pi/ctxlog.jsonl`。`--file` か環境変数 `CTXLOG_FILE` で変更可。

## kind の推奨値

| kind | 意味 |
|---|---|
| `decision` | 決定・合意事項（未来の判断の根拠） |
| `task` | タスク・実装記録 |
| `research` | 調査の結論 |
| `ui` | UI 関連 |
| `code` | コード変更 |
| `bugfix` | バグ修正 |
| `note` | その他のメモ |

タグは自由語（プロジェクト名、技術、フェーズなど）。AI が文脈から付ける（ヒューマンは追記可）。

## 背景

pi のセッション履歴は全文がコンテキストに入って重く、タグ検索ができない。
`ctxlog` は「過去を読む量を減らし、読むべきものを一意に引ける」ための外部ログ。
セッションの坊目（作業完了・話題転換・フェーズ切替）で AI が自律的に `ctxlog write` して蓄積する。

## テスト

```bash
node --test test/ctxlog.test.mjs
```