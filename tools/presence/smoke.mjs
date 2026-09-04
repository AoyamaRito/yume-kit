// presence smoke test — @why 欠落を検出できるか（git 不要・diffText 直接渡し）
// @why: [2026-09-06] ベンチ環境（非 git・コンテナ）で presence が動くことの保証
// @tags: SPEC, e2e, presence
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { checkWhyPresence } from './presence.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// diffText を直接渡す（git に依存しない）
// コード変更があるのに @why がない → 違反
const noWhyDiff = `diff --git a/a.mjs b/a.mjs
index 0000000..1111111 100644
--- a/a.mjs
+++ b/a.mjs
@@ -0,0 +1,2 @@
+export const x = 1;
+console.log(x);
`;

const r1 = checkWhyPresence({ diffText: noWhyDiff, cwd: HERE });
assert.strictEqual(r1.pass, false, 'コード変更で @why 欠落は FAIL のはず');
assert.ok(r1.violations.length >= 1, '違反が列挙されるべき');
assert.ok(r1.violations[0].file.endsWith('a.mjs'), 'ファイル名が正しいべき');

// @why 付き → PASS
const withWhyDiff = `diff --git a/a.mjs b/a.mjs
index 0000000..1111111 100644
--- a/a.mjs
+++ b/a.mjs
@@ -0,0 +1,3 @@
+// @why: テスト用
+export const x = 1;
+console.log(x);
`;

const r2 = checkWhyPresence({ diffText: withWhyDiff, cwd: HERE });
assert.strictEqual(r2.pass, true, '@why があれば PASS のはず');

console.log('presence smoke: PASS');