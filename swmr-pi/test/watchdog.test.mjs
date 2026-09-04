// @why: サブエージェントの監視、異常検知（沈黙・ターン肥大・空回り）、一時停止（SIGSTOP）、点検（Inspect）、中間報告パース、再開（SIGCONT）の正確性をヘッドレスで保証する。
// @tags: SPEC, SWMR, WATCHDOG

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { SubagentWatchdog, parseInterimReportText } from "../watchdog.mjs";

console.log("🧪 === SWMR Subagent Watchdog & Intercept Test Suite ===");

let passed = 0;
function test(name, fn) {
	try {
		fn();
		console.log(`  ✓ ${name}`);
		passed++;
	} catch (err) {
		console.error(`  ✗ ${name}`);
		console.error(err);
		process.exit(1);
	}
}

async function asyncTest(name, fn) {
	try {
		await fn();
		console.log(`  ✓ ${name}`);
		passed++;
	} catch (err) {
		console.error(`  ✗ ${name}`);
		console.error(err);
		process.exit(1);
	}
}

// 1. 基本登録・解除
test("Watchdog: 登録・一覧・取得・解除", () => {
	const wd = new SubagentWatchdog();
	const entry = wd.register({
		id: "agent-001",
		pid: 1234,
		agent: "research",
		task: "API 仕様調査",
	});

	assert.equal(entry.id, "agent-001");
	assert.equal(entry.status, "running");
	assert.equal(wd.list().length, 1);
	assert.equal(wd.get("agent-001")?.agent, "research");

	const unreg = wd.unregister("agent-001");
	assert.equal(unreg, true);
	assert.equal(wd.list().length, 0);
});

// 2. 異常検知: 沈黙 (Silent Timeout)
test("Watchdog: 沈黙 (Silent Timeout) 検知とヒント示唆", () => {
	const wd = new SubagentWatchdog({ silentTimeoutMs: 1000 });
	const entry = wd.register({
		id: "agent-silent",
		pid: 2001,
		agent: "dev",
		task: "重いビルド実行",
	});

	// 最初は健全
	let diag = wd.diagnoseAgent(entry, Date.now());
	assert.equal(diag.healthy, true);

	// 1.5秒後の時間で診断
	const future = Date.now() + 1500;
	diag = wd.diagnoseAgent(entry, future);
	assert.equal(diag.healthy, false);
	assert.equal(diag.anomalies.some((a) => a.type === "SILENT_TIMEOUT"), true);
	assert.equal(diag.suggestions.length > 0, true);

	const alertText = wd.formatAlert(diag);
	assert.equal(alertText.includes("SILENT_TIMEOUT"), true);
	assert.equal(alertText.includes("pause"), true);
});

// 3. 異常検知: ターン肥大 (Turn Bloat)
test("Watchdog: ターン肥大 (Turn Bloat) 検知", () => {
	const wd = new SubagentWatchdog({ maxTurns: 5 });
	const entry = wd.register({
		id: "agent-turns",
		pid: 2002,
		agent: "inspect",
		task: "コード探索",
	});

	for (let i = 0; i < 5; i++) {
		wd.recordActivity("agent-turns", { type: "turn" });
	}

	const diag = wd.diagnoseAgent(entry, Date.now());
	assert.equal(diag.healthy, false);
	assert.equal(diag.anomalies.some((a) => a.type === "TURN_BLOAT"), true);
});

// 4. 異常検知: 同一ツールの空回り (Tool Churn)
test("Watchdog: 同一ツールの空回り (Tool Churn) 検知", () => {
	const wd = new SubagentWatchdog({ maxToolChurn: 3 });
	const entry = wd.register({
		id: "agent-churn",
		pid: 2003,
		agent: "dev",
		task: "ファイル修正",
	});

	// 同一引数で3回実行
	for (let i = 0; i < 3; i++) {
		wd.recordActivity("agent-churn", {
			type: "tool_call",
			data: { name: "edit", args: { path: "foo.js", text: "abc" } },
		});
	}

	const diag = wd.diagnoseAgent(entry, Date.now());
	assert.equal(diag.healthy, false);
	assert.equal(diag.anomalies.some((a) => a.type === "TOOL_CHURN"), true);
});

// 5. 異常検知: 連続エラー (Consecutive Errors)
test("Watchdog: 連続エラー検知", () => {
	const wd = new SubagentWatchdog({ maxConsecutiveErrors: 3 });
	const entry = wd.register({
		id: "agent-err",
		pid: 2004,
		agent: "research",
		task: "Webフェッチ",
	});

	for (let i = 0; i < 3; i++) {
		wd.recordActivity("agent-err", {
			type: "tool_result",
			data: { isError: true, error: "404 Not Found" },
		});
	}

	const diag = wd.diagnoseAgent(entry, Date.now());
	assert.equal(diag.healthy, false);
	assert.equal(diag.anomalies.some((a) => a.type === "CONSECUTIVE_ERRORS"), true);
});

// 6. 中間報告テキストのパース
test("Watchdog: 中間報告（Interim Report）のパースと記録", () => {
	const rawReport = `
【中間報告】
方針: 認証トークンのキャッシュ層を実装中
完了した作業:
- src/auth.js のインターフェース修正
- test/auth.test.js の骨格作成
障害・ブロック:
- Redis 接続タイムアウトが再発中
残り予定ステップ: 2
`;

	const parsed = parseInterimReportText(rawReport);
	assert.equal(parsed.hypothesis.includes("認証トークン"), true);
	assert.equal(parsed.done.length, 2);
	assert.equal(parsed.blockers.length, 1);
	assert.equal(parsed.blockers[0].includes("Redis"), true);
	assert.equal(parsed.remainingSteps, 2);

	const wd = new SubagentWatchdog();
	wd.register({ id: "agent-rep", pid: 3001, agent: "dev", task: "Auth" });
	const rec = wd.recordInterimReport("agent-rep", rawReport);
	assert.equal(rec.hypothesis.includes("認証トークン"), true);

	const insp = wd.inspect("agent-rep");
	assert.equal(insp.latestReport?.remainingSteps, 2);
});

// 7. 実プロセスでの一時停止 (SIGSTOP) ➔ 点検 (Inspect) ➔ 再開 (SIGCONT) ➔ 終了 (Abort)
await asyncTest("Watchdog: 実プロセス介入サイクル (Pause -> Inspect -> Resume -> Abort)", async () => {
	// 永続ループする子プロセスを起動
	const child = spawn(process.execPath, ["-e", "let count=0; setInterval(() => { count++; }, 50);"], {
		stdio: "ignore",
	});

	const wd = new SubagentWatchdog();
	const entry = wd.register({
		id: "live-proc",
		pid: child.pid,
		agent: "dev",
		task: "長時間ループ",
		process: child,
	});

	wd.recordActivity("live-proc", { type: "log", data: "プロセス開始" });
	wd.recordActivity("live-proc", {
		type: "tool_call",
		data: { name: "bash", args: { command: "make test" } },
	});

	// 一時停止 (SIGSTOP)
	const pauseRes = wd.pause("live-proc");
	assert.equal(pauseRes.success, true);
	assert.equal(entry.status, "paused");

	// 点検 (Inspect)
	const insp = wd.inspect("live-proc");
	assert.equal(insp.status, "paused");
	assert.equal(insp.recentTools.length, 1);
	assert.equal(insp.recentTools[0].name, "bash");

	// 是正指示を注入して再開 (SIGCONT)
	const resumeRes = wd.resume("live-proc", {
		steerPrompt: "make test の代わりに node test/unit.js を実行せよ",
	});
	assert.equal(resumeRes.success, true);
	assert.equal(entry.status, "running");
	assert.equal(entry.steerHistory.length, 1);
	assert.equal(entry.steerHistory[0].prompt.includes("node test/unit.js"), true);

	// 終了 (Abort)
	const abortRes = wd.abort("live-proc");
	assert.equal(abortRes.success, true);
	assert.equal(entry.status, "aborted");

	// プロセスの安全な終了を待つ
	await new Promise((resolve) => {
		child.on("exit", resolve);
		// 万一のための SIGKILL
		setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {}
			resolve();
		}, 300);
	});
});

console.log(`🎉 All ${passed} Watchdog tests passed successfully!`);
