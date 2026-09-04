# pi-dashboard — 並走 pi の Web 総合監視・集中管理

wezterm で並走する複数 pi の状態（稼働中／入力待ち／エラー）とログを、ブラウザ 1 画面でリアルタイムに監視する。依存ゼロ（Node 標準 http + fetch のみ）・ローカル完結。

## 何ができるか

- **全タブを 1 画面で監視**: 各 pi タブ＝1 カード。状態ランプ（🔵稼働中 / 🟢入力待ち / 🔴エラー）＋ログ tail ＋累積コスト
- **ログのコピー**: 各タブの受信ログを JSONL に永続化（pi 自身の session JSONL は触らない）
- **通知**: タブが「稼働中 → 入力待ち」に遷移したらブラウザ通知
- **集中管理センター**: ユーザー ⇄ 集中管理 LLM が会話し、応答 JSON の actions を各タブへ自動送信（wezterm send-text）
- **自律モード**: タブが待機になるたびに集中管理 LLM が「次にやるべきこと」を自動判断して指示を送る（暴走防止: デフォルト OFF・送信間隔 30 秒・タブごと 60 秒・連続 5 回上限）

## 使い方

```bash
node yume-kit/pi-dashboard/server.mjs   # → localhost:8787
```

pi 側拡張（global）: `~/.pi/agent/extensions/pi-watch.ts` が状態・ログをサーバーへ POST する。