// @why: [2026-08-28] asset-gen の単体・結合テスト（E2E snowball）。
// @why: [2026-08-29] キャラクター同一性（Identity Consistency）および絵柄保持（Style Consistency）、ビューアHTML出力のテスト追加。
// @why: モックfetchを用いた全機能検証と、実環境での key / payload 整合性を保証する。
// @tags: SPEC

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { PRESETS, MODEL_ALIASES, EXPRESSIONS, POSES } from './presets.mjs';
import { loadFalKey, buildRequestPayload, generateAsset, fileToDataUrl } from './asset-gen.mjs';
import { createCharacterTemplate, generateViewerHtml, generateCharacterPack } from './char-gen.mjs';

test('1. PRESETS & MODEL_ALIASES 定義検証', () => {
  assert.ok(PRESETS['vector-icon'], 'vector-icon プリセットが存在すること');
  assert.ok(PRESETS['pixel-art'], 'pixel-art プリセットが存在すること');
  assert.ok(PRESETS['anime-char'], 'anime-char プリセットが存在すること');
  assert.ok(PRESETS['background'], 'background プリセットが存在すること');
  assert.ok(PRESETS['game-item'], 'game-item プリセットが存在すること');
  assert.ok(PRESETS['flagship-art'], 'flagship-art プリセットが存在すること');
  assert.ok(PRESETS['pro-anime'], 'pro-anime プリセットが存在すること');
  assert.ok(MODEL_ALIASES['recraft'], 'recraft エイリアスが存在すること');
  assert.ok(MODEL_ALIASES['ultra'], 'ultra エイリアスが存在すること');
  assert.ok(MODEL_ALIASES['pro'], 'pro エイリアスが存在すること');
  assert.ok(MODEL_ALIASES['dev'], 'dev エイリアスが存在すること');
});

test('2. loadFalKey() がキーを読み込めること', () => {
  const key = loadFalKey();
  assert.ok(key, 'FAL_KEY が取得できること');
  assert.ok(key.length > 10, 'FAL_KEY の長さが適切であること');
});

test('3. buildRequestPayload() の挙動検証', () => {
  // vector-icon (Recraft)
  const p1 = buildRequestPayload({
    prompt: 'magic potion',
    presetName: 'vector-icon',
    seed: 42,
  });
  assert.equal(p1.model, 'fal-ai/recraft-v3');
  assert.equal(p1.body.style, 'vector_illustration');
  assert.equal(p1.body.seed, 42);
  assert.ok(p1.body.prompt.includes('magic potion'));

  // pixel-art (Flux Dev)
  const p2 = buildRequestPayload({
    prompt: 'dragon sprite',
    presetName: 'pixel-art',
    num: 2,
  });
  assert.equal(p2.model, 'fal-ai/flux/dev');
  assert.equal(p2.body.num_images, 2);
  assert.ok(p2.body.prompt.includes('dragon sprite'));

  // raw + custom model override
  const p3 = buildRequestPayload({
    prompt: 'custom prompt',
    presetName: 'raw',
    modelOverride: 'dev',
    sizeOverride: 'landscape_16_9',
  });
  assert.equal(p3.model, 'fal-ai/flux/dev');
  assert.equal(p3.body.image_size, 'landscape_16_9');
  assert.equal(p3.body.prompt, 'custom prompt');
});

test('4. generateAsset() dry-run 動作検証', async () => {
  const dry = await generateAsset({
    prompt: 'crystal sword',
    preset: 'vector-icon',
    dryRun: true,
  });

  assert.equal(dry.dryRun, true);
  assert.equal(dry.model, 'fal-ai/recraft-v3');
  assert.equal(dry.preset, 'vector-icon');
  assert.ok(dry.endpoint.includes('recraft-v3'));
  assert.ok(dry.body.prompt.includes('crystal sword'));
});

