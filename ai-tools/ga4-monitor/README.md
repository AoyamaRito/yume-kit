# ga4-monitor — GA4 データ状態の自前継続監視

GA4 のデータ鮮度・ボリューム異常・(任意で)受信経路の死活を、**自前の Node スクリプト**で定期監視して Slack/コンソールに通知する。**依存ゼロ**(Node 組み込みのみ)。Google 公式 API を使うので、サービス停止の公式ステータスに依存しない「自社データ」視点の監視。

> 注意: GA4「サービス自体の稼働」は公式 API が乏しく自前では限界。本ツールは「自社プロパティにデータが流れてるか・鮮度・異常」を監視する。

## やること

| チェック | 手段 | 判定 |
|---|---|---|
| データ鮮度 | Data API `dateHourMinute` の最新行 | lag > `MAX_LAG_MIN` 分で警告 |
| ボリューム異常 | 直近3h の `eventCount` を前日同時刻と比較 | 前日比 < `DROP_THRESHOLD_PCT` % で警告 |
| 受信経路(任意) | MP v2 で `monitor_ping` を送信 → Data API で到達確認 | `PING_TIMEOUT_MIN` 分以上届かないと警告 |

## セットアップ

### 1. GCP 側 (読み取り用サービスアカウント)
1. [Google Cloud Console](https://console.cloud.google.com) でプロジェクトを作成/選択。
2. 左メニュー「API とサービス」>「ライブラリ」で **Analytics Data API** を有効化。
3. 「IAM と管理」>「サービス アカウント」で作成 → 「キー」タブで **JSON をダウンロード** → パスを `GA4_CREDENTIALS_FILE` に。
4. GA4 管理画面 >「プロパティ」>「プロパティのアクセス管理」で、上記サービスアカウントのメールを追加、役割を **閲覧者** に。

### 2. 設定ファイル
```bash
cd ai-tools/ga4-monitor
cp .env.example .env
# 編集して埋める
```

### 3. (任意) MP テストヒット用 API シークレット
GA4 管理 >「データストリーム」> 対象ストリーム >「Measurement Protocol API secrets」で作成 → `MP_API_SECRET` に。`MP_MEASUREMENT_ID` は `G-XXXXXXXX`。

### 4. 実行テスト
```bash
node ga4-monitor.mjs --verbose     # チェック
node ga4-monitor.mjs --ping        # テストヒット送信
```

## cron での定期実行
```cron
# 5分ごとに監視
*/5 * * * * cd /Users/AoyamaRito/grok_build/ai-tools/ga4-monitor && /usr/bin/env node ga4-monitor.mjs >> monitor.log 2>&1
# 1日1回 ping 送信 (受信経路の死活確認)
17 3 * * * cd /Users/AoyamaRito/grok_build/ai-tools/ga4-monitor && /usr/bin/env node ga4-monitor.mjs --ping >> monitor.log 2>&1
```
異常時は exit code 1 になるので、cron ラッパや監視基盤に繋げば検知できる。

## アラート重複について
毎 cron 実行で状態が悪化していれば都度通知する。Slack の重複通知を抑えたい場合は、`state.json` を使った状態保持を拡張するか、Slack 側の Webhook で抑制する。

## 注意点
- **鮮度**: 標準 Data API のデータは通常数分遅延する。`MAX_LAG_MIN` のデフォルト 15 はその前提。リアルタイム厳密性が必要なら Realtime API を併用する。
- **タイムゾーン**: `dateHour`/`dateHourMinute` はプロパティのタイムゾーン。`GA4_TZ_OFFSET_HOURS` を正しく設定しないと比較がズレる。
- **ボリューム異常のbaseline**: 前日同時刻が 0 の場合は比較不能としてスキップ(低トラフィック誤報回避)。
- **MP ping**: 新規 `client_id` の初回イベントは集計まで時間がかかる場合がある。初回は `state.json` の `clientId` を維持して連続利用する(スクリプトが自動で再利用)。