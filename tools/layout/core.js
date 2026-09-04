// ─────────────────────────────────────────────────────────────────
// map of meaning — core.js
// 責務: 単位解決・正規化・親子矩形・整列・衝突検知・HTML組み立て。
// 公開関数の入口（最初に読む順序）:
//   toPt(v)                      単位文字列を pt 数値へ
//   resolveNestedLayers(layers)  親矩形 + inset から子の座標を計算
//   applyLayoutOperations(...)    align / distribute / match-* を適用
//   detectCollisions(layers)      AABB 単位で重なりを返す
//   autoFixCollisions(layers)    右・下・左・上候補から最小移動で退避
//   buildLayout(raw)             JSON全体 → 正規化済みレイヤー配列を返す
//   normalizeLayer(l)            1レイヤーを正規化（単位・回転・属性吸収、balloon を含む）
//   renderHTML(layout)           HTML文字列を生成（DOM I/Oなし、balloon div も生成）
//
// 壊してはいけない性質（HANDOFF §7〜§8 と一致）:
//   - 判定は AABB（レイヤー矩形）。字形輪郭ではない。
//   - text × text は error、text × rule は warn、box / balloon は背景扱いとして除外、allowOverlap/hide は除外（2026-08-30 で balloon 追加）。
//   - ページ処理順序: 正規化 → 親子解決 → operations → 子の再解決 → oob再計算 → 衝突検知。
//   - normalizeLayer の戻り値は破壊的に.layerに書き戻してはいけない（applyLayoutOperations等で参照される）。
//
// AIが1分で観測する手順:
//   cd layout-cli
//   npm test                                                    # 226 pass / 0 fail を確認（balloon MVP後は 231前後）
//   node --check core.js cli.js typography.js rules.js test.js  # 全ファイル構文OK
//   node cli.js examples/alignment-demo.json --check --report /tmp/r.json
// ─────────────────────────────────────────────────────────────────

/**
 * layout-cli/core.js — 純粋レイアウト（DOM・画像IO なし・headless 検証対象）。
 *
 * 「レイヤーで縦書き・横書きを配置する」だけをやる最小の配置層。
 * 和文出版DTP規格（Q数/H数・割注・多種傍点・初字拡大・長体平体・字詰め・各種罫線・飾り枠）および
 * 画像配置（type: img）、複数ページ（pages）、AI自動衝突修復（autoFixCollisions）を完全統合。
 *
 * // @why: [2026-08-26] ユーザー要求「重なりをチェックして直す・画像配置・複数ページ展開」。
 * //       1. 画像レイヤー（type: img - cover/contain/filter/placeholder）を実装しイラスト・写真配置に対応。
 * //       2. 衝突自動修復（autoFixCollisions）により、AIが検出した重なりを一発で安全位置へ自動退避。
 * //       3. 複数ページ（pages[]）対応で見開き・カード束・パンフレットの一括出力を可能にする。
 * //       4. 画像とフォールバックは同じ親矩形へ絶対配置し、読込失敗時にも枠外へ流れないようにする。
 * // @tags: SPEC
 */

import { escapeHtml, inlineTypography, resolveFont, resolveKerning, resolveScaling } from './typography.js';
import { renderRuleStyle, renderFrameStyle, renderCapDecorations } from './rules.js';

// —— 長さ。pt を基底（1in = 72pt = 25.4mm = 96px） ——
/** 1mm = 72/25.4 pt。 CSS では 96px = 1in（= 72pt） 。ポイントと px の真ん中は、_MM は言葉で 中央集約。 */
export const MM = 72 / 25.4;

/** 1レイヤーの .oob を 「上下左右の ページ外 ピクセル量（正のとき不満）」 に更新。 0.01pt 以下のノイズは null 化。  layer を in-place 上書きし、自身を返す。 */
function refreshOob(layer, pageW, pageH) {
  const bounds = {
    left: -layer.x,
    top: -layer.y,
    right: layer.x + layer.w - pageW,
    bottom: layer.y + layer.h - pageH,
  };
  layer.oob = Object.values(bounds).some((value) => value > 0.01)
    ? Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, Math.round(value)]))
    : null;
  return layer;
}

/**
 * 単位文字列を pt 数値に解決する（"12pt" / "3mm" / "16Q" / "24H" / "1.5cm" / 数値 など）。
 *  入力: v:string|number, base:number=1000（%変換の基準幅）。
 *  出力: number (pt)。未対応単位・null/undefined・空文字は 0 を返す（fail-soft）。
 *  不変条件: 副作用ゼロ・例外を投げない・乱れた値も 0 を返すので呼び出し側は 0 でも安心。
 * 覗き口: HANDOFF §5.1 ／ map of meaning — core.js
 */
// @why: [2026-08-26] AABB判定と pt への一元化により、以降全ての幾何計算を同一スケールで安全に行える。
//       「不正値で例外」「別単位のまま計算」は、ハンドオフ語の違う負の事故を産むことから、不正値は黙って 0 に。
//       「AIが誤ったJSONを渡しても壊れず、どこで破綻したかを報告に任せられる」状態にした。
/** "12pt" / "3mm" / "16Q" / "24H" / "1.5cm" / 数値(pt) → pt。乱れた値は 0 扱い。 */
export function toPt(v, base = 1000) {
  const t = typeof v === 'number' ? String(v) : String(v ?? '').trim();
  const m = /^(-?[\d.]+)(mm|cm|in|pt|px|%|[qQhH])?$/.exec(t);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const u = (m[2] || '').toLowerCase();
  switch (u) {
    case 'q':
    case 'h': return n * 0.25 * MM; // 1Q = 1H = 0.25mm
    case 'mm': return n * MM;
    case 'cm': return n * MM * 10;
    case 'in': return n * 72;
    case 'px': return n * 72 / 96;
    case '%': return n / 100 * base;
    default: return n; // pt / 数値
  }
}

function normalizeInset(value, pageW, pageH) {
  if (value == null) return null;
  if (typeof value === 'object') {
    return {
      top: toPt(value.top ?? 0, pageH),
      right: toPt(value.right ?? 0, pageW),
      bottom: toPt(value.bottom ?? 0, pageH),
      left: toPt(value.left ?? 0, pageW),
    };
  }
  const all = toPt(value, pageW);
  return { top: all, right: all, bottom: all, left: all };
}

/**
 * 親矩形＋内側マージンで子レイヤーの矩形を解決する。
 *  入力: layers[]、pageW/pageH を決定論。layers を破壊的に書き換える（in-place 与える呼び出し側の責務）。
 *  出力: 解決できなかった id 配列。未解決はサイレントでも報告可能（unresolved[]）。
 *  不変条件: 親サイクルは throw / 親が存在しない子は unresolved として記録される / 子の rect 値は小数 2 位に丸める。
 * 覗き口: HANDOFF §6 ／ map of meaning — core.js
 */
// @why: [2026-08-26] 親を動かせば全子要素が追従する「箱の中の箱」モデルを導入。
//       画像クロップの基準矩形を一意にし、個別座標のセット上のずれをスキーマから除外する。
//       未親は unresolved で報告し、サイレントに例外より気づけるようにした（AIがレポーティング可能）。
// @why: [2026-08-26] 画像外枠・ラベル・カードの上端が個別座標だと微妙にずれるため、
//       親を動かせば全子要素が追従する「箱の中の箱」を導入。画像クロップの基準矩形も一意になる。
// @tags: SPEC
export function resolveNestedLayers(layers, pageW, pageH) {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const visiting = new Set();
  const resolved = new Set();
  const unresolved = [];

  function resolve(layer) {
    if (!layer.parent || resolved.has(layer.id)) return;
    if (visiting.has(layer.id)) throw new Error(`parent cycle: ${layer.id}`);
    const parent = byId.get(layer.parent);
    if (!parent) {
      unresolved.push({ id: layer.id, parent: layer.parent });
      resolved.add(layer.id);
      return;
    }
    visiting.add(layer.id);
    resolve(parent);
    const inset = layer.inset || { top: 0, right: 0, bottom: 0, left: 0 };
    if (layer.radiusMode === 'inherit') layer.radius = parent.radius;
    layer.x = +(parent.x + inset.left).toFixed(2);
    layer.y = +(parent.y + inset.top).toFixed(2);
    layer.w = +Math.max(0, parent.w - inset.left - inset.right).toFixed(2);
    layer.h = +Math.max(0, parent.h - inset.top - inset.bottom).toFixed(2);
    visiting.delete(layer.id);
    resolved.add(layer.id);
  }

  layers.forEach(resolve);
  return unresolved;
}

/**
 * レイヤー集合に align / distribute / match-* 操作を宣言的に適用する。
 *  入力: layers[] (破壊的上書き), operations[] = { mode, ids[], anchor }
 *  出力: { layers, changes[] } — layers は参照返し、変更詳細は changes[] に記録。
 *  不変条件: anchor 自身は動かない / ids は2個以上ないと無視 / ランダム未使用 / 例外を投げない。
 * 覗き口: HANDOFF §7 ／ map of meaning — core.js
 */
// @why: [2026-08-26] 「2〜3要素を選び、1つを基準に揃え・分布・サイズ合わせ」を座標計算でなく
//       宣言で記述したく導入。anchor のみ不動 / 結果を changes[] でレポートして
//       AIが「適用された動き」を再検証できる（観測可能）ことを最重視。
export function applyLayoutOperations(layers, operations = []) {
  const changes = [];
  const byId = new Map(layers.map((l) => [l.id, l]));

  for (const op of operations) {
    if (!op || typeof op !== 'object') continue;
    const mode = String(op.mode || op.action || op.axis || (op.op === 'align' ? 'center-x' : '')).toLowerCase().replace(/_/g, '-');
    const ids = Array.isArray(op.ids) ? op.ids : [];
    const selected = ids.map((id) => byId.get(id)).filter(Boolean);
    if (selected.length < 2) continue;

    if (mode === 'distribute-x' || mode === 'distribute-y') {
      const axis = mode.endsWith('x') ? 'x' : 'y';
      const ordered = [...selected].sort((a, b) => (a[axis] + a[axis === 'x' ? 'w' : 'h'] / 2) - (b[axis] + b[axis === 'x' ? 'w' : 'h'] / 2));
      const first = ordered[0];
      const last = ordered[ordered.length - 1];
      const firstCenter = first[axis] + first[axis === 'x' ? 'w' : 'h'] / 2;
      const lastCenter = last[axis] + last[axis === 'x' ? 'w' : 'h'] / 2;
      const step = ordered.length > 1 ? (lastCenter - firstCenter) / (ordered.length - 1) : 0;
      ordered.slice(1, -1).forEach((layer, i) => {
        const key = axis === 'x' ? 'w' : 'h';
        const next = firstCenter + step * (i + 1) - layer[key] / 2;
        if (Math.abs(layer[axis] - next) > 0.01) {
          changes.push({ id: layer.id, from: layer[axis], to: +next.toFixed(2), mode });
          layer[axis] = +next.toFixed(2);
        }
      });
      continue;
    }

    const anchor = byId.get(op.anchor || ids[0]);
    if (!anchor || !selected.includes(anchor)) continue;
    const targets = selected.filter((layer) => layer !== anchor);
    for (const layer of targets) {
      const old = { x: layer.x, y: layer.y, w: layer.w, h: layer.h };
      const anchorCenterX = anchor.x + anchor.w / 2;
      const anchorCenterY = anchor.y + anchor.h / 2;
      if (mode === 'center-x' || mode === 'center') layer.x = +(anchorCenterX - layer.w / 2).toFixed(2);
      if (mode === 'center-y' || mode === 'center') layer.y = +(anchorCenterY - layer.h / 2).toFixed(2);
      if (mode === 'left') layer.x = +anchor.x.toFixed(2);
      if (mode === 'right') layer.x = +(anchor.x + anchor.w - layer.w).toFixed(2);
      if (mode === 'top') layer.y = +anchor.y.toFixed(2);
      if (mode === 'bottom') layer.y = +(anchor.y + anchor.h - layer.h).toFixed(2);
      if (mode === 'match-width' || mode === 'match-size') layer.w = anchor.w;
      if (mode === 'match-height' || mode === 'match-size') layer.h = anchor.h;
      if (mode === 'match-width' || mode === 'match-height' || mode === 'match-size') {
        // サイズ変更後も矩形中心をanchor中心に維持
        layer.x = +(anchorCenterX - layer.w / 2).toFixed(2);
        layer.y = +(anchorCenterY - layer.h / 2).toFixed(2);
      }
      if (mode === 'center-x' || mode === 'center-y' || mode === 'center' || mode === 'left' || mode === 'right' || mode === 'top' || mode === 'bottom' || mode.startsWith('match-')) {
        if (old.x !== layer.x || old.y !== layer.y || old.w !== layer.w || old.h !== layer.h) {
          changes.push({ id: layer.id, from: old, to: { x: layer.x, y: layer.y, w: layer.w, h: layer.h }, mode, anchor: anchor.id });
        }
      }
    }
  }
  return { layers, changes };
}

/**
 * レイヤー間の重なりを AABB 判定で検出し、機械可読な衝突レポートを返す。
 *  入力: layers[]（破壊的: __colliding フラグを その場で消去・付与）。
 *  出力: collisions[] — { idA, idB, typeA, typeB, overlapW, overlapH, severity }。
 *  不変条件: text×text = error、text×rule = warn、box / allowOverlap / hide は除外。
 *          text-rule は wide/high とも 0.05pt 以上、text-text は 1.5pt 以上で交差と判定。AABB 判定（字形輪郭ではない）、
 *          ランダム未使用・例外を投げない。
 * 覗き口: HANDOFF §8 ／ map of meaning — core.js
 */
// @why: [2026-08-26] AABBに限定した理由: 字体メトリクス/fout-hinting 依存は headless で不安定。
//       AIが同じ入力で同じ結果を得る「決定性」が最重大＝ 字形輪郭判定には踏み込まない。
//       text×text=ERROR／text×rule=WARN とシンプルにレベルを分けたのは、警告粒度を上げると
//       ループの中での「取捨選択コスト」が上がってしまうため。
export function detectCollisions(layers) {
  // 前回の検査結果を持ち越さない（autoFix 後に古い ⚡衝突表示を残さない）。
  layers.forEach((l) => { delete l.__colliding; });
  const collisions = [];
  const n = layers.length;

  for (let i = 0; i < n; i++) {
    const a = layers[i];
    if (a.hide || a.allowOverlap) continue;

    for (let j = i + 1; j < n; j++) {
      const b = layers[j];
      if (b.hide || b.allowOverlap) continue;

      // 包含関係の判定（一方がboxで、もう一方を完全に囲んでいる場合は正常な親枠とみなす）
      if (a.type === 'box' && a.x <= b.x && a.y <= b.y && (a.x + a.w) >= (b.x + b.w) && (a.y + a.h) >= (b.y + b.h)) {
        continue;
      }
      if (b.type === 'box' && b.x <= a.x && b.y <= a.y && (b.x + b.w) >= (a.x + a.w) && (b.y + b.h) >= (a.y + a.h)) {
        continue;
      }
      // box は背景・枠として他要素の下に敷く用途が基本。box同士/boxと要素は衝突扱いしない。
      // 検出対象は「内容同士」と「内容を横切る罫線」の事故に限定する。
      // @why: [2026-08-30] balloon も box と同じく「背景付き枠」と位置づけ、シナリオ間のうっかり重なり検知はしない。
      //       ふきだし枠にコマ内のテキストが読みにくいほど重なるのは次のフェーズで balloon-aware warn として導入する。
      if (a.type === 'box' || b.type === 'box' || a.type === 'balloon' || b.type === 'balloon') continue;

      // AABB 衝突判定。細い罫線は厚みが1pt未満でも文字を横切るため、
      // text同士（面積）と rule-text（線分交差）で閾値を分ける。
      const overlapW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      const isTextText = (a.type === 'text' && b.type === 'text');
      const isRuleText = (a.type === 'rule' && b.type === 'text') || (a.type === 'text' && b.type === 'rule');
      const intersects = isRuleText
        ? overlapW > 0.05 && overlapH > 0.05
        : overlapW > 1.5 && overlapH > 1.5;

      if (intersects) {
        const severity = isTextText ? 'error' : (isRuleText ? 'warn' : 'info');

        collisions.push({
          idA: a.id,
          idB: b.id,
          typeA: a.type,
          typeB: b.type,
          overlapW: +overlapW.toFixed(1),
          overlapH: +overlapH.toFixed(1),
          severity,
        });

        a.__colliding = true;
        b.__colliding = true;
      }
    }
  }

  return collisions;
}

/**
 * 衝突の自動修復（Auto Fix Collisions）。
 * 衝突している要素を、主軸・交差軸に沿って重ならない位置へ自動退避。
 */
/** AABBだけでなく、背景boxの包含を除いた「衝突扱い」の候補検査。 */
function candidateHasCollision(candidate, others) {
  const probe = [...others.map((l) => ({ ...l })), { ...candidate }];
  return detectCollisions(probe).some((c) => c.idA === candidate.id || c.idB === candidate.id);
}

/**
 * 衝突している B 側のレイヤーをページ内へ自動退避する。
 *  入力: layers[]、pageW/pageH。B はコピー、layer を破壊しない。B が a の中の並び順で全件検査し、
 *        衝突ごとに右→左→下→上のページを跨がない候補のうち最距離小を adoption。最大 8 试行。
 *  出力: { layers, fixesApplied[] } — layers は新配列、fixesApplied に { id, action } を記録。
 *  不変条件: ランダム使用なし・例外を投げない・決定的に動作。layer を破壊しないので返り値を上書きしても安全。
 *          試行上限 8 を越えると「動かせないことが分かる」ことを返す（無に黙ってしない）。
 * 覗き口: HANDOFF §8 ／ map of meaning — core.js
 */
// @why: [2026-08-26] --fix はデザインを再構成しない、「安全な退避」だけが他以上を担当しないことを明示したい。
//       ページ外への出を許すとページ装丁を壊すので、まずページ内に収まることを優先。
//       Next:「デザイン意意を理解する AI」ではなく「スキルったべきか」ではなく「スキル取った」という不変条件を持たせたい。
/**
 * 衝突の自動修復（Auto Fix Collisions）。
 * 右・左・下・上の4候補から、ページ内に収まり、他要素と衝突しない最短移動を選ぶ。
 *
 * // @why: [2026-08-26] 単純に「下へ移動」するとページ外へ出るケースがあった。
 * //       修復はデザインを勝手に再構成する機能ではなく、衝突を解消する安全退避なので、
 * //       4方向のページ内候補を比較し、移動距離最小のものだけを採用する。
 */
export function autoFixCollisions(layers, pageW, pageH) {
  const fixed = layers.map((l) => ({ ...l }));
  const fixesApplied = [];
  const gap = 12 * (72 / 25.4 * 0.3528); // 約12pt

  let attempts = 0;
  while (attempts < 8) {
    const cols = detectCollisions(fixed);
    if (cols.length === 0) break;
    const fixCountBefore = fixesApplied.length;

    cols.forEach((c) => {
      const idxA = fixed.findIndex((l) => l.id === c.idA);
      const idxB = fixed.findIndex((l) => l.id === c.idB);
      if (idxA === -1 || idxB === -1) return;

      const a = fixed[idxA];
      const b = fixed[idxB];
      const candidates = [
        { side: 'right', x: a.x + a.w + gap, y: b.y },
        { side: 'left', x: a.x - b.w - gap, y: b.y },
        { side: 'down', x: b.x, y: a.y + a.h + gap },
        { side: 'up', x: b.x, y: a.y - b.h - gap },
      ].filter((p) => p.x >= 0 && p.y >= 0 && p.x + b.w <= pageW && p.y + b.h <= pageH)
        .map((p) => ({ ...p, distance: Math.abs(p.x - b.x) + Math.abs(p.y - b.y) }))
        .sort((p, q) => p.distance - q.distance);

      const chosen = candidates.find((p) => {
        const probe = { ...b, x: p.x, y: p.y };
        return !candidateHasCollision(probe, fixed.filter((_, k) => k !== idxB));
      });

      if (chosen) {
        b.x = +chosen.x.toFixed(2);
        b.y = +chosen.y.toFixed(2);
        fixesApplied.push({ id: b.id, action: `shifted ${chosen.side} to x:${(b.x / MM).toFixed(1)}mm y:${(b.y / MM).toFixed(1)}mm` });
      }
    });

    attempts++;
    // どの要素も動かせない場合の無限ループ防止
    if (fixesApplied.length === fixCountBefore) break;
  }

  return { layers: fixed, fixesApplied };
}

/**
 * 入力 JSON を正規化し、レイヤー配列とレポートを返す（コアパイプライン・スイート）。
 *  入力: raw = { page, layers[] } または { pages:[…], page }。
 *  出力: 単一ページなら { w, h, layers[], oob[], collisions[], ... }、
 *        複数ページなら { isMultiPage:true, pages[], oob[], collisions[]、... }。
 *  不変条件: 入力 JSON を破壊しない / ランダムなし / 例外を投げない（parent cycle は呼び出し側で例外）。
 *          実行順序: normalize → resolveNestedLayers → applyLayoutOperations → (if親移動) 再 resolveNested →
 *                    refreshOob → detectCollisions。
 * 　　　呼び出し側はこの返り値を layout-cli の CLI --check / --fix / --png の指針として使う。
 * ぞき口: HANDOFF §5 ／ map of meaning — core.js
 */
// @why: [2026-08-26] 設計起点のコマンドを CLI / --check / --fix / --png がいずれも答えられる１ヶ所に集約。
//       CLI / test.js / サンプルジェネレータのいずれもこの関数からスタートする。
//       順序を関数内に隠さず、JSDoc に同じ順序を書くことで「observability」を物理的に保証。
/** 入力 JSON を正規化。単一ページまたは複数ページ (pages) 対応。 */
export function buildLayout(raw = {}) {
  // 複数ページ (pages) の場合
  if (Array.isArray(raw.pages) && raw.pages.length > 0) {
    const rootPage = raw.page ?? {};
    const pw = toPt(rootPage.w ?? 210 * MM, 0) || 595.28;
    const ph = toPt(rootPage.h ?? 297 * MM, 0) || 841.89;
    const pMargin = toPt(rootPage.margin ?? 15 * MM, pw);
    const pBg = rootPage.bg ?? '#f6f1e5';

    const pages = raw.pages.map((p, pIdx) => {
      const pageMeta = p.page ?? rootPage;
      const w = toPt(pageMeta.w ?? pw, 0);
      const h = toPt(pageMeta.h ?? ph, 0);
      const margin = toPt(pageMeta.margin ?? pMargin, w);
      const bg = pageMeta.bg ?? pBg;
        const layers = (Array.isArray(p.layers) ? p.layers : []).map((l, i) => normalizeLayer(l, w, h, `${pIdx}_${i}`));
      const unresolvedParents = resolveNestedLayers(layers, w, h);
      const operationResult = applyLayoutOperations(layers, p.operations ?? raw.operations ?? []);
      // 親自身を整列操作で動かした場合だけ、子をもう一度追従させる。
      const parentIds = new Set(layers.filter((layer) => layer.parent).map((layer) => layer.parent));
      if (operationResult.changes.some((change) => parentIds.has(change.id))) resolveNestedLayers(layers, w, h);
      layers.forEach((layer) => refreshOob(layer, w, h));
      const oob = layers.filter((l) => l.oob).map((l) => ({ id: l.id, dir: l.dir, ...l.oob }));
      const collisions = detectCollisions(layers);
      return { w, h, margin, bg, layers, oob, collisions, pageNum: pIdx + 1, operationChanges: operationResult.changes, unresolvedParents };
    });

    const allOob = pages.flatMap((p) => p.oob);
    const allCollisions = pages.flatMap((p) => p.collisions);
    return { isMultiPage: true, pages, oob: allOob, collisions: allCollisions, w: pw, h: ph };
  }

  // 単一ページの場合
  const page = raw.page ?? raw ?? {};
  const w = toPt(page.w ?? 210 * MM, 0) || 595.28;
  const h = toPt(page.h ?? 297 * MM, 0) || 841.89;
  const margin = toPt(page.margin ?? 15 * MM, w);
  const bg = page.bg ?? '#f6f1e5';
  const layers = (Array.isArray(raw.layers) ? raw.layers : []).map((l, i) => normalizeLayer(l, w, h, i));
  const operations = Array.isArray(raw.operations) ? raw.operations : [];
  const unresolvedParents = resolveNestedLayers(layers, w, h);
  const operationResult = applyLayoutOperations(layers, operations);
  // 親自身を整列操作で動かした場合だけ、子をもう一度追従させる。
  const parentIds = new Set(layers.filter((layer) => layer.parent).map((layer) => layer.parent));
  if (operationResult.changes.some((change) => parentIds.has(change.id))) resolveNestedLayers(layers, w, h);
  layers.forEach((layer) => refreshOob(layer, w, h));
  const oob = layers.filter((l) => l.oob).map((l) => ({ id: l.id, dir: l.dir, ...l.oob }));
  const collisions = detectCollisions(layers);
  return { isMultiPage: false, w, h, margin, bg, layers, oob, collisions, operations, operationChanges: operationResult.changes, unresolvedParents, parentChanges: [] };
}

/** align / valign の文字列を start / center / end / justify の 4 値に マップ。末は start。 */
function normalizeAlign(align) {
  if (!align) return 'start';
  const a = String(align).toLowerCase();
  if (['justify', 'distribute', 'equal', '均等', '均等割付', '等幅'].includes(a)) return 'justify';
  if (['center', 'middle', '中央'].includes(a)) return 'center';
  if (['end', 'right', 'bottom', '右', '下', '地'].includes(a)) return 'end';
  return 'start'; // left / top / 天 / 左
}

/**
 * 1レイヤーJSON を正規化し、buildLayout ングインが読み取れるレイヤーオブジェクトを作る。
 *  入力: l（単一レイヤーJSON）、pageW/pageH（pt）、i（id が無いときの代用インデックス）。
 *  出力: 完全なレイヤーオブジェクト — id / dir / type / x,y,w,h / size / kerning / scale / ...。
 *  不変条件: l を破壊しない。新オブジェクトを返す。ランダム未使用・例外を投げない。
 *          type: が未指定なら 'text'、dir が未指定なら rule/rule と は ○（ะや : rule/text は 親と coerce）。
 *          align/valign は normalizeAlign で正規化、kerning は kerning > palt 優先。
 * ぞき口: HANDOFF §5.2 ／ map of meaning — core.js
 */
// @why: [2026-08-26] 入力 1 件に「未指定」を許容しつつ buildLayout の全体者には均一なレイアウトを渡すためのステップ。
//       　未 coerce をここで済ませて、以後の関数には「checked 前提」を渡すことで、調査コストを一定に保つ。
/** 1レイヤーを正規化。既定: 縦書き text。座標は絶対値（ページ左上が0,0）。 */
export function normalizeLayer(l, pageW, pageH, i) {
  const id = l.id ?? `ly${i}`;
  const rawType = (l.type || 'text').toLowerCase();
  const isRule = rawType === 'rule' || rawType === 'line' || rawType === '罫線';
  const isBox = rawType === 'box' || rawType === 'frame' || rawType === '枠';
  const isImg = rawType === 'img' || rawType === 'image' || rawType === '画像' || rawType === '写真';
  // @why: [2026-08-30] balloon MVP。type は text/box/img/rule の隣に「吹き出し」を位置づける。
  //       既存4タイプの判定順序と正規化結果（type）に手を加えず、isBalloon を加列するだけにする方針で、
  //       type のフォールバックを 4分岐だったものから 5分岐に変えないと追加できない。
  //       漫画内のつな「門の文字」として描画する・改行も可能、なので type='text' とは区別して取り出す。
  const isBalloon = rawType === 'balloon' || rawType === '吹き出し' || rawType === 'speech' || rawType === 'fukidashi';
  const type = isRule ? 'rule' : (isBox ? 'box' : (isImg ? 'img' : (isBalloon ? 'balloon' : 'text')));

  // 既定の方向: 罫線なら横(h), テキストなら縦(v)
  const defaultDir = (isRule || isImg) ? 'h' : 'v';
  const dir = l.dir ? (l.dir === 'h' ? 'h' : 'v') : defaultDir;

  const x = toPt(l.x ?? 0, pageW);
  const y = toPt(l.y ?? 0, pageH);

  // 寸法解決
  let w = 0, h = 0;
  if (isRule) {
    const len = toPt(l.length ?? l.len ?? (dir === 'h' ? (l.w ?? 200) : (l.h ?? 200)), pageW);
    const th = toPt(l.thickness ?? l.borderWidth ?? l.weight ?? l.size ?? 1, pageW) || 1;
    if (dir === 'h') {
      w = len;
      h = th;
    } else {
      w = th;
      h = len;
    }
  } else {
    w = toPt(l.w ?? (isBox || isImg ? 100 : 200), pageW);
    h = toPt(l.h ?? (isBox || isImg ? 100 : 600), pageH);
  }

  const size = toPt(l.size ?? 16, pageW) || 16;
  const thickness = toPt(l.thickness ?? l.borderWidth ?? l.size ?? 1, pageW) || 1;

  const bounds = { right: x + w - pageW, bottom: y + h - pageH };
  const oob = (bounds.right > 0.01 || bounds.bottom > 0.01)
    ? { right: Math.round(bounds.right), bottom: Math.round(bounds.bottom) } : null;

  // 字詰めオプションの解決（kerning > palt）
  const kerning = l.kerning ?? (l.palt !== undefined ? (l.palt ? 'palt' : 'beta') : null);

  // 長体・平体スケール
  const scale = resolveScaling(l);

  return {
    id, dir, type,
    x: +x.toFixed(2), y: +y.toFixed(2), w: +w.toFixed(2), h: +h.toFixed(2), size: +size.toFixed(2),
    thickness: +thickness.toFixed(2),
    parent: l.parent ?? null,
    inset: normalizeInset(l.inset, pageW, pageH),
    src: l.src ?? l.url ?? l.path ?? null,
    alt: l.alt ?? l.id ?? '',
    fit: ['cover', 'contain', 'fill', 'scale-down', 'none'].includes(l.fit) ? l.fit : 'cover',
    position: l.position ?? l.objectPosition ?? 'center', // cover時のクロップ位置
    filter: l.filter ?? null,       // grayscale(100%), sepia(50%) etc.
    opacity: l.opacity ?? null,
    shadow: l.shadow ?? null,
    style: l.style ?? 'solid',
    frame: l.frame ?? l.style ?? null,
    cap: l.cap ?? null,
    text: l.text ?? '',
    color: l.color ?? '#111111',
    bg: l.bg ?? 'transparent',
    align: normalizeAlign(l.align),
    valign: normalizeAlign(l.valign),
    z: l.z ?? 0,
    rotate: +(l.rotate ?? 0),
    scale,
    border: l.border ?? null,
    borderColor: l.borderColor ?? l.color ?? null,
    borderWidth: l.borderWidth != null ? toPt(l.borderWidth, pageW) : (l.thickness != null ? toPt(l.thickness, pageW) : null),
    radius: l.radius === 'inherit' || l.radius === 'parent' ? null : (l.radius ?? null),
    radiusMode: l.radius === 'inherit' || l.radius === 'parent' ? 'inherit' : null,
    padding: l.padding ?? null,
    // @why: [2026-08-30] balloon MVP拡張。shape は layerStyle 側で border-radius に接続され、MVP は
    //       "round"（デフォルト・角丸 8mm）と "square-bracket"（角丸 0）の 2 値だけ。
    //       将来 cloud/shout/thought/whisper/narration を加える今は「未指定 = round」を弾くため、
    //       normalize 段階で許容値のみに補正しておく（層を出た後に 例外や強み型を入れないため）。
    shape: isBalloon ? (['round', 'square-bracket'].includes(l.shape) ? l.shape : 'round') : null,
    font: resolveFont(l.font),
    weight: l.weight ?? null,
    lineH: l.lineH ?? null,
    letterSpacing: l.letterSpacing ?? l.tracking ?? null,
    indent: l.indent ?? null,
    kerning,
    autospace: !!l.autospace,       // true=和欧文四分アキ自動挿入
    autoTcy: !!l.autoTcy,           // true=1〜2桁数字の自動縦中横
    liga: !!l.liga,                 // true=OpenType合字有効化
    smallCaps: !!l.smallCaps,       // true=スモールキャップス
    allowOverlap: !!l.allowOverlap, // true=意図的な重なり（衝突警告抑止）
    hide: !!l.hide,                 // true=非表示レイヤー（検知対象外）
    inline: l.inline !== false,     // 既定でルビ・傍点・縦中横・割注を有効化
    wrap: !!l.wrap,
    oob,
  };
}

// —— HTML 生成（単一ファイル・外部依存なし） ——
/** pt → CSS px。 96 dpi。 Math.round で整数化。 */
const px = (pt) => Math.round(pt * 96 / 72); // pt → px

/** 1レイヤー を type (text / rule / box / img) ごとの CSS inline 属性に変換。 返り値は ';'で終わる 1 文字列。 */
function layerStyle(l) {
  const isV = l.dir === 'v';
  const styles = [
    `left:${px(l.x)}px`,
    `top:${px(l.y)}px`,
    `width:${px(l.w)}px`,
    `height:${px(l.h)}px`,
    `z-index:${l.z}`,
  ];

  // 罫線レイヤー
  if (l.type === 'rule') {
    styles.push(renderRuleStyle(l, px));
    if (l.rotate) styles.push(`transform:rotate(${l.rotate}deg)`);
    return styles.join(';') + ';';
  }

  // 枠ボックスレイヤー
  if (l.type === 'box') {
    styles.push(`background:${l.bg}`);
    if (l.radius) styles.push(`border-radius:${l.radius}`);
    if (l.padding) styles.push(`padding:${l.padding}`);
    if (l.shadow) styles.push(`box-shadow:${l.shadow}`);
    styles.push(renderFrameStyle(l, px));
    if (l.rotate) styles.push(`transform:rotate(${l.rotate}deg)`);
    return styles.join(';') + ';';
  }

  // 吹き出しレイヤー（balloon MVP: 2026-08-30 追加）
  // @why: [2026-08-30] box と「背景付き枠」としては同類だが、咜の中に「台詞テキスト」を置くので、
  //       font-size/color/writing-mode などのテキスト属性も一緒に乗せる必要がある。
  //       shape=round は 8mm 角丸（mx な漫画の「まる」）、square-bracket は 角丸なし。
  //       雲形/shout/thought/whisper は次フェーズで加える。今は CSS の border-radius と border だけで済む 2 つだけ実装。
  //       下に続く text 兼用ブロックをくぐらせるため、ここでは return せずスタイルを積むだけにする。
  let balloonBackground = null;
  if (l.type === 'balloon') {
    balloonBackground = l.bg || '#fff';
    styles.push(`background:${balloonBackground}`);
    if (l.padding) styles.push(`padding:${l.padding}`);
    else styles.push('padding:5mm'); // @why: balloon はきらにパディングを入れないし、デフォルトを仕上げる
    if (l.shadow) styles.push(`box-shadow:${l.shadow}`);
    // shape → border-radius。二次的な既存 radius 指定はそちらを優先（後方互換）。
    if (l.radius) styles.push(`border-radius:${l.radius}`);
    else if (l.shape === 'square-bracket') styles.push('border-radius:0');
    else styles.push('border-radius:8mm');
    if (!l.border) styles.push('border:1.5pt solid #111'); // @why: 漫画の吹き出しはデフォルトで黒 1.5pt
    else styles.push(`border:${l.border}`);
    if (l.hide) styles.push('visibility:hidden');
    if (l.rotate) styles.push(`transform:rotate(${l.rotate}deg)`);
  }

  // 画像レイヤー
  if (l.type === 'img') {
    styles.push(`background:${l.bg || '#eee'}`);
    if (l.hide) styles.push('visibility:hidden');
    if (l.radius) styles.push(`border-radius:${l.radius}`, 'overflow:hidden');
    if (l.border) styles.push(`border:${l.border}`);
    if (l.shadow) styles.push(`box-shadow:${l.shadow}`);
    if (l.opacity !== null) styles.push(`opacity:${l.opacity}`);
    if (l.rotate) styles.push(`transform:rotate(${l.rotate}deg)`);
    return styles.join(';') + ';';
  }

  // テキストレイヤー
  styles.push(
    `font-size:${px(l.size)}px`,
    `color:${l.color}`,
    `background:${balloonBackground != null ? 'transparent' : l.bg}`
  );
  if (l.hide) styles.push('visibility:hidden');
  if (isV) styles.push('writing-mode:vertical-rl', 'text-orientation:mixed');
  if (l.font) styles.push(`font-family:${l.font}`);
  if (l.weight) styles.push(`font-weight:${l.weight}`);
  if (l.lineH) styles.push(`line-height:${l.lineH}`);
  if (l.border) styles.push(`border:${l.border}`);
  if (l.radius) styles.push(`border-radius:${l.radius}`);
  if (l.padding) styles.push(`padding:${l.padding}`);
  if (l.shadow) styles.push(`text-shadow:${l.shadow}`);
  if (l.indent) styles.push(`text-indent:${typeof l.indent === 'number' ? px(l.indent) + 'px' : l.indent}`);
  if (l.liga) styles.push('font-variant-ligatures:common-ligatures discretionary-ligatures');
  if (l.smallCaps) styles.push('font-variant-caps:small-caps');

  // 変形（回転・長体・平体）
  const transforms = [];
  if (l.rotate) transforms.push(`rotate(${l.rotate}deg)`);
  if (l.scale) transforms.push(`scale(${l.scale.sx}, ${l.scale.sy})`);
  if (transforms.length) {
    styles.push(`transform:${transforms.join(' ')}`);
    styles.push(`transform-origin:${isV ? 'top right' : 'top left'}`);
  }

  // 字詰め（Kerning & OpenType 特性）
  const kern = resolveKerning(l.kerning, isV);
  if (kern) {
    if (kern.features && kern.features.length) {
      styles.push(`font-feature-settings:${kern.features.join(',')}`);
    }
    if (kern.letterSpacing) {
      styles.push(`letter-spacing:${kern.letterSpacing}`);
    }
  }

  // 手動 letterSpacing / tracking
  if (l.letterSpacing) {
    const lsVal = typeof l.letterSpacing === 'number'
      ? `${px(toPt(l.letterSpacing))}px`
      : (l.letterSpacing.endsWith('em') || l.letterSpacing.endsWith('%') ? l.letterSpacing : `${px(toPt(l.letterSpacing))}px`);
    styles.push(`letter-spacing:${lsVal}`);
  }

  // 均等割り付け (justify / 等幅配分)
  if (l.align === 'justify') {
    styles.push(
      'text-align:justify',
      'text-align-last:justify',
      'text-justify:inter-character',
      'display:block'
    );
  } else if (l.align === 'center' || l.valign === 'center' || l.align === 'end' || l.valign === 'end') {
    // flex 配置による上下左右揃え（朱印の中央揃え、帯の配置）
    styles.push('display:flex');
    if (!isV) {
      const jc = l.align === 'center' ? 'center' : l.align === 'end' ? 'flex-end' : 'flex-start';
      const ai = l.valign === 'center' ? 'center' : l.valign === 'end' ? 'flex-end' : 'flex-start';
      styles.push(`justify-content:${jc}`, `align-items:${ai}`, `text-align:${l.align === 'center' ? 'center' : l.align === 'end' ? 'right' : 'left'}`);
    } else {
      const jc = l.valign === 'center' ? 'center' : l.valign === 'end' ? 'flex-end' : 'flex-start';
      const ai = l.align === 'center' ? 'center' : l.align === 'end' ? 'flex-end' : 'flex-start';
      styles.push(`justify-content:${jc}`, `align-items:${ai}`, `text-align:${l.align === 'center' ? 'center' : l.align === 'end' ? 'right' : 'left'}`);
    }
  } else if (l.align && l.align !== 'start') {
    styles.push(`text-align:${l.align === 'end' ? (isV ? 'right' : 'right') : 'left'}`);
  }

  // 折り返し: wrap 指定がない限り nowrap で勝手な列落ち（"る"落ち）を防ぐ（justify 時を除く）
  if (!l.wrap && l.align !== 'justify') {
    styles.push('white-space:nowrap');
  }

  return styles.join(';') + ';';
}

/** 1レイヤーを <div class="ly v text">...<span class="lbl">id</span>...</div> の HTML に変換。 label は .page:hover で表示。 */
function renderLayerDiv(l) {
  const s = layerStyle(l);
  const cls2 = `ly ${l.dir === 'v' ? 'v' : 'h'} ${l.type}${l.oob ? ' oob' : ''}${l.__colliding ? ' colliding' : ''}`;
  let body = '';
  if (l.type === 'rule') {
    body = renderCapDecorations(l, px);
  } else if (l.type === 'box') {
    body = '';
  } else if (l.type === 'balloon') {
    // @why: [2026-08-30] balloon は「白背景 + 領域付きのテキスト」と見れるので、
    //       text と同じ inlineTypography() パスを通す（ルビ・傍点・縦中横を有効化）。
    //       inline フラグを false にしていたら escapeHtml にフォールバック（他タイプと一貫）。
    body = l.inline ? inlineTypography(l.text, { autospace: l.autospace, autoTcy: l.autoTcy }) : escapeHtml(l.text || '');
  } else if (l.type === 'img') {
    const filterStyle = l.filter ? `filter:${l.filter};` : '';
    const imgTag = l.src
      ? `<img src="${escapeHtml(l.src)}" alt="${escapeHtml(l.alt || l.id)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:${l.fit};object-position:${escapeHtml(l.position)};${filterStyle}" onerror="this.parentElement.classList.add('img-fallback')"/>`
      : '';
    const fallbackTag = `<div class="img-placeholder" style="font-size:10px;color:#888;background:#eee;border:1px dashed #bbb;">🖼 ${escapeHtml(l.id)}</div>`;
    body = `${imgTag}${fallbackTag}`;
    if (!l.src) {
      // srcなしは onerror を待たず、最初からプレースホルダを表示。
      return `<div class="${cls2} img-fallback" style="${s}" data-id="${escapeHtml(l.id)}"><span class="lbl">${escapeHtml(l.id)} · img</span>${body}</div>`;
    }
  } else {
    body = l.inline ? inlineTypography(l.text, { autospace: l.autospace, autoTcy: l.autoTcy }) : escapeHtml(l.text);
  }
  return `<div class="${cls2}" style="${s}" data-id="${escapeHtml(l.id)}"><span class="lbl">${escapeHtml(l.id)} · ${l.type} · ${l.dir === 'v' ? '縦' : '横'}${l.rotate ? ' ⇄' + l.rotate : ''}${l.__colliding ? ' ⚡衝突' : ''}</span>${body}</div>`;
}

/**
 * レイヤー配列を HTML 文字列にシリアライズする（headless・Chrome/Puppeteer 用）。
 *  入力: layout（buildLayout の返り値・単一／複数どちらも受付), {  title='layout' }。
 *  出力: 完全な HTML 1 ファイル分文字列（<!doctype html>…</body></html>）。CSS はインライン。
 *  不変条件: 副作用なし — DOM を生成せず文字列として返す。ランダム未使用。
 *          複数ページは .page 要素を複数含む（HTML に印刷対応あり）。 label は .page:hover で表示。
 *          yui で検証できる（ロジカルグラフ・sto-stack・遮蔽・a11y の黴検出）。
 * ぞき口: HANDOFF §1 ／ README §5 ／ map of meaning — core.js
 */
// @why: [2026-08-26] 強制インライン CSS・他 JS 依存ゼロで 1 ファイル HTML を生成し、
//       　Chrome headless 変換 / 手元ブラウザ表示 / E2E 検証 / AI レンダリングのすべてに使える。
//       　「文字列」として返すため Node test · Puppeteer ・puppeteer より上も動く。
/** ページ全体をHTMLで出す。単一または複数ページ対応。 */
export function renderHTML(layout, { title = 'layout', pageSize = null } = {}) {
  const pages = layout.isMultiPage ? layout.pages : [layout];
  
  const style = `
    html,body{margin:0;padding:0;background:#2b2926;font-family:"Hiragino Mincho ProN","Yu Mincho","YuMincho","Noto Serif JP",serif;}
    .page{position:relative;margin:20px auto;background:#fff;box-shadow:0 4px 20px rgba(0,0,0,.5);overflow:hidden;line-break:strict;word-break:keep-all;overflow-wrap:break-word;font-kerning:normal;text-spacing-trim:space-first;hanging-punctuation:first last force-end allow-end;}
    .ly{position:absolute;box-sizing:border-box;line-height:1.6;z-index:1;color:#111;}
    .ly.v{writing-mode:vertical-rl;text-orientation:mixed;}
    /* balloon MVP (2026-08-30)。黒枠・白背景・内側 padding は layerStyle が出すのでここでは box-sizing だけ。 */
    .ly.balloon{box-sizing:border-box;background:#fff;}
    .ly.oob{outline:2px dashed #d33;}
    .ly.colliding{outline:2px dashed #e67e22 !important;}
    .page:hover .ly{outline:1px dashed rgba(180,100,20,.3);}
    .lbl{position:absolute;top:0;left:0;font:9px ui-monospace,sans-serif;color:#a55;background:rgba(255,255,255,.85);padding:1px 3px;display:none;pointer-events:none;z-index:99;}
    .page:hover .lbl{display:block;}
    
    /* 画像フォールバック */
    .img-placeholder{position:absolute;inset:0;display:none;width:100%;height:100%;align-items:center;justify-content:center;box-sizing:border-box;}
    .img-fallback .img-placeholder{display:flex;}
    .img-fallback img{display:none;}
    
    /* 傍点（圏点）多種 */
    .bouten{font-style:normal;}
    .bouten-sesame{-webkit-text-emphasis:filled sesame;text-emphasis:filled sesame;}
    .bouten-open-sesame{-webkit-text-emphasis:open sesame;text-emphasis:open sesame;}
    .bouten-circle{-webkit-text-emphasis:filled circle;text-emphasis:filled circle;}
    .bouten-open-circle{-webkit-text-emphasis:open circle;text-emphasis:open circle;}
    .bouten-triangle{-webkit-text-emphasis:filled triangle;text-emphasis:filled triangle;}
    .bouten-double-circle{-webkit-text-emphasis:filled double-circle;text-emphasis:filled double-circle;}
    
    /* 縦中横 */
    .tcy{-webkit-text-combine:horizontal;text-combine-upright:all;}
    
    /* ルビ */
    ruby{ruby-position:over;ruby-align:center;line-height:1;}
    ruby rt{font-size:0.5em;font-weight:normal;letter-spacing:0;line-height:1;color:inherit;}
    
    /* 割注 (Warichu) */
    .warichu{display:inline-flex;align-items:center;font-size:0.55em;line-height:1.15;vertical-align:middle;}
    .ly.v .warichu{display:inline-flex;flex-direction:column;align-items:center;font-size:0.55em;line-height:1.15;vertical-align:middle;}
    .w-lines{display:inline-flex;flex-direction:column;}
    .ly.v .w-lines{display:inline-flex;flex-direction:row-reverse;}
    .w-l{white-space:nowrap;text-align:start;}
    .w-paren{font-size:1.3em;line-height:1;opacity:0.65;}
    
    /* 初字拡大 (Drop Cap) */
    .drop-cap{font-size:2.2em;line-height:0.9;font-weight:bold;color:#b83824;float:left;margin-right:0.15em;}
    .ly.v .drop-cap{float:none;display:inline-block;font-size:2.2em;line-height:0.9;margin-bottom:0.1em;}
    
    /* 四分アキ (0.25em) */
    .q-sp{display:inline-block;width:0.25em;height:1em;}
    .ly.v .q-sp{width:1em;height:0.25em;}
    
    /* 罫線端部飾り */
    .cap-start-h{position:absolute;left:-6px;top:50%;transform:translateY(-50%);font-size:8px;line-height:1;}
    .cap-end-h{position:absolute;right:-6px;top:50%;transform:translateY(-50%);font-size:8px;line-height:1;}
    .cap-start-v{position:absolute;top:-6px;left:50%;transform:translateX(-50%);font-size:8px;line-height:1;}
    .cap-end-v{position:absolute;bottom:-6px;left:50%;transform:translateX(-50%);font-size:8px;line-height:1;}
    
    @media print{
      body{background:none;}
      .page{margin:0 auto;box-shadow:none;page-break-after:always;}
      .page:last-child{page-break-after:auto;}
      .page:hover .ly{outline:none;}
      .lbl{display:none !important;}
    }${pageSize ? `\n@page { size: ${pageSize}; margin: 0; }` : ''}`;

  const pagesHtml = pages.map((p) => {
    const pStyle = `width:${px(p.w)}px;height:${px(p.h)}px;background:${p.bg};`;
    const divs = p.layers.map((l) => renderLayerDiv(l)).join('\n');
    return `<div class="page" style="${pStyle}" data-page="${p.pageNum || 1}">${divs}</div>`;
  }).join('\n');

  return `<!doctype html><html lang="ja"><head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="data:,">
<meta name="viewport" content="width=1, initial-scale=1">
<style>${style}</style></head>
<body>${pagesHtml}</body></html>`;
}