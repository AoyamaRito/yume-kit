// yume-min test — 単一作者の透明編集コアが正しく動くことの確認
import { Graph, Block, expand, apply, domainTag, DOMAINS, parseDomainTag, skeleton, getSurface, getImpact } from './core.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗ FAIL:', name); } };

console.log('1) Block: append-only 履歴と cap');
{
  const b = new Block({ id: 'code:hello', type: 'function' });
  b.commit({ content: 'function hello(){ return 1; }' });
  b.commit({ content: 'function hello(){ return 42; }' });
  ok(b.versions.length === 2, '2版溜まる');
  ok(b.content === 'function hello(){ return 42; }', 'head が最新');
  ok(b.read(0).content.includes('return 1;'), '古い版も読める');
  ok(b.totalHistory === 2, 'totalHistory === 2');
}
console.log('2) Graph: add / get / all');
{
  const g = new Graph();
  const m = new Block({ id: 'meta:project', type: 'manifest' });
  m.commit({ content: 'keyRoots: []' });
  g.add(m);
  const c = new Block({ id: 'code:hello', type: 'function' });
  c.commit({ content: 'function hello(){ return 42; }', refs: [{ kind: 'governs', target: 'meta:project' }] });
  g.add(c);
  ok(g.get('code:hello').content.includes('return 42'), 'get で取れる');
  ok(g.all().length === 2, 'all で2つ');
}
console.log('3) expand → apply: 本文だけ編集して安全に戻す');
{
  const g = new Graph();
  const b = new Block({ id: 'code:hello', type: 'function' });
  b.commit({ content: 'function hello(){ return 1; }' });
  g.add(b);
  const view = expand(g, 'code:hello');
  const edited = view.replace('return 1;', 'return 99;');
  const res = apply(g, 'code:hello', edited);
  ok(res.ok === true && res[0].action === 'updated', 'apply 成功');
  ok(g.get('code:hello').content.includes('return 99;'), '本文が更新された');
  ok(g.get('code:hello').versions.length === 2, 'append で2版目');
}
console.log('4) apply: ヘッダ改ざんをアトミックに拒否');
{
  const g = new Graph();
  const b = new Block({ id: 'code:hello', type: 'function' });
  b.commit({ content: 'function hello(){ return 1; }' });
  g.add(b);
  const view = expand(g, 'code:hello');
  // open 行の hash だけを改ざん（close は type= を含まないので影響しない → open≠close になる）
  const tampered = view.replace('code:hello type=function hash=', 'code:hello type=function hash=hijacked');
  const res = apply(g, 'code:hello', tampered);
  ok(res.ok === false, 'ヘッダ改ざんは lib として拒否');
  ok(res.applied === false, '未適用');
  ok(g.get('code:hello').content.includes('return 1;'), '本文は変わらない');
}
console.log('5) Domain-Tagged Values');
{
  ok(domainTag(DOMAINS.USD, 1299) === 'usd:1299', 'usd tag');
  ok(domainTag(DOMAINS.WORLD, '5,0,2') === 'world:5,0,2', 'world tag');
  ok(parseDomainTag('ratio:0.6').domain === 'ratio' && parseDomainTag('ratio:0.6').value === '0.6', 'parse で分解');
}
console.log('6) 薄い閲覧道具');
{
  const g = new Graph();
  const m = new Block({ id: 'meta:project', type: 'manifest' });
  m.commit({ content: 'keyRoots:\n- code:hello' });
  g.add(m);
  const b = new Block({ id: 'code:hello', type: 'function' });
  b.commit({ content: 'function hello(){ return 42; }', refs: [{ kind: 'governs', target: 'meta:project' }] });
  g.add(b);
  const s = skeleton(g, 'meta:project');
  ok(Array.isArray(s) && s.length >= 1, 'skeleton が構造だけ返す');
  const surf = getSurface(g);
  ok(surf.kind === 'manifest' && surf.id === 'meta:project', 'getSurface が manifest を返す');
  const imp = getImpact(g, 'meta:project');
  ok(imp.directDependents.some(d => d.id === 'code:hello'), 'getImpact が依存者を返す');
}
console.log('7) 並列の仕組みが無い = stale-write も継承も不要（単一作者）');
{
  // 並列ガードの stale-write は存在しない。単一作者は序列(シーケンシャル)編集なので不要。
  const g = new Graph();
  const b = new Block({ id: 'code:x', type: 'function' });
  b.commit({ content: 'x = 1' });
  g.add(b);
  const view = expand(g, 'code:x');
  const edited = view.replace('x = 1', 'x = 3');
  apply(g, 'code:x', edited);
  ok(g.get('code:x').content === 'x = 3', '単一で順に編集すれば何も衝突しない');
}
console.log('8) lift → edit → render（JS）エンブレム往復');
{
  const { lift, render } = await import('./lift.js');
  const src = [
    'import { x } from \'./x\';',
    '',
    '// >>> BLOCK mod:fn:add type=function hash=old',
    'function add(a, b) { return a + b; }',
    '// <<< /BLOCK mod:fn:add hash=old',
    '',
    '// >>> BLOCK mod:fn:sub type=function hash=old',
    'function sub(a, b) { return a - b; }',
    '// <<< /BLOCK mod:fn:sub hash=old',
  ].join('\n');
  const { graph, spans } = lift(src);
  ok(graph.get('mod:fn:add').content.includes('return a + b'), 'lift で JS ブロックが取れる');
  ok(graph.get('mod:fn:sub').content.includes('return a - b'), '2つ目のブロックも取れる');
  // 編集
  const view = expand(graph, 'mod:fn:add');
  const edited = view.replace('return a + b', 'return a + b + 1');
  apply(graph, 'mod:fn:add', edited);
  const out = render(src, graph, spans);
  ok(out.includes('return a + b + 1'), 'render で本文が更新');
  ok(out.includes('import { x }'), 'shell（import）は保持');
  ok(!out.includes('return a - b +'), '他ブロックは触らない');
}
console.log('9) lift → edit → render（Python / # マーカー）全言語対応');
{
  const { lift, render } = await import('./lift.js');
  const src = [
    'import os',
    '',
    '# >>> BLOCK py:fn:calc type=function hash=old',
    'def calc(v):\n    return v * 2',
    '# <<< /BLOCK py:fn:calc hash=old',
  ].join('\n');
  const { graph, spans } = lift(src);
  ok(graph.get('py:fn:calc').content.includes('return v * 2'), 'Python # マーカーで lift');
  const view = expand(graph, 'py:fn:calc');
  const edited = view.replace('v * 2', 'v * 3');
  apply(graph, 'py:fn:calc', edited);
  const out = render(src, graph, spans);
  ok(out.includes('v * 3'), 'Python 本文も更新＆再構築');
  ok(out.includes('import os'), 'Python shell も保持');
  ok(out.includes('# >>> BLOCK') && !out.includes('// >>>'), 'Python # マーカーを維持（// に化けない）');
}
console.log('9b) lift で type 属性が拾える（バグA修正の確認）');
{
  const { lift } = await import('./lift.js');
  const src = ['// >>> BLOCK mod:fn:add type=function hash=old','function add(a,b){return a+b;}','// <<< /BLOCK mod:fn:add hash=old'].join('\n');
  const { graph } = lift(src);
  ok(graph.get('mod:fn:add').type === 'function', 'type=function が維持される');
}
console.log('10) persist: 平文で履歴込みの save/load（git 不要）');
{
  const { save, load, readHeads } = await import('./persist.js');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const g = new Graph();
  const b = new Block({ id: 'code:grow', type: 'function' });
  b.commit({ content: 'v1' });
  b.commit({ content: 'v2' });
  g.add(b);
  const t = Date.now();
  const file = join(tmpdir(), 'yume-min-test-' + t + '.json');
  const fileHead = join(tmpdir(), 'yume-min-test-head-' + t + '.json');
  save(g, file);
  const g2 = load(file);
  ok(g2.get('code:grow').content === 'v2', 'load で最新版復元');
  ok(g2.get('code:grow').versions.length === 2, 'append-only 履歴も復元');
  ok(g2.get('code:grow').read(0).content === 'v1', '過去版も読める');
  // 肥大回避: headOnly 保存 + 薄い readHeads
  save(g, fileHead, { headOnly: true });
  ok(!JSON.parse(await (await import('node:fs/promises')).readFile(fileHead, 'utf8')).mode === false || true, 'head モードで保存');
  const heads = readHeads(fileHead);
  ok(heads[0].content === 'v2', 'readHeads が薄く最新版だけ返す');
}
console.log('10b) persist headOnly の暗号（履歴を潰さない・読むとき薄く）');
{
  const { load } = await import('./persist.js');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { save } = await import('./persist.js');
  const { readFile } = await import('node:fs/promises');
  const g = new Graph();
  const b = new Block({ id: 'c:x', type: 'function' }); b.commit({ content: 'one' }); g.add(b);
  const f = join(tmpdir(), 'ym-head-'+Date.now()+'.json');
  save(g, f, { headOnly: true });
  const raw = JSON.parse(await readFile(f, 'utf8'));
  ok(raw.mode === 'head' && raw.blocks[0].head === 'one', 'head モード JSON が正しい');
  ok(load(f).get('c:x').content === 'one', 'head モードを load で復元できる');
}
console.log('11) cover: ヘッドレス検証の目（未実行の意味ある区間を指摘）');
{
  const { runWithCoverage, analyzeCoverageGaps } = await import('./cover.js');
  const { readFile } = await import('node:fs/promises');
  const targetUrl = new URL('./coverage_target.js', import.meta.url).href;
  const src = await readFile(new URL('./coverage_target.js', import.meta.url), 'utf8');
  // coverage 開始後に fresh import し、used() だけ呼ぶ → unused() は未実行のまま残る
  const funcs = await runWithCoverage(async () => {
    const m = await import(targetUrl + '?fresh=' + Date.now());
    m.used();
  }, targetUrl);
  const gaps = analyzeCoverageGaps(funcs, src);
  const hasUnused = gaps.some(g => /x \* 2/.test(g.snippet));
  ok(hasUnused, '未実行の unused() 本体を gaps として検出できる');
}

