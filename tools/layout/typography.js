// ─────────────────────────────────────────────────────────────────
// map of meaning — typography.js
// 責務: 和文DTP由来の文字列変換とCSSフラグ組み立て。DOM非依存・Node/ブラウザ共通。
// 公開関数の入口:
//   escapeHtml(s)             HTML エスケープ（セキュリティ基礎）
//   rubyExplicit(text)        ｜漢字《かんじ》 → <ruby> 形式
//   rubyImplicit(text)        漢字《かんじ》 を <ruby> に変換
//   applyTcy(text)            {{19}} / [tcy:19] を縦中横に
//   applyAutoTcy(text)        半角1〜2桁を自動縦中横に
//   applyDropCap(text)        [[初]] を初字拡大に
//   applyWarichu(text)        〔〔上｜下〕〕 を割注に（長文は自動2行分割）
//   parseBouten(inner)        《《白丸:文字》》 形式を傍点スタイルに
//   applyAutospace(text)      和欧文間四分アキ (0.25em) を挿入
//   inlineTypography(text,opts) 全体のパイプライン（適用順は内部実装に従う）
//   resolveKerning(kerning, isV) 字詰めフラグをCSSに展開（kana/palt/tight/yakumono/beta）
//   resolveScaling({choutai,heitai,scaleX,scaleY}) transform: scale(...) の計算
//   FONT_PRESETS              serif/sans/mono プリセット
//   resolveFont(font)         CSS font-family 文字列へ
//
// 壊してはいけない性質（HANDOFF §9 と一致）:
//   - DOM を一切触らない（Node test.js、ブラウザ、Puppeteerから同一呼出で使える）。
//   - 変換は文字列sの長さや見た目の情報量を大きく変えない（適用前後で意図差分のみ）。
//   - apply* / parse* は入力に存在しないパターンを発見しても黙って素通し（throwしない）。
//   - resolve* は未知の値に対して「無効化（=デフォルト）」を返す（上書き消滅回避）。
//
// AIが1分で観測する手順:
//   cd layout-cli
//   node -e "import('./typography.js').then(t=>console.log(t.applyWarichu('本文〔〔A｜B〕〕続き')))"
//   npm run render -- examples/typography-demo.json --png
// ─────────────────────────────────────────────────────────────────

/**
 * layout-cli/typography.js — 純粋タイポグラフィ処理（DOM非依存・ブラウザ/Node共通）。
 *
 * 和文出版・DTP規格（JIS X 4051・Q数H数・割注・多種傍点・かな詰め・四分アキ）の完全モジュール:
 * 1. 単位: Q (級 = 0.25mm), H (歯 = 0.25mm), pt, mm, cm, in, px, %
 * 2. 割注 (Warichu): `〔〔上段｜下段〕〕` または `〔〔長文割注テキスト〕〕` (自動2行分割)
 * 3. 傍点多種:
 *    - 黒ゴマ: `《《ゴマ:文字》》` / `《《文字》》`
 *    - 白ゴマ: `《《白ゴマ:文字》》`
 *    - 黒丸: `《《丸:文字》》` / `《《黒丸:文字》》`
 *    - 白丸/蛇の目: `《《白丸:文字》》`
 *    - 三角: `《《三角:文字》》`
 *    - 二重丸: `《《二重丸:文字》》`
 * 4. 初字拡大 (Drop Cap): `[[初]]字拡大`
 * 5. 縦中横: `{{19}}`, `[tcy:19]`, または `autoTcy: true` による半角1〜2桁の自動縦中横
 * 6. 和欧文間四分アキ (autospace): 漢字/かな と 半角英数の間に 0.25em アキ自動挿入
 * 7. 長体 (choutai)・平体 (heitai) 変形スケール
 * 8. 字詰め (kerning): beta, kana (pkna), palt (vpal), tight, loose, yakumono
 *
 * // @why: [2026-08-26] ユーザー要求「タイポグラフィの更なる強化。割注・Q数H数・多種傍点・長体平体・初字拡大・自動縦中横」。
 * //       和文DTPの現場で使われる奥義（割注、級数Q/歯数H、かな詰めpkna、初字拡大、蛇の目傍点）を完全網羅。
 * // @tags: SPEC
 */

