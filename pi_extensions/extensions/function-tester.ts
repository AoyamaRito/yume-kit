import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// @why: E2E通過後のunit test追加を、プロジェクトの意図・@why・設計書を知らない別プロセスに委譲し、実装者の思い込みによるテストを減らす。関数テスターは指定されたソースとテスト入口だけを読み、プロダクトコードを変更せずテストファイルだけを書く。
// @tags: SPEC
const TESTER_SYSTEM_PROMPT = `
あなたは function-tester です。E2E snowball の unit-test フェーズだけを担当します。

## あなたの立場
- あなたは対象プロジェクトを初めて見る、意図を知らない第三者です。
- AGENTS.md / CLAUDE.md / README / DESIGN / REQS / @why / git履歴 / 無関係なファイルは読まないでください。
- 作者の意図を推測してテストを都合よく作らず、指定された対象ソース、指定されたテストファイル、実行に必要な直接依存だけを根拠にしてください。
- この「無知」は、サブエージェントのコンテキストを狭くするための運用上の分離です。ファイルシステム権限のサンドボックスではありません。指示外のファイルを読まないでください。

## やること
1. 指定ソース内の「意味のあるプロダクト関数」を列挙する。export関数だけに限定せず、外部から観測可能な内部関数・重要な分岐も含める。
2. 各関数について、実装から確認できる正常系、境界値、異常系、決定性、不変条件を考える。
3. 指定されたテストファイルにunit testを追加する。既存テストの流儀・assertion・runnerに合わせる。
4. unit testの追加後、E2Eは実行しない。あなた自身は実行用shellを持たないため、unit testの実行は親ラッパーが行い、結果をあなたの報告に付加します。失敗してもプロダクトコードを直してはいけません。テストの誤り、実装の問題、仕様不明を分けて報告してください。
5. E2E-only coverageを増やすのは、次のMAIN/Writerフェーズの仕事です。

## 禁止
- プロダクトコード、E2E、仕様書、設定、package.jsonを変更しない。
- 既存テストを弱める、削除する、skipする、期待値を実装に合わせて捏造する、coverage数字だけの空テストを書く、を禁止する。
- 関数の挙動がソースだけでは確定できない場合、断定的なテストを作らず unknowns に記録する。
- test helper・fixture生成関数など、テストコード自身の関数を「プロダクト関数」として水増ししない。

## 出力形式
最後に必ず以下を出力してください。
## Function Inventory
- function: tested|unknown|excluded — 根拠
## Files Changed
- テストファイルだけを列挙
## Unit Test Result
- 実行コマンドと実測結果
## Unknowns
- ソースだけでは決められない契約
## Risks
- unit testで保証できず、E2Eまたは人間確認が必要なもの
## Summary
- 追加したテスト数、対象関数数、未確定数を短く報告
`;

function finalAssistantText(stdout: string): string {
	let last = "";
	for (const line of stdout.split("\n")) {
		if (!line.trim()) continue;
		try {
			const event = JSON.parse(line);
			if (event.type === "message_end" && event.message?.role === "assistant") {
				const text = event.message.content?.find((part: any) => part.type === "text")?.text;
				if (text) last = text;
			}
		} catch {
			// JSON mode may emit non-JSON diagnostics; the final report is taken from message_end.
		}
	}
	return last;
}

// @why: [2026-08-27] guard へ渡す write 許可パス（YUME_FUNCTION_TESTER_TEST_FILE）だけが process.cwd() 基準で解決され、
//        ctx.cwd ≠ process.cwd() のとき正しいテストファイルへの書き込みまで guard が誤ブロックするバグがあった（read 側は params.cwd 基準で非対称）。
//        全パス解決を params.cwd 基準の純関数に一元化し、E2E（モック不要・cwd を変えて実呼び出し）から検証できるよう export する。
// @tags: SPEC
export function resolveTesterPaths(cwd: string, params: {
	target: string;
	testFile: string;
	additionalAllowedFiles?: string[];
}): { target: string; testFile: string; allowed: string[] } {
	const target = path.resolve(cwd, params.target);
	const testFile = path.resolve(cwd, params.testFile);
	const allowed = [target, testFile, ...(params.additionalAllowedFiles || []).map((file) => path.resolve(cwd, file))];
	return { target, testFile, allowed };
}

async function runTester(params: {
	cwd: string;
	target: string;
	testFile: string;
	unitCommand: string;
	e2eEvidence: string;
	model?: string;
	additionalAllowedFiles?: string[];
	timeoutMs?: number;
	signal?: AbortSignal;
}) {
	const { target, testFile, allowed } = resolveTesterPaths(params.cwd, params);
	const task = [
		"E2E snowball の unit-test フェーズを実行してください。",
		`対象ソース: ${target}`,
		`追記してよいテストファイル: ${testFile}`,
		`unit testコマンド: ${params.unitCommand}`,
		`E2E通過Evidence（再実行せず、前提として扱う）: ${params.e2eEvidence}`,
		`追加で読んでよい直接依存: ${allowed.join(", ")}`,
		"指定した対象とテスト入口以外は読まないでください。",
	].join("\n");

	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "yume-function-tester-"));
	const systemPath = path.join(tempDir, "system.md");
	await fs.writeFile(systemPath, TESTER_SYSTEM_PROMPT, "utf8");

	const args = [
		"--mode", "json", "-p", "--no-session", "--no-context-files", "--no-extensions",
		"--tools", "read,write,edit", "--extension", path.join(path.dirname(fileURLToPath(import.meta.url)), "function-tester-guard.mjs"), "--append-system-prompt", systemPath,
	];
	if (params.model) args.push("--model", params.model);
	args.push(task);

	let stdout = "";
	let stderr = "";
	const timeoutMs = params.timeoutMs ?? 10 * 60 * 1000;
	const result = await runProcess("pi", args, {
		cwd: params.cwd,
		env: { ...process.env, YUME_FUNCTION_TESTER_TEST_FILE: testFile, YUME_FUNCTION_TESTER_ALLOWED_FILES: JSON.stringify(allowed) },
		timeoutMs,
		signal: params.signal,
	});
	stdout = result.stdout;
	stderr = result.stderr;
	await fs.rm(tempDir, { recursive: true, force: true });

	const unit = result.exitCode === 0
		? await runProcess("sh", ["-lc", params.unitCommand], { cwd: params.cwd, timeoutMs, signal: params.signal })
		: { exitCode: result.exitCode ?? 1, stdout: "", stderr: "unit command skipped because function-tester failed" };
	const agentReport = finalAssistantText(stdout) || stderr.trim() || "function-tester did not return a report";
	const report = `${agentReport}\n\n## Unit Test Result (wrapper evidence)\n- command: ${params.unitCommand}\n- exitCode: ${unit.exitCode}\n- output:\n${[unit.stdout, unit.stderr].filter(Boolean).join("\n") || "(no output)"}`;
	return {
		report,
		exitCode: result.exitCode === 0 && unit.exitCode === 0 ? 0 : (result.exitCode || unit.exitCode),
		isolated: true,
		contextFilesDisabled: true,
		extensionsDisabled: true,
		allowedFiles: allowed,
		unitExitCode: unit.exitCode,
		timedOut: result.timedOut || unit.timedOut,
	};
}

async function runProcess(command: string, args: string[], options: {
	cwd: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs: number;
	signal?: AbortSignal;
}): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut?: boolean }> {
	return await new Promise((resolve) => {
		const child = spawn(command, args, { cwd: options.cwd, env: options.env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let settled = false;
		let timedOut = false;
		const append = (current: string, chunk: Buffer | string) => {
			const next = current + chunk.toString();
			return next.length > 200_000 ? next.slice(0, 200_000) + "\n[output truncated]" : next;
		};
		const finish = (exitCode: number | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			resolve({ exitCode, stdout, stderr, timedOut });
		};
		const kill = () => {
			if (settled) return;
			child.kill("SIGTERM");
			setTimeout(() => { if (!settled) child.kill("SIGKILL"); }, 2_000).unref();
		};
		const onAbort = () => kill();
		const timer = setTimeout(() => { timedOut = true; kill(); }, options.timeoutMs);
		options.signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
		child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
		child.on("error", (error) => { stderr = append(stderr, `${error.message}\n`); finish(1); });
		child.on("close", (exitCode) => finish(exitCode));
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "function_tester",
		label: "Run ignorant function tester",
		description: "E2E通過後、指定ソースの意味のある関数へunit testを追加する無知な別プロセス。仕様書・@why・git履歴・無関係なファイルを読まず、指定テストファイルだけを書き、unit test結果とunknownsを報告する。",
		parameters: Type.Object({
			target: Type.String({ description: "unit test対象のプロダクトソース。例: src/core.js" }),
			testFile: Type.String({ description: "テストを追記してよいファイル。例: test/core.test.js" }),
			unitCommand: Type.String({ description: "unit test実行コマンド。例: node test/core.test.js" }),
			e2eEvidence: Type.String({ description: "直前に通過したE2Eのコマンドと結果。再実行はしない" }),
			model: Type.Optional(Type.String({ description: "任意のサブエージェントモデル" })),
			additionalAllowedFiles: Type.Optional(Type.Array(Type.String({ description: "実行に必要な直接依存ファイル" }))),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			try {
				const result = await runTester({ ...params, cwd: ctx.cwd, signal });
				return {
					content: [{ type: "text", text: result.report }],
					details: { exitCode: result.exitCode, unitExitCode: result.unitExitCode, isolated: result.isolated, contextFilesDisabled: result.contextFilesDisabled, extensionsDisabled: result.extensionsDisabled, allowedFiles: result.allowedFiles },
				};
			} catch (error: any) {
				return { content: [{ type: "text", text: `function_tester error: ${error.message}` }], details: { error: error.message } };
			}
		},
	});
}