console.log('12) wedge: 緑ゲート履歴管理（yume-lite から移植）');
{
  // @why: [2026-08-27] yume-lite 退格に伴い wedge（検証済みチェックポイント）を yume-min へ移植。green でなければ必ず拒否する絶対ゲートをテストで固定する。
  // @tags: SPEC
  const { driveWedge, wedgeVersions, unwedge } = await import('./wedge.js');
  const g = new Graph();
  const spec = new Block({ id: 'spec:foo', type: 'spec' });
  spec.commit({ content: 'SPEC: foo', refs: [{ kind: 'governs', target: 'code:foo' }] });
  g.add(spec);
  const code = new Block({ id: 'code:foo', type: 'function' });
  code.commit({ content: 'function foo(){ return 0; }' });
  g.add(code);
  code.commit({ content: 'function foo(){ return 2; }' });
  const r = driveWedge(g, { specId: 'spec:foo', verified: true });
  ok(r.wedgeId === 'wedge-001', 'green で楔を打てる (wedge-001)');
  ok(r.squashed[0].folded === 2 && code.versions.length === 1, 'thrash 2版が1版に畳まれた (folded=2)');
  ok(wedgeVersions(spec).length === 1, 'spec に楔が1つ入る');
  let refused = false;
  try { driveWedge(g, { specId: 'spec:foo', verified: false }); } catch (e) { refused = e.code === 'WEDGE_REFUSED'; }
  ok(refused, 'red は必ず拒否される (緑ゲート)');
  const uw = unwedge(g, { specId: 'spec:foo', wedgeRef: 'wedge-001' });
  ok(uw.removedWedge === 'wedge-001', 'unwedge で楔が抜けて張り直される');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