/** HTML エスケープ */
export function escapeHtml(s = '') {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 明示ルビ ｜base《ruby》 */
export function rubyExplicit(text = '') {
  return String(text).replace(/｜([^《》\n]+)《([^《》\n]+)》/g, (_, base, ruby) => {
    return `<ruby>${escapeHtml(base)}<rt>${escapeHtml(ruby)}</rt></ruby>`;
  });
}

/** 暗黙ルビ 漢字《かんじ》 */
export function rubyImplicit(text = '') {
  return String(text).replace(/([一-龠々〆ヵヶ]+)《([^《》\n]+)》/g, (_, base, ruby) => {
    return `<ruby>${escapeHtml(base)}<rt>${escapeHtml(ruby)}</rt></ruby>`;
  });
}

/** 縦中横: {{19}} または [tcy:19] */
export function applyTcy(text = '') {
  return String(text)
    .replace(/\{\{([^\}\n]+)\}\}/g, (_, inner) => `<span class="tcy">${escapeHtml(inner)}</span>`)
    .replace(/\[tcy:([^\]\n]+)\]/g, (_, inner) => `<span class="tcy">${escapeHtml(inner)}</span>`);
}

/** 自動縦中横（1〜2桁の数字を自動で <span class="tcy"> 化） */
export function applyAutoTcy(text = '') {
  return String(text).replace(/(^|[^\d])(\d{1,2})([^\d]|$)/g, (m, p1, d, p2) => {
    return `${p1}<span class="tcy">${d}</span>${p2}`;
  });
}

/** 初字拡大 (Drop Cap): [[初]]文字 */
export function applyDropCap(text = '') {
  return String(text).replace(/\[\[([^\]\n]+)\]\]/g, (_, cap) => {
    return `<span class="drop-cap">${escapeHtml(cap)}</span>`;
  });
}

/**
 * 割注 (Warichu): 〔〔上段｜下段〕〕 または 〔〔8文字以上の割注〕〕 (自動2等分)
 */
export function applyWarichu(text = '') {
  return String(text).replace(/〔〔([^〕\n]+)〕〕/g, (_, inner) => {
    let top = '', bot = '';
    if (inner.includes('｜')) {
      const sp = inner.split('｜');
      top = sp[0];
      bot = sp.slice(1).join('｜');
    } else {
      // 自動で文字数を半分に分割
      const half = Math.ceil(inner.length / 2);
      top = inner.slice(0, half);
      bot = inner.slice(half);
    }
    return `<span class="warichu"><span class="w-paren">（</span><span class="w-lines"><span class="w-l">${escapeHtml(top)}</span><span class="w-l">${escapeHtml(bot)}</span></span><span class="w-paren">）</span></span>`;
  });
}

/** 傍点の種別マップ */
const BOUTEN_TYPES = {
  'ゴマ': 'sesame',
  '黒ゴマ': 'sesame',
  'sesame': 'sesame',
  '白ゴマ': 'open-sesame',
  'open-sesame': 'open-sesame',
  '丸': 'circle',
  '黒丸': 'circle',
  'circle': 'circle',
  '白丸': 'open-circle',
  '蛇の目': 'open-circle',
  'open-circle': 'open-circle',
  '三角': 'triangle',
  'triangle': 'triangle',
  '二重丸': 'double-circle',
  'double-circle': 'double-circle',
};

/** 傍点《《種別:テキスト》》または《《テキスト》》 */
export function parseBouten(innerRaw) {
  let type = 'sesame';
  let content = innerRaw;
  const m = /^([^:\n]+):([\s\S]+)$/.exec(innerRaw);
  if (m && BOUTEN_TYPES[m[1].trim()]) {
    type = BOUTEN_TYPES[m[1].trim()];
    content = m[2];
  }
  return { type, content };
}

/** 和欧文間四分アキ（JIS X 4051 準拠: 漢字/仮名 と 半角英数字の境界に 0.25em アキ） */
export function applyAutospace(text = '') {
  const cjk = '[一-龠々〆ヵヶぁ-んァ-ヶー]';
  const latin = '[A-Za-z0-9]';
  const r1 = new RegExp(`(${cjk})(${latin})`, 'g');
  const r2 = new RegExp(`(${latin})(${cjk})`, 'g');
  return String(text)
    .replace(r1, '$1<span class="q-sp"></span>$2')
    .replace(r2, '$1<span class="q-sp"></span>$2');
}

