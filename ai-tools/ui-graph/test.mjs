// @why: ui-graph の snowball E2E テスト。good-ui (正常系) と bad-ui (異常系: はみ出し/遮蔽/極小タップ/ゼロサイズ/横スクロール/data-yui-ignore) を走査し全件検証する
// @tags: SPEC

import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { runUIGraph } from './ui-graph.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOOD_UI = path.join(HERE, 'fixtures/good-ui.html');
const BAD_UI = path.join(HERE, 'fixtures/bad-ui.html');

async function runTests() {
  console.log('🧪 === ui-graph E2E Test Start ===\n');

  // Test 1: Good UI Verification
  console.log('▶ [Test 1] good-ui.html should pass with zero errors');
  const goodRes = await runUIGraph(GOOD_UI);
  console.log(`  - Total nodes: ${goodRes.summary.totalNodes}`);
  console.log(`  - Total edges: ${goodRes.summary.totalEdges}`);
  console.log(`  - Interactive count: ${goodRes.summary.interactiveCount}`);
  console.log(`  - Error count: ${goodRes.summary.errorCount}`);
  assert.strictEqual(goodRes.summary.pass, true, 'good-ui must pass with 0 errors');
  assert.strictEqual(goodRes.summary.errorCount, 0, 'good-ui errorCount must be 0');
  console.log('  ✅ Test 1 Passed!\n');

  // Test 2: Bad UI Verification & Anomaly Detection
  console.log('▶ [Test 2] bad-ui.html should catch all targeted anomalies');
  const badRes = await runUIGraph(BAD_UI);
  console.log(`  - Total anomalies detected: ${badRes.anomalies.length}`);
  console.log(`  - Error count: ${badRes.summary.errorCount}`);
  console.log(`  - Warn count: ${badRes.summary.warnCount}`);
  assert.strictEqual(badRes.summary.pass, false, 'bad-ui must fail due to errors');

  const anomalyCodes = badRes.anomalies.map(a => a.code);
  console.log('  - Detected codes:', anomalyCodes);

  // 1. OVERFLOW_LEAK check
  const overflow = badRes.anomalies.find(a => a.code === 'OVERFLOW_LEAK');
  assert.ok(overflow, 'Must detect OVERFLOW_LEAK');
  assert.ok(overflow.selector.includes('child-wide'), 'Overflow element must be #child-wide');
  console.log(`  ✅ OVERFLOW_LEAK detected correctly: +${overflow.detail.leakPx}px`);

  // 2. INTERACTION_OCCLUDED check
  const occluded = badRes.anomalies.find(a => a.code === 'INTERACTION_OCCLUDED');
  assert.ok(occluded, 'Must detect INTERACTION_OCCLUDED');
  assert.ok(occluded.selector.includes('btn-covered'), 'Occluded element must be #btn-covered');
  assert.ok(occluded.detail.occluderSelector.includes('overlay-blocker'), 'Occluder must be #overlay-blocker');
  console.log('  ✅ INTERACTION_OCCLUDED detected correctly!');

  // 3. TINY_TAP_TARGET check
  const tinyTap = badRes.anomalies.find(a => a.code === 'TINY_TAP_TARGET');
  assert.ok(tinyTap, 'Must detect TINY_TAP_TARGET');
  assert.ok(tinyTap.selector.includes('btn-tiny'), 'Tiny element must be #btn-tiny');
  console.log('  ✅ TINY_TAP_TARGET detected correctly!');

  // 4. ZERO_BOX_WITH_CONTENT check
  const zeroBox = badRes.anomalies.find(a => a.code === 'ZERO_BOX_WITH_CONTENT');
  assert.ok(zeroBox, 'Must detect ZERO_BOX_WITH_CONTENT');
  assert.ok(zeroBox.selector.includes('box-zero'), 'Zero box element must be #box-zero');
  console.log('  ✅ ZERO_BOX_WITH_CONTENT detected correctly!');

  // 5. VIEWPORT_HORIZONTAL_OVERFLOW check (page wide scrollbar)
  const vpOverflow = badRes.anomalies.find(a => a.code === 'VIEWPORT_HORIZONTAL_OVERFLOW');
  assert.ok(vpOverflow, 'Must detect VIEWPORT_HORIZONTAL_OVERFLOW');
  assert.ok(vpOverflow.detail.leakPx > 500, 'Viewport leakPx should be > 500px');
  console.log(`  ✅ VIEWPORT_HORIZONTAL_OVERFLOW detected correctly: +${vpOverflow.detail.leakPx}px`);

  // 6. data-yui-ignore check (intentional overflow should NOT be reported)
  const ignoredLeak = badRes.anomalies.find(a => a.selector && a.selector.includes('child-badge-ignored'));
  assert.strictEqual(ignoredLeak, undefined, 'data-yui-ignore element must NOT trigger OVERFLOW_LEAK');
  console.log('  ✅ data-yui-ignore opt-out verified (ignored intentional overflow)');

  // 7. Check occluded_by edge
  const occludedEdge = badRes.edges.find(e => e.type === 'occluded_by');
  assert.ok(occludedEdge, 'Edge occluded_by must exist in graph');
  console.log('  ✅ occluded_by graph edge verified!');

  console.log('  ✅ Test 2 Passed!\n');

  // Test 3: CLI commands execution check
  console.log('▶ [Test 3] CLI command formatting check');
  const treeOutput = execSync(`node ${path.join(HERE, 'ui-graph.mjs')} tree ${GOOD_UI}`, { encoding: 'utf8' });
  assert.ok(treeOutput.includes('Viewport:'), 'Tree output should contain Viewport header');
  assert.ok(treeOutput.includes('#login-btn'), 'Tree output should contain elements');

  const mermaidOutput = execSync(`node ${path.join(HERE, 'ui-graph.mjs')} mermaid ${GOOD_UI}`, { encoding: 'utf8' });
  assert.ok(mermaidOutput.includes('flowchart TD'), 'Mermaid output should start with flowchart TD');

  console.log('  ✅ Test 3 Passed!\n');

  console.log('🎉 === All ui-graph E2E Tests Passed Successfully! ===');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
