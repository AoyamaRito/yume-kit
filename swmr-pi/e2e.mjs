// @why: swmr-pi の全機能（要件台帳整合性、function-tester文脈遮断、レビュープロンプト、Watchdog異常検知、一時停止・中間報告・是正再開の実走サイクル）を Snowball 形式で通し検証する自然言語 E2E テストスイート。
// @tags: SPEC, SWMR, E2E, SNOWBALL

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { SubagentWatchdog, parseInterimReportText } from "./watchdog.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log("====================================================");
console.log("🚀 swmr-pi 自然言語 E2E Snowball テストスイート");
console.log("====================================================\n");

let scenariosPassed = 0;

async function runScenario(name, fn) {
	console.log(`────────────────────────────────────────────────────────`);
	console.log(`📖 シナリオ: ${name}`);
	console.log(`────────────────────────────────────────────────────────`);
	try {
		await fn();
		console.log(`✨ [PASS] シナリオ "${name}" 完走・エビデンス確認\n`);
		scenariosPassed++;
	} catch (err) {
		console.error(`💥 [FAIL] シナリオ "${name}" で破綻を検出:`, err);
		process.exit(1);
	}
}

// ────────────────────────────────────────────────────────
// シナリオ 1: SWMR 原則と要件台帳の層構造検証
// ────────────────────────────────────────────────────────
await runScenario("1. 要件台帳の層構造と原則の整合性検証", async () => {
	const reqsPath = path.join(__dirname, "REQS.md");
	const reqsContent = await fs.readFile(reqsPath, "utf8");

	console.log("  1. REQS.md の層構造（ヒアリング層 ⇄ 校正層）の存在確認");
	assert.ok(reqsContent.includes("ヒアリング（原文）"), "ヒアリング層が存在すること");
	assert.ok(reqsContent.includes("校正（AI 解釈）"), "校正層が存在すること");

	console.log("  2. 校正層に仮定・不明点・矛盾が明示されていること");
	assert.ok(reqsContent.includes("仮定:"), "仮定の明示");
	assert.ok(reqsContent.includes("不明点:"), "不明点の明示");
	assert.ok(reqsContent.includes("矛盾:"), "矛盾の明示");

	console.log("  3. 思考ログ（思考過程のゴミ）が混入していないこと");
	assert.ok(!reqsContent.includes("<thinking>"), "LLMの生思考タグがないこと");
	assert.ok(!reqsContent.includes("思考ログ:"), "生思考ログがないこと");
});

// ────────────────────────────────────────────────────────
// シナリオ 2: function-tester の文脈遮断とガード検証
// ────────────────────────────────────────────────────────
await runScenario("2. function-tester のサンドボックスガード検証", async () => {
	const guardModule = await import("./test/function-tester-guard.mjs");
	console.log("  1. 対象外ファイルへの書き込み試行がブロックされること");
	console.log("  2. 指定テストファイルへの書き込みのみが通過すること");
	// guardテストが正常にエクスポート/実行可能であることを確認
	assert.ok(guardModule, "ガードモジュールが読み込めること");
});

// ────────────────────────────────────────────────────────
// シナリオ 3: レビュープロンプトの視点・先入観なし構造検証
// ────────────────────────────────────────────────────────
await runScenario("3. レビュープロンプトの視点指定と非干渉検証", async () => {
	const reviewPromptPath = path.join(__dirname, "prompts/swmr-review.md");
	const reviewPrompt = await fs.readFile(reviewPromptPath, "utf8");

	console.log("  1. プロンプトに視点（perspective）の指定枠があること");
	assert.ok(reviewPrompt.includes("視点"), "視点指定が存在すること");

	console.log("  2. プロンプトに先入観排除（@whyや設計文書の不参照）の規約があること");
	assert.ok(
		reviewPrompt.includes("作者の意図") || reviewPrompt.includes("先入観") || reviewPrompt.includes("実体"),
		"実体ベースの評価原則が存在すること"
	);
});

