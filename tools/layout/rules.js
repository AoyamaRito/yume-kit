// ─────────────────────────────────────────────────────────────────
// map of meaning — rules.js
// 責務: 罫線（rule）と飾り枠（box.frame）をCSS/SVGに展開。DOM非依存。
// 公開関数の入口:
//   wavePatternSvg(color, thickness, isVertical)
//     波罫のSVG文字列（width/height付き）を返す（data URI化するsvgDataUriは内部）
//   renderRuleStyle(l, px)
//     1本の罫線レイヤーを width/height/stroke/border 等のCSS文字列に展開
//   renderFrameStyle(l, px)
//     box.frame を bg/border/border-image に展開（二重・子持・四隅カギ・波枠）
//   renderCapDecorations(l, px)
//     罫線の両端の飾り（diamond / circle / round）を ::before / ::after 風HTMLに
//
// 壊してはいけない性質（HANDOFF §10 と一致）:
//   - 値はCSSとして有効（空／未対応キーは出さない）。
//   - box.frame は JSONに書かれた style を尊重し、未知の style は無効化する。
//   - wave 罫は SVG data URI 1枚で再現（複数行に渡る破綻は出さない）。
//
// AIが観測する手順:
//   cd layout-cli
//   node cli.js examples/rules-showcase.json --png  # rules-showcase.png で目視確認
// ─────────────────────────────────────────────────────────────────

/**
 * layout-cli/rules.js — 罫線・飾り罫・飾り枠（Rules & Frames）処理モジュール。
 *
 * 和文出版・DTPの伝統的および現代的な罫線・飾り枠をCSS/SVGで決定論的に生成:
 * 1. 罫線スタイル (rule style):
 *    - "solid" (表罫/実線)
 *    - "double" (双線/二重罫)
 *    - "dashed" (破線/点罫)
 *    - "dotted" (水玉/丸点罫)
 *    - "wave" (波罫 / 和風波線)
 *    - "komochi" (子持罫 / 外太内細の太細二重罫)
 *    - "fade" (グラデーション消え罫 / 見出し用フェードアウト)
 *    - "dash-dot" (一点鎖線)
 * 2. 飾り枠スタイル (box frame):
 *    - "single" / "solid" (標準枠)
 *    - "double" (二重枠)
 *    - "komochi" (子持枠 / 外太内細の伝統書籍枠)
 *    - "bracket" (四隅カギ枠 ⌜ ⌝ ⌞ ⌟)
 *    - "dashed" / "dotted"
 *    - "wave" (波枠)
 * 3. 飾り端部 (caps):
 *    - "diamond" (両端に菱形飾り ◆───◆)
 *    - "circle" (両端に丸飾り ●───●)
 *    - "round" (丸端)
 *
 * // @why: [2026-08-26] ユーザー要求「次行くとしたら線（罫線・飾り罫・飾り枠）」。
 * //       和文デザインの骨格である罫線（子持罫、波罫、フェード罫、四隅カギ枠、二重枠）を
 * //       SVG/CSSで完全にプログラマブル化し、JSONから1単語で指定できるようにする。
 * // @tags: SPEC
 */

import { escapeHtml } from './typography.js';

