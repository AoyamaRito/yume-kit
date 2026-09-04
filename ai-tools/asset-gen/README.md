# asset-gen & char-gen — fal.ai を用いた2Dイラスト・ゲームアセット制作エンジン

// @why: [2026-08-28] fal.ai API (Recraft v3, Flux Schnell/Dev) を叩いて、2Dイラスト・ゲーム用アイコン(SVG)・ドット絵・立ち絵・背景・UI枠を即時生成・保存するCLI。
// @why: [2026-08-29] キャラクター同一性保持（Identity Consistency）・絵柄保持（Style Consistency）・表情/ポーズパック一括生成・インタラクティブHTMLプレビューア出力を追加。
// @why: [2026-08-29] 最上位モデル（Recraft v3, Flux 1.1 Pro Ultra, Flux 1.1 Pro, Flux Dev）を標準採用し画質と精度を最大化。
// @tags: SPEC

Node.js 22+ 組み込みの `fetch` のみを使用（zero-dependency）。

## 特徴

1. **業界最高峰の生成モデルを標準採用**:
   - **Recraft v3**: ベクターSVG & 2Dデジタルアートで世界最高峰（アイコン・立ち絵・差分・UI枠）
   - **Flux 1.1 Pro Ultra**: 2K超高精細アート・コンセプトアートの最上位フラグシップ
   - **Flux 1.1 Pro**: 最先端プロ仕様アニメ・キービジュアル・背景
   - **Flux Dev**: 28ステップ高精細ピクセルアート・シームレスタイル
   - **Clarity Upscaler**: 2x/4x 超解像・高精細化
2. **キャラクター同一性 & 絵柄保持（Identity & Style Consistency）**:
   - `--char-ref <image>`: 基準画像を注入し、同じ顔・髪型・衣装を維持したまま表情差分・ポーズ差分を生成。
   - `--style-ref <image>`: 参照画像の塗りのタッチ・線の太さ・色調を完全模倣。
   - `char-gen.mjs`: キャラクター設定（JSON）からベース立ち絵・表情パック・ポーズパック・ドット絵・ちびキャラを一括自動生成。
   - **インタラクティブ HTML プレビューア**: 生成した全アセットをブラウザで表情切り替え・背景チェッカー（透過/Dark/White/Dungeon）で即時検証可能。
3. **決定論的生成 & メタデータ保護**:
   - `--seed <number>` による再現性固定
   - 生成アセットと同名でサイドカー `.json` を保存（プロンプト、モデル、プリセット、seed、fal_url 等を記録）
4. **キーの自動検出**:
   - `~/.env`, `.env`, `pi_root/.env` または環境変数 `FAL_KEY` を自動検出

---

## 使い方: キャラクター制作スタジオ (`char-gen.mjs`)

```bash
# 1. キャラクター立ち絵＋設定を作成
node yume-kit/ai-tools/asset-gen/char-gen.mjs create elena "young female paladin with silver twintail hair, emerald green eyes, ornate silver plate armor, royal blue cape"

# 2. 表情差分＋ポーズ差分＋ドット絵＋ちびキャラを一括生成（同一性と絵柄を自動保持）
node yume-kit/ai-tools/asset-gen/char-gen.mjs pack ./generated-characters/elena/character.json --pack all

# 3. 生成された HTML ビューアをブラウザで開いてインタラクティブに確認
open ./generated-characters/elena/viewer.html
```

---

## 使い方: 単発アセット生成 (`asset-gen.mjs`)

```bash
# 基本: ベクターアイコン (SVG出力)
node yume-kit/ai-tools/asset-gen/asset-gen.mjs "magic blue potion bottle with glowing liquid" --out ./potion.svg

# 基準立ち絵を参照して「笑顔」差分を生成（同一性保持）
node yume-kit/ai-tools/asset-gen/asset-gen.mjs "silver haired paladin girl" --preset char-expression -e "笑顔" --char-ref ./elena_base.png --out ./elena_happy.png

# 基準立ち絵を参照して「攻撃」ポーズを生成
node yume-kit/ai-tools/asset-gen/asset-gen.mjs "silver haired paladin girl" --preset char-pose -p "攻撃" --char-ref ./elena_base.png --out ./elena_attack.png

# 絵柄を参照して同じタッチで新アイテムを生成
node yume-kit/ai-tools/asset-gen/asset-gen.mjs "crystal holy rapier sword" --preset style-consistent --style-ref ./elena_base.png --out ./sword.png

# ドット絵スプライト
node yume-kit/ai-tools/asset-gen/asset-gen.mjs "fire dragon" --preset pixel-art --out ./dragon.png

# 2Dゲーム背景 (16:9)
node yume-kit/ai-tools/asset-gen/asset-gen.mjs "mystical floating island in twilight" --preset background --out ./bg.webp
```

---

## オプション一覧 (`asset-gen.mjs`)

| オプション | 説明 | 既定値 |
|---|---|---|
| `<プロンプト>` | 生成したい対象（日本語・英語どちらも可） | 必須 |
| `--preset <name>` | プリセット選択 | `vector-icon` |
| `--char-ref <path\|url>` | キャラクター同一性参照画像（パスまたはURL） | なし |
| `--style-ref <path\|url>` | 絵柄・スタイル参照画像（パスまたはURL） | なし |
| `--expression, -e <str>` | 表情指定 (`happy`, `angry`, `笑顔`, `ドヤ顔` 等) | なし |
| `--pose, -p <str>` | ポーズ指定 (`attack`, `idle`, `攻撃`, `待機` 等) | なし |
| `--model <name>` | モデル上書き (`recraft`, `flux`, `dev`, `ideogram`) | プリセット準拠 |
| `--style <name>` | スタイル指定 (`vector_illustration`, `digital_illustration`) | プリセット準拠 |
| `--size <size>` | サイズ (`square_hd`, `portrait_4_3`, `landscape_16_9`) | プリセット準拠 |
| `--seed <number>` | 乱数シード値 | なし（ランダム） |
| `--num <number>` | 生成枚数 | `1` |
| `--out <path>` | 保存ファイル名（例: `./sword.svg`） | 自動生成 |
| `--dir <folder>` | 保存先ディレクトリ | `./generated-assets` |
| `--dry-run` | API呼び出しを行わずリクエスト内容を確認 | `false` |
| `--json` | 結果をJSON形式で標準出力 | `false` |

---

## プログラムからの利用 (ES Module)

```js
import { generateAsset } from './yume-kit/ai-tools/asset-gen/asset-gen.mjs';
import { generateCharacterPack } from './yume-kit/ai-tools/asset-gen/char-gen.mjs';

// 表情差分の生成
const result = await generateAsset({
  prompt: 'silver hair paladin girl',
  preset: 'char-expression',
  expression: 'happy',
  charRef: './base.png',
  out: './happy.png',
});
```
