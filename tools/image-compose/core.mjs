// ─────────────────────────────────────────────────────────────────
// map of meaning — core.mjs
// 責務: シーンJSONの正規化と、レイヤー合成HTMLの組み立て（DOM・画像IOなし・純粋）。
// 公開入口（最初に読む順序）:
//   buildScene(raw)    JSON全体 → 正規化済み scene { canvas, layers（z順） }
//   checkScene(scene)  構造検証 → { ok, problems[] }（src実在は cli.mjs が担う）
//   renderHTML(scene)  HTML文字列（Chrome headless で PNG 焼きする側）
//
// 壊してはいけない性質（DESIGN §3 と一致）:
//   - レイヤーは z 順（同値なら配列順維持の安定ソート）で下→上に合成。
//   - NaN・不正値は例外を投げず 0 扱い（layout-cli と同じ流儀）。
//   - img の src は cli 側で file:// 等へ解決済みのものを渡す（core は触らない）。
//   - 深い日本語組版（ルビ・禁則）は layout-cli のレン…このツールには持たない。
//     text は「合成に載せる文字」に留める（DESIGN §3 type:text）。
// ─────────────────────────────────────────────────────────────────

/** 数値化。不正（NaN / Infinity / undefined）は既定値へ。 */
export function toNum(v, dflt = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** CSS色か、'transparent'（透明）か。 */
export function isTransparentBg(bg) {
  return bg == null || /^transparent$|^none$|^rgba\(.*,0\)$|^#(?:00){3,4}$/i.test(String(bg).trim());
}

// @why: [2026-08-31] 文字グラデーション塗り用プリセット（AIが直感的に "gold" / "fire" 等で豪華な文字を作れる）。
//        -webkit-background-clip: text + -webkit-text-fill-color: transparent で描画。
const FILL_PRESETS = {
  gold: 'linear-gradient(180deg, #fff2a8 0%, #e6b800 35%, #ffffff 42%, #b38600 65%, #ffd700 100%)',
  silver: 'linear-gradient(180deg, #ffffff 0%, #c8d1d9 38%, #ffffff 45%, #7d8590 70%, #d0d7de 100%)',
  fire: 'linear-gradient(180deg, #ffffff 0%, #ffdf00 25%, #ff5500 60%, #990000 100%)',
  sunset: 'linear-gradient(180deg, #ff9a9e 0%, #fecfef 40%, #a1c4fd 100%)',
  rainbow: 'linear-gradient(90deg, #ff4545, #ffa500, #ffff00, #00e676, #00b0ff, #d500f9)',
  cyber: 'linear-gradient(180deg, #ffffff 0%, #00f2fe 50%, #4facfe 100%)',
  purple: 'linear-gradient(180deg, #ffffff 0%, #e040fb 50%, #651fff 100%)',
  blood: 'linear-gradient(180deg, #ff4d6d 0%, #c9184a 50%, #590d22 100%)',
};

// @why: [2026-08-31] タイポグラフィ 7 のプロファイル（AI は名前で指定すれば良い）。lineH / letterSpacing / weight は
//        プロファイル → 明示指定の順に解決。未指定の項目があればプロファイルの値を適用。
//        「何か」を「手金く」指定するよりも短い名前で宣言できるほうが AI が JSON を縞麗に書ける。
const TYPO_PROFILES = {
  auto:      { lineH: 'auto', letterSpacing: 0 }, // 短文なら lineH を 1.4 に詰める（下の関数が実行時に）
  tight:     { lineH: '1.2', letterSpacing: -0.5 }, // 短文・キャプション向け
  normal:    { lineH: '1.5', letterSpacing: 0 },    // 横書きテキストのデフォルト
  relaxed:   { lineH: '1.85', letterSpacing: 0.5 },  // 長文・縦書きのデフォルト
  title:     { lineH: '1.15', letterSpacing: 2 },   // タイトル、饰り文字
  caption:   { lineH: '1.3', letterSpacing: 1 },    // キャプション、説明
  onomato:   { lineH: '0.95', letterSpacing: 6, weight: 900 }, // オノマトピオン（インパ外文字）
  narrative: { lineH: '1.7', letterSpacing: 0.2 },  // 長文のシーン説明・ナレーション
};

const FIT_VALUES = new Set(['cover', 'contain', 'fill', 'none']);
const BLEND_VALUES = new Set(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten']);
const TYPE_DEFAULT = 'rect';

/** 色名・#rgb・linear-gradient などをそのまま CSS bg に出す（不正は transparent へ落とす）。 */
function safeBg(v) {
  if (v == null || v === '') return 'transparent';
  const s = String(v).trim();
  // 大雑把な危険文字（セミコロン・インジェクション）は透明へ落とす（clearify: 将来の自作HTML生成を塞がない最低限）。
  return /[;"'<>\\]/.test(s) ? 'transparent' : s;
}

/** CSS 文字列へ（数値は px 付き、CSS自体にそのまま渡す場合は既成品文字列）。 */
function px(v) {
  return `${Math.round(v)}px`;
}

function normalizeLayer(l, i) {
  l = l ?? {};
  const type = String(l.type || 'rect').toLowerCase();
  const typeSafe = ['img', 'rect', 'gradient', 'text', 'text3d'].includes(type) ? type : TYPE_DEFAULT;
  // @why: [2026-08-31] 未知 type は黙って rect に落とす（DESIGN: 例外を投げず NaN 0 扱いと同じ流儀）。
  //       ただし checkScene で未知 type だったことは problems に残す（AI が気付ける=clearify）。
  const unknown = type !== typeSafe;
  const flip = l.flip === 'h' || l.flip === 'v' ? l.flip : (l.flip == null ? null : undefined);

  const base = {
    id: String(l.id ?? `ly${i}`),
    type: typeSafe,
    unknownType: unknown ? type : null,
    x: toNum(l.x, 0),
    y: toNum(l.y, 0),
    w: toNum(l.w, 0),
    h: toNum(l.h, 0),
    z: toNum(l.z, i), // z 未指定は配列順（安定）
    rotate: toNum(l.rotate, 0),
    opacity: toNum(l.opacity, 1),
    blur: toNum(l.blur, 0),
    // @why: [2026-08-31] blend 未指定は 'normal'。素の l.blend を String すると undefined 文字列になり
    //       mix-blend-mode:undefined という正当性のないCSSを吐く（デモ実焼きで発見）。フォールバック後に String。
    blend: BLEND_VALUES.has(String(l.blend ?? 'normal').toLowerCase())
      ? String(l.blend ?? 'normal').toLowerCase()
      : 'normal',
    shadow: l.shadow ? String(l.shadow) : null,
    filter: l.filter ? String(l.filter) : null,
    corner: toNum(l.corner, 0),
    flip,
  };

  switch (typeSafe) {
    case 'img':
      return {
        ...base,
        src: l.src != null ? String(l.src) : null,
        fit: FIT_VALUES.has(String(l.fit || 'cover').toLowerCase()) ? String(l.fit || 'cover').toLowerCase() : 'cover',
        position: l.position ? String(l.position) : 'center',
      };
    case 'gradient':
      return {
        ...base,
        from: safeBg(l.from ?? '#444'),
        to: safeBg(l.to ?? '#000'),
        angle: toNum(l.angle, 135),
      };
    case 'text':
      return {
        ...base,
        dir: l.dir === 'v' ? 'v' : 'h',
        text: typeof l.text === 'string' ? l.text : '',
        font: l.font ? String(l.font) : null,
        size: toNum(l.size, 24),
        color: safeBg(l.color ?? '#111'),
        weight: l.weight != null ? toNum(l.weight, 400) : null,
        style: l.style === 'italic' ? 'italic' : 'normal',
        // @why: [2026-08-31] text レイヤに「未指定」と「明示ゼロ」を区別させるため、ユーザー指定値を Normalized レイヤにそのまま保存。
        //       0 は明示ゼロ·未指定は null。それを renderText 内でプロファイル · short-text 推定 · 明示指定の優先順で適用する。
        letterSpacing: l.letterSpacing != null ? toNum(l.letterSpacing, 0) : null,
        lineH: l.lineH != null ? String(l.lineH) : null,
        align: ['center', 'end', 'justify'].includes(String(l.align || '').toLowerCase()) ? String(l.align).toLowerCase() : 'start',
        valign: ['center', 'end'].includes(String(l.valign || '').toLowerCase()) ? String(l.valign).toLowerCase() : 'start',
        indent: toNum(l.indent, 0),
        typography: TYPO_PROFILES[String(l.typography || '').toLowerCase()] ? String(l.typography).toLowerCase() : 'auto',
        // @why: [2026-08-31] 漫画文字の必須表現を text レイヤで完結（image-compose-cli は生成ツール）。
        //       stroke は -webkit-text-stroke + paint-order:stroke fill で「文字の周囲に太縁」。
        //       tcy は数字 2-3 桁を縦書きでも横並び（漫画の「19世紀」「2人」等）。
        //       ruby は layout-cli 流の《》簡易マークアップ（漢字_ふりがな）。
        //       autoTcy/ruby は ruby に含めて tokenize で一括処理。
        stroke: (l.stroke && (toNum(l.stroke.width, 0) > 0 || l.stroke.color))
          ? { color: safeBg(l.stroke.color ?? '#000'), width: toNum(l.stroke.width, 2) }
          : null,
        // @why: [2026-08-31] 多重フチ（袋文字）：内フチ stroke + 外フチ strokes 配列。
        strokes: Array.isArray(l.strokes)
          ? l.strokes.map((st) => ({ color: safeBg(st.color ?? '#000'), width: toNum(st.width, 2) })).filter((st) => st.width > 0)
          : null,
        // @why: [2026-08-31] 文字グラデーション（fill）: プリセット名（gold/fire等）または linear-gradient()。
        fill: l.fill ? (FILL_PRESETS[String(l.fill).toLowerCase()] || safeBg(l.fill)) : null,
        // @why: [2026-08-31] ネオン・発光（glow）: 必殺技・魔法・電撃などの文字発光演出。
        glow: l.glow
          ? (typeof l.glow === 'object'
            ? { color: safeBg(l.glow.color ?? '#ff0055'), blur: toNum(l.glow.blur, 10) }
            : { color: safeBg(l.glow), blur: 10 })
          : null,
        // @why: [2026-08-31] 漫画のスピード感・勢い変形（skewX / skewY）。
        skewX: toNum(l.skewX, 0),
        skewY: toNum(l.skewY, 0),
        // @why: [2026-08-31] 2D ソリッド押し出し（レイキャスト・単色ドット埋め）:
        //       3DCGくささを排し、漫画・アニメのセル画オノマトペのように角度と距離に沿ってパキッと単色で埋める。
        extrude: l.extrude
          ? (typeof l.extrude === 'object'
            ? {
                angle: toNum(l.extrude.angle, 135),
                depth: Math.max(0, Math.min(100, toNum(l.extrude.depth, 10))),
                color: safeBg(l.extrude.color ?? '#000'),
              }
            : {
                angle: 135,
                depth: Math.max(0, Math.min(100, toNum(l.extrude, 10))),
                color: safeBg(l.stroke?.color ?? '#000'),
              })
          : null,
        // @why: [2026-08-31] フラット平行オフセット（flatOffset）:
        //       立体押し出しではなく、文字そのものをカチッと平行ズラしした洗練されたモダンフラット2重レイヤー影。
        flatOffset: l.flatOffset
          ? (typeof l.flatOffset === 'object'
            ? { x: toNum(l.flatOffset.x, 6), y: toNum(l.flatOffset.y, 6), color: safeBg(l.flatOffset.color ?? '#000') }
            : { x: 6, y: 6, color: safeBg(l.flatOffset) })
          : null,
        // @why: [2026-08-31] フラット台紙・グラフィックプレート（badge）:
        //       文字の背後にピタッと敷く、平行四辺形・角丸カプセル・帯などのフラットデザイン台座。
        badge: l.badge
          ? (typeof l.badge === 'object'
            ? {
                bg: safeBg(l.badge.bg ?? 'rgba(0,0,0,0.8)'),
                pad: l.badge.pad != null ? toNum(l.badge.pad, 8) : 8,
                corner: toNum(l.badge.corner, 4),
                border: l.badge.border ? String(l.badge.border) : null,
                skew: toNum(l.badge.skew, 0),
              }
            : { bg: safeBg(l.badge), pad: 8, corner: 4, border: null, skew: 0 })
          : null,
        // @why: [2026-08-31] フラット2色ツートン（splitColor）:
        //       グラデーションではなく、文字の上半分と下半分をパキッと2色で直線分割するモダンタイポ。
        splitColor: l.splitColor
          ? {
              top: safeBg(l.splitColor.top ?? '#fff'),
              bottom: safeBg(l.splitColor.bottom ?? l.color ?? '#ffd84a'),
              ratio: Math.max(10, Math.min(90, toNum(l.splitColor.ratio, 50))),
            }
          : null,
        // @why: [2026-08-31] 傍点・圏点（emphasis）: 文字の頭に点（・）を打つ強調。
        emphasis: l.emphasis ? String(l.emphasis).toLowerCase() : null,
        wrap: l.wrap !== false, // false で white-space: nowrap（一行強制）
        ruby: l.ruby !== false, // 既定 ON（false で完全エスケープ）
        autoTcy: l.autoTcy !== false, // 既定 ON（《》トークン化と別に、数字 2-3 桁を tcy 化）
      };
    case 'text3d':
      // @why: [2026-08-31] 3D text レイヤは「迫力が必要なシーンだけ」使うというガイドラインを DESIGN-TIPS に明記。
      //       text レイヤの全プロパティを引き継ぎ、3D 専用プロパティのみ上乗せ。
      //       extrude は text-shadow の N 段重ねで彫き出し。 rotateX/Y でグリフを空間内で傾ける。
      //       他の共通エフェクト (rotate/opacity/blend/corner/filter/flip) もあ流れで適用。
      return {
        ...base,
        dir: l.dir === 'v' ? 'v' : 'h',
        text: typeof l.text === 'string' ? l.text : '',
        font: l.font ? String(l.font) : null,
        size: toNum(l.size, 64),
        color: safeBg(l.color ?? '#ffd84a'),
        weight: l.weight != null ? toNum(l.weight, 400) : null,
        style: l.style === 'italic' ? 'italic' : 'normal',
        letterSpacing: l.letterSpacing != null ? toNum(l.letterSpacing, 0) : null,
        lineH: l.lineH != null ? String(l.lineH) : null,
        align: ['center', 'end', 'justify'].includes(String(l.align || '').toLowerCase()) ? String(l.align).toLowerCase() : 'start',
        valign: ['center', 'end'].includes(String(l.valign || '').toLowerCase()) ? String(l.valign).toLowerCase() : 'start',
        indent: toNum(l.indent, 0),
        typography: TYPO_PROFILES[String(l.typography || '').toLowerCase()] ? String(l.typography).toLowerCase() : 'onomato',
        stroke: (l.stroke && (toNum(l.stroke.width, 0) > 0 || l.stroke.color))
          ? { color: safeBg(l.stroke.color ?? '#000'), width: toNum(l.stroke.width, 2) }
          : null,
        strokes: Array.isArray(l.strokes)
          ? l.strokes.map((st) => ({ color: safeBg(st.color ?? '#000'), width: toNum(st.width, 2) })).filter((st) => st.width > 0)
          : null,
        fill: l.fill ? (FILL_PRESETS[String(l.fill).toLowerCase()] || safeBg(l.fill)) : null,
        glow: l.glow
          ? (typeof l.glow === 'object'
            ? { color: safeBg(l.glow.color ?? '#ff0055'), blur: toNum(l.glow.blur, 10) }
            : { color: safeBg(l.glow), blur: 10 })
          : null,
        skewX: toNum(l.skewX, 0),
        skewY: toNum(l.skewY, 0),
        emphasis: l.emphasis ? String(l.emphasis).toLowerCase() : null,
        ruby: l.ruby !== false,
        autoTcy: l.autoTcy !== false,
        // 3D 独自
        depth: Math.max(0, Math.min(50, toNum(l.depth, 8))), // 押出し段数 (0 で flat な text として動く)
        rotateX: toNum(l.rotateX, 0),
        rotateY: toNum(l.rotateY, 0),
        perspective: Math.max(120, toNum(l.perspective, 800)),
        extrudeColor: l.extrudeColor ? safeBg(l.extrudeColor) : null,
      };
    default: // rect
      return {
        ...base,
        bg: safeBg(l.bg ?? 'transparent'),
        border: l.border ? String(l.border) : null,
      };
  }
}

/** raw JSON → scene（正規化済み）。canvas 不正値は 0 落ち（cli の checkScene が止める）。 */
export function buildScene(raw = {}) {
  const rawCanvas = raw.canvas ?? raw ?? {};
  const rawLayers = Array.isArray(raw.layers) ? raw.layers : [];
  const canvas = {
    w: toNum(rawCanvas.w, 0),
    h: toNum(rawCanvas.h, 0),
    bg: safeBg(rawCanvas.bg ?? 'transparent'),
  };
  const dirty = rawLayers.map(normalizeLayer);
  // @why: [2026-08-31] 合成層だから「衝突検知はしない」が設計。ただし z 順（上に来る層のリスト順）だけは
  //       決定的にする必要がある。値の等しい z は配列順(=元JSON順)を保つ安定ソート。
  const layers = dirty
    .map((l, idx) => ({ ...l, _z0: idx }))
    .sort((a, b) => (a.z - b.z) || (a._z0 - b._z0))
    .map(({ ...rest }) => {
      const { _z0, ...l } = rest;
      return { ...l };
    });
  return { canvas, layers, hasUnknownType: dirty.some((l) => l.unknownType) };
}

/** 構造検証（src の実在は cli 側で fs チェック。ここは純粋に形状のみ）。 */
export function checkScene(scene) {
  const problems = [];
  if (scene.canvas.w <= 0 || scene.canvas.h <= 0) {
    problems.push({ level: 'error', code: 'canvas-empty', msg: 'canvas.w / canvas.h は正の数が必要' });
  }
  if (scene.layers.length === 0) {
    problems.push({ level: 'warn', code: 'no-layers', msg: 'レイヤーが0枚（空のPNGになる）' });
  }
  scene.layers.forEach((l) => {
    if (l.unknownType) {
      problems.push({ level: 'warn', code: 'unknown-type', id: l.id, msg: `不明な type "${l.unknownType}" → rect 扱い` });
    }
    if (l.type === 'img' && !l.src) {
      problems.push({ level: 'error', code: 'img-no-src', id: l.id, msg: 'img レイヤーに src がない' });
    }
    if (l.type === 'img' && l.src && !/^(data:|https?:|file:)/i.test(l.src)) {
      problems.push({ level: 'warn', code: 'img-src-relative', id: l.id, msg: `相対 src "${l.src}"（cli が絶対化すべき。core はそのまま出す）` });
    }
    if (l.type === 'text' && !l.text) {
      problems.push({ level: 'warn', code: 'text-empty', id: l.id, msg: 'テキストが空' });
    }
    if (l.type === 'gradient' && (!l.from || !l.to)) {
      problems.push({ level: 'warn', code: 'gradient-keys', id: l.id, msg: 'gradient の from/to が不足' });
    }
  });
  return { ok: problems.every((p) => p.level !== 'error'), problems, hasWarn: problems.some((p) => p.level === 'warn') };
}

// —— HTML 組み立て ——
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** フラット・外側ステッカーフチ用の 32 方位 text-shadow スタックを生成（超滑らか・ハードエッジ）。
 *  @why: [2026-08-31] ユーザー設計思想「立体ではなく外側にフラットな枠・ステッカーを広げたい」。
 *        32 方向の等方性展開（11.25度刻み）でギザギザを完全に排除した滑らかなフラットステッカー外枠を生成。 */
function buildOuterStrokeShadow(color, width) {
  if (width <= 0) return '';
  const angles = [];
  for (let a = 0; a < 360; a += 11.25) angles.push(a);
  const rad = (deg) => (deg * Math.PI) / 180;
  return angles
    .map((a) => {
      const x = Math.round(Math.cos(rad(a)) * width * 10) / 10;
      const y = Math.round(Math.sin(rad(a)) * width * 10) / 10;
      return `${x}px ${y}px 0 ${color}`;
    })
    .join(', ');
}

/** 2D ソリッド押し出し（レイキャスト・方向指定オフセット塗り）。
 *  @why: [2026-08-31] ユーザー設計思想「3DCGくささを排し、2Dでレイキャスト（方向指定）して単色ドットで埋める」。
 *        角度（angle）と距離（depth）に沿って 1px 刻みで完全なハードエッジ（blur 0px）の text-shadow を生成。
 *        漫画・アニメのセル画オノマトペ・タイトルロゴのパキッとした立体描き文字を 2D 平行投影で実現する。
 *  @tags: SPEC */
function build2DSolidExtrude(angleDeg, depth, color) {
  if (depth <= 0) return '';
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const parts = [];
  // 0.5px〜1px 刻みで隙間なくソリッドに埋める
  for (let d = 1; d <= depth; d++) {
    const x = Math.round(cos * d);
    const y = Math.round(sin * d);
    parts.push(`${x}px ${y}px 0 ${color}`);
  }
  return parts.join(', ');
}

/** 共通レイヤー効果（rotate/flip/skew/opacity/blend/filter/corner/position をCSS文字列へ）。 */
function layerEffectCSS(l) {
  const parts = [];
  const transforms = [];
  if (l.rotate) transforms.push(`rotate(${l.rotate}deg)`);
  if (l.skewX) transforms.push(`skewX(${l.skewX}deg)`);
  if (l.skewY) transforms.push(`skewY(${l.skewY}deg)`);
  if (l.flip === 'h' || l.flip === 'v') {
    transforms.push(l.flip === 'h' ? 'scaleX(-1)' : 'scaleY(-1)');
  }
  if (transforms.length) {
    parts.push(`transform:${transforms.join(' ')}`);
    parts.push('transform-origin:center');
  }
  if (l.opacity !== 1) parts.push(`opacity:${l.opacity}`);
  if (l.blend && l.blend !== 'normal') parts.push(`mix-blend-mode:${l.blend}`);
  if (l.filter) parts.push(`filter:${l.filter}`);
  else if (l.blur) parts.push(`filter:blur(${l.blur}px)`);
  if (l.corner) parts.push(`border-radius:${px(l.corner)}`);
  return parts.join(';');
}

/** layerEffectCSS から transform 関連（rotate/flip）だけを除いた版。 text3d は自前で transform を組み立てるため使う。
 *  @why: [2026-08-31] text3d では rotate/flip を transform に含めるため、共通エフェクトの transform と二重生成になる。
 *  opacity/blend/filter/corner のみ出力する版を抽出した。 */
function layerEffectsExceptTransform(l) {
  const parts = [];
  if (l.opacity !== 1) parts.push(`opacity:${l.opacity}`);
  if (l.blend && l.blend !== 'normal') parts.push(`mix-blend-mode:${l.blend}`);
  if (l.filter) parts.push(`filter:${l.filter}`);
  else if (l.blur) parts.push(`filter:blur(${l.blur}px)`);
  if (l.corner) parts.push(`border-radius:${px(l.corner)}`);
  return parts.join(';');
}

/** rect / gradient のレイヤー（外枠 div に背景・枠・影）。 */
function renderBox(l) {
  const css = [];
  css.push(`position:absolute;left:${px(l.x)};top:${px(l.y)};width:${px(l.w)};height:${px(l.h)};z-index:${Math.round(l.z)};overflow:${l.corner > 0 ? 'hidden' : 'visible'}`);  if (l.type === 'rect') {
    if (l.bg) css.push(`background:${l.bg}`);
    if (l.border) css.push(`border:${l.border}`);
  } else {
    css.push(`background:linear-gradient(${l.angle}deg, ${l.from}, ${l.to})`);
  }
  if (l.shadow) css.push(`box-shadow:${l.shadow}`);
  const eff = layerEffectCSS(l);
  if (eff) css.push(eff);
  return `<div class="ly ${l.type}" data-id="${escapeHtml(l.id)}" style="${css.join(';')}"></div>`;
}

function renderImg(l) {
  const css = [];
  css.push(`position:absolute;left:${px(l.x)};top:${px(l.y)};width:${px(l.w)};height:${px(l.h)};z-index:${Math.round(l.z)};overflow:${l.corner > 0 ? 'hidden' : 'visible'}`);
  if (l.shadow) css.push(`box-shadow:${l.shadow}`);
  const eff = layerEffectCSS(l);
  if (eff) css.push(eff);
  const innerFit = `object-fit:${l.fit};object-position:${encodeURI(l.position)}`;
  const src = l.src ? escapeHtml(l.src) : '';
  const imgTag = l.src
    ? `<img src="${src}" alt="layer ${escapeHtml(l.id)}" style="width:100%;height:100%;${innerFit}" onerror="this.closest('.ly').classList.add('missing')"/>`
    : '';
  return `<div class="ly ${l.type}" data-id="${escapeHtml(l.id)}" style="${css.join(';')}">${imgTag}</div>`;
}

/** 本文 HTML を組み立て（エスケープ後のテキスト上で ruby/tcy をタグトークン化）。
 *  @why: [2026-08-31] escapeHtml でユーザー入力を完全に無菌化してから、《》を ruby に、連数字を tcy に組み立てる。
 *        生成されるタグはハードコードで、ユーザー文字列は混入しない（RE/XSS 安全）。 */
function buildInlineContent(text, { ruby, autoTcy }) {
  let out = escapeHtml(text);
  if (ruby) {
    // 「直前の1+文字《読み》」を <ruby>前側<rt>読み</rt></ruby> に置換。
    // ユーザー入力は既に escapeHtml 済みで、《》もHTML エンティティ化されてない全角文字なので plain text としてマッチする。
    out = out.replace(/(\S+)《([^》]+)》/g, '<ruby>$1<rt>$2</rt></ruby>');
  }
  if (autoTcy) {
    // 半角・全角の 2 桁連数字を縦中横へ。ruby 変換後のタグ部分の < や > は \S+ にマッチしないので安心。
    out = out.replace(/[0-9０-９]{2,3}/g, (m) => `<span class="tcy">${m}</span>`);
  }
  return out;
}

/** lineH/letterSpacing/weight を「ユーザー指定 > プロファイル > short-text補正」の順で解決（AIは名前だけで適用される）。
 *  @why: [2026-08-31] 「短文は行間が空きすぎる」問題。短いセンテンス（1-2 行）は CSS lineH が 1.5 以上だと余白が大きく
 *        センテンスとしてのグループ感が崩れる。lineH 未指定のプロファイル値を超える場合にプロファイル値を使いつつ、
 *        short-text（推定行数 ≤ 短文閾値）に限り lineH を 1.4 以下に抑える“normalized"を適用。これがtextプロファイル `auto` の本質。 */
function applyTypoProfile(l) {
  const prof = TYPO_PROFILES[l.typography] || TYPO_PROFILES.auto;
  // 1. ユーザー指定が無ければプロファイル値で初期化
  let lineH = (l.lineH != null) ? l.lineH : (prof.lineH === 'auto' ? null : prof.lineH);
  let letterSpacing = (l.letterSpacing != null) ? l.letterSpacing : (prof.letterSpacing ?? 0);
  let weight = (l.weight != null) ? l.weight : (prof.weight ?? null);

  // 2. short-text 補正：CSS line-height 単位が倍（"1.5" 等の string）のとき l.h が 1-2 行しか入らないなら 1.4 まで下げる
  if (l.lineH == null && prof.lineH === 'auto') {
    const estLines = estimateLineCount(l);
    if (estLines != null && estLines <= 2 && typeof lineH === 'string' && /^\d+(\.\d+)?$/.test(lineH) && Number(lineH) > 1.4) {
      lineH = '1.4';
    } else if (estLines != null && estLines >= 4 && typeof lineH === 'string' && /^\d+(\.\d+)?$/.test(lineH) && Number(lineH) < 1.5) {
      lineH = '1.6';
    }
  }
  return { lineH, letterSpacing, weight };
}

/** テキストがレイヤー矩形内で何行になりそうかを推定。lineH が未取得なら「不明」を返す。 */
function estimateLineCount(l) {
  if (!l.size || !l.w) return null;
  const charW = l.size * (l.dir === 'v' ? 1 : 0.55); // 横書きや縦書きのきいいた 1 文字幅の概算
  if (!charW) return null;
  // 改行（\n）は明示行数。只一行ならサイズ/文字数で行を推定。
  const text = l.text || '';
  const hardBreaks = (text.match(/\n/g) || []).length;
  const chars = text.replace(/\n/g, '');
  const linePx = (l.dir === 'v') ? l.size * 1.2 : (l.size * 1.5); // 行の高さ（lineH 1.5 として概算）
  const linesByBox = Math.max(1, Math.round(l.h / linePx));
  const cols = Math.max(1, Math.floor(l.w / charW));
  const wrapLines = (chars.length === 0) ? 1 : Math.ceil(chars.length / cols);
  return Math.max(hardBreaks + 1, Math.min(wrapLines, linesByBox));
}

function renderText(l) {
  const css = [];
  css.push(`position:absolute;left:${px(l.x)};top:${px(l.y)};width:${px(l.w)};height:${px(l.h)};z-index:${Math.round(l.z)}`);
  if (l.dir === 'v') {
    css.push('writing-mode:vertical-rl');
    css.push('text-orientation:mixed');
  }
  css.push(`font-size:${px(l.size)}`);
  if (l.font) css.push(`font-family:${l.font}`);
  css.push(`color:${l.color}`);

  // @why: [2026-08-31] 文字グラデーション（fill）またはフラット2色ツートン（splitColor）。
  if (l.splitColor) {
    const sc = l.splitColor;
    css.push(`background-image:linear-gradient(180deg, ${sc.top} 0%, ${sc.top} ${sc.ratio}%, ${sc.bottom} ${sc.ratio}%, ${sc.bottom} 100%)`);
    css.push('-webkit-background-clip:text');
    css.push('background-clip:text');
    css.push('-webkit-text-fill-color:transparent');
  } else if (l.fill) {
    css.push(`background-image:${l.fill}`);
    css.push('-webkit-background-clip:text');
    css.push('background-clip:text');
    css.push('-webkit-text-fill-color:transparent');
  }

  // @why: [2026-08-31] フラット台紙・グラフィックプレート（badge）。
  if (l.badge) {
    css.push(`background:${l.badge.bg}`);
    if (l.badge.pad) css.push(`padding:${px(l.badge.pad)}`);
    if (l.badge.corner) css.push(`border-radius:${px(l.badge.corner)}`);
    if (l.badge.border) css.push(`border:${l.badge.border}`);
  }

  // @why: [2026-08-31] AI が「短文は行間が空きすぎる」と言った問題。プロファイル + short-text 補正で自動解決。
  const typo = applyTypoProfile(l);
  if (typo.weight) css.push(`font-weight:${typo.weight}`);
  if (l.style === 'italic') css.push('font-style:italic');
  if (typo.letterSpacing) css.push(`letter-spacing:${px(typo.letterSpacing)}`);
  if (typo.lineH) css.push(`line-height:${typo.lineH}`);
  css.push(l.wrap === false ? 'white-space:nowrap' : 'white-space:pre-line');

  // 上下左右揃え
  const f = (pos) => (pos === 'center' ? 'center' : (pos === 'end' ? 'flex-end' : 'flex-start'));
  if (l.align === 'justify') {
    // justify は flex 中央寄せと相性が悪いので、display:block にして text-align:justify で両端揃え。
    css.push('display:block', 'text-align-last:justify', 'text-align:justify');
    if (l.dir === 'v') {
      // 縦書きは両端揃えの概念が違うので fallback で flex-start 維持。
      css.pop(); css.pop(); css.pop();
      css.push('display:flex', 'justify-content:flex-start');
    }
  } else {
    css.push('display:flex');
    if (l.dir === 'v') {
      css.push(`justify-content:${f(l.valign)}`); // 縦書き主軸=上下
      css.push(`align-items:${f(l.align)}`);       // 交差軸=左右
    } else {
      css.push(`justify-content:${f(l.align)}`);
      css.push(`align-items:${f(l.valign)}`);
    }
  }
  if (l.indent) css.push(`text-indent:${px(l.indent)}`);

  // @why: [2026-08-31] 傍点・圏点（emphasis）: 文字の頭に点（・）を打つ強調。
  if (l.emphasis) {
    const style = l.emphasis === 'dot' ? 'filled circle' : l.emphasis;
    css.push(`-webkit-text-emphasis:${style}`);
    css.push(`text-emphasis:${style}`);
  }

  // シャドウ・2Dソリッド押し出し・フラットオフセット・多重ストローク（袋文字）・グローの統合
  const shadowList = [];

  // @why: [2026-08-31] フラット平行オフセット（flatOffset）: カチッとした単色平行ズラし。
  if (l.flatOffset) {
    shadowList.push(`${px(l.flatOffset.x)} ${px(l.flatOffset.y)} 0 ${l.flatOffset.color}`);
  }

  // @why: [2026-08-31] 2D ソリッド押し出し（レイキャスト・単色ドット埋め）:
  //       角度 angle と距離 depth に沿って 1px 刻みで完全ハードエッジの text-shadow を生成。
  if (l.extrude && l.extrude.depth > 0) {
    const extSh = build2DSolidExtrude(l.extrude.angle, l.extrude.depth, l.extrude.color);
    if (extSh) shadowList.push(extSh);
  }

  // @why: [2026-08-31] 多重ストローク（袋文字）: 1番目を -webkit-text-stroke に、2番目以降を全方位 text-shadow に。
  if (l.strokes && l.strokes.length > 0) {
    const first = l.strokes[0];
    css.push(`-webkit-text-stroke:${px(first.width)} ${first.color}`);
    css.push('paint-order:stroke fill');
    for (let i = 1; i < l.strokes.length; i++) {
      const st = l.strokes[i];
      const outSh = buildOuterStrokeShadow(st.color, st.width);
      if (outSh) shadowList.push(outSh);
    }
  } else if (l.stroke) {
    css.push(`-webkit-text-stroke:${px(l.stroke.width)} ${l.stroke.color}`);
    css.push('paint-order:stroke fill');
  }

  if (l.shadow) shadowList.push(l.shadow);

  // @why: [2026-08-31] ネオン・発光（glow）: 多重シャドウで光彩をふわっと広げる。
  if (l.glow) {
    const g = l.glow;
    shadowList.push(`0 0 ${px(g.blur * 0.4)} ${g.color}`);
    shadowList.push(`0 0 ${px(g.blur * 0.8)} ${g.color}`);
    shadowList.push(`0 0 ${px(g.blur * 1.5)} ${g.color}`);
  }

  if (shadowList.length > 0) {
    css.push(`text-shadow:${shadowList.join(', ')}`);
  }

  const eff = layerEffectCSS(l);
  if (eff) css.push(eff);
  const body = buildInlineContent(l.text, { ruby: l.ruby, autoTcy: l.autoTcy });
  return `<div class="ly ${l.type}" data-id="${escapeHtml(l.id)}" style="${css.join(';')}">${body}</div>`;
}

/** 3D 文字レイヤー。 text-shadow の N 段重ねで押出し、 perspective + rotateX/Y で空間内でグリフを傾ける。
 *  @why: [2026-08-31] text3d は迫力が必要なシーンだけ使う。光沢と反射は CSS だけだと表現が低いので擬似 3D に留める。
 *        depth=0 のときはフラットな斜体グリフとして動作（外側の rotate だけ X/Y に効く）。
 *        押出し色はユーザー指定があればそれ、未指定なら stroke.color か color を HSLA to dark。
 *        perspective は container に、rotateX/Y はグリフ自体に適用。 */
function renderText3D(l) {
  const css = [];
  css.push(`position:absolute;left:${px(l.x)};top:${px(l.y)};width:${px(l.w)};height:${px(l.h)};z-index:${Math.round(l.z)}`);
  if (l.dir === 'v') css.push('writing-mode:vertical-rl', 'text-orientation:mixed');
  css.push(`font-size:${px(l.size)}`);
  if (l.font) css.push(`font-family:${l.font}`);
  css.push(`color:${l.color}`);

  // 文字グラデーション（fill）
  if (l.fill) {
    css.push(`background-image:${l.fill}`);
    css.push('-webkit-background-clip:text');
    css.push('background-clip:text');
    css.push('-webkit-text-fill-color:transparent');
  }

  // タイポプロファイル適用 (omomato をデフォルト推奨)
  const typo = typeof applyTypoProfile === 'function' ? applyTypoProfile(l) : { lineH: null, letterSpacing: null, weight: null };
  if (typo.weight) css.push(`font-weight:${typo.weight}`);
  if (l.style === 'italic') css.push('font-style:italic');
  if (typo.letterSpacing) css.push(`letter-spacing:${px(typo.letterSpacing)}`);
  if (typo.lineH) css.push(`line-height:${typo.lineH}`);
  css.push(l.wrap === false ? 'white-space:nowrap' : 'white-space:pre-line');

  // 上下中央揃え
  const f = (pos) => (pos === 'center' ? 'center' : (pos === 'end' ? 'flex-end' : 'flex-start'));
  css.push('display:flex');
  if (l.dir === 'v') {
    css.push(`justify-content:${f(l.valign)}`);
    css.push(`align-items:${f(l.align)}`);
  } else {
    css.push(`justify-content:${f(l.align)}`);
    css.push(`align-items:${f(l.valign)}`);
  }
  if (l.indent) css.push(`text-indent:${px(l.indent)}`);

  if (l.emphasis) {
    const style = l.emphasis === 'dot' ? 'filled circle' : l.emphasis;
    css.push(`-webkit-text-emphasis:${style}`);
    css.push(`text-emphasis:${style}`);
  }

  if (l.stroke) {
    css.push(`-webkit-text-stroke:${px(l.stroke.width)} ${l.stroke.color}`);
    css.push('paint-order:stroke fill');
  }

  // transform を 1 行に集約する
  css.push('transform-style:preserve-3d');
  const txParts = [];
  txParts.push(`perspective(${l.perspective}px)`);
  txParts.push(`rotateX(${l.rotateX}deg)`);
  txParts.push(`rotateY(${l.rotateY}deg)`);
  if (l.skewX) txParts.push(`skewX(${l.skewX}deg)`);
  if (l.skewY) txParts.push(`skewY(${l.skewY}deg)`);
  if (l.rotate) txParts.push(`rotate(${l.rotate}deg)`);
  if (l.flip === 'h') txParts.push('scaleX(-1)');
  else if (l.flip === 'v') txParts.push('scaleY(-1)');
  css.push(`transform:${txParts.join(' ')}`);
  css.push('transform-origin:center');

  // 共通エフェクトから transform 以外（opacity / blend / filter / corner / blur）だけを引く
  const eff = layerEffectsExceptTransform(l);
  if (eff) css.push(eff);

  // 押出し: text-shadow を N 段重ねる
  const shadowList = [];
  if (l.depth > 0) {
    const baseShadow = l.extrudeColor || l.stroke?.color || l.color;
    for (let i = 1; i <= l.depth; i++) {
      shadowList.push(`${i}px ${i}px 0 ${baseShadow}`);
    }
  }

  if (l.glow) {
    const g = l.glow;
    shadowList.push(`0 0 ${px(g.blur * 0.5)} ${g.color}`);
    shadowList.push(`0 0 ${px(g.blur * 1.5)} ${g.color}`);
  }

  if (shadowList.length > 0) {
    css.push(`text-shadow:${shadowList.join(',')}`);
  }

  const body = buildInlineContent(l.text, { ruby: l.ruby, autoTcy: l.autoTcy });
  return `<div class="ly text3d" data-id="${escapeHtml(l.id)}" style="${css.join(';')}">${body}</div>`;
}



/** scene → 完全なHTML文字列（Chrome 焼き用）。bg transparent は body も透明。 */
export function renderHTML(scene) {
  const { canvas } = scene;
  // @why: [2026-08-31] 透明判定は isTransparentBg に一元化（"#0000" / "rgba(0,0,0,0)" も透明PNG）。
  //       従来は === 'transparent' 比較だけだったため、それ以外の透明指定で body 背景が塗られて白PNGになった。
  const bg = isTransparentBg(canvas.bg) ? 'transparent' : canvas.bg;
  // @why: [2026-08-31] html/body に canvas と同じ背景を置く（Chromeスクショで canvas 外の余白を差し…透明な
  //       部分は --default-background-color=00000000 で透明PNGになる。背景を有するときは余白が塗られてあふれ防止）。
  // @why: [2026-08-31] text3d レイヤを renderText3D に配線する。switch 含めなかったため現状は renderBox（rect 扱い）に
  //        落ちて "background:linear-gradient(undefineddeg, undefined, undefined)" という無意味な div が出力されていた。
  //        配線後は perspective + rotateX/Y + text-shadow N 段押出しがテキスト要素に乗る。
  // @tags: SPEC
  const renderer = (l) => {
    if (l.type === 'img') return renderImg(l);
    if (l.type === 'text') return renderText(l);
    if (l.type === 'text3d') return renderText3D(l);
    return renderBox(l);
  };
  const lay = scene.layers.map(renderer).join('\n');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>image-compose</title>
<style>
  html,body{margin:0;padding:0;background:${bg};width:100%;height:100%;}
  .ly{position:absolute;box-sizing:border-box;}
  .missing{background:#ffd;outline:1px dashed #f66;display:flex;align-items:center;justify-content:center;}
  .missing img{display:none;}
  /* テキスト強化（2026-08-31） */
  .tcy{-webkit-text-combine:horizontal;text-combine-upright:all;}
  ruby{ruby-position:over;line-height:1;}
  rt{font-size:0.5em;letter-spacing:0;line-height:1.2;color:inherit;font-weight:normal;}
</style></head>
<body><div class="canvas" style="position:relative;width:${px(canvas.w)};height:${px(canvas.h)};background:${bg};overflow:hidden;">${lay}</div></body></html>`;
}