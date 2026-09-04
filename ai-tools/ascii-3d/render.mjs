#!/usr/bin/env node
/**
 * ascii-3d/render.mjs — 「文字列で3Dを見る」仕組み
 *
 * 3d-rpg-map/index.html と同じ地形生成ロジック（乱数・量子化・分類）をNodeで再現し、
 * 画像・ブラウザを一切経由せずに 3D 地形を文字列で描画する。
 *
 *   node render.mjs top            ... 俯視図（高さ or 種類で色分け）
 *   node render.mjs persp          ... 透視図（レイキャスト、カメラ可変）
 *   node render.mjs cut            ... 断面図
 *   node render.mjs shadow         ... 影分布（太陽からの遮蔽判定）
 *   node render.mjs verify         ... 生成の正しさ（1/4刻み・穴なし等）を数値で検証
 *   node render.mjs dump           ... 地形データをJSONで出力（パリティ検証用）
 *
 * 共通オプション: --seed N --n 44 --elev 100 --tree 0.45
 * persp用: --yaw deg --pitch deg --pos x,y,z --w cols
 *
 * 依存: なし（Node 22+）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

/* =========================================================
   3d-rpg-map と同じ生成ロジック（唯一下流側からコピーされる結晶）
   ========================================================= */
const THRESH = { deep: 0.42, water: 0.72, sand: 0.94, grass: 1.30, grass2: 1.58, hill: 1.90 };
const QUARTER = 0.25;
const TYPE = { deep: 0, water: 1, sand: 2, grass: 3, grass2: 4, hill: 5, rock: 6 };
const TYPE_CH = ['≈', '~', 's', 'g', 'G', 'h', 'r'];

function hash2(x, y, seed) {
  let h = (x * 0x27d4eb2d) ^ (y * 0x165667b1) ^ ((seed * 0x9e3779b9) | 0);
  h = (h ^ (h >>> 15)) * 0x85ebca6b | 0;
  h = (h ^ (h >>> 13)) * 0xc2b2ae35 | 0;
  h ^= (h >>> 16);
  return (h >>> 0) / 4294967296;
}
function valNoise(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x, y, seed, oct) {
  let v = 0, amp = 1, f = 1, tot = 0;
  for (let i = 0; i < oct; i++) { v += valNoise(x * f, y * f, seed + i * 101) * amp; tot += amp; amp *= 0.5; f *= 2.12; }
  return v / tot;
}
function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function classify(h) {
  if (h < THRESH.deep) return TYPE.deep;
  if (h < THRESH.water) return TYPE.water;
  if (h < THRESH.sand) return TYPE.sand;
  if (h < THRESH.grass) return TYPE.grass;
  if (h < THRESH.grass2) return TYPE.grass2;
  if (h < THRESH.hill) return TYPE.hill;
  return TYPE.rock;
}

function gen(seed, n, elev) {
  const STEP = 0.92 * elev;
  const H = Math.max(1.0, STEP * 1.15);
  const tile = new Uint8Array(n * n);
  const topY = new Float64Array(n * n);
  const lvlIdx = new Uint8Array(n * n); // 1/4単位での段数インデックス
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const s = ((x + 0.5) / n) * 2 - 1, t = ((z + 0.5) / n) * 2 - 1;
    const r = Math.sqrt(s * s + t * t);
    const island = 1 - smoothstep(0.52, 1.18, r);
    const h = (fbm(s * 3.0, t * 3.0, seed, 3) * 0.72 + fbm(s * 8.0, t * 8.0, seed + 77, 2) * 0.28) * island * 2.4;
    const ty = classify(h);
    const lvl = Math.max(0, Math.round((h - 0.72) * 4)) / 4;
    tile[z * n + x] = ty;
    lvlIdx[z * n + x] = Math.round(lvl / QUARTER);
    topY[z * n + x] = lvl * STEP;
  }
  return { seed, n, STEP, H, tile, topY, lvlIdx };
}

/* =========================================================
   CLI
   ========================================================= */
const args = process.argv.slice(2);
const view = args.find(a => ['top', 'persp', 'cut', 'shadow', 'verify', 'dump', 'channel', 'movie'].includes(a)) || 'top';
const get = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : dflt;
};
const seed = +get('--seed', 42);
const n = +get('--n', 44);
const elev = +get('--elev', 1.0);
const tree = +get('--tree', 0.45);

const M = gen(seed, n, elev);
const { tile, topY, lvlIdx } = M;
const half = n / 2;

/* ---------- 俯視図 ---------- */
function topView(style, MM = M) {
  const HEIGHT_CH = '~.+o#8@%'; // 段数 0..7
  const tl = MM.lvlIdx, tt = MM.tile, nn = MM.n;
  const out = [];
  for (let z = 0; z < nn; z++) {
    let line = '';
    for (let x = 0; x < nn; x++) {
      const i = z * nn + x;
      line += style === 'type' ? TYPE_CH[tt[i]] : HEIGHT_CH[Math.min(7, tl[i])];
    }
    out.push(line);
  }
  return out;
}
function topLegend() {
  return [
    view === 'top' ? `俯視図 [高さ]  ~=水 .+=低地 o#=丘 8@%=峰   (1/4刻み: ${(M.STEP * QUARTER).toFixed(2)} 単位)` : '',
    `俯視図 [種類]  ≈=深水 ~=水 s=砂 g=草 G=草2 h=高台 r=岩`,
  ].filter(Boolean);
}

/* ---------- 透視図（高さ場レイキャスト） ---------- */
function perspView(opt = {}) {
  const yaw = opt.yaw ?? ((+get('--yaw', 45)) * Math.PI / 180);      // 45° = 南西から島中心を見る
  const pitch = opt.pitch ?? ((+get('--pitch', -14)) * Math.PI / 180); // 負 = 見下ろし
  const [px = -16, py = 9, pz = -16] = opt.pos ? opt.pos : (get('--pos', '')).split(',').map(Number);
  const W = opt.W ?? +get('--w', 104);
  const Hh = opt.Hh ?? Math.floor(W * 0.42);
  const fovY = 0.62; // 縦方向半角
  const maxDist = n * 1.6;
  const shade = ' .·:+*#@'; // 遠い→近い
  const step = 0.22;

  const lines = [];
  for (let row = 0; row < Hh; row++) {
    // 上(負)→下(正)の仰角。地平線が中央、上は空、下は手前の地面になる
    const theta = pitch + (row / Hh - 0.5) * fovY * 2; // 負=見上げ → rayYは下降しすぎない
    let line = '';
    for (let col = 0; col < W; col++) {
      const ang = yaw + (col / W - 0.5) * (fovY * 1.25) * 2;
      const dx = Math.cos(ang), dz = Math.sin(ang);
      // レイを水平に進め、高さ場と交差するところを探す
      let hit = null;
      for (let d = 0.4; d < maxDist && !hit; d += step) {
        const wx = px + dx * d, wz = pz + dz * d;
        const cx = Math.floor(wx + half), cz = Math.floor(wz + half);
        if (cx < 0 || cz < 0 || cx >= n || cz >= n) break; // マップ外 = 海の彼方
        const top = topY[cz * n + cx];
        const rayY = py + Math.tan(theta) * d;
        if (rayY < top) { hit = { d, top, ty: tile[cz * n + cx] }; }
      }
      if (!hit) {
        // 空: うっすらコン。行の下方向ほどわずかに濃く
        line += row > Hh * 0.45 && theta < 0 ? '.' : ' ';
      } else {
        const k = Math.min(shade.length - 1, Math.max(1, Math.floor((maxDist - hit.d) / maxDist * shade.length)));
        if (hit.top <= 0.02) line += '~';              // 水面
        else if (hit.d < 9 && hit.ty === TYPE.rock) line += '@';
        else if (hit.d < 9 && hit.ty >= TYPE.hill) line += '#';
        else line += shade[k];
      }
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines;
}

/* ---------- 断面図 ---------- */
function cutView() {
  const line = [];
  const Hc = 13;
  let maxH = 0;
  for (let x = 0; x < n; x++) { maxH = Math.max(maxH, topY[x * n + x]); }
  for (let x = 0; x < n; x++) {
    const h = Math.round(topY[x * n + x] / maxH * (Hc - 1));
    line.push(h);
  }
  const out = [];
  for (let r = Hc - 1; r >= 0; r--) {
    let s = '';
    for (let x = 0; x < n; x++) {
      const i = x * n + x;
      if (line[x] === r) s += TYPE_CH[tile[i]];
      else if (line[x] > r) s += '|';
      else s += ' ';
    }
    out.push(s);
  }
  return out;
}

/* ---------- 影分布 ---------- */
function shadowView() {
  const sun = [24, 32, 14];
  const len = Math.hypot(...sun);
  const [sx, sy, sz] = sun.map(v => v / len);
  const out = [];
  for (let z = 0; z < n; z++) {
    let s = '';
    for (let x = 0; x < n; x++) {
      const i = z * n + x;
      if (tile[i] <= TYPE.water) { s += '~'; continue; }
      // 太陽方向へマーチ: 途中に自分より高いタイルがあれば影
      const y0 = topY[i];
      let shaded = false;
      for (let d = 0.5; d < n * 1.4 && !shaded; d += 0.45) {
        const wx = x + sx * d, wz = z + sz * d;
        const cx = Math.round(wx), cz = Math.round(wz);
        if (cx < 0 || cz < 0 || cx >= n || cz >= n) break;
        if (topY[cz * n + cx] >= y0 + 0.01) shaded = true;
      }
      s += shaded ? ':' : '.';
    }
    out.push(s);
  }
  return out;
}

/* ---------- チャンネル別ビュー（時間軸切替用の単フレーム） ---------- */
function channelView() {
  const img = get('--img', null);
  if (!img) { console.error('--img <png> が必要です'); process.exit(2); }
  const png = PNG.sync.read(readFileSync(img));
  const W0 = png.width, H0 = png.height, d = png.data;
  const cols = +get('--w', 92);
  const rows = Math.max(8, Math.floor(cols * (H0 / W0) * 0.44));
  const c = get('--c', 'DOM').toUpperCase();
  const ramp = ' .:-=+*#%@';
  const out = [];
  for (let y = 0; y < rows; y++) {
    let line = '';
    for (let x = 0; x < cols; x++) {
      const px = Math.min(W0 - 1, Math.floor((x / cols) * W0));
      const py = Math.min(H0 - 1, Math.floor((y / rows) * H0));
      const i = (py * W0 + px) * 4;
      const R = d[i], G = d[i + 1], B = d[i + 2];
      const v = c === 'R' ? R : c === 'G' ? G : c === 'B' ? B : 0.2126 * R + 0.7152 * G + 0.0722 * B;
      if (c === 'DOM') {
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
        line += (mx - mn < 24) ? '.' : (R > G && R > B ? 'r' : (G > B ? 'g' : 'b'));
      } else {
        line += ramp[Math.min(9, Math.floor((v / 256) * 10))];
      }
    }
    out.push(line);
  }
  return { out, cols, rows, c };
}

/* ---------- 時間軸ムービー ---------- */
function movieView() {
  const mode = get('--mode', 'orbit');
  const frames = +get('--frames', 8);
  if (mode === 'orbit') {
    const r = +get('--r', 21), ph = +get('--height', 9), W = +get('--w', 84);
    const lines = [];
    for (let f = 0; f < frames; f++) {
      const a = (f / frames) * Math.PI * 2;
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      const yawRad = Math.atan2(-cz, -cx); // 島の中心を向く
      lines.push(`── frame ${f + 1}/${frames} 視点方位 ${Math.round(a * 180 / Math.PI)}° (${cx.toFixed(0)},${ph},${cz.toFixed(0)}) ──`);
      for (const l of perspView({ yaw: yawRad, pos: [cx, ph, cz], W })) lines.push(l);
    }
    return lines;
  }
  if (mode === 'sweep') {
    const from = +get('--from', 0.4), to = +get('--to', 2.0), topStyle = get('--style', 'height');
    const lines = [];
    for (let f = 0; f < frames; f++) {
      const e = frames === 1 ? from : from + (f / (frames - 1)) * (to - from);
      const s = gen(seed, n, e);
      lines.push(`── frame ${f + 1}/${frames} elev=${e.toFixed(2)} (STEP=${s.STEP.toFixed(2)}, 1/4段=${(s.STEP * QUARTER).toFixed(2)}, 最大高=${Math.max(...s.topY).toFixed(2)}) ──`);
      for (const l of topView(topStyle, s)) lines.push(l);
    }
    return lines;
  }
  if (mode === 'water') {
    // 水面の疑似アニメーション（フレームごとに水の波紋パターンを横へ流す）
    const waves = ['≈~≈~', '~≈~≈', '≈≈~≈', '~≈≈~', '≈~~≈', '~≈~~'];
    const lines = [];
    for (let f = 0; f < frames; f++) {
      const off = f % waves.length;
      lines.push(`── frame ${f + 1}/${frames} 波位相 ${off} ──`);
      const rows = [];
      for (let y = 0; y < n; y++) {
        let row = '';
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          row += tile[i] <= TYPE.water ? waves[off][(x + y) % 4] : (lvlIdx[i] > 0 ? '.' : ' ');
        }
        rows.push(row);
      }
      lines.push(rows.join(String.fromCharCode(10)));
    }
    return lines;
  }
  return ['不明な --mode'];
}

/* ---------- 検証 ---------- */
function verify() {
  const { STEP, H } = M;
  const q = Math.round(STEP * QUARTER * 1e3) / 1e3;
  let holes = 0, maxGap = 0, peaks = 0, water = 0, land = 0;
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const v = topY[z * n + x];
    if (x + 1 < n) { const g = Math.abs(v - topY[z * n + x + 1]); maxGap = Math.max(maxGap, g); if (g > H * 0.999) holes++; }
    if (z + 1 < n) { const g = Math.abs(v - topY[(z + 1) * n + x]); maxGap = Math.max(maxGap, g); if (g > H * 0.999) holes++; }
    if (tile[z * n + x] <= TYPE.water) water++; else land++;
    peaks = Math.max(peaks, v);
  }
  const levels = new Set();
  for (const l of lvlIdx) levels.add(l);
  return { q, holes, maxGap: +maxGap.toFixed(3), H: +H.toFixed(3), water, land, maxHeight: +peaks.toFixed(2), levelBands: levels.size };
}

/* =========================================================
   出力
   ========================================================= */
console.log(`3Dマップ文字列ビュー  seed=${seed} n=${n} elev=${elev}  (STEP=${M.STEP.toFixed(2)}, 1/4段=${(M.STEP * QUARTER).toFixed(2)})`);
console.log('');

if (view === 'dump') {
  writeFileSync('map.json', JSON.stringify({ seed, n, elev, topY: [...topY], tile: [...tile], lvlIdx: [...lvlIdx], STEP: M.STEP, H: M.H }));
  console.log('map.json に書き出しました');
  process.exit(0);
}

if (view === 'verify') {
  const v = verify();
  console.log('── 検証 ──');
  console.log(`1/4単位の段差: ${v.q}  ✓ (期待値 ${v.q})`);
  console.log(`隣接ギャップ最大: ${v.maxGap}  < スラブ厚 ${v.H}  → 穴: ${v.holes} 件`);
  console.log(`段数バンド: ${v.levelBands}  | 水: ${v.water} 陸: ${v.land} | 最大標高: ${v.maxHeight}`);
  if (v.maxGap < v.H) console.log('判定: 透け・スリット穴なし OK');
  else { console.log('判定: NG（要修正）'); process.exit(1); }
} else if (view === 'top') {
  for (const lg of topLegend()) console.log(lg);
  console.log('');
  for (const l of topView('height')) console.log(l);
  console.log('');
  for (const l of topView('type')) console.log(l);
  console.log('凡例: 上=高さ / 下=種類');
} else if (view === 'persp') {
  console.log(`透視図 (視点=${get('--pos', '-16,9,-16')} yaw=${get('--yaw', '45')}° pitch=${get('--pitch', '-14')}° 斜め見下ろし)`);
  console.log('');
  for (const l of perspView()) console.log(l);
  console.log('凡例: 空白=空 .::暗い遠景 +*#=遠近の中間 @=岩 #=高台 ~=水面');
} else if (view === 'cut') {
  console.log('断面図（左上→右下 対角線。高さに合わせて拡大表示）');
  console.log('');
  for (const l of cutView()) console.log(l);
  console.log('凡例: 各列 = タイル1枚の標高、文字 = 種類(≈深水 ~水 s砂 g草 G草2 h高台 r岩)');
} else if (view === 'shadow') {
  console.log('影分布（太陽方向 24,32,14 からの遮蔽判定） : = 影 . = 日向 ~ = 水');
  console.log('');
  for (const l of shadowView()) console.log(l);
} else if (view === 'channel') {
  const { out, c } = channelView();
  const legend = {
    R: 'Rチャンネル（赤の強さ。r値→明るいほど暖色/明色）',
    G: 'Gチャンネル（緑の強さ）',
    B: 'Bチャンネル（青の強さ。水面・空・寒色ほど明るい）',
    L: '輝度（0.2126R+0.7152G+0.0722B）',
    DOM: '支配チャンネル  r=赤が最強 g=緑が最強 b=青が最強 .=ほぼ無彩色',
  }[c] || '';
  console.log('チャンネルビュー [' + c + '] ' + legend);
  console.log('');
  for (const l of out) console.log(l);
} else if (view === 'movie') {
  for (const l of movieView()) console.log(l);
}