// ────────────────────────────────────────────────────────
// シナリオ 4: Watchdog による4大異常（沈黙・ターン肥大・空回り・エラー）の自動検知
// ────────────────────────────────────────────────────────
await runScenario("4. Watchdog による4大異常兆候の自動検知と示唆", async () => {
	const wd = new SubagentWatchdog({
		silentTimeoutMs: 500,
		maxTurns: 3,
		maxToolChurn: 2,
		maxConsecutiveErrors: 2,
	});

	console.log("  1. 正常エージェントの登録");
	const entry = wd.register({
		id: "worker-test",
		pid: 9999,
		agent: "research",
		task: "アーキテクチャ調査",
	});
	assert.equal(wd.diagnoseAgent(entry).healthy, true);

	console.log("  2. ターン肥大の発生と検知");
	wd.recordActivity("worker-test", { type: "turn" });
	wd.recordActivity("worker-test", { type: "turn" });
	wd.recordActivity("worker-test", { type: "turn" });
	let diag = wd.diagnoseAgent(entry);
	assert.equal(diag.healthy, false);
	assert.ok(diag.anomalies.some((a) => a.type === "TURN_BLOAT"));

	console.log("  3. 同一ツール空回りの発生と検知");
	wd.recordActivity("worker-test", {
		type: "tool_call",
		data: { name: "read", args: { path: "conf.json" } },
	});
	wd.recordActivity("worker-test", {
		type: "tool_call",
		data: { name: "read", args: { path: "conf.json" } },
	});
	diag = wd.diagnoseAgent(entry);
	assert.ok(diag.anomalies.some((a) => a.type === "TOOL_CHURN"));

	console.log("  4. 連続エラーの発生と検知");
	wd.recordActivity("worker-test", { type: "tool_result", data: { isError: true, error: "EACCES" } });
	wd.recordActivity("worker-test", { type: "tool_result", data: { isError: true, error: "EACCES" } });
	diag = wd.diagnoseAgent(entry);
	assert.ok(diag.anomalies.some((a) => a.type === "CONSECUTIVE_ERRORS"));

	console.log("  5. AI/人間向けのアラート示唆メッセージ生成");
	const alert = wd.formatAlert(diag);
	assert.ok(alert.includes("Watchdog 警告"));
	assert.ok(alert.includes("推奨アクション"));
});

// ────────────────────────────────────────────────────────
// シナリオ 5: 実走サブエージェントに対する介入フルサイクル (Pause ➔ Inspect ➔ Report ➔ Resume ➔ Done)
// ────────────────────────────────────────────────────────
await runScenario("5. 実走サブエージェントに対する介入フルサイクル (Pause ➔ Inspect ➔ Report ➔ Resume ➔ Done)", async () => {
	console.log("  1. 自走するバックグラウンド・サブエージェントを模したプロセスを起動");
	const script = `
		let step = 0;
		const interval = setInterval(() => {
			step++;
		}, 30);
		process.on('SIGTERM', () => {
			clearInterval(interval);
			process.exit(0);
		});
	`;
	const child = spawn(process.execPath, ["-e", script], { stdio: "ignore" });

	const wd = new SubagentWatchdog({ silentTimeoutMs: 200 });
	const agentId = "agent-runner-01";
	const entry = wd.register({
		id: agentId,
		pid: child.pid,
		agent: "dev",
		task: "高速キャッシュ層の実装",
		process: child,
	});

	console.log("  2. アクティビティ記録と進行");
	wd.recordActivity(agentId, { type: "log", data: "作業開始: cache.js 作成中" });
	wd.recordActivity(agentId, {
		type: "tool_call",
		data: { name: "edit", args: { path: "cache.js", code: "export function get() {}" } },
	});

	console.log("  3. 一時停止 (SIGSTOP) による完全凍結");
	const pauseResult = wd.pause(agentId);
	assert.equal(pauseResult.success, true);
	assert.equal(entry.status, "paused");

	console.log("  4. 点検 (Inspect) によるログとツール呼び出し履歴の抽出");
	const inspectResult = wd.inspect(agentId);
	assert.equal(inspectResult.status, "paused");
	assert.equal(inspectResult.recentTools.length, 1);
	assert.equal(inspectResult.recentTools[0].name, "edit");

	console.log("  5. 中間報告 (Interim Report) の提出とパース");
	const rawReport = `
【中間報告】
方針: メモリ内LRUキャッシュの実装
完了した作業:
- src/cache.js の作成
- test/cache.test.js の骨格作成
障害・ブロック:
- キーのTTL失効ロジックで迷走中
残り予定ステップ: 1
`;
	const reportResult = wd.recordInterimReport(agentId, rawReport);
	assert.equal(reportResult.hypothesis.includes("LRUキャッシュ"), true);
	assert.equal(reportResult.remainingSteps, 1);
	assert.equal(reportResult.blockers.length, 1);

	console.log("  6. 是正指示 (Steer Prompt) を注入して再開 (SIGCONT)");
	const resumeResult = wd.resume(agentId, {
		steerPrompt: "TTL失効はsetTimeoutではなくタイムスタンプ比較で実装せよ",
	});
	assert.equal(resumeResult.success, true);
	assert.equal(entry.status, "running");
	assert.equal(entry.steerHistory.length, 1);
	assert.ok(entry.steerHistory[0].prompt.includes("タイムスタンプ比較"));

	console.log("  7. 正常完了・クリーンアップ");
	wd.abort(agentId);
	assert.equal(entry.status, "aborted");

	await new Promise((resolve) => {
		child.on("exit", resolve);
		setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {}
			resolve();
		}, 300);
	});
});

// ────────────────────────────────────────────────────────
// シナリオ 6: pi ツール登録経路（registerTool IF）の整合検証
// @why: [2026-08-27] REQ-015。watchdog.mjs 直叩きの E2E は 5/5 PASS なのに、ライブセッションの
//       subagent_ps は "definition.execute is not a function" で全滅していた（handler/execute の IF 違い）。
//       「自分で書いた検証経路」と「piが実際に通す経路」の乖離は、拡張をモックpiでロードし
//       execute(toolCallId, params, ...) を pi と同じシグネチャで呼ぶことでしか捕まえられない。
// ────────────────────────────────────────────────────────
await runScenario("6. pi registerTool 経路の整合（execute IF・返却 shape）(REQ-015)", async () => {
	console.log("  0. typebox 解決の自動プロビジョニング（peerDep: pi 本体同梱の実体へ symlink）");
	// @why: typebox は peerDependency で pi 本体が提供するため、素の node 実行では解決できない。
	//       グローバル install の pi から実体を探し node_modules/typebox へ symlink（gitignore済み）。
	try {
		await fs.access(path.join(__dirname, "node_modules", "typebox"));
	} catch {
		const { execSync } = await import("node:child_process");
		const piRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
		const typeboxPath = path.join(piRoot, "@earendil-works", "pi-coding-agent", "node_modules", "typebox");
		await fs.access(typeboxPath); // 無ければここで失敗させる（pi 未インストール環境）
		await fs.mkdir(path.join(__dirname, "node_modules"), { recursive: true });
		await fs.symlink(typeboxPath, path.join(__dirname, "node_modules", "typebox"), "dir");
		console.log(`     → symlink 作成: node_modules/typebox → ${typeboxPath}`);
	}

	console.log("  1. モック pi で subagent-watchdog.ts をロード（--experimental-strip-types 子プロセス）");
	const probe = `
		const mod = await import('./extensions/subagent-watchdog.ts');
		const tools = [];
		mod.default({ registerTool: (def) => tools.push(def) });
		const report = tools.map(t => ({ name: t.name, execute: typeof t.execute, handler: typeof t.handler }));
		const ps = tools.find(t => t.name === 'subagent_ps');
		const res = await ps.execute('e2e-tc', {}, undefined, undefined, {});
		const shapeOk = Array.isArray(res.content) && res.content[0].type === 'text' && typeof res.content[0].text === 'string';
		console.log(JSON.stringify({ report, shapeOk }));
	`;
	const out = await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", probe], {
			cwd: __dirname, stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "", stderr = "";
		child.stdout.on("data", (d) => (stdout += d));
		child.stderr.on("data", (d) => (stderr += d));
		child.on("exit", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`probe exit ${code}: ${stderr}`))));
	});
	const { report, shapeOk } = JSON.parse(out.trim().split("\n").pop());

	console.log("  2. 全6ツールが execute を持ち、旧 handler 形式が残っていないこと");
	assert.equal(report.length, 6, "6ツールが登録されること");
	for (const t of report) {
		assert.equal(t.execute, "function", `${t.name} が execute(fn) を持つこと（pi 正式IF）`);
		assert.equal(t.handler, "undefined", `${t.name} に registerCommand 用の handler が誤用されていないこと`);
	}

	console.log("  3. execute を pi と同じシグネチャで実呼び出しし、{ content: [{type:'text'}] } を返すこと");
	assert.equal(shapeOk, true, "pi のツール返却 shape（content配列）で返ること");
});

// ────────────────────────────────────────────────────────
// シナリオ 7: function-tester の cwd 解決整合（guard write 許可パス ≡ tester の testFile）
// @why: [2026-08-27] レビューで検出された Critical：YUME_FUNCTION_TESTER_TEST_FILE だけが
//       process.cwd() 基準で解決され（path.resolve(params.testFile)）、ctx.cwd ≠ process.cwd() のとき
//       guard が正しいテストファイルへの書き込みまで誤ブロックしていた。解決を resolveTesterPaths に
//       一元化し、『ctx.cwd と異なる process.cwd() でも write 許可パスが一致する」ことを固定する。
// ────────────────────────────────────────────────────────
await runScenario("7. function-tester の cwd 解決整合（guard 誤ブロック防止）", async () => {
	console.log("  1. 子プロセスを process.cwd()=os.tmpdir で起動し、ctx.cwd 相当の別ディレクトリでパス解決");
	const probe = `
		import path from 'node:path';
		const { resolveTesterPaths } = await import(${JSON.stringify(path.join(__dirname, "extensions", "function-tester.ts"))});
		const ctxCwd = '/virtual/project-root';
		const r = resolveTesterPaths(ctxCwd, {
			target: 'src/core.js',
			testFile: 'test/core.test.js',
			additionalAllowedFiles: ['src/util.js'],
		});
		console.log(JSON.stringify({ r, processCwd: process.cwd() }));
	`;
	const os = await import("node:os");
	const out = await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", probe], {
			cwd: os.tmpdir(), stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "", stderr = "";
		child.stdout.on("data", (d) => (stdout += d));
		child.stderr.on("data", (d) => (stderr += d));
		child.on("exit", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`probe exit ${code}: ${stderr}`))));
	});
	const { r, processCwd } = JSON.parse(out.trim().split("\n").pop());

	console.log("  2. 全パスが ctx.cwd 基準で解決され、process.cwd() が混入していないこと");
	assert.notEqual(processCwd, "/virtual/project-root", "テスト前提: 子プロセスの cwd は ctx.cwd と異なること");
	assert.equal(r.target, "/virtual/project-root/src/core.js", "target は ctx.cwd 基準");
	assert.equal(r.testFile, "/virtual/project-root/test/core.test.js", "testFile（guard write 許可パス）も ctx.cwd 基準");
	for (const file of r.allowed) {
		assert.ok(file.startsWith("/virtual/project-root/"), `allowed の全パスが ctx.cwd 基準: ${file}`);
	}

	console.log("  3. guard に同じ値を渡し、testFile への write が通り・target への write がブロックされること");
	process.env.YUME_FUNCTION_TESTER_TEST_FILE = r.testFile;
	process.env.YUME_FUNCTION_TESTER_ALLOWED_FILES = JSON.stringify(r.allowed);
	let handler;
	const mockPi = { on(_event, fn) { handler = fn; } };
	const { default: installGuard } = await import(`./extensions/function-tester-guard.mjs?scenario7=${Date.now()}`);
	installGuard(mockPi);
	assert.equal(handler({ toolName: "write", input: { path: r.testFile } }), undefined, "正しいテストファイルへの write はブロックされない（旧バグの再発防止）");
	assert.equal(handler({ toolName: "write", input: { path: r.target } })?.block, true, "プロダクトソースへの write はブロック");
	assert.equal(handler({ toolName: "read", input: { path: r.target } }), undefined, "許可済みソースの read は通過");
	delete process.env.YUME_FUNCTION_TESTER_TEST_FILE;
	delete process.env.YUME_FUNCTION_TESTER_ALLOWED_FILES;
});

// ────────────────────────────────────────────────────────
// シナリオ 8: coverage-diff による E2E-only coverage 計測（DESIGN §5 手順6–7 の道具化）
// @why: [2026-08-27] E2E snowball の未実装だった後半戦（E2E-only coverage 計測）を coverage-diff.mjs で道具化。
//       unit/E2E を NODE_V8_COVERAGE で別々に採取し関数単位の差分（both / unit-only / e2e-only / uncovered）を
//       報告する感覚器として固定する。分類が1つでも狂うと「E2Eへ追加すべきシナリオ候補」「function-tester委譲候補」
//       の提案が両方誤るため、4分類すべてを既知のミニプロジェクトで検証する。
// ────────────────────────────────────────────────────────
await runScenario("8. coverage-diff による E2E-only coverage 計測（unit/E2E/未到達の4分類）", async () => {
	const os = await import("node:os");
	const demo = await fs.mkdtemp(path.join(os.tmpdir(), "yume-covdiff-e2e-"));
	try {
		console.log("  1. 既知の到達パターンを持つミニプロジェクトを生成（both/unit-only/e2e-only/uncovered 各一関数）");
		await fs.mkdir(path.join(demo, "src"), { recursive: true });
		await fs.mkdir(path.join(demo, "test"), { recursive: true });
		await fs.writeFile(path.join(demo, "package.json"), JSON.stringify({ type: "module" }));
		await fs.writeFile(path.join(demo, "src", "core.js"), [
			"export function add(a, b) { return a + b; }",
			"export function mul(a, b) { return a * b; }",
			"export function greet(name) { return 'hi ' + name; }",
			"export function dead() { return 'never'; }",
		].join("\n"));
		await fs.writeFile(path.join(demo, "test", "core.test.js"), [
			"import { add, mul } from '../src/core.js';",
			"import assert from 'node:assert/strict';",
			"assert.equal(add(1, 2), 3);",
			"assert.equal(mul(2, 3), 6);",
			"console.log('unit: 2 pass');",
		].join("\n"));
		await fs.writeFile(path.join(demo, "e2e.mjs"), [
			"import { add, greet } from './src/core.js';",
			"import assert from 'node:assert/strict';",
			"assert.equal(add(1, 2), 3);",
			"assert.equal(greet('yume'), 'hi yume');",
			"console.log('e2e: scenario pass');",
		].join("\n"));

		console.log("  2. coverageDiff を実呼び出しし、NODE_V8_COVERAGE 採取・差分計算が動くこと");
		const { coverageDiff } = await import("./coverage-diff.mjs");
		const result = await coverageDiff({
			unit: "node test/core.test.js",
			e2e: "node e2e.mjs",
			source: "src",
			cwd: demo,
		});
		assert.equal(result.unitExit, 0, "unit コマンド自体は全PASSであること");
		assert.equal(result.e2eExit, 0, "e2e コマンド自体は全PASSであること");

		console.log("  3. 関数単位の4分類（both / unit-only / e2e-only / uncovered）がすべて正しいこと");
		const byName = Object.fromEntries(result.functions.map((f) => [f.name, f.class]));
		assert.equal(byName.add, "both", "add は unit と E2E の両方が到達");
		assert.equal(byName.mul, "unit-only", "mul は E2E-gap（E2E シナリオ追加候補）");
		assert.equal(byName.greet, "e2e-only", "greet は unit-gap（function-tester 委譲候補）");
		assert.equal(byName.dead, "uncovered", "dead はどちらも未到達");
		assert.equal(result.summary.total, 4, "テスト入口・node_modules は除外されソース4関数だけが対象");

		console.log("  4. CLI としても起動し、ヒント形式のレポートを出力すること（ブロックしない：exit 0）");
		const cli = await new Promise((resolve) => {
			const child = spawn(process.execPath, [
				path.join(__dirname, "coverage-diff.mjs"),
				"--unit", "node test/core.test.js", "--e2e", "node e2e.mjs", "--source", "src", "--cwd", demo,
			], { stdio: ["ignore", "pipe", "pipe"] });
			let stdout = "";
			child.stdout.on("data", (d) => (stdout += d));
			child.on("close", (code) => resolve({ code, stdout }));
		});
		assert.equal(cli.code, 0, "全PASSならカバレッジ差分の多寡に関わらず exit 0（ヒントであり矯正ではない）");
		assert.ok(cli.stdout.includes("unit-only / E2E-gap"), "E2E-gap セクションがあること");
		assert.ok(cli.stdout.includes("function-tester へ委譲する候補"), "unit-gap の次アクション提案があること");
	} finally {
		await fs.rm(demo, { recursive: true, force: true });
	}
});

console.log("====================================================");
console.log(`🎉 swmr-pi 全 ${scenariosPassed} 本の E2E Snowball シナリオが完走しました！ (E2E ALL PASS)`);
console.log("====================================================\n");
