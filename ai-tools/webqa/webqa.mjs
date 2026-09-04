#!/usr/bin/env node
/**
 * webqa.mjs — ヘッドレスブラウザQA + ピクセル解析 + パリティ検証
 *
 * 使い方（URLは index.html を直接でも、サーバー経由でも可）:
 *   node webqa.mjs snap  <url> <out.png> [--mobile] [--wait ms]
 *   node webqa.mjs dump  <url>                 ... ページの __rpg3d デバッグ情報をJSON表示
 *   node webqa.mjs parity <url>                ... __rpg3d と ascii-3d の再生成が一致するか
 *   node webqa.mjs analyze <img.png>           ... 穴/スリット/主要色/コントラストのピクセル解析
 *   node webqa.mjs ascii <img.png> [--w cols]  ... 画像を文字列化（私が読む用）
 *   node webqa.mjs qa <url>                    ... snap → ascii → analyze を一気に
 *
 * 環境: WEBQA_CHROME でChromeパス上書き可（既定は ms-playwright キャッシュを自動検出）
 * 下準備: npm i  （初回のみ）
 */
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASCII3D = path.resolve(HERE, '../ascii-3d');
const ARGS = ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'];

/* ---------- ブラウザ検出 ---------- */
function findBrowser() {
  if (process.env.WEBQA_CHROME && existsSync(process.env.WEBQA_CHROME)) return process.env.WEBQA_CHROME;
  const cache = path.join(homedir(), 'Library/Caches/ms-playwright');
  if (!existsSync(cache)) return null;
  for (const prefix of ['chromium_headless_shell-', 'chromium-']) {
    const dirs = readdirSync(cache).filter(d => d.startsWith(prefix)).sort();
    for (const d of dirs.reverse()) {
      const cand = prefix === 'chromium_headless_shell-'
        ? path.join(cache, d, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell')
        : [path.join(cache, d, 'chrome-mac', 'Chromium'), path.join(cache, d, 'chromium', 'chrome-mac', 'Chromium')];
      for (const exe of Array.isArray(cand) ? cand : [cand]) if (existsSync(exe)) return exe;
    }
  }
  return null;
}
const EXE = findBrowser();
if (!EXE) { console.error('ブラウザが見つかりません。WEBQA_CHROME を指定するか ms-playwright キャッシュが必要です'); process.exit(2); }

const arg = (flag, dflt) => { const i = process.argv.indexOf(flag); return i > 0 ? (process.argv[i + 1] ?? dflt) : dflt; };

async function loadPage(browser, url, mobile) {
  const page = await browser.newPage({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1400, height: 880 },
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
  });
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => { const l = document.getElementById('loader'); return !l || l.style.display === 'none'; }, null, { timeout: 60000 }).catch(() => {});
  return page;
}

/* ---------- snap ---------- */
async function snap(url, out) {
  const b = await chromium.launch({ executablePath: EXE, args: ARGS });
  const p = await loadPage(b, url, arg('--mobile', null) !== null);
  await p.waitForTimeout(+arg('--wait', 2500));
  await p.screenshot({ path: out });
  console.log(`snap: ${out}`);
  await b.close();
}

/* ---------- dump ---------- */
async function dump(url) {
  const b = await chromium.launch({ executablePath: EXE, args: ARGS });
  const p = await loadPage(b, url, false);
  const d = await p.evaluate(() => window.__rpg3d ? { seed: window.__rpg3d.seed, N: window.__rpg3d.N, counts: window.__rpg3d.counts } : null);
  console.log(JSON.stringify(d, null, 2));
  await b.close();
}

/* ---------- parity ---------- */
async function parity(url) {
  const b = await chromium.launch({ executablePath: EXE, args: ARGS });
  const p = await loadPage(b, url, false);
  const d = await p.evaluate(() => { const x = window.__rpg3d; return x ? { seed: x.seed, n: x.N, topY: [...x.topY] } : null; });
  if (!d) { console.error('__rpg3d が無いページです（デバッグフック必須）'); process.exit(1); }
  await b.close();
  execSync(`node render.mjs dump --seed ${d.seed} --n ${d.n} --elev 1`, { cwd: ASCII3D, stdio: 'pipe' });
  const map = JSON.parse(readFileSync(path.join(ASCII3D, 'map.json'), 'utf8'));
  let maxDiff = 0;
  for (let i = 0; i < d.topY.length; i++) maxDiff = Math.max(maxDiff, Math.abs(map.topY[i] - d.topY[i]));
  console.log(`parity: seed=${d.seed} n=${d.n}  topY maxDiff=${maxDiff.toFixed(8)} ${maxDiff === 0 ? '→ 完全一致 ✓' : '→ 不一致 ✗'}`);
  process.exit(maxDiff === 0 ? 0 : 1);
}

