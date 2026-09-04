# pi-dashboard — wezterm の全 pi タブを Web で総合監視 + 集中管理センター

// @why: [2026-09-03] ユーザー要望「web で総合監視したい。全てのタブを。log の copy と通知」。
//   wezterm で並走する複数 pi の状態（稼働中／入力待ち／エラー）とログを、ブラウザ 1 画面でリアルタイムに
//   見て、入力待ちをブラウザ通知で知らせる。依存ゼロ（Node 標準 http + fetch のみ）・ローカル完結。
// @why: [2026-09-06] ユーザー要望「集中管理LLMと俺が会話し、LLMが各端末へ指示を送る（俺との会話の結果）」を実装。
//   下部の集中管理チャットでオーケストレーター LLM（OpenRouter）と会話し、応答 JSON の actions を
//   wezterm の各 pane へ send-text で投入して各 pi を作業させる。UI は 3 列・高さ控えめ・ライトフラット・点線枠。
// @tags: SPEC

## 何ができるか

- **全タブを 1 画面で監視**: 各 pi タブ＝1 カード（3 列・高さ控えめ）。状態ランプ（🔵稼働中 / 🟢入力待ち / 🔴エラー）＋ログ tail ＋💸累積コスト
- **ログのコピー**: 各タブの受信ログを `~/.pi/agent/dashboard/panes/<paneId>.jsonl` に永続化（pi 自身の session JSONL は触らない）
- **通知**: タブが「稼働中 → 入力待ち」に遷移したらブラウザ通知（`Notification` API がデスクトップ通知）
- **集中管理センター（下部チャット）**: 俺 ⇄ 集中管理 LLM が会話し、LLM の応答から抽出した指示（actions）を各タブへ自動送信（wezterm send-text）。会話履歴は `chat.jsonl` に永続化され、リロード後も継続
- **自律モード**: トグルを ON にすると、タブが作業を終えて待機（idle）になるたびに集中管理 LLM が「次にやるべきこと」を自動判断し、あれば指示を送る（暴走防止: デフォルト OFF・送信間隔 30 秒・タブごと 60 秒・連続 5 回上限・ユーザー指示でリセット）
- **作業タイトル**: タブが作業を終えると、直近ログから LLM が 20 字程度の作業タイトルを生成し、カードのトップに表示（元のタブ名はメタ行に）
- **集中管理ビュー**: チャットで「ターミナル見せて」「画像見せて」と言うと、AI が view 領域にターミナル内容（wezterm get-text）や画像ファイル（data URL）を一時表示
- **タブを開く**: ヘッダーの「＋ タブを開く」で新しい wezterm タブを開き、その中で pi を起動（cwd 指定可・既定は pi_root）。LLM も応答 JSON の `openTab` で自律的に開ける
- **コマンド実行**: チャットで「ls 実行して」等と言うと、LLM が応答 JSON の `command` でシェルコマンドを実行し、出力をチャットに表示（pi の非対話実行 `pi 'タスク'` も可）

## 構成

```
yume-kit/pi-dashboard/
├── server.mjs           監視＋集中管理サーバー（http + SSE、依存ゼロ）
├── public/index.html    ダッシュボード UI（3列カード＋下部集中管理チャット）
├── test/pi-dashboard.test.mjs   node --test E2E（16 件）
└── README.md            このファイル

pi 側拡張（global）:
  ~/.pi/agent/extensions/pi-watch.ts   ← 状態・ログをサーバーへ POST するクライアント
```

## 使い方

1. サーバーを起動:
   ```bash
   node yume-kit/pi-dashboard/server.mjs
   # → http://localhost:8787
   ```
   （ポート変更: `PI_DASHBOARD_PORT=9999`、保存先変更: `PI_DASHBOARD_DATA=/path`、拡張側の接続先変更: `PI_DASHBOARD_URL`）

2. ブラウザで `http://localhost:8787` を開く（初回に通知許可を求められる → 許可）

3. 監視したい各 pi で拡張を読み込む:
   - 起動済みの pi は `/reload`
   - 新規の pi は起動するだけで自動ロード

4. pi が何か応答を終えると、そのタブのカードが 🟢「入力待ち」になり、ブラウザ通知が届く

5. **集中管理センター（下部チャット）**: 入力欄に全体指示を書くと、オーケストレーター LLM が各タブへ振り分ける。
   例:「全タブの状況をまとめて」「B に調査を、C に実装を投げて」。会話から派生したタブ作業のログは各カードでリアルタイム表示

## API 契約

| 端点 | 役割 |
|---|---|
| `POST /ingest` | 拡張から状態・ログ受信。JSON: `{ paneId, kind: "register"\|"state"\|"log", state?, role?, text?, cost?, title?, cwd?, session? }` |
| `GET /state` | 全パネの現在状態（初回描画用） |
| `GET /events` | SSE（状態・ログ・チャットの差分をリアルタイム配信） |
| `POST /api/chat` | 集中管理チャット送信（JSON: `{ text }`）。受理後は非同期に LLM → actions 送信を実施し、過程は SSE（type:"chat"）で流す |
| `GET /api/chat/history` | 会話履歴（`chat.jsonl` の直近分） |
| `GET /api/autonomy` | 自律モードの状態（`{ enabled, lastSendAt, consecutive }`） |
| `POST /api/autonomy` | 自律モード切替（JSON: `{ enabled: bool }`） |
| `POST /api/tab` | 新しい wezterm タブで pi を起動（JSON: `{ cwd? }`。既定 cwd は `PI_DASHBOARD_TAB_CWD`、起動コマンドは `PI_DASHBOARD_TAB_COMMAND` で変更可） |
| `GET /` | ダッシュボード HTML |

- タブ識別キーは wezterm の `WEZTERM_PANE`（非 wezterm では pid フォールバック）
- サーバー未起動時の拡張の投稿失敗は無視される（監視は必須機能ではない）
- 集中管理 LLM: キーは `OPENROUTER_API_KEY`（なければ `~/.pi/agent/auth.json` の openrouter.key）、モデルは `PI_DASHBOARD_MODEL`（既定 `deepseek/deepseek-v4-flash-0731`）
- wezterm 送信: `WEZTERM_BIN`（既定 `/Applications/WezTerm.app/Contents/MacOS/wezterm`）で `cli send-text --pane-id <id> --no-paste` を実行

## テスト

```bash
node --test yume-kit/pi-dashboard/test/pi-dashboard.test.mjs
```

一時ディレクトリへ `PI_DASHBOARD_DATA` を差し替えて回すため、ホームの実データは汚れない。
集中管理チャットの 2 件は LLM 呼び出しと wezterm 送信を `__testOverrideLLM` でモックに差し替えて検証する（ネットワーク・実キー不要）。

## DO_NOT（方針）

- npm 依存・外部クラウド・CDN を使わない（すべて Node 標準 / 素の Web 標準）
- pi 本体に手を入れない（拡張 `pi-watch.ts` のみ）
- 既存の pi session JSONL を書き換えない（コピー先は `~/.pi/agent/dashboard/`）
- 認証・HTTP**S** は付けない（localhost のみ想定）
- 集中管理 LLM には busy（実行中）のタブへ送らせない（システムプロンプトで禁止）。LLM の振り分けは推奨であり、最終判断は人間