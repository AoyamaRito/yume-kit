/**
 * yume-min — 最小の clearify コア。
 *
 * yume-lite から「けずれるもの」を https://けずった版。
 *
 * 残す本質（単一作者・単一スレッドで透明に読んで編集するためだけのもの）:
 *   - Block ... append-only, 直近32版キャップの履歴
 *   - expand / apply ... 厚編集ビュー（hash境界でヘッダ保護 + アトミック拒否）
 *   - domainTag ... 値にドメインを埋め込む self-describing 規約
 *   - skeleton / getSurface / getImpact ... 薄い閲覧道具（トークン節約）
 *
 * けずったもの（=「必要なかった人」）:
 *   - stale-write 検知（並行編集ガード。単一作者では不要）
 *   - マニフェスト契約キー / v00x / map並列層（複数ワーカーの調整のための仕組み）
 *   - makeThickEdit / applyThickEdit（remote authority 素管）
 *   - lintThickView / heavyApply / readPartial（重複 or 凝った検証）
 *   - 冗長なコメント
 *
 * 1ファイル一気読みで、透明編集の全体像が1パスで入る。
 */

// --- ハッシュ（境界の改ざん検知にだけ使う） ---
export function hash(s) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) o[k] = canon(v[k]); return o; }
  return v;
}
// @why: yume-lite 退格（2026-08-27）に伴い、wedge.js（緑ゲート履歴管理）を yume-min へ移植するために makeVersion / hashVersion を公開する。yume-min は単一作者向けなので hash は改ざん検知用途のみ。
// @tags: SPEC
export function makeVersion({ content = null, refs = [], children = [], tags = [], meta = {} }, prev = null) {
  const v = { timestamp: Date.now(), prevHash: prev ? prev.hash : null, content, refs, children, tags, meta };
  v.hash = hashVersion(v);
  return v;
}

// 一版のハッシュ（makeVersion と同じ計算。wedge の rechain が使う）
export function hashVersion(v) {
  return hash(JSON.stringify(canon(v)));
}

// --- Block（実体 + 履歴） ---
const MAX_HISTORY = 32;
export class Block {
  constructor({ id, type, versions = [], meta = {} }) {
    if (!id) throw new Error('Block requires id');
    if (!type) throw new Error('Block requires type');
    this.id = id; this.type = type; this.versions = versions; this.meta = meta;
  }
  commit({ content = null, refs = [], children = [], tags = [], meta = {} } = {}) {
    const v = makeVersion({ content, refs, children, tags, meta }, this.head());
    this.versions.push(v);
    if (this.versions.length > MAX_HISTORY) {
      this._trimmed = (this._trimmed || 0) + (this.versions.length - MAX_HISTORY);
      this.versions.splice(0, this.versions.length - MAX_HISTORY);
    }
    return v;
  }
  head() { return this.versions[this.versions.length - 1] || null; }
  get content() { return this.head()?.content ?? null; }
  get refs() { return this.head()?.refs ?? []; }
  get tags() { return this.head()?.tags ?? []; }
  get totalHistory() { return (this._trimmed || 0) + this.versions.length; }

  read(index = -1) {
    let i = index; if (i < 0) i = this.versions.length + i;
    const v = this.versions[i]; return v ? { ...v, index: i } : null;
  }
  readContent(index = -1) { const v = this.read(index); return v ? v.content : null; }

  applyPatch(content, opts = {}) {
    const h = this.head();
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    if (h && h.content === content
        && (opts.refs == null || same(opts.refs, h.refs))
        && (opts.tags == null || same(opts.tags, h.tags)))
      return { action: 'unchanged', block: this };
    this.commit({
      content,
      refs: opts.refs ?? h?.refs ?? [],
      children: opts.children ?? h?.children ?? [],
      tags: opts.tags ?? h?.tags ?? [],
      meta: { ...(h?.meta ?? {}), ...(opts.meta ?? {}) },
    });
    return { action: h ? 'updated' : 'created', block: this };
  }

  toJSON() { return { id: this.id, type: this.type, versions: this.versions, meta: this.meta }; }
  static fromJSON(j) { return new Block({ id: j.id, type: j.type, versions: j.versions || [], meta: j.meta || {} }); }
}