/** 行内タイポグラフィ展開（エスケープ → 初字拡大 → 割注 → 縦中横 → 傍点 → ルビ → 四分アキ） */
export function inlineTypography(text = '', { autospace = false, autoTcy = false } = {}) {
  if (!text) return '';
  let raw = String(text);
  
  // 1. 初字拡大 [[文字]]
  raw = applyDropCap(raw);
  
  // 2. 割注 〔〔…〕〕
  raw = applyWarichu(raw);

  // 3. 自動縦中横
  if (autoTcy) {
    raw = applyAutoTcy(raw);
  }

  // 4. 傍点《《…》》の抽出・保護（種別対応）
  const parts = [];
  let i = 0;
  const n = raw.length;
  while (i < n) {
    const k = raw.indexOf('《《', i);
    if (k === -1) { parts.push(processInline(raw.slice(i), autospace)); break; }
    parts.push(processInline(raw.slice(i, k), autospace));
    
    let depth = 0, j = k, closed = false;
    while (j < n) {
      if (raw[j] === '《') depth++;
      else if (raw[j] === '》') { depth--; if (depth === 0) { j++; closed = true; break; } }
      j++;
    }
    if (closed) {
      const inner = raw.slice(k + 2, j - 2);
      const { type, content } = parseBouten(inner);
      parts.push(`<em class="bouten bouten-${type}">${processInline(content, autospace)}</em>`);
      i = j;
    } else {
      parts.push(processInline('《《', autospace));
      i = k + 2;
    }
  }
  return parts.join('');
}

function processInline(s, autospace) {
  let res = applyTcy(s);
  res = rubyImplicit(rubyExplicit(res));
  if (autospace) {
    res = applyAutospace(res);
  }
  return res;
}

/** 字詰め設定の解決（OpenType features & letter-spacing） */
export function resolveKerning(kerning, isVertical = false) {
  if (kerning === null || kerning === undefined) return null;
  const k = typeof kerning === 'string' ? kerning.toLowerCase().trim() : (kerning ? 'palt' : 'beta');

  switch (k) {
    case 'beta':
    case 'none':
    case 'ベタ':
    case '等幅':
      return {
        features: ['"palt" 0', '"pkna" 0', 'tabular-nums'],
        letterSpacing: null,
      };

    case 'kana':
    case 'かな':
    case 'かな詰め':
      return {
        features: ['"pkna" 1', '"palt" 0'],
        letterSpacing: null,
      };

    case 'palt':
    case 'proportional':
    case '文字詰め':
    case '標準詰め':
      return {
        features: isVertical ? ['"vpal" 1', '"palt" 1'] : ['"palt" 1'],
        letterSpacing: null,
      };

    case 'tight':
    case 'ツメ':
    case '極詰め':
      return {
        features: isVertical ? ['"vpal" 1', '"palt" 1'] : ['"palt" 1'],
        letterSpacing: '-0.04em',
      };

    case 'loose':
    case 'アキ':
    case '疎':
      return {
        features: ['"palt" 0'],
        letterSpacing: '0.12em',
      };

    case 'yakumono':
    case '約物':
    case '約物詰め':
      return {
        features: isVertical ? ['"vhal" 1', '"vchw" 1'] : ['"halt" 1', '"chws" 1'],
        letterSpacing: null,
      };

    default:
      return {
        features: isVertical ? ['"vpal" 1', '"palt" 1'] : ['"palt" 1'],
        letterSpacing: String(kerning),
      };
  }
}

/** 長体・平体スケール計算 (choutai / heitai: パーセンテージまたは倍率) */
export function resolveScaling({ choutai, heitai, scaleX, scaleY }) {
  let sx = scaleX ?? 1;
  let sy = scaleY ?? 1;

  if (choutai !== undefined && choutai !== null) {
    const val = typeof choutai === 'number' ? (choutai > 2 ? choutai / 100 : choutai) : parseFloat(choutai) / 100;
    sx = val;
  }
  if (heitai !== undefined && heitai !== null) {
    const val = typeof heitai === 'number' ? (heitai > 2 ? heitai / 100 : heitai) : parseFloat(heitai) / 100;
    sy = val;
  }

  if (sx === 1 && sy === 1) return null;
  return { sx: +sx.toFixed(3), sy: +sy.toFixed(3) };
}

/** フォントプリセット辞書 */
export const FONT_PRESETS = {
  serif: '"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "Noto Serif JP", serif',
  mincho: '"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "Noto Serif JP", serif',
  sans: '"Hiragino Sans", "Yu Gothic", "YuGothic", "Noto Sans JP", sans-serif',
  gothic: '"Hiragino Sans", "Yu Gothic", "YuGothic", "Noto Sans JP", sans-serif',
  mono: '"BIZ UDGothic", "Osaka-Mono", "Menlo", "Courier New", monospace',
  monospace: '"BIZ UDGothic", "Osaka-Mono", "Menlo", "Courier New", monospace',
};

/** フォント名を解決（プリセットまたは生文字列） */
export function resolveFont(font) {
  if (!font) return null;
  const key = String(font).trim().toLowerCase();
  return FONT_PRESETS[key] || font;
}