# AI_GUIDE.md — asset-gen / char-gen 運用マニュアル（AI向け）

// @why: [2026-08-29] AIエージェントがこのツールを最小の推論コストで使いこなすためのクイックリファレンス。
// @why: CLI から import まで、AIが「探さずに済む」ように1ファイルに集約。
// @tags: SPEC

## マインドモデル（3秒で把握）

```
[プロンプト] + [プリセット] + [参照画像(任意)] → fal.ai API → [画像 + サイドカーJSON]
```

- **asset-gen.mjs**: 単発生成。CLIでもimportでもOK。
- **char-gen.mjs**: キャラクター制作パイプライン。設定ファイル→一括生成→HTMLビューア。
- **presets.mjs**: プリセット定義・表情辞書・ポーズ辞書。importして使う。

## 即時発見コマンド（AIが最初に叩く）

```bash
# 何ができる？
node yume-kit/ai-tools/asset-gen/asset-gen.mjs --help

# 全プリセット一覧（コンパクト出力）
node yume-kit/ai-tools/asset-gen/asset-gen.mjs --list-presets

# 全表情キー（コンマ区切り）
node yume-kit/ai-tools/asset-gen/asset-gen.mjs --list-expressions

# 全ポーズキー（コンマ区切り）
node yume-kit/ai-tools/asset-gen/asset-gen.mjs --list-poses
```

## プログラムからの利用（推奨：AIはimportして使う）

```js
import { generateAsset, buildRequestPayload, fileToDataUrl } from './yume-kit/ai-tools/asset-gen/asset-gen.mjs';
import { generateCharacterPack, createCharacterTemplate, generateViewerHtml } from './yume-kit/ai-tools/asset-gen/char-gen.mjs';
import { PRESETS, EXPRESSIONS, POSES, MODEL_ALIASES } from './yume-kit/ai-tools/asset-gen/presets.mjs';
```

### 単発生成パターン

```js
// 基本: アイテムアイコン (SVG)
const res = await generateAsset({
  prompt: 'golden key',
  preset: 'vector-icon',
  out: './assets/key.svg',
});
// → res.results[0].filePath, res.results[0].metaPath

// キャラ基準立ち絵
const res = await generateAsset({
  prompt: 'silver haired paladin girl',
  preset: 'char-base',
  out: './assets/hero.png',
});

// 表情差分（基準画像参照 → 同一性保持）
const res = await generateAsset({
  prompt: 'silver haired paladin girl',
  preset: 'char-expression',
  expression: 'happy',   // ← 日本語可: '笑顔'
  charRef: './assets/hero.png',  // ← 基準画像を参照
  out: './assets/hero_happy.png',
});

// ポーズ差分
const res = await generateAsset({
  prompt: 'silver haired paladin girl',
  preset: 'char-pose',
  pose: 'attack',        // ← 日本語可: '攻撃'
  charRef: './assets/hero.png',
  out: './assets/hero_attack.png',
});

// ドット絵化
const res = await generateAsset({
  prompt: 'silver haired paladin girl',
  preset: 'char-pixel',
  charRef: './assets/hero.png',
  out: './assets/hero_pixel.png',
});

// 攻撃前確認（APIコストなし）
const dry = await generateAsset({
  prompt: 'test',
  preset: 'char-base',
  dryRun: true,
});
// → dry.model, dry.body, dry.fullPrompt を確認
```

### キャラクターパック一括生成パターン

```js
// 設定テンプレート作成
const char = createCharacterTemplate('elena', 'silver hair paladin with emerald eyes');

// 一括生成: 基準立ち絵 + 表情8種 + ポーズ6種 + ドット絵 + ちびキャラ
const pack = await generateCharacterPack({
  charConfig: char,
  outDir: './generated-characters',
  packs: ['base', 'expressions', 'poses', 'pixel', 'chibi'],
  seed: 42,
  dryRun: false,  // true でAPI呼ばずに確認
});

// pack.viewerPath → HTMLビューアをブラウザで開く
// pack.assets[].filePath → 各生成ファイル
// pack.configPath → character.json 保存先
```

## プリセット早見表（最高峰モデル標準採用）