// --- Graph ---
export class Graph {
  constructor(blocks = []) { this.blocks = new Map(); for (const b of blocks) this.add(b); }
  add(b) { this.blocks.set(b.id, b instanceof Block ? b : Block.fromJSON(b)); return this; }
  get(id) { return this.blocks.get(id); }
  has(id) { return this.blocks.has(id); }
  all() { return [...this.blocks.values()]; }
}

// --- 厚編集（expand = 読む / apply = 書く） ---
const OPEN_ROOT_RE = /^\s*(?:\/\/|#)\s*>>>\s+ROOT\s+(\S+)(?:\s+(.*))?\s*$/;
const CLOSE_ROOT_RE = /^\s*(?:\/\/|#)\s*<<<\s+\/ROOT\s+(\S+)(?:\s+(.*))?\s*$/;
const OPEN_BLOCK_RE = /^\s*(?:\/\/|#)\s*>>>\s+BLOCK\s+(\S+)(?:\s+(.*))?\s*$/;
const CLOSE_BLOCK_RE = /^\s*(?:\/\/|#)\s*<<<\s+\/BLOCK\s+(\S+)(?:\s+(.*))?\s*$/;
const META_LINE_RE = /^\s*\/\/\s+(tags|refs):/;

function parseAttrs(s) { const o = {}; if (s) for (const m of String(s).matchAll(/(\w+)=(\S+)/g)) o[m[1]] = m[2]; return o; }
function blockHash(b) { return hash(b.id + '\0' + b.type + '\0' + (b.content ?? '')); }

function scopeOf(graph, rootId) {
  const out = [], seen = new Set();
  (function walk(id) {
    if (seen.has(id)) return;
    const b = graph.get(id); if (!b) return;
    seen.add(id); out.push(b);
    for (const r of b.refs) walk(r.target);
  })(rootId);
  return out;
}

export function expand(graph, rootId, opts = {}) {
  const blocks = scopeOf(graph, rootId);
  const rootHash = hash(rootId + '\0' + blocks.map(b => b.id).join('\0'));
  const out = [`// >>> ROOT ${rootId} hash=${rootHash}`];
  for (const b of blocks) {
    const h = blockHash(b);
    out.push(`// >>> BLOCK ${b.id} type=${b.type} hash=${h}`);
    if (b.tags?.length) out.push(`//     tags: ${b.tags.join(', ')}`);
    if (b.refs?.length) out.push(`//     refs: ${b.refs.map(r => `${r.kind}->${r.target}`).join(', ')}`);
    if (b.content) out.push(b.content);
    out.push(`// <<< /BLOCK ${b.id} hash=${h}`);
  }
  out.push(`// <<< /ROOT ${rootId} hash=${rootHash}`);
  return out.join('\n');
}

// apply: 行パーサ + ヘッダ整合チェック。本文だけ編集したビューを安全に append で戻す。
//   - hash境界の改ざん / ID不一致 / root不一致 → アトミックに拒否
//   - （並列ガードの stale-write は「いらない」ので無い）
export function apply(graph, rootId, content, opts = {}) {
  const { lenient = false } = opts;
  const scope = scopeOf(graph, rootId);
  const lines = String(content ?? '').split('\n');
  const warnings = [], parsed = [];
  let cur = null, buf = [], rootOpen = false;

  const flush = st => { if (!cur) return; cur.body = buf.filter(l => !META_LINE_RE.test(l)).join('\n').replace(/^\n+|\n+$/g, ''); cur.status = st; parsed.push(cur); cur = null; buf = []; };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; let m;
    if ((m = line.match(OPEN_ROOT_RE))) { rootOpen = true; if (m[1] !== rootId) warnings.push({ kind: 'root-id-mismatch' }); continue; }
    if ((m = line.match(CLOSE_ROOT_RE))) { if (m[1] !== rootId) warnings.push({ kind: 'root-close-mismatch' }); if (cur) { warnings.push({ kind: 'block-no-close', id: cur.id }); flush('no-close'); } continue; }
    if ((m = line.match(OPEN_BLOCK_RE))) { if (cur) { warnings.push({ kind: 'block-no-close', id: cur.id }); flush('no-close'); } const a = parseAttrs(m[2]); cur = { id: m[1], type: a.type, hashOpen: a.hash }; buf = []; continue; }
    if ((m = line.match(CLOSE_BLOCK_RE))) {
      if (!cur) { warnings.push({ kind: 'stray-close', id: m[1] }); continue; }
      const a = parseAttrs(m[2]); let st = 'ok';
      if (m[1] !== cur.id) { warnings.push({ kind: 'block-id-mismatch' }); st = 'id-mismatch'; }
      else if (cur.hashOpen && a.hash && cur.hashOpen !== a.hash) { warnings.push({ kind: 'block-hash-tamper', id: cur.id }); st = 'header-tamper'; }
      flush(st); continue;
    }
    if (cur) buf.push(line);
  }
  if (cur) { warnings.push({ kind: 'block-no-close', id: cur.id }); flush('no-close'); }

  const seen = new Set();
  for (const p of parsed) { if (seen.has(p.id)) { warnings.push({ kind: 'duplicate-id', id: p.id }); p.status = 'duplicate'; } seen.add(p.id); }
  if (rootOpen) for (const b of scope) if (!parsed.some(p => p.id === b.id)) warnings.push({ kind: 'missing-block', id: b.id });

  const FATAL = new Set(['root-id-mismatch', 'root-close-mismatch', 'block-id-mismatch', 'block-hash-tamper', 'duplicate-id', 'block-no-close']);
  const updates = [];
  if (warnings.some(w => FATAL.has(w.kind)) && !lenient) {
    for (const p of parsed) updates.push({ id: p.id, action: 'rejected-integrity', status: p.status });
    return Object.assign(updates, { ok: false, applied: false, warnings });
  }
  for (const p of parsed) {
    if (p.status !== 'ok') { updates.push({ id: p.id, action: 'skipped', status: p.status }); continue; }
    if (!scope.some(b => b.id === p.id)) { updates.push({ id: p.id, action: 'skipped-out-of-scope' }); continue; }
    const r = scope.find(b => b.id === p.id).applyPatch(p.body);
    updates.push({ id: p.id, ...r });
  }
  return Object.assign(updates, { ok: true, applied: true, warnings });
}

// --- Domain-Tagged Values（値にドメインを埋め込む自己記述） ---
export const DOMAINS = { WORLD: 'world', USD: 'usd', TIME: 'time', COUNT: 'count', RATIO: 'ratio' };
export const domainTag = (d, v) => v == null ? `${d}:` : `${d}:${v}`;
export function parseDomainTag(t) {
  if (typeof t !== 'string') return { domain: null, value: t };
  const i = t.indexOf(':');
  return i < 0 ? { domain: null, value: t } : { domain: t.slice(0, i), value: t.slice(i + 1) };
}

// --- 薄い閲覧道具（トークン節約） ---
export function skeleton(graph, rootId, opts = {}) {
  return scopeOf(graph, rootId).map(b => {
    const h = b.head() || {}; const c = h.content || '';
    const brace = c.match(/\{([\s\S]*?)\}/);
    return { id: b.id, type: b.type, tags: h.tags || [], refs: h.refs || [],
             preview: c.split('{')[0].trim().slice(0, 80),
             bodyLength: brace ? brace[1].length : c.length, versionCount: b.versions.length };
  });
}

export function getSurface(graph) {
  const m = graph.all().find(b => {
    const id = b.id || ''; const tags = (b.tags || b.head?.()?.tags || []); const t = b.type || '';
    return id.startsWith('meta:') || id.startsWith('doc:') || tags.includes('manifest') || t === 'manifest';
  });
  if (m) { const h = m.head ? m.head() : {}; return { kind: 'manifest', id: m.id, content: h.content || null, advice: 'Read this first.' }; }
  return { kind: 'inferred', advice: 'Create a meta:project surface block.', totalBlocks: graph.all().length };
}

export function getImpact(graph, blockId) {
  const deps = [];
  for (const b of graph.all()) { const refs = (b.refs || []).filter(r => r.target === blockId); if (refs.length) deps.push({ id: b.id, type: b.type, via: refs.map(r => r.kind) }); }
  return { target: blockId, dependentCount: deps.length, directDependents: deps };
}