test('5. generateAsset() モック fetch を使った結合テスト (SVG & PNG 生成・メタデータ出力)', async () => {
  const testDir = join(tmpdir(), `asset-gen-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });

  const mockSvgContent = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>';

  // モック fetch
  const mockFetch = async (url, opts) => {
    if (url.includes('fal.run')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          images: [
            {
              url: 'https://mock.fal.media/files/sword.svg',
              content_type: 'image/svg+xml',
              width: 1024,
              height: 1024,
            },
          ],
          seed: 12345,
        }),
      };
    } else if (url.includes('mock.fal.media')) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode(mockSvgContent).buffer,
      };
    }
    throw new Error('Unknown URL: ' + url);
  };

  const outFile = join(testDir, 'sword.svg');
  const result = await generateAsset({
    prompt: 'holy golden sword',
    preset: 'vector-icon',
    out: outFile,
    fetchFn: mockFetch,
  });

  assert.equal(result.success, true);
  assert.equal(result.results.length, 1);
  assert.ok(existsSync(outFile), '出力ファイルが存在すること');
  assert.equal(readFileSync(outFile, 'utf8'), mockSvgContent, 'ファイル内容が一致すること');

  const metaFile = outFile.replace('.svg', '.json');
  assert.ok(existsSync(metaFile), 'サイドカーメタデータが存在すること');
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  assert.equal(meta.prompt, 'holy golden sword');
  assert.equal(meta.preset, 'vector-icon');
  assert.equal(meta.seed, 12345);
  assert.equal(meta.fal_url, 'https://mock.fal.media/files/sword.svg');

  // クリーンアップ
  rmSync(testDir, { recursive: true, force: true });
});

test('6. キャラクター・絵柄保持プリセット・辞書の検証', () => {
  assert.ok(PRESETS['char-base'], 'char-base プリセットが存在すること');
  assert.ok(PRESETS['char-expression'], 'char-expression プリセットが存在すること');
  assert.ok(PRESETS['char-pose'], 'char-pose プリセットが存在すること');
  assert.ok(PRESETS['char-pixel'], 'char-pixel プリセットが存在すること');
  assert.ok(PRESETS['char-chibi'], 'char-chibi プリセットが存在すること');
  assert.ok(PRESETS['style-consistent'], 'style-consistent プリセットが存在すること');

  assert.ok(EXPRESSIONS['happy'], 'happy 表情が存在すること');
  assert.ok(EXPRESSIONS['笑顔'], '日本語「笑顔」が引けること');
  assert.ok(POSES['attack'], 'attack ポーズが存在すること');
  assert.ok(POSES['攻撃'], '日本語「攻撃」が引けること');
});

test('7. fileToDataUrl() の動作検証', () => {
  // null / URL 直渡し
  assert.equal(fileToDataUrl(null), null);
  assert.equal(fileToDataUrl('https://example.com/image.png'), 'https://example.com/image.png');
  assert.equal(fileToDataUrl('data:image/png;base64,xxx'), 'data:image/png;base64,xxx');

  // ローカルファイル変換
  const testDir = join(tmpdir(), `dataurl-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  const sampleFile = join(testDir, 'sample.png');
  writeFileSync(sampleFile, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNGヘッダ

  const dataUrl = fileToDataUrl(sampleFile);
  assert.ok(dataUrl.startsWith('data:image/png;base64,'), 'Data URL 形式に正しく変換されること');

  // 存在しないファイルのエラー
  assert.throws(() => {
    fileToDataUrl(join(testDir, 'non_existent.png'));
  }, /参照画像が見つかりません/);

  rmSync(testDir, { recursive: true, force: true });
});

test('8. buildRequestPayload() キャラクター・絵柄保持 payload 検証', () => {
  const p = buildRequestPayload({
    prompt: 'silver knight girl',
    presetName: 'char-expression',
    expression: '笑顔',
    charRef: 'https://example.com/base.png',
    styleRef: 'https://example.com/style.png',
    seed: 999,
  });

  assert.equal(p.model, 'fal-ai/recraft-v3');
  assert.equal(p.body.seed, 999);
  assert.ok(p.fullPrompt.includes('happy smiling expression'));
  assert.deepEqual(p.body.image_references, [{ url: 'https://example.com/base.png' }]);
  assert.deepEqual(p.body.style_references, [{ url: 'https://example.com/style.png' }]);
});

test('9. generateViewerHtml() HTML 出力検証', () => {
  const testDir = join(tmpdir(), `viewer-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });

  const char = createCharacterTemplate('elena', 'silver hair paladin');
  const assets = [
    { label: 'Base', category: 'base', filePath: join(testDir, 'base.png'), relPath: 'base.png' },
    { label: '笑顔', category: 'expressions', filePath: join(testDir, 'happy.png'), relPath: 'happy.png' },
  ];

  const viewerPath = generateViewerHtml({
    character: char,
    assets,
    outDir: testDir,
  });

  assert.ok(existsSync(viewerPath), 'viewer.html が出力されていること');
  const content = readFileSync(viewerPath, 'utf8');
  assert.ok(content.includes('Elena — Character Asset Studio'));
  assert.ok(content.includes('happy.png'));
  assert.ok(content.includes('透過チェッカー'));

  rmSync(testDir, { recursive: true, force: true });
});

test('10. generateCharacterPack() モック結合テスト (一括パック生成 & ビューア自動作成)', async () => {
  const testDir = join(tmpdir(), `char-pack-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });

  const mockImageContent = 'MOCK_IMAGE_DATA';

  const mockFetch = async (url, opts) => {
    if (url.includes('fal.run')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          images: [
            {
              url: 'https://mock.fal.media/files/char_asset.png',
              content_type: 'image/png',
              width: 1024,
              height: 1024,
            },
          ],
          seed: 777,
        }),
      };
    } else if (url.includes('mock.fal.media')) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode(mockImageContent).buffer,
      };
    }
    throw new Error('Unknown URL: ' + url);
  };

  const charDef = createCharacterTemplate('lydia', 'mystic mage with violet hair');
  const res = await generateCharacterPack({
    charConfig: charDef,
    outDir: testDir,
    packs: ['base', 'expressions', 'pixel'],
    expressions: ['happy', 'serious'],
    seed: 777,
    fetchFn: mockFetch,
  });

  assert.equal(res.success, true);
  assert.ok(existsSync(res.configPath), 'character.json が保存されていること');
  assert.ok(existsSync(res.viewerPath), 'viewer.html が生成されていること');

  // 生成アセット数の確認 (base 1 + expressions 2 + pixel 1 = 4)
  assert.equal(res.assets.length, 4);

  for (const a of res.assets) {
    assert.ok(existsSync(a.filePath), `生成ファイル ${a.filePath} が存在すること`);
  }

  rmSync(testDir, { recursive: true, force: true });
});

test('11. フラグシップモデル (Pro Ultra / Pro / Clarity) payload 検証', () => {
  // Flagship Pro Ultra
  const pUltra = buildRequestPayload({
    prompt: 'floating castle in sky',
    presetName: 'flagship-art',
    seed: 100,
  });
  assert.equal(pUltra.model, 'fal-ai/flux-pro/v1.1-ultra');
  assert.equal(pUltra.body.aspect_ratio, '16:9');
  assert.equal(pUltra.body.seed, 100);

  // Pro Anime
  const pAnime = buildRequestPayload({
    prompt: 'cyberpunk girl with katana',
    presetName: 'pro-anime',
    seed: 200,
  });
  assert.equal(pAnime.model, 'fal-ai/flux-pro/v1.1');
  assert.equal(pAnime.body.safety_tolerance, '5');

  // Clarity Upscaler
  const pUpscale = buildRequestPayload({
    prompt: 'enhance details',
    presetName: 'raw',
    modelOverride: 'clarity',
    charRef: 'https://example.com/small.png',
  });
  assert.equal(pUpscale.model, 'fal-ai/clarity-upscaler');
  assert.equal(pUpscale.body.upscale_factor, 2);
  assert.equal(pUpscale.body.image_url, 'https://example.com/small.png');
});
