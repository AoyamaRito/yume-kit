// read_prompts smoke test — 目次と詳細読み出しが動くか
// @why: [2026-09-06] ベンチ環境で read_prompts が動くことの保証（依存ゼロ・スモーク）
// @tags: SPEC, e2e, read-prompts
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'read_prompts.mjs');

// 目次（引数なし）
const list = execFileSync(process.execPath, [CLI], { encoding: 'utf8' });
assert.ok(list.includes('00_core') || list.includes('core'), '目次に 00_core があるべき');
assert.ok(list.includes('04_complex_conditions') || list.includes('complex'), '目次に複雑条件分岐があるべき');

// 詳細（部分一致 core）
const detail = execFileSync(process.execPath, [CLI, 'core'], { encoding: 'utf8' });
assert.ok(/clearify|推論コスト/i.test(detail), 'core の詳細が読めるべき');

// 詳細（04_complex_conditions）
const complex = execFileSync(process.execPath, [CLI, 'complex'], { encoding: 'utf8' });
assert.ok(/条件分岐|擬似コード|YAML/i.test(complex), '複雑条件分岐の詳細が読めるべき');

// 概念サマリ（05_yume_min）
const yumeMin = execFileSync(process.execPath, [CLI, 'yume_min'], { encoding: 'utf8' });
assert.ok(/clearify|expand|wedge/.test(yumeMin), 'yume-min 概念が読めるべき');

// 概念サマリ（06_swmr）
const swmr = execFileSync(process.execPath, [CLI, 'swmr'], { encoding: 'utf8' });
assert.ok(/並列化|要件台帳/.test(swmr), 'swmr 概念が読めるべき');

// 概念サマリ（08_design_system）
const design = execFileSync(process.execPath, [CLI, 'design_system'], { encoding: 'utf8' });
assert.ok(/単機能|企画意図/.test(design), 'design-system 概念が読めるべき');

// 概念サマリ（09_log_clean）
const logClean = execFileSync(process.execPath, [CLI, 'log_clean'], { encoding: 'utf8' });
assert.ok(/清書|意味.*変え/.test(logClean), 'log-clean 概念が読めるべき');

console.log('read_prompts smoke: PASS');