| プリセット | 用途 | 採用モデル (最高峰) | 出力形式 |
|---|---|---|---|
| `flagship-art` | **最上位超高精細2Dアート** | **Flux 1.1 Pro Ultra** | PNG(16:9/2K) |
| `pro-anime` | **最先端プロイラスト・KV** | **Flux 1.1 Pro** | PNG |
| `background` | **最高峰2D背景・風景** | **Flux 1.1 Pro** | PNG(16:9) |
| `vector-icon` | **ベクターSVGアイコン** | **Recraft v3** (世界最高峰) | **SVG** |
| `game-item` | RPGアイテム・装備 | **Recraft v3** | PNG |
| `anime-char` | アニメ立ち絵 | **Recraft v3** | PNG |
| `char-base` | **キャラ基準立ち絵** | **Recraft v3** | PNG |
| `char-expression` | **表情差分** (同一性保持) | **Recraft v3** | PNG |
| `char-pose` | **ポーズ差分** (同一性保持) | **Recraft v3** | PNG |
| `char-pixel` | **16/32bitドット絵** (同一性保持) | **Flux Dev** (28 steps) | PNG |
| `char-chibi` | **SDちびキャラ** (同一性保持) | **Recraft v3** | PNG |
| `style-consistent` | **絵柄保持アセット** | **Recraft v3** | PNG |
| `pixel-art` | レトロドット絵 | **Flux Dev** (28 steps) | PNG |
| `texture` | シームレスタイル | **Flux Dev** (28 steps) | PNG |
| `chibi` | SDちびキャラ | **Recraft v3** | PNG |
| `monster` | 敵モンスター | **Recraft v3** | PNG |
| `ui-frame` | UI装飾枠・ボタン | **Recraft v3** | **SVG** |
| `raw` | 直渡し生成 | **Flux Dev** (28 steps) | PNG |

## モデルエイリアス（最上位順）

```js
'ultra' / 'pro-ultra' → 'fal-ai/flux-pro/v1.1-ultra'  // 2K超高解像度フラグシップ
'pro' / 'flux-pro'    → 'fal-ai/flux-pro/v1.1'        // 最先端プロ仕様
'recraft' / 'v3'      → 'fal-ai/recraft-v3'           // ベクター & 2Dイラスト世界最高峰
'dev' / 'flux'        → 'fal-ai/flux/dev'             // 28ステップ高精細
'ideogram'            → 'fal-ai/ideogram/v2'          // 文字・タイポグラフィ最高峰
'clarity' / 'upscale' → 'fal-ai/clarity-upscaler'     // 2x/4x 超解像・高精細化
'schnell'             → 'fal-ai/flux/schnell'         // 高速テスト用(4 steps)
```

```
neutral, happy, angry, sad, surprised, serious, blushing, smug, wink, crying, shouting
通常, 笑顔, 怒り, 悲しみ, 驚き, 真剣, 照れ, ドヤ顔, ウインク, 泣き, 叫び
```

## ポーズキー（日本語エイリアスあり）

```
idle, attack, defense, casting, victory, hurt, jump, sit
待機, 攻撃, 防御, 詠唱, 勝利, 被弾, ジャンプ, 座り
```

## モデルエイリアス

```js
'recraft'    → 'fal-ai/recraft-v3'
'flux'       → 'fal-ai/flux/schnell'
'dev'        → 'fal-ai/flux/dev'
'ideogram'   → 'fal-ai/ideogram/v2'
```

## エラー自己修復

| エラー | 原因 | 対処 |
|---|---|---|
| `FAL_KEY が見つかりません` | .env未設定 | `~/.env` に `FAL_KEY=...` を書く |
| `401/403` | キー無効 | fal.ai ダッシュボードで再発行 |
| `404` + モデル名 | モデルID誤り | `--list-presets` で確認 |
| `429` | レート制限 | 数秒待って再試行 |
| `参照画像が見つかりません` | パス誤り | `ls -la <path>` で確認 |

## 設計上の注意

- **ゼロ依存**: `node:fs`, `node:path`, `node:os` のみ。`npm install` 不要。
- **サイドカーJSON**: 生成画像と同名の `.json` に全メタデータ（prompt, seed, model, fal_url）を保存。再現性保証。
- **--dry-run を先に**: APIコストをかける前に必ず `dryRun: true` または `--dry-run` でpayload確認。
- **charRef は自動 Data URL 化**: ローカルファイルパスを渡せば自動で base64 変換してAPIに送る。URLを渡せばそのまま。
- **seed 固定で完全再現**: 同じ seed + 同じプロンプト + 同じモデル = 同じ画像。