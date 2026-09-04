// ─────────────────────────────────────────────────────────────────
// map of meaning — ascii.js
// 責務: buildLayout の出力（正規化済みレイヤー・衝突判定済み）を
//       「ターミナルで見える ASCII 鳥瞰図」に変換する出力器。
//       GUI でも PNG でもなく、テキスト構造として「どこに何が重なっているか」を
//       人間と LLM 双方が一瞥で読める形にする。
//
// 思想 (yume-spec の read-only 感覚器と同一):
//   - 一切「編集」しない。直すのは既存 --fix / core.js が担う。
//   - 座標・衝突は buildLayout の判定をそのまま信用し、二重計算しない（ズレの元を増やさない）。
//   - 新しいフォーマットを生やさない。入力は既存 spec.json、出力は常に平文。
//
// 使い方 (cli.js 経由):
//   node cli.js spec.json --ascii
//   node cli.js spec.json --ascii --ascii-width 60
//   node cli.js spec.json --ascii --zoom 20,30,40,60     # 指定領域(pt)を拡大
//   node cli.js spec.json --ascii --zoom-into-collision # 衝突領域を自動拡大
//
// @why: [2026-08-30] 衝突判定は数値（重なり pt 同士）だけで、AI が「どの矩形がどこで
//       重なっているか」を画像を開かずにイメージするのが辛かった。正規化レイヤーを
//       ASCII 鳥瞰図に落とすことで、構造の視認をトークン節約・ゼロ依存で得るため追加。
//       形式は増やさない（平文）。修復・座標計算は既存層に任せ、本モジュールは描画専用。
// @why: [2026-08-30] 全体図：セル 1 個 1 文字の解像度では小さい矩形・重なり量が「・」「⚠」に
//       潰れて区別できない。描画領域を viewport（ズーム）にするだけでセル密度が上がり、
//       「どこで・どれだけ重なっているか」を潰さず読める。--zoom-into-collision は
//       衝突のある場所を自動で十分なマージン付きに切り出して精細に見せる（yume-min の
//       readPartial と同構想・トークン節約）。新フォーマットは増やさない。
// @tags: SPEC, LAYOUT_ASCII
//

// 種別ごとの枠線表現（ターミナルで視認性の高い簡易セット）
const FRAME = {
  box:  { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
  text: { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃' },
  img:  { tl: '▝', tr: '▘', bl: '▗', br: '▖', h: '▔', v: '▏' },
  rule: { tl: '+', tr: '+', bl: '+', br: '+', h: '─', v: '│' },
};
const MARK = { box: '▣', text: '▪', img: '▧', rule: '•' };

/**
 * buildLayout 済みレイアウトを ASCII 鳥瞰図に描画する。
 * @param {object} layout  buildLayout の戻り値（正規化済みレイヤー・衝突判定済みを持っている前提）
 * @param {object} opts
 *   width            : 出力幅（文字数）。既定 80。ページ比率から高さを自動決定。
 *   compact          : true なら凡例を省略。
 *   zoom             : {x,y,w,h} in pt — このページ座標領域だけを画面幅に拡大して描く。
 *   zoomIntoCollision: true なら衝突1件ごとに自動拡大ビューを生成（衝突がない時は全体図）。
 * @returns {string} 複数ページ・複数ビューは空行で区切る
 */
export function renderAscii(layout, opts = {}) {
  const width = Math.max(24, Math.min(200, opts.width ?? 80));
  const compact = !!opts.compact;
  const pageList = layout.isMultiPage ? layout.pages : [layout];
  const blocks = [];

  if (opts.zoomIntoCollision) {
    // 衝突ごとに拡大ビュー（見えない時・多重衝突時に「1件ずつ」確認できる）
    pageList.forEach((page, i) => {
      const cols = page.collisions || [];
      if (!cols.length) {
        blocks.push(renderPage(page, width, opts, { label: pageList.length > 1 ? `page ${i + 1}` : null }));
        return;
      }
      cols.forEach((c, ci) => {
        const view = collisionViewport(page, c);
        if (!view) return;
        blocks.push(renderPage(page, width, { ...opts, zoom: view }, {
          label: (pageList.length > 1 ? `page ${i + 1} · ` : '') + `衝突 ${ci + 1}: ${c.idA}×${c.idB}(${c.severity})`,
        }));
      });
    });
  } else {
    pageList.forEach((page, i) => {
      const label = pageList.length > 1 ? `page ${i + 1}` : null;
      if (opts.zoom) {
        blocks.push(renderPage(page, width, opts, { label: label ? `${label} · zoom` : 'zoom' }));
      } else {
        blocks.push(renderPage(page, width, opts, { label }));
      }
    });
  }

  let out = blocks.join('\n\n');
  if (!compact) out += '\n\n' + legend(layout, pageList, opts);
  return out;
}

/**
 * 衝突矩形を中心に、周囲へ余白を足した viewport（pt）を作る。
 * どの矩形のどこで重なっているか＝細部が見たいので、重なり矩形を余白付きで拡大する。
 */
function collisionViewport(page, c) {
  const a = page.layers.find((l) => l.id === c.idA);
  const b = page.layers.find((l) => l.id === c.idB);
  if (!a || !b) return null;
  const vx0 = Math.max(a.x, b.x), vy0 = Math.max(a.y, b.y);
  const vx1 = Math.min(a.x + a.w, b.x + b.w), vy1 = Math.min(a.y + a.h, b.y + b.h);
  const ow = Math.max(1, vx1 - vx0), oh = Math.max(1, vy1 - vy0);
  // 周囲に重なり幅の半分＋最低マージンを足す。ページ内にクランプ。
  const padX = Math.max(ow * 0.6, 10), padY = Math.max(oh * 0.6, 10);
  const vx = Math.max(0, vx0 - padX), vy = Math.max(0, vy0 - padY);
  const vw = Math.min(page.w - vx, (vx1 - vx0) + padX * 2);
  const vh = Math.min(page.h - vy, (vy1 - vy0) + padY * 2);
  return { x: vx, y: vy, w: Math.max(1, vw), h: Math.max(1, vh) };
}

/**
 * 1 viewport（既定: ページ全体、zoom指定時: その領域）を ASCII グリッドに描く。
 * 座標系は pt のまま。グリッド密度 = width(文字) / viewport幅 で、zoom が狭いほど拡大される。
 */
function renderPage(page, width, opts = {}, meta = {}) {
  const W = page.w, H = page.h;
  const vp = opts.zoom || { x: 0, y: 0, w: W, h: H };
  const innerW = width - 2;          // 左右の枠分
  const aspect = 2;                  // ターミナル文字は縦2倍 → 同じ密度で正方形に見える
  const innerH = Math.max(2, Math.round((innerW * vp.h) / vp.w / aspect));
  const cw = vp.w / innerW;          // 1セル = vp.w/innerW pt
  const ch = vp.h / innerH;

  const rows = innerH + 2, cols = width;
  const g = Array.from({ length: rows }, () => Array(cols).fill(' '));

  // 枠: 全体図はページ枠 / ズーム図は「クリップ境界」をドット縁で示す（外のページがあることを暗示）
  // @why: [2026-08-30] ズーム時にページ枠を描くと画面いっぱいの領域の外側に枠が二重に見えて紛らわしい。
  //       ドット縁は「表示領域はここまで（左右上下にページが続く）」のクリップ境界として読める。
  if (opts.zoom) {
    for (let x = 0; x < cols; x++) { g[0][x] = '…'; g[rows - 1][x] = '…'; }
    for (let y = 0; y < rows; y++) { g[y][0] = '…'; g[y][cols - 1] = '…'; }
    g[0][0] = '…'; g[0][cols - 1] = '…'; g[rows - 1][0] = '…'; g[rows - 1][cols - 1] = '…';
  } else {
    for (let x = 0; x < cols; x++) { g[0][x] = '─'; g[rows - 1][x] = '─'; }
    for (let y = 0; y < rows; y++) { g[y][0] = '│'; g[y][cols - 1] = '│'; }
    g[0][0] = '┌'; g[0][cols - 1] = '┐'; g[rows - 1][0] = '└'; g[rows - 1][cols - 1] = '┘';
  }

  const set = (x, y, c) => {
    if (x > 0 && x < cols - 1 && y > 0 && y < rows - 1) g[y][x] = c;
  };

  const sorted = [...page.layers].sort((a, b) => (a.z || 0) - (b.z || 0));
  for (const l of sorted) {
    // ページ座標 (l.x) を viewport 座標系に引いてからグリッドへ
    const lx = l.x - vp.x, ly = l.y - vp.y;
    const x0 = Math.max(1, Math.floor(lx / cw) + 1);
    const x1 = Math.min(cols - 2, Math.ceil((lx + l.w) / cw) + 1);
    const y0 = Math.max(1, Math.floor(ly / ch) + 1);
    const y1 = Math.min(rows - 2, Math.ceil((ly + l.h) / ch) + 1);
    if (x0 > x1 || y0 > y1) continue; // viewport 外

    const f = FRAME[l.type] || FRAME.box;
    for (let x = x0; x <= x1; x++) { set(x, y0, f.h); set(x, y1, f.h); }
    for (let y = y0; y <= y1; y++) { set(x0, y, f.v); set(x1, y, f.v); }
    set(x0, y0, f.tl); set(x0, y1, f.bl); set(x1, y0, f.tr); set(x1, y1, f.br);

    if (l.w > cw * 1.5 && l.h > ch * 1.5) {
      // @why: [2026-08-30] レイヤーIDを矩形内に埋めると罫線と混ざって視認性が落ちたため、
      //       中心マーク 1 文字だけ置き、ID は凡例（legend）に出す運用にした（clearify: 探させない）。
      set(Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2), MARK[l.type] || '·');
    } else {
      set(Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2), '·');
    }
  }

  // 衝突の重なり領域を「⚠」でハイライト
  for (const c of page.collisions || []) {
    const a = page.layers.find((l) => l.id === c.idA);
    const b = page.layers.find((l) => l.id === c.idB);
    if (!a || !b) continue;
    const ox0 = Math.max(a.x, b.x), oy0 = Math.max(a.y, b.y);
    const ox1 = Math.min(a.x + a.w, b.x + b.w), oy1 = Math.min(a.y + a.h, b.y + b.h);
    const mx = Math.round(((ox0 + ox1) / 2 - vp.x) / cw) + 1;
    const my = Math.round(((oy0 + oy1) / 2 - vp.y) / ch) + 1;
    set(mx, my, '⚠');
  }

  const lines = g.map((r) => r.join('').replace(/\s+$/, ''));
  if (meta.label) lines.splice(0, 0, `— ${meta.label} —`);
  return lines.join('\n');
}

/** 凡例：レイヤー数・ID と、衝突一覧と、ズーム状態を読める形で */
function legend(layout, pageList, opts = {}) {
  const parts = [];
  parts.push('■ 枠=box ▪ text ▧ image → rule（罫線） ⚠=衝突');
  if (opts.zoom) parts.push(`zoom: x=${opts.zoom.x}pt y=${opts.zoom.y}pt w=${opts.zoom.w.toFixed(0)}pt h=${opts.zoom.h.toFixed(0)}pt`);
  if (opts.zoomIntoCollision) parts.push('zoom-into-collision: 各衝突ごとに拡大ビュー');
  const ids = pageList.flatMap((p, pi) =>
    p.layers.map((l) => (pageList.length > 1 ? `p${pi + 1}:` : '') + `${l.id}(${l.type})`)
  );
  if (ids.length) parts.push('layers: ' + ids.join(' '));
  const cols = layout.isMultiPage ? layout.collisions : (layout.collisions || []);
  if (cols.length) {
    parts.push('collisions: ' + cols.map((c) => `${c.idA}×${c.idB}(${c.severity})`).join(' '));
  }
  return parts.join('\n');
}