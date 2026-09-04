import assert from "node:assert/strict";
import path from "node:path";

// @why: function-testerの「無知」と単一テストファイルWriter境界は運用文だけでなく、子piプロセス側のguardでも壊れないことを固定する。
// @tags: SPEC
const cwd = process.cwd();
const source = path.resolve(cwd, "fixture-source.js");
const testFile = path.resolve(cwd, "fixture.test.js");

process.env.YUME_FUNCTION_TESTER_TEST_FILE = testFile;
process.env.YUME_FUNCTION_TESTER_ALLOWED_FILES = JSON.stringify([source, testFile]);

let handler;
const pi = { on(event, fn) { assert.equal(event, "tool_call"); handler = fn; } };
const { default: installGuard } = await import(`../extensions/function-tester-guard.mjs?test=${Date.now()}`);
installGuard(pi);
assert.equal(typeof handler, "function");

const check = (toolName, input) => handler({ toolName, input });
assert.equal(check("read", { path: source }), undefined, "allowed source read passes");
assert.equal(check("read", { path: testFile }), undefined, "allowed test read passes");
assert.equal(check("read", { path: path.resolve(cwd, "README.md") })?.block, true, "unlisted read is blocked");
assert.equal(check("write", { path: testFile }), undefined, "test file write passes");
assert.equal(check("edit", { file_path: testFile }), undefined, "test file edit passes");
assert.equal(check("write", { path: source })?.block, true, "source write is blocked");
assert.equal(check("edit", { file_path: path.resolve(cwd, "other.test.js") })?.block, true, "other test edit is blocked");

console.log("function-tester-guard: 7 pass, 0 fail");