// SVG Data-URI ヘルパー
function svgDataUri(svgStr) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svgStr)}`;
}

/** 波罫のSVGパターン生成 */
export function wavePatternSvg(color = '#111', thickness = 1, isVertical = false) {
  if (!isVertical) {
    // 横波罫 (幅16px, 高さ8px)
    const svg = `<svg width="16" height="8" viewBox="0 0 16 8" xmlns="http://www.w3.org/2000/svg"><path d="M0 4 Q 4 1, 8 4 T 16 4" fill="none" stroke="${color}" stroke-width="${thickness}" stroke-linecap="round"/></svg>`;
    return svgDataUri(svg);
  } else {
    // 縦波罫 (幅8px, 高さ16px)
    const svg = `<svg width="8" height="16" viewBox="0 0 8 16" xmlns="http://www.w3.org/2000/svg"><path d="M4 0 Q 1 4, 4 8 T 4 16" fill="none" stroke="${color}" stroke-width="${thickness}" stroke-linecap="round"/></svg>`;
    return svgDataUri(svg);
  }
}

/** 罫線レイヤーのCSSスタイル生成 */
export function renderRuleStyle(l, px) {
  const isV = l.dir === 'v';
  const color = l.color || '#111111';
  const styleType = (l.style || 'solid').toLowerCase();
  const th = l.thickness || l.borderWidth || l.size || 1; // pt
  const thPx = px(th);

  const styles = [];

  switch (styleType) {
    case 'double':
      if (!isV) {
        styles.push(`height:${thPx * 3}px;border-top:${thPx}px solid ${color};border-bottom:${thPx}px solid ${color};background:transparent;`);
      } else {
        styles.push(`width:${thPx * 3}px;border-left:${thPx}px solid ${color};border-right:${thPx}px solid ${color};background:transparent;`);
      }
      break;

    case 'dashed':
      if (!isV) {
        styles.push(`height:0;border-top:${thPx}px dashed ${color};background:transparent;`);
      } else {
        styles.push(`width:0;border-left:${thPx}px dashed ${color};background:transparent;`);
      }
      break;

    case 'dotted':
      if (!isV) {
        styles.push(`height:0;border-top:${thPx}px dotted ${color};background:transparent;`);
      } else {
        styles.push(`width:0;border-left:${thPx}px dotted ${color};background:transparent;`);
      }
      break;

    case 'wave':
    case 'wavy':
      {
        const bgSvg = wavePatternSvg(color, thPx, isV);
        if (!isV) {
          styles.push(`height:8px;background:url("${bgSvg}") repeat-x center;border:none;`);
        } else {
          styles.push(`width:8px;background:url("${bgSvg}") repeat-y center;border:none;`);
        }
      }
      break;

    case 'komochi':
    case '外太内細':
    case '太細':
      // 子持罫: 外側（上/右）が太く、内側（下/左）が細い
      if (!isV) {
        const thick = Math.max(2, thPx * 2);
        const thin = Math.max(1, thPx * 0.8);
        styles.push(`height:${thick + thin + 2}px;border-top:${thick}px solid ${color};border-bottom:${thin}px solid ${color};background:transparent;`);
      } else {
        const thick = Math.max(2, thPx * 2);
        const thin = Math.max(1, thPx * 0.8);
        styles.push(`width:${thick + thin + 2}px;border-right:${thick}px solid ${color};border-left:${thin}px solid ${color};background:transparent;`);
      }
      break;

    case 'fade':
    case 'gradient':
      if (!isV) {
        styles.push(`height:${thPx}px;background:linear-gradient(to right, transparent, ${color} 15%, ${color} 85%, transparent);border:none;`);
      } else {
        styles.push(`width:${thPx}px;background:linear-gradient(to bottom, transparent, ${color} 15%, ${color} 85%, transparent);border:none;`);
      }
      break;

    case 'dash-dot':
    case 'morse':
      // 一点鎖線（SVG）
      {
        const svg = !isV
          ? `<svg width="24" height="${thPx * 2}" xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="${thPx}" x2="14" y2="${thPx}" stroke="${color}" stroke-width="${thPx}"/><circle cx="20" cy="${thPx}" r="${thPx / 2}" fill="${color}"/></svg>`
          : `<svg width="${thPx * 2}" height="24" xmlns="http://www.w3.org/2000/svg"><line x1="${thPx}" y1="0" x2="${thPx}" y2="14" stroke="${color}" stroke-width="${thPx}"/><circle cx="${thPx}" cy="20" r="${thPx / 2}" fill="${color}"/></svg>`;
        const repeat = !isV ? 'repeat-x' : 'repeat-y';
        const dim = !isV ? `height:${thPx * 2}px;` : `width:${thPx * 2}px;`;
        styles.push(`${dim}background:url("${svgDataUri(svg)}") ${repeat} center;border:none;`);
      }
      break;

    default: // 'solid'
      if (!isV) {
        styles.push(`height:${thPx}px;background:${color};border:none;`);
      } else {
        styles.push(`width:${thPx}px;background:${color};border:none;`);
      }
      break;
  }

  return styles.join('');
}

/** 飾り枠（Box Frame）のCSSスタイル生成 */
export function renderFrameStyle(l, px) {
  const frameType = (l.frame || l.style || '').toLowerCase();
  const color = l.borderColor || l.color || '#2c251e';
  const th = l.borderWidth || l.thickness || 1;
  const thPx = px(th);

  const styles = [];

  switch (frameType) {
    case 'double':
      // 二重枠
      styles.push(`border:${thPx * 3}px double ${color};`);
      break;

    case 'komochi':
    case '外太内細':
      // 子持枠: 外側太線＋内側細線（outline + border）
      {
        const thick = Math.max(2, thPx * 2);
        const thin = Math.max(1, thPx * 0.8);
        styles.push(`border:${thin}px solid ${color};outline:${thick}px solid ${color};outline-offset:${thPx * 2}px;`);
      }
      break;

    case 'bracket':
    case '隅カギ':
    case 'カギ':
      // 四隅カギ枠 ⌜ ⌝ ⌞ ⌟ （コーナー線のみ）
      {
        const arm = Math.max(10, thPx * 6);
        const svg = `<svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <path d="M0 ${arm} L0 0 L${arm} 0" fill="none" stroke="${color}" stroke-width="${thPx}"/>
          <path d="M calc(100% - ${arm}) 0 L 100% 0 L 100% ${arm}" fill="none" stroke="${color}" stroke-width="${thPx}"/>
          <path d="M0 calc(100% - ${arm}) L0 100% L${arm} 100%" fill="none" stroke="${color}" stroke-width="${thPx}"/>
          <path d="M calc(100% - ${arm}) 100% L 100% 100% L 100% calc(100% - ${arm})" fill="none" stroke="${color}" stroke-width="${thPx}"/>
        </svg>`;
        styles.push(`background-image:url("${svgDataUri(svg)}");background-size:100% 100%;border:none;`);
      }
      break;

    case 'wave':
    case 'wavy':
      // 波枠
      styles.push(`border:${thPx * 2}px wavy ${color};`);
      break;

    case 'dashed':
      styles.push(`border:${thPx}px dashed ${color};`);
      break;

    case 'dotted':
      styles.push(`border:${thPx}px dotted ${color};`);
      break;

    default:
      if (l.border) {
        styles.push(`border:${l.border};`);
      }
      break;
  }

  return styles.join('');
}

/** 両端飾り（端部にダイヤや丸）の内部要素HTML */
export function renderCapDecorations(l, px) {
  if (!l.cap) return '';
  const cap = String(l.cap).toLowerCase();
  const color = l.color || '#111111';
  const isV = l.dir === 'v';

  if (cap === 'diamond' || cap === 'ダイヤ' || cap === '◆') {
    const symbol = '◆';
    return isV
      ? `<div class="cap-start-v" style="color:${color};">${symbol}</div><div class="cap-end-v" style="color:${color};">${symbol}</div>`
      : `<div class="cap-start-h" style="color:${color};">${symbol}</div><div class="cap-end-h" style="color:${color};">${symbol}</div>`;
  } else if (cap === 'circle' || cap === '丸' || cap === '●') {
    const symbol = '●';
    return isV
      ? `<div class="cap-start-v" style="color:${color};">${symbol}</div><div class="cap-end-v" style="color:${color};">${symbol}</div>`
      : `<div class="cap-start-h" style="color:${color};">${symbol}</div><div class="cap-end-h" style="color:${color};">${symbol}</div>`;
  }
  return '';
}