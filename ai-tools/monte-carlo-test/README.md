# monte-carlo-test — DOM ランダム探索テスト（モンテカルロ法）

// @why: [2026-09-04→09-04] LLM（特に低性能なモデル）の品質に依存せず、テスト工程を機械化するため yume-kit/ai-tools に導入。実ブラウザ(playwright-core)で DOM をランダム操作し、パターン抽出→意図生成→コマンド実行で壊れ(遮蔽・連続エラー・暴走・インジェクション)を機械的に探索する。ui-graph（静的UI検証）と役割分担し、yume-kit の UI 品質保証を「静的＋動的ランダム」の2本柱にする。playwright は ui-graph と同様に任意依存（webqa の node_modules を symlink 共有）。コア（yume-min）のゼロ依存は不変。
// @tags: SPEC, monte-carlo, test, optional, ai-tools

**フロー**: ランダム操作 → パターン抽出 → 意図（シナリオ）生成 → コマンド実行（再生）

## ui-graph との役割分担

| ツール | 検出 | 性格 |
|---|---|---|
| `ui-graph` | レイアウト破綻・遮蔽・A11y | **静的**（DOM 俯瞰・read-only） |
| `monte-carlo-test` | 遮蔽実測・連続エラー・操作暴走・インジェクション | **動的**（ランダム操作・能動的） |

両方で「静的＋動的」の2軸をカバーする。

## 使い方

```bash
# 前提: chromium（実行ブラウザ）。playwright-core は webqa の node_modules を symlink 共有。

# 静的俯瞰（playwright 不要）
node fuzz.mjs extract <file.html>

# 意図（シナリオJSON）を決定的乱数で生成
node fuzz.mjs scenario <file.html> --seed 42 --steps 20

# 意図をコマンド実行（座標マウスで再生）
node fuzz.mjs replay <scenario.json>

# 生成+再生を統合し合否判定（緑ゲート・CI 用）
node fuzz.mjs scan   <file.html> --seed 42          # 既定: error/occlusion のみ
node fuzz.mjs scan   <file.html> --seed 42 --strict # loop/stale も検出
```

## 操作種別（5種をランダムに織りまぜる）

| アクション | 内容 | 得意な検出 |
|---|---|---|
| `click` | 座標マウス→クリック | **遮蔽**（透明オーバーレイ）・ホバー依存UI |
| `type` | テキスト入力（ランダム文字列） | バリデーション・XSS/インジェクション |
| `change` | checkbox/radio/select/range 変更 | change イベント未発火・状態反映漏れ |
| `drag` | ドラッグ＆ドロップ（DragEvent 実測） | ドロップ不達・drag イベント未発火 |
| `Enter` | キー押下 | フォーム送信・既定動作 |

## 検出種別

| kind | 内容 | 既定 |
|---|---|---|
| `error` | console.error / pageerror / requestfailed | ✓ |
| `occlusion` | 座標最前面が対象と別要素（透明オーバーレイ遮蔽） | ✓ |
| `loop` | 同一 DOM 状態へのリピート（潜在的暴走） | --strict |
| `stale` | 操作しても状態が変化しない（イベント未接続） | --strict |

## なぜ座標マウスクリックか

`locator().click()` は Playwright が前面要素へ自動補正するため、透明オーバーレイで
ボタンが塞がっていても押してしまい「遮蔽バグ」に気づけない。
座標マウス（`page.mouse.move→click`）は実ユーザー同様、**塞がっていたら押せない**ので
遮蔽・ホバー依存 UI を実体として検出できる。

## 決定性

同一 `--seed` からは常に同一操作列 + 同一文字列（mulberry32 疑似乱数）。
「同じ入力を同じ手順で再生」できるため、検出結果の再現が可能。

## ブラウザ解決（ui-graph と互換）

- `UI_GRAPH_CHROME` 環境変数（最優先）→ `YHM_CHROME`（yume-hyper-min 互換）→ ms-playwright キャッシュ再帰探索 → OS 標準 chromium
- ui-graph と同じ解決ポリシーを共有し、二重実装の乖離を避ける。

## 位置づけ

playwright-core は任意依存。`node_modules -> ../webqa/node_modules`（ui-graph と同じ symlink 共有）。
**yume-min コアのゼロ依存は不変**。教育版（yume-hyper-min）の skills/ にも同ファイルが同梱される。

## 同期方針

本体（yume-hyper-min）の `skills/monte-carlo-test/fuzz.mjs` とこの場所は**内容同一**（配布物と AI 運用ツールの一体運用）。
fuzz.mjs を更新したら、両方に反映すること（`cp` で同期。配布 zip には node_modules を含めない）。