/* ---------- ピクセル解析 ---------- */
function analyze(img) {
  const png = PNG.sync.read(readFileSync(img));
  const W = png.width, H = png.height, d = png.data;
  const at = (x, y) => [d[(y * W + x) * 4], d[(y * W + x) * 4 + 1], d[(y * W + x) * 4 + 2]];
  const sky = i => d[i + 2] > 170 && d[i] > 110 && d[i] < 160 && d[i + 2] > d[i + 1] + 20;
  // 1) 孤立空 = 地形の中を透ける穴
  let iso = 0, totSky = 0;
  const X0 = W * 0.15 | 0, X1 = W * 0.85 | 0, Y0 = H * 0.25 | 0, Y1 = H * 0.75 | 0;
  const isSky = new Uint8Array(W * H);
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) { const i = (y * W + x) * 4; if (sky(i)) { isSky[y * W + x] = 1; totSky++; } }
  for (let y = Y0 + 1; y < Y1 - 1; y++) for (let x = X0 + 1; x < X1 - 1; x++) {
    if (!isSky[y * W + x]) continue;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += isSky[(y + dy) * W + (x + dx)];
    if (n <= 2) iso++;
  }
  // 2) 長い暗線（スリット）の縦横
  const grass = i => d[i + 1] > d[i] + 25 && d[i + 1] > d[i + 2] + 30 && d[i + 1] > 90;
  const dark = i => (d[i] + d[i + 1] + d[i + 2] < 250 && d[i + 1] < 130) || (d[i + 1] < d[i] - 30 && d[i + 1] < d[i + 2] - 20);
  const longLines = horiz => {
    let long = 0;
    const len = horiz ? H : W;
    for (let a = 0; a < len; a++) {
      let run = 0, best = 0;
      for (let b = 0; b < (horiz ? W : H); b++) {
        const i = ((horiz ? a : b) * W + (horiz ? b : a)) * 4;
        if (grass(i) && dark(i)) { run++; best = Math.max(best, run); } else run = 0;
      }
      if (best >= 24) long++;
    }
    return long;
  };
  // 3) 主要色 + コントラスト
  const bins = {};
  for (let i = 0; i < d.length; i += 28) { const q = (d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4); bins[q] = (bins[q] || 0) + 1; }
  const top = Object.entries(bins).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const Lc = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const cr = (a, bb) => { const x = Lc(a), y = Lc(bb); return ((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2); };
  console.log(`analyze: ${img} (${W}x${H})`);
  console.log(`  孤立空(穴): ${(iso / Math.max(1, totSky) * 100).toFixed(1)}%  | 長い暗線 横:${longLines(true)} 縦:${longLines(false)}`);
  console.log(`  主要色: ${top.map(([q]) => '#' + ((q >> 8 & 15) << 4).toString(16).padStart(2, '0') + (((q >> 4 & 15) << 4)).toString(16).padStart(2, '0') + ((q & 15) << 4).toString(16).padStart(2, '0')).join(' ')}`);
  const px = (x, y) => at((x * W / 100) | 0, (y * H / 100) | 0);
  console.log(`  対比度サンプル: 草#5fae42 vs 水#2f6fd0 = ${cr([0x5f, 0xae, 0x42], [0x2f, 0x6f, 0xd0])}:1 (1.5未満は弱い)`);
}

/* ---------- 画像 → ASCII ---------- */
function asciiImg(img) {
  const png = PNG.sync.read(readFileSync(img));
  const W0 = png.width, H0 = png.height, d = png.data;
  const cols = +arg('--w', 104);
  const rows = Math.max(8, (cols * (H0 / W0) * 0.45) | 0);
  const ramp = ' .:-=+*#%@';
  for (let y = 0; y < rows; y++) {
    let line = '';
    for (let x = 0; x < cols; x++) {
      const i = ((Math.min(H0 - 1, (y / rows * H0) | 0)) * W0 + Math.min(W0 - 1, (x / cols * W0) | 0)) * 4;
      const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      line += ramp[Math.min(9, (L / 256 * 10) | 0)];
    }
    console.log(line.replace(/\s+$/, ''));
  }
}

/* ---------- qa: 一括 ---------- */
async function qa(url) {
  const out = path.join(tmpdir(), `webqa_${Date.now()}.png`);
  await snap(url, out);
  console.log('');
  analyze(out);
  console.log('');
  asciiImg(out);
}

/* ---------- ディスパッチ ---------- */
const cmd = process.argv[2];
const u = process.argv[3];
if (cmd === 'snap') { if (!u || !process.argv[4]) { console.error('snap <url> <out.png>'); process.exit(2); } snap(u, process.argv[4]); }
else if (cmd === 'dump') { u ? dump(u) : (console.error('dump <url>'), process.exit(2)); }
else if (cmd === 'parity') { u ? parity(u) : (console.error('parity <url>'), process.exit(2)); }
else if (cmd === 'analyze') { process.argv[3] ? analyze(process.argv[3]) : console.error('analyze <img.png>'); }
else if (cmd === 'ascii') { process.argv[3] ? asciiImg(process.argv[3]) : console.error('ascii <img.png>'); }
else if (cmd === 'qa') { u ? qa(u) : console.error('qa <url>'); }
else {
  console.log(`webqa 使い方:
  snap   <url> <out.png> [--mobile] [--wait ms]  スクリーンショット
  dump   <url>                                    __rpg3d 表示
  parity <url>                                    アプリとascii-3dの一致検証
  analyze <img.png>                               穴/スリット/主要色/対比度
  ascii  <img.png> [--w cols]                     画像を文字列化
  qa     <url>                                    snap→analyze→ascii 一括`);
}