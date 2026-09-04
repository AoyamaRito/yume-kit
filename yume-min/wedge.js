/**
 * yume-min/wedge.js
 *
 * 楔(wedge)エンジン — 緑ゲート履歴管理（yume-lite から移植）。
 * // @why: [2026-08-27] yume-lite 退格（grok 並列用の可搬キット扱いだったが正本を yume-min に一元化）に伴い、唯一「単一作者でも価値のある」装置（緑ゲート履歴管理）だけを移植した。yume-lite の版は worktrees/yume-lite-retired-2026-08-27/ に履歴ごと退避済み。
 * // @tags: SPEC
 *
 * 思想（spec → たくさんの code 編集 → spec のリズム）:
 *   spec を「楔」とし、楔と楔の間に積み上がった code 編集の山(thrash, 最も価値の低い版)を
 *   1つに畳む(squash)。残る履歴は楔の列＝検証済みチェックポイントの列になる。
 *
 * 楔を打つ絶対条件: 「バグがないこと」。
 *   driveWedge は verified !== true のとき必ず拒否する(抜け道なし)。
 *   この絶対ゲートのおかげで、残る履歴は「全部緑」になり、rollback は必ず動く状態に着地する。
 *
 * core.js を「一読で全体を保持できる」最小に保つため、楔ロジックはここに分離する
 * (constraint-template.js と同じ方針)。core.js の append / 履歴 / refs を一切殺さない。
 *
 * 操作は3つ(ユーザの言葉のまま):
 *   - 打つ  driveWedge   … e2e 緑を確認 → governed な code を squash → spec に楔版を積む
 *   - 抜く  unwedge      … spec から楔を取り除き、版連鎖を張り直す
 *   - マージ mergeVersions … 隣り合う版を後勝ちで1つに畳む
 *
 * 規約:
 *   - 楔は version.meta.wedge にIDを持つ版で表す(検証済みチェックポイント)。
 *   - spec block の versions[] そのものが楔の列(「SPEC は楔」)。
 *   - spec → code の関係は refs の kind 'governs' で表す
 *     (spec.refs = [{ kind: 'governs', target: 'code:foo' }])。
 */

import { makeVersion, hashVersion } from './core.js';

export const WEDGE_REFUSED = 'WEDGE REFUSED: e2e not green. 楔はバグがないこと必須。';

// 真の楔だけを列挙する。
//
// 注意: core.js の applyPatch/commit は meta を継承する({...head.meta})。
// つまり楔の直後に普通の編集をすると、その版も meta.wedge を引き継いでしまう。
// 楔IDは打つたびに単調に新しくなる(wedge-001, wedge-002...)ので、
// 「各楔IDが最初に現れた版」だけを真の楔とみなせば、継承コピーを誤検出しない。
export function wedgeVersions(block) {
  const seen = new Set();
  const out = [];
  block.versions.forEach((v, i) => {
    const w = v.meta?.wedge;
    if (w && !seen.has(w)) {
      seen.add(w);
      out.push({ index: i, wedge: w, foldedFrom: v.meta?.foldedFrom || 0 });
    }
  });
  return out;
}

// 最後に「新しい楔を導入した」版の index(継承コピーは無視)。
function lastWedgeIndex(block) {
  const ws = wedgeVersions(block);
  return ws.length ? ws[ws.length - 1].index : -1;
}

// splice 後に prevHash / hash の連鎖を張り直す。
// (履歴の修復系操作。hashVersion は内部で .hash を除いて計算するのでそのまま渡せる)
function rechain(versions, from = 0) {
  for (let i = Math.max(0, from); i < versions.length; i++) {
    versions[i].prevHash = i > 0 ? versions[i - 1].hash : null;
    versions[i].hash = hashVersion(versions[i]);
  }
}

/**
 * 前の楔以降の版(thrash)を1つに畳む。HEAD の内容は保持する。
 * 落とした生版は dropped で返す(CLI 側で *.archive へ逃がせる)。
 */
export function squashToWedge(block, wedgeId) {
  const head = block.head();
  if (!head) return { folded: 0, dropped: [] };
  const anchor = lastWedgeIndex(block);
  const segment = block.versions.slice(anchor + 1); // 前の楔より後ろ全部(head を含む)
  if (segment.length === 0) {
    // 前回の楔以降、新しい編集がない → 畳むものなし
    return { folded: 0, dropped: [] };
  }
  const dropped = block.versions.splice(anchor + 1); // thrash を除去
  const prev = block.head(); // = anchor 版 or null(初回の楔)
  const v = makeVersion({
    content: head.content,
    refs: head.refs,
    children: head.children,
    tags: head.tags,
    meta: { ...head.meta, wedge: wedgeId, foldedFrom: segment.length },
  }, prev);
  block.versions.push(v);
  return { folded: segment.length, dropped, head: v };
}

/**
 * 楔を打つ(drive)。
 * 絶対条件: verified === true(= e2e 緑)。さもなくば必ず拒否する。
 */
export function driveWedge(graph, { specId, verified, note = null, specContent = null, certifies = null }) {
  if (verified !== true) {
    const err = new Error(WEDGE_REFUSED);
    err.code = 'WEDGE_REFUSED';
    throw err;
  }
  const spec = graph.get(specId);
  if (!spec) throw new Error(`driveWedge: spec block not found: ${specId}`);

  // 証明対象の code block: 明示 certifies を優先、なければ spec の governs refs から。
  let codeIds = certifies;
  if (!codeIds) {
    codeIds = (spec.refs || []).filter(r => r.kind === 'governs').map(r => r.target);
  }

  const wedgeId = `wedge-${String(wedgeVersions(spec).length + 1).padStart(3, '0')}`;

  // code を楔境界まで squash する。
  const squashed = [];
  for (const id of codeIds) {
    const code = graph.get(id);
    if (!code) { squashed.push({ id, missing: true }); continue; }
    const r = squashToWedge(code, wedgeId);
    squashed.push({ id, folded: r.folded, dropped: r.dropped });
  }

  // certifies のハッシュを採る(squash 後の head)。
  const certified = codeIds.map(id => {
    const code = graph.get(id);
    const h = code?.head();
    return { id, hash: h?.hash || null, version: code ? code.versions.length - 1 : null };
  });

  // spec に楔版を積む(spec の versions[] がそのまま楔の列)。
  const specHead = spec.head();
  spec.commit({
    content: specContent ?? specHead?.content ?? null,
    refs: specHead?.refs ?? [],
    children: specHead?.children ?? [],
    tags: specHead?.tags ?? [],
    meta: {
      ...(specHead?.meta ?? {}),
      wedge: wedgeId,
      e2e: 'green',
      certifies: certified,
      ...(note ? { note } : {}),
    },
  });

  return {
    wedgeId,
    specId,
    specVersion: spec.versions.length - 1,
    certifies: certified,
    squashed,
  };
}

/**
 * 隣り合う版を1つに畳む(merge)。範囲 [fromIdx, toIdx] を後勝ち(toIdx の内容)で1版に。
 * 負index対応。「楔を抜く → 2つの編集を1つにマージ」の後半。
 */
export function mergeVersions(block, fromIdx, toIdx, { note = null } = {}) {
  const n = block.versions.length;
  const a = fromIdx < 0 ? n + fromIdx : fromIdx;
  const b = toIdx < 0 ? n + toIdx : toIdx;
  if (a < 0 || b >= n || a > b) {
    throw new Error(`mergeVersions: bad range [${fromIdx}, ${toIdx}] for length ${n}`);
  }
  if (a === b) return { merged: 0, into: 1, dropped: [] };
  const dropped = block.versions.slice(a, b); // a..b-1 を消す(b は後勝ちで残す)
  block.versions.splice(a, b - a);            // 残った b は index a へ繰り上がる
  block.versions[a].meta = {
    ...(block.versions[a].meta || {}),
    mergedFrom: dropped.length + 1,
    ...(note ? { mergeNote: note } : {}),
  };
  rechain(block.versions, a);
  return { merged: dropped.length + 1, into: 1, dropped };
}

/**
 * 楔を抜く(pull)。spec から楔版を取り除き、版連鎖を張り直す。
 * wedgeRef は楔ID('wedge-002')または version index(数値、負index可)。
 */
export function unwedge(graph, { specId, wedgeRef }) {
  const spec = graph.get(specId);
  if (!spec) throw new Error(`unwedge: spec block not found: ${specId}`);
  let idx = -1;
  if (typeof wedgeRef === 'number') {
    idx = wedgeRef < 0 ? spec.versions.length + wedgeRef : wedgeRef;
  } else {
    idx = spec.versions.findIndex(v => v.meta?.wedge === wedgeRef);
  }
  if (idx < 0 || idx >= spec.versions.length) {
    throw new Error(`unwedge: wedge not found: ${wedgeRef}`);
  }
  const removed = spec.versions[idx];
  if (!removed.meta?.wedge) throw new Error(`unwedge: version ${idx} is not a wedge`);
  spec.versions.splice(idx, 1);
  rechain(spec.versions, idx);
  return { specId, removedWedge: removed.meta.wedge, removedIndex: idx };
}
