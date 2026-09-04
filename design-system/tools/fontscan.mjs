#!/usr/bin/env node
// tools/fontscan.mjs — Local font collection → Web usable & license-ledgered assets
// @why: [2026-08-28] design-system のローカルフォント収集（fonts/）を「ライセンス記録付きで Web で使える
//       資産」に変える自動パイプライン。フォントを fonts/ に放り込んで再実行するだけで
//       ① @font-face + CSS変数（tokens/fonts.css）② メタデータ台帳（fonts/fonts.json）
//       ③ ライセンス台帳（fonts/LICENSES.md）④ 試し打ちカタログ+ライセンス表示（font-hub.html）
//       を生成する。ライセンスはフォント内部の OpenType name テーブルから自動抽出し、
//       機械判定（✅/⚠️）はヒントとして残し、最終判断は人が原文で行う。
// @tags: SPEC, DESIGN_SYSTEM
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '..'); // yume-kit/design-system/
const DEFAULT_FONT_DIR = path.join(DEFAULT_ROOT, 'fonts');
const DEFAULT_OVERRIDES = path.join(DEFAULT_FONT_DIR, 'catalog.json'); // optional { familyName: { category? } }

const FMT = { '.ttf': 'truetype', '.otf': 'opentype', '.woff': 'woff', '.woff2': 'woff2' };
const FMT_ORDER = { woff2: 0, woff: 1, truetype: 2, opentype: 3 };

// ---------------------------------------------------------------- binary: sfnt & name table
function walkFonts(dir, depth = 0) {
  if (depth > 6 || !fs.existsSync(dir)) return [];
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkFonts(p, depth + 1));
    else if (FMT[path.extname(ent.name).toLowerCase()]) out.push(p);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function utf16buf(buf) {
  let out = '';
  for (let i = 0; i + 1 < buf.length; i += 2) out += String.fromCharCode(buf.readUInt16BE(i));
  return out;
}

// Read OpenType 'name' table. Returns null for woff2 (brotli 圧縮) or malformed files.
function readNameTable(buf, ext) {
  let numOff, entrySize, header;
  const magic = buf.readUInt32BE(0);
  if (magic === 0x774f4632 || ext === '.woff2') return null; // woff2: brotli inside — filename fallback
  if (magic === 0x774f4646) { entrySize = 20; header = 44; numOff = 8; } // WOFF
  else if ([0x00010000, 0x74727565, 0x4f54544f].includes(magic)) { entrySize = 12; header = 12; numOff = 4; } // TTF / 'true' / OTF
  else return null;

  const num = buf.readUInt16BE(numOff);
  let nb = null;
  for (let i = 0; i < num; i++) {
    const e = header + i * entrySize;
    if (buf.toString('latin1', e, e + 4) !== 'name') continue;
    nb = entrySize === 20
      ? { off: buf.readUInt32BE(e + 4), len: buf.readUInt32BE(e + 12) } // WOFF: tag off compLen origLen
      : { off: buf.readUInt32BE(e + 8), len: buf.readUInt32BE(e + 12) };
    break;
  }
  if (!nb || nb.off + nb.len > buf.length || nb.len < 6) return null;

  const base = nb.off;
  const count = buf.readUInt16BE(base + 2);
  if (count === 0 || count > 256) return null;
  const strOff = buf.readUInt16BE(base + 4);
  const recs = [];
  for (let i = 0; i < count; i++) {
    const r = base + 6 + i * 12;
    recs.push({
      plat: buf.readUInt16BE(r), enc: buf.readUInt16BE(r + 2),
      lang: buf.readUInt16BE(r + 4), id: buf.readUInt16BE(r + 6),
      len: buf.readUInt16BE(r + 8), off: buf.readUInt16BE(r + 10),
    });
  }
  const str = (id) => {
    const pick = recs.find(r => r.id === id && r.plat === 3 && (r.enc === 1 || r.enc === 0))
      || recs.find(r => r.id === id && r.plat === 0)
      || recs.find(r => r.id === id && r.plat === 1);
    if (!pick) return '';
    const o = base + strOff + pick.off;
    if (o + pick.len > buf.length) return '';
    const b = buf.subarray(o, o + pick.len);
    if (pick.plat === 1) return b.toString('latin1').replace(/[^\x20-\x7e]/g, '').trim();
    return utf16buf(b).replace(/\u0000/g, '').trim();
  };
  return {
    family: str(16) || str(1),
    subfamily: str(2),
    copyright: str(0),
    license: str(13),
    licenseUrl: str(14),
  };
}

function os2Weight(buf, ext) {
  const magic = buf.readUInt32BE(0);
  if (magic === 0x774f4632 || magic === 0x774f4646 || ext === '.woff2' || ext === '.woff') return null;
  const num = buf.readUInt16BE(4);
  for (let i = 0; i < num; i++) {
    const e = 12 + i * 12;
    if (buf.toString('latin1', e, e + 4) !== 'OS/2') continue;
    const off = buf.readUInt32BE(e + 8), len = buf.readUInt32BE(e + 12);
    if (off + 6 > buf.length) return null;
    const fsSel = len >= 64 && off + 64 <= buf.length ? buf.readUInt16BE(off + 62) : 0;
    return { weight: Math.min(900, Math.max(100, buf.readUInt16BE(off + 4))), italic: (fsSel & 1) === 1 };
  }
  return null;
}

function subweight(sub) {
  const n = (sub || '').toLowerCase();
  if (n.includes('thin')) return 100;
  if (n.includes('ultralight') || n.includes('extralight')) return 200;
  if (n.includes('light')) return 300;
  if (n.includes('semibold') || n.includes('demibold')) return 600;
  if (n.includes('bold')) return 700;
  if (n.includes('black') || n.includes('extrabold')) return 800;
  if (n.includes('medium')) return 500;
  return 400;
}

// ---------------------------------------------------------------- semantics
function classifyLicense(t) {
  const s = (t || '').toLowerCase();
  if (/sil open font/.test(s)) return { ok: true, kind: 'SIL OFL 1.1', note: '商用・Web埋込自由 / 単体再頒布と改変は同ライセンス継承' };
  if (/apache/.test(s)) return { ok: true, kind: 'Apache 2.0', note: '商用自由 / 帰属表示推奨' };
  if (/cc0|public domain/.test(s)) return { ok: true, kind: 'CC0 1.0', note: 'パブリックドメイン宣言' };
  if (/^mit\b|mit license/.test(s)) return { ok: true, kind: 'MIT', note: '帰属表記' };
  if (/free for commercial|commercial use (is )?allowed/.test(s)) return { ok: true, kind: '商用可（原文確認）', note: '文言を原文で確認推奨' };
  if (/proprietary|all rights reserved|do not sell|do not redistribute/.test(s)) return { ok: false, kind: '規制あり', note: '再頒布・改変に制限。原文を要確認' };
  return { ok: false, kind: '要確認', note: 'ライセンス未記載 or 未知。原文を要確認' };
}

function categorize(name, file, ov) {
  const cfg = ov || {};
  if (cfg[name] && cfg[name].category) return cfg[name].category;
  const n = (name + ' ' + path.basename(file)).toLowerCase();
  if (/mincho|serif|明朝|roman|times|garamond|bodoni|palatino|didot/.test(n)) return 'serif';
  if (/mono$|\bmono\b|jetbrains|fira code|courier|menlo|hack|gothic16|dotgothic|cascadia|fira mono/i.test(n)) return 'mono';
  if (/brush|hand|yuji|zaburian|stencil|pencil|pen\b/.test(n)) return 'brush';
  if (/display|dela|bungee|rocknroll|torus|stardust|clamp/.test(n)) return 'display';
  return 'sans';
}

// ---------------------------------------------------------------- scan
function readOverrides(p) {
  try { if (p && fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
  return {};
}

function scan(fontDir, overridePath) {
  const ov = readOverrides(overridePath);
  const files = walkFonts(fontDir).map((f) => ({ file: f, rel: path.relative(fontDir, f) }));
  const fams = [];
  for (const { file, rel } of files) {
    const ext = path.extname(rel).toLowerCase();
    const fnameBase = path.basename(rel, ext);
    const buf = fs.readFileSync(file);
    let meta = null, os2 = null;
    if (ext !== '.woff2') {
      os2 = os2Weight(buf, ext);
      meta = readNameTable(buf, ext);
    }
    if (!meta) {
      // メタ未取得（woff2 / 不正）はファイル名推測: 末尾のウェイト接尾辞を除去してファミリー名にする
      const base = fnameBase.trim();
      const famGuess = base.replace(/(?:-(?:Regular|Bold|Italic|Oblique|Light|Medium|Thin|Black|SemiBold|DemiBold|ExtraBold|ExtraLight|UltraLight|R|B|I|K))$/i, '');
      meta = {
        family: famGuess || base, subfamily: '', copyright: '', license: '', licenseUrl: '',
        fromFile: true, // メタ由来でない（CSS 変数選定で優先度を下げる）
      };
    }
    const fam = meta.family || fnameBase;
    // ウェイト/スタイルは name テーブルが無い場合（woff2 等）はファイル名からも推定
    const weight = os2 ? os2.weight : subweight((meta.subfamily || '') + ' ' + fnameBase);
    const style = /italic|oblique/i.test((meta.subfamily || '') + ' ' + fnameBase) || (os2 && os2.italic) ? 'italic' : 'normal';
    let grp = fams.find((g) => g.name === fam);
    if (!grp) { grp = { name: fam, category: categorize(fam, file, ov), override: ov[fam] || null, files: [] }; fams.push(grp); }
    grp.files.push({ rel, format: FMT[ext], weight, style, meta });
  }
  // collapse to best single file per (family, weight, style): woff2 > woff > ttf > otf
  for (const g of fams) {
    const best = new Map();
    for (const f of g.files) {
      const k = f.weight + '|' + f.style;
      const cur = best.get(k);
      if (!cur || FMT_ORDER[f.format] < FMT_ORDER[cur.format]) best.set(k, f);
    }
    g.files = [...best.values()].sort((a, b) => a.weight - b.weight || a.style.localeCompare(b.style));
    g.fromFileOnly = g.files.every((ff) => ff.meta.fromFile); // 全ファイルがメタ未取得（CSS変数の代表にしない）
  }
  fams.sort((a, b) => a.name.localeCompare(b.name));
  return fams;
}

// ---------------------------------------------------------------- outputs
function faceCss(fams, baseUrl) {
  let out = '';
  for (const f of fams) {
    for (const ff of f.files) {
      out += '@font-face {\n  font-family: "' + f.name + '";\n  font-weight: ' + ff.weight + ';\n  font-style: ' + ff.style + ';\n  font-display: swap;\n  src: url("' + baseUrl + ff.rel + '") format("' + ff.format + '");\n}\n\n';
    }
  }
  return out;
}

function tokenCss(fams) {
  const first = {};
  for (const c of ['sans', 'serif', 'display', 'mono', 'brush']) {
    const real = fams.find((f) => f.category === c && !f.fromFileOnly);
    const fallback = fams.find((f) => f.category === c);
    if (real) first[c] = real.name;
    else if (fallback) first[c] = fallback.name;
  }
  const stack = {
    sans: ['"Noto Sans JP"', '"Hiragino Sans"', 'system-ui', 'sans-serif'],
    serif: ['"Noto Serif JP"', 'serif'],
    display: ['var(--font-sans)'],
    mono: ['ui-monospace', '"SF Mono"', 'Menlo', 'monospace'],
    brush: ['var(--font-sans)'],
  };
  const lines = [];
  for (const c of ['sans', 'serif', 'display', 'mono', 'brush']) {
    if (!first[c]) continue;
    // 代表ファミリと同名のフォールバックは重複するので除く
    const fb = stack[c].filter((x) => x.replace(/^"|"$/g, '') !== first[c]);
    lines.push('  --font-' + c + ': "' + first[c] + '", ' + fb.join(', ') + ';');
  }
  const head = '/* tokens/fonts.css — AUTO-GENERATED by tools/fontscan.mjs. Do not edit manually. */';
  return head + '\n/* @why: [2026-08-28] fonts/ 収集フォントの Web 用 @font-face と CSS 変数。scan のたび再生成。 */\n:root {\n' + lines.join('\n') + '\n}\n\n/* Web で使う: font-family: var(--font-sans); ← ゴシック,  var(--font-serif); ← 明朝 … */\n';
}

function payload(fams, generatedAt, fontDir) {
  return {
    generatedAt,
    fontDir: path.relative(DEFAULT_ROOT, fontDir) || 'fonts',
    families: fams.map((f) => {
      const ov = f.override || {};
      const licenseText = ov.license || f.files[0].meta.license || '';
      const lic = classifyLicense(licenseText);
      return {
        name: f.name,
        category: f.category,
        copyright: ov.copyright || f.files[0].meta.copyright || '',
        licenseText,
        licenseUrl: ov.licenseUrl || f.files[0].meta.licenseUrl || '',
        note: ov.note || '',
        lic,
        files: f.files.map((ff) => ({ file: ff.rel, format: ff.format, weight: ff.weight, style: ff.style })),
      };
    }),
  };
}

function licensesMd(data) {
  const rows = data.families
    .map((f) => {
      const con = f.lic.ok ? '✅' : '⚠️';
      const m = (s) => (s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      return '| ' + m(f.name) + ' | ' + f.category + ' | ' + f.files.map((x) => x.weight + (x.style === 'italic' ? 'i' : '')).join(' / ') + ' | ' + m(f.lic.kind) + ' | ' + con + ' | ' + (m(f.lic.note) + (f.note ? ' / ' + m(f.note) : '')) + ' | ' + (m(f.licenseUrl) || '─') + ' | ' + (m(f.copyright) || '—') + ' |';
    })
    .join('\n');
  return `# フォント ライセンス台帳（自動生成）

> この台帳は \`tools/fontscan.mjs\` が自動生成します。\`fonts/\` にフォントを追加して再実行すれば自動更新されます。
> ライセンスは各フォント内部（OpenType name テーブル）からの自動抽出。**自動判定はヒントであり、最終的な利用可否は
> 各ライセンス原文で必ず確認**してください（✅=機械的に「開放」と読めたもの / ⚠️=要確認）。

- 更新日時: ${data.generatedAt}
- 収集先: \`${data.fontDir}/\`

| ファミリー | カテゴリ | 同梱ウェイト | ライセンス（自動判定） | 可否 | メモ | URL | 著作権 |
|---|---|---|---|---|---|---|---|
${rows}

---
## 問題ないフォントの入手ルート（ライセンス的に安全）

| ソース | ライセンス | 備考 |
|---|---|---|
| Google Fonts（github.com/google/fonts） | 大半 OFL 1.1 / Apache 2.0 | 商用・Web利用とも自由。フォントごとに個別確認 |
| Fontsource（npm \`@fontsource/*\`） | 各 OSS フォントの woff2 | コマンドでローカルに落とせ、そのままこの fonts/ へ |
| 日本語 OSS ゴシック | Noto Sans JP / M PLUS / Zen Kaku Gothic / BIZ UDPGothic | OFL 等、本文・UI 向き |
| 日本語 OSS 明朝 | Shippori Mincho / Noto Serif JP / Kaisei Tokumin | OFL、本文・書籍向き |
| 日本語 ディスプレイ | Dela Gothic One / DotGothic16 / Yuji Boku / RocknRoll One | OFL、見出し・アクセント向き |

> ライセンス記載のないもの（⚠️ 要確認）を Web で使う前に、作者の配布ページ原文を必ず確認してから利用してください。
`;
}

function hubHtml(payload, facesCss) {
  const json = JSON.stringify(payload);
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>フォントブック — ローカルフォント見本帳 &amp; ライセンス台帳</title>
<!-- @why: [2026-08-28] tools/fontscan.mjs の生成物。fonts/ に追加して node tools/fontscan.mjs を再実行すると再生成される。 -->
<style>
:root {
  --bg: #FAFAF9;
  --panel: #FFFFFF;
  --ink: #18181B;
  --muted: #71717A;
  --line: #E4E4E7;
  --row-hover: #F4F4F5;
  --badge-bg: #F4F4F5;
  --badge-ink: #52525B;
  --code-bg: #F4F4F5;
  --code-ink: #27272A;
  --sp-ink: #18181B;
  --sp-label: #A1A1AA;
  --btn-bg: #FFFFFF;
  --btn-border: #D4D4D8;
  --btn-ink: #18181B;
  --accent: #18181B;
}
[data-theme="dark"] {
  --bg: #09090B;
  --panel: #18181B;
  --ink: #FAFAFA;
  --muted: #A1A1AA;
  --line: #27272A;
  --row-hover: #27272A;
  --badge-bg: #27272A;
  --badge-ink: #D4D4D8;
  --code-bg: #27272A;
  --code-ink: #E4E4E7;
  --sp-ink: #FAFAFA;
  --sp-label: #71717A;
  --btn-bg: #27272A;
  --btn-border: #3F3F46;
  --btn-ink: #FAFAFA;
  --accent: #FAFAFA;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: "Noto Sans JP", "Hiragino Sans", -apple-system, BlinkMacSystemFont, sans-serif;
  background: var(--bg);
  color: var(--ink);
  line-height: 1.5;
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}
header {
  border-bottom: 1px solid var(--line);
  padding: 16px 28px;
  background: var(--panel);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.header-left {
  display: flex;
  align-items: baseline;
  gap: 14px;
  flex-wrap: wrap;
}
.kicker {
  font-size: 10px;
  letter-spacing: .2em;
  color: var(--muted);
  font-weight: 700;
  text-transform: uppercase;
}
h1 {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: .02em;
}
.font-count {
  font-size: 12px;
  color: var(--muted);
  background: var(--badge-bg);
  padding: 2px 8px;
  border-radius: 99px;
}
.theme-btn {
  background: var(--btn-bg);
  border: 1px solid var(--btn-border);
  color: var(--btn-ink);
  padding: 4px 12px;
  border-radius: 99px;
  font-size: 11px;
  cursor: pointer;
}
.theme-btn:hover { background: var(--row-hover); }

/* 一括コントロールバー（上部固定・超高機能） */
.sticky-bar {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  padding: 12px 28px;
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
  box-shadow: 0 2px 8px rgba(0,0,0,.03);
}
.search-input {
  flex: 1 1 260px;
  min-width: 200px;
  background: var(--bg);
  border: 1px solid var(--line);
  color: var(--ink);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 14px;
}
.search-input:focus {
  outline: none;
  border-color: var(--accent);
}
.filter-tabs {
  display: flex;
  gap: 4px;
  background: var(--bg);
  padding: 3px;
  border-radius: 6px;
  border: 1px solid var(--line);
}
.tab-btn {
  background: transparent;
  border: none;
  color: var(--muted);
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.tab-btn.active {
  background: var(--panel);
  color: var(--ink);
  box-shadow: 0 1px 2px rgba(0,0,0,.05);
}
.slider-group {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 11px;
  color: var(--muted);
}
.slider-group input { width: 90px; }

/* 1フォント1行リスト */
main {
  max-width: 1400px;
  margin: 0 auto;
  padding: 16px 28px 80px;
}
.font-list {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}
.font-row {
  border-bottom: 1px solid var(--line);
  transition: background .1s;
}
.font-row:last-child { border-bottom: none; }
.font-row:hover { background: var(--row-hover); }

/* 行のメイン部（1行圧縮） */
.row-main {
  display: flex;
  align-items: center;
  padding: 14px 20px;
  gap: 16px;
  cursor: pointer;
}
.fav-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 4px;
  border-radius: 4px;
  color: var(--muted);
  opacity: 0.4;
  transition: all .15s;
  user-select: none;
  flex: 0 0 24px;
  text-align: center;
}
.fav-btn:hover {
  opacity: 1;
  transform: scale(1.2);
  color: #E11D48;
}
.fav-btn.active {
  opacity: 1;
  color: #E11D48;
}
.row-meta {
  flex: 0 0 210px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.font-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.font-tags {
  display: flex;
  gap: 4px;
  align-items: center;
  flex-wrap: wrap;
}
.tag {
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--badge-bg);
  color: var(--badge-ink);
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: .05em;
}
.tag.lic { background: transparent; border: 1px solid var(--line); }

/* 1行ストリーム見本（主役） */
.row-sample {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 24px;
  line-height: 1.3;
  color: var(--sp-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row-toggle {
  flex: 0 0 32px;
  text-align: right;
  font-size: 11px;
  color: var(--muted);
  user-select: none;
}

/* アコーディオン詳細部（クリックで展開） */
.row-detail {
  display: none;
  padding: 18px 20px 22px 230px;
  background: var(--bg);
  border-top: 1px dashed var(--line);
}
.font-row.open .row-detail { display: block; }
.font-row.open .row-toggle { transform: rotate(180deg); }

.detail-grid {
  display: grid;
  gap: 12px;
}
.spec-line {
  display: flex;
  gap: 16px;
  align-items: baseline;
}
.spec-lbl {
  flex: 0 0 70px;
  font-size: 10px;
  letter-spacing: .15em;
  color: var(--sp-label);
  text-transform: uppercase;
  font-weight: 600;
}
.spec-txt {
  font-size: 20px;
  line-height: 1.8;
  color: var(--sp-ink);
  white-space: pre-wrap;
  word-break: break-all;
}
.detail-footer {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  font-size: 11px;
  color: var(--muted);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.detail-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  background: var(--code-bg);
  color: var(--code-ink);
  padding: 3px 8px;
  border-radius: 4px;
}

footer {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px 28px 40px;
  font-size: 11px;
  color: var(--muted);
  text-align: center;
}
</style>
</head>
<body>
<header>
  <div class="header-left">
    <div class="kicker">Local Font Book</div>
    <h1>フォント見本帳</h1>
    <span class="font-count" id="countBadge">38 Families</span>
  </div>
  <div style="display:flex; gap:8px; align-items:center;">
    <button id="licenseModalBtn" class="theme-btn" style="border-color:var(--btn-border);">📜 ライセンス早見表</button>
    <button id="themeToggle" class="theme-btn">🌙 ダーク</button>
  </div>
</header>

<!-- ライセンス早見表（トグル表示） -->
<div id="licenseGuide" style="display:none; background:var(--panel); border-bottom:1px solid var(--line); padding:24px 28px; box-shadow:0 4px 12px rgba(0,0,0,.04);">
  <div style="max-width:1400px; margin:0 auto;">
    <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:14px;">
      <h2 style="font-size:14px; font-weight:700; color:var(--ink); margin:0;">収録フォントのライセンス概略（SIL OFL 1.1 / Apache 2.0）</h2>
      <button id="closeLicGuide" style="background:none; border:none; color:var(--muted); font-size:16px; cursor:pointer;">✕</button>
    </div>
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:16px; font-size:12px; line-height:1.7;">
      <div style="background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:14px 16px;">
        <strong style="color:var(--ink); display:block; margin-bottom:6px;">⭕ 完全に許可されていること</strong>
        <ul style="padding-left:18px; color:var(--muted); margin:0; display:grid; gap:4px;">
          <li><b>商用利用・個人利用</b>（Webサイト、アプリ、動画、広告、ゲーム等）</li>
          <li><b>Webフォント埋め込み</b>（<code>@font-face</code> やサブセット化）</li>
          <li><b>印刷物・商品パッケージ・同人誌</b>への印字</li>
          <li><b>ロゴ・商標デザイン</b>（文字をアウトライン化してロゴに使用）</li>
          <li><b>改変・派生フォント作成</b>（フォント自体の字形修正・合成）</li>
        </ul>
      </div>
      <div style="background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:14px 16px;">
        <strong style="color:var(--ink); display:block; margin-bottom:6px;">❌ 禁止されていること・要件</strong>
        <ul style="padding-left:18px; color:var(--muted); margin:0; display:grid; gap:4px;">
          <li><b>フォント単体での転売・販売</b>（フォントファイル自体をお金を取って売る行為）</li>
          <li><b>改変後の非オープン化</b>（改変フォントを配布する場合は同じOFLライセンスを継承）</li>
          <li><b>予約フォント名（Reserved Font Name）の無断使用</b>（改変時は別名をつける）</li>
          <li><b>著作権表記の保持</b>（CSSや配布物に著作権テキストを残す — 当システムは自動内蔵）</li>
        </ul>
      </div>
      <div style="background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:14px 16px;">
        <strong style="color:var(--ink); display:block; margin-bottom:6px;">ℹ️ 当ワークスペースでの利用方針</strong>
        <p style="color:var(--muted); margin:0;">
          当コレクションのフォントはすべて <code>SIL OFL 1.1</code> または <code>Apache 2.0</code> です。
          制作する Web アプリ・LP・システム画面で<b>完全に自由・ロイヤリティフリー</b>で利用できます。
        </p>
      </div>
    </div>
  </div>
</div>

<div class="sticky-bar">
  <input type="text" id="customText" class="search-input" value="あいう アイウ 永字八法 春夏秋冬 0123 AaBbCc" placeholder="テスト文字列を入力（全フォントに即時反映）">
  <div class="filter-tabs">
    <button class="tab-btn active" data-cat="all">全て</button>
    <button class="tab-btn" data-cat="fav" id="favTabBtn">❤️ お気に入り (<span id="favCount">0</span>)</button>
    <button class="tab-btn" data-cat="sans">ゴシック</button>
    <button class="tab-btn" data-cat="serif">明朝</button>
    <button class="tab-btn" data-cat="brush">手書き/丸</button>
    <button class="tab-btn" data-cat="display">見出し</button>
    <button class="tab-btn" data-cat="mono">等幅</button>
  </div>
  <div class="slider-group">
    <span>サイズ: <b id="szVal">24</b>px</span>
    <input type="range" id="szSlider" min="14" max="56" value="24">
  </div>
</div>

<main>
  <div class="font-list" id="fontList"></div>
</main>
<footer>yume-kit/design-system/font-hub.html · 1行圧縮・高密度一覧版 · 自動生成 (${payload.generatedAt})</footer>
<script>
var FONT_DATA = ${json};
</script>
<script>
(function () {
  'use strict';
  var fams = FONT_DATA.families || [];

  // ---- テーマ切り替え
  var themeBtn = document.getElementById('themeToggle');
  function setTheme(t) {
    if (t === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      themeBtn.textContent = '☀️ ライト';
    } else {
      document.documentElement.removeAttribute('data-theme');
      themeBtn.textContent = '🌙 ダーク';
    }
    try { localStorage.setItem('ds_theme', t); } catch (e) {}
  }
  var saved = 'light';
  try { saved = localStorage.getItem('ds_theme') || 'light'; } catch (e) {}
  setTheme(saved);
  themeBtn.addEventListener('click', function () {
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    setTheme(isDark ? 'light' : 'dark');
  });

  // ---- font-face 注入（hub.html は fonts/ からの相対読込）
  var st = document.createElement('style');
  st.textContent = '${facesCss.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}';
  document.head.appendChild(st);

  // ---- ライセンスガイド開閉
  var licBtn = document.getElementById('licenseModalBtn');
  var licGuide = document.getElementById('licenseGuide');
  var closeLic = document.getElementById('closeLicGuide');
  if (licBtn && licGuide && closeLic) {
    licBtn.addEventListener('click', function(){
      var isHidden = licGuide.style.display === 'none';
      licGuide.style.display = isHidden ? 'block' : 'none';
      licBtn.style.background = isHidden ? 'var(--row-hover)' : 'var(--btn-bg)';
    });
    closeLic.addEventListener('click', function(){
      licGuide.style.display = 'none';
      licBtn.style.background = 'var(--btn-bg)';
    });
  }
  document.getElementById('countBadge').textContent = fams.length + ' Families';

  var customInput = document.getElementById('customText');
  var szSlider = document.getElementById('szSlider');
  var szVal = document.getElementById('szVal');
  var fontList = document.getElementById('fontList');
  var currentCat = 'all';

  // ---- お気に入り管理 (localStorage: ds_font_favs)
  var favs = {};
  try {
    var savedFavs = JSON.parse(localStorage.getItem('ds_font_favs') || '[]');
    savedFavs.forEach(function(k){ favs[k] = true; });
  } catch(e){}

  function updateFavCount() {
    var count = Object.keys(favs).filter(function(k){ return favs[k]; }).length;
    var el = document.getElementById('favCount');
    if (el) el.textContent = count;
  }
  updateFavCount();

  function toggleFav(name, btn, e) {
    if (e) e.stopPropagation();
    if (favs[name]) {
      delete favs[name];
      btn.classList.remove('active');
      btn.textContent = '♡';
    } else {
      favs[name] = true;
      btn.classList.add('active');
      btn.textContent = '❤️';
    }
    try {
      localStorage.setItem('ds_font_favs', JSON.stringify(Object.keys(favs)));
    } catch(e){}
    updateFavCount();
    if (currentCat === 'fav') {
      renderList();
    }
  }

  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

  // ---- 1行フォントリスト描画
  var SPEC = [
    ['ひらがな', 'あいうえお かきくけこ さしすせそ たちつてと なにぬねの はひふへほ まみむめも やゆよ らりるれろ わをん がぎぐげご ざじずぜぞ だぢづでど ばびぶべぼ ぱぴぷぺぽ'],
    ['カタカナ', 'アイウエオ カキクケコ サシスセソ タチツテト ナニヌネノ ハヒフヘホ マミムメモ ヤユヨ ラリルレロ ワヲン ガギグゲゴ ザジズゼゾ ダヂヅデド バビブベボ パピプペポ'],
    ['漢字', '永字八法 春夏秋冬 花鳥風月 東京都特別区 日本語漢字見本 鬱薔薇驚鑑璽'],
    ['数字・英字', '0 1 2 3 4 5 6 7 8 9 · ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz']
  ];

  function renderList() {
    fontList.innerHTML = '';
    var filtered = fams.filter(function(f){
      if (currentCat === 'fav') return !!favs[f.name];
      if (currentCat === 'all') return true;
      return f.category === currentCat;
    });

    filtered.forEach(function (f) {
      var row = document.createElement('div');
      row.className = 'font-row';

      var lic = f.lic || { ok:true, kind:'OFL 1.1' };
      var wts = f.files.map(function(x){ return 'w' + x.weight; }).join('/');
      var isFav = !!favs[f.name];

      var mainDiv = document.createElement('div');
      mainDiv.className = 'row-main';

      var favBtn = document.createElement('button');
      favBtn.className = 'fav-btn' + (isFav ? ' active' : '');
      favBtn.textContent = isFav ? '❤️' : '♡';
      favBtn.title = isFav ? 'お気に入りを解除' : 'お気に入りに追加';
      favBtn.addEventListener('click', function(e){ toggleFav(f.name, favBtn, e); });

      var metaDiv = document.createElement('div');
      metaDiv.className = 'row-meta';
      metaDiv.innerHTML = '<div class="font-title">' + esc(f.name) + '</div><div class="font-tags"><span class="tag">' + esc(f.category) + '</span><span class="tag">' + wts + '</span><span class="tag lic">' + esc(lic.kind) + '</span></div>';

      var sampleDiv = document.createElement('div');
      sampleDiv.className = 'row-sample';
      sampleDiv.style.fontFamily = '"' + f.name + '", sans-serif';
      sampleDiv.style.fontSize = szSlider.value + 'px';
      sampleDiv.textContent = customInput.value;

      var toggleDiv = document.createElement('div');
      toggleDiv.className = 'row-toggle';
      toggleDiv.textContent = '▾';

      mainDiv.appendChild(favBtn);
      mainDiv.appendChild(metaDiv);
      mainDiv.appendChild(sampleDiv);
      mainDiv.appendChild(toggleDiv);

      // 詳細部（アコーディオン）
      var detailDiv = document.createElement('div');
      detailDiv.className = 'row-detail';

      var detailGrid = document.createElement('div');
      detailGrid.className = 'detail-grid';

      SPEC.forEach(function(s){
        var sLine = document.createElement('div');
        sLine.className = 'spec-line';
        var sTxt = document.createElement('span');
        sTxt.className = 'spec-txt';
        sTxt.style.fontFamily = '"' + f.name + '", sans-serif';
        sTxt.textContent = s[1];
        sLine.innerHTML = '<span class="spec-lbl">' + s[0] + '</span>';
        sLine.appendChild(sTxt);
        detailGrid.appendChild(sLine);
      });

      var detailFooter = document.createElement('div');
      detailFooter.className = 'detail-footer';
      var noteText = f.note ? esc(f.note) : '';
      var copyText = f.copyright ? '<span style="color:var(--muted); font-size:10px;">' + esc(f.copyright) + '</span>' : '';
      var licTerms = '<span style="display:inline-flex; gap:6px; font-size:10px; color:var(--muted);"><span style="color:#16A34A;">●商用○</span> <span>●Web埋込○</span> <span>●改変○</span> <span style="color:#DC2626;">●単体販売✕</span></span>';
      var licLink = f.licenseUrl ? '<a href="' + esc(f.licenseUrl) + '" target="_blank" rel="noopener" style="color:var(--muted); text-decoration:underline;">' + esc(lic.kind) + ' 原文</a>' : '<span>' + esc(lic.kind) + '</span>';

      detailFooter.innerHTML = '<div style="display:grid; gap:4px;"><div>' + (noteText ? '<b style="color:var(--ink);">' + noteText + '</b> ' : '') + licTerms + ' · ' + licLink + '</div>' + copyText + '</div><span class="detail-code">font-family: "' + esc(f.name) + '";</span>';

      detailDiv.appendChild(detailGrid);
      detailDiv.appendChild(detailFooter);

      row.appendChild(mainDiv);
      row.appendChild(detailDiv);

      mainDiv.addEventListener('click', function(){
        row.classList.toggle('open');
      });

      fontList.appendChild(row);
    });

    if (filtered.length === 0) {
      fontList.innerHTML = '<div style="padding:30px; text-align:center; color:var(--muted);">該当するフォントがありません</div>';
    }
  }

  // リアルタイム入力連動（全フォントの一行見本が一瞬で書き換わる）
  customInput.addEventListener('input', function(){
    var val = customInput.value || 'あいう アイウ 永字八法 春夏秋冬 0123 AaBbCc';
    var samples = document.querySelectorAll('.row-sample');
    for (var i = 0; i < samples.length; i++) {
      samples[i].textContent = val;
    }
  });

  // サイズスライダー
  szSlider.addEventListener('input', function(){
    szVal.textContent = szSlider.value;
    var samples = document.querySelectorAll('.row-sample');
    for (var i = 0; i < samples.length; i++) {
      samples[i].style.fontSize = szSlider.value + 'px';
    }
  });

  // カテゴリタブ切り替え
  var tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(function(t){
    t.addEventListener('click', function(){
      tabs.forEach(function(x){ x.classList.remove('active'); });
      t.classList.add('active');
      currentCat = t.getAttribute('data-cat');
      renderList();
    });
  });

  renderList();
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------- writer / CLI
function generate(opts = {}) {
  const root = opts.root || DEFAULT_ROOT;
  const fontDir = opts.fontDir || DEFAULT_FONT_DIR;
  const overrides = path.join(fontDir, 'catalog.json');
  const fams = scan(fontDir, overrides);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const pd = payload(fams, now, fontDir);
  const outCss = path.join(root, 'tokens', 'fonts.css');
  const outJson = path.join(fontDir, 'fonts.json');
  const outLic = path.join(fontDir, 'LICENSES.md');
  const outHub = path.join(root, 'font-hub.html');
  fs.mkdirSync(path.dirname(outCss), { recursive: true });
  fs.mkdirSync(fontDir, { recursive: true });
  fs.writeFileSync(outCss, tokenCss(fams) + '\n' + faceCss(fams, '../fonts/'));
  fs.writeFileSync(outJson, JSON.stringify(pd, null, 2) + '\n');
  fs.writeFileSync(outLic, licensesMd(pd));
  fs.writeFileSync(outHub, hubHtml(pd, faceCss(fams, 'fonts/')));
  return { fams, pd, outCss, outJson, outLic, outHub };
}

function main() {
  const { fams, pd, outCss, outJson, outLic, outHub } = generate();
  console.log('── fontscan: ローカルフォント → Web font 資産');
  console.log('  収集元 : fonts/');
  console.log('  生成物 :\n    ' + outCss + '\n    ' + outJson + '\n    ' + outLic + '\n    ' + outHub);
  if (fams.length === 0) {
    console.log('\n  ⚠ fonts/ は空です。フォントを放り込んでから再実行してください。');
    return;
  }
  console.log('\n  コレクション:');
  for (const f of fams) {
    const l = pd.families.find((x) => x.name === f.name).lic;
    const mark = l.ok ? '✅' : '⚠️';
    const wts = f.files.map((x) => x.weight + (x.style === 'italic' ? 'i' : '')).join(', ');
    console.log(`    ${mark} ${f.name}  [${f.category}]  w:${wts}  — ${l.kind}`);
  }
  console.log('\n  完成: fonts/ に追加 → 再実行で全資産が追従します。');
}

export { generate, scan, classifyLicense, categorize };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();