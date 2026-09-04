#!/usr/bin/env node
// @why: [2026-08-27] E2E snowball（DESIGN.md §5 手順6–7）の未実装だった道具化。unit実行とE2E実行の
//        カバレッジを NODE_V8_COVERAGE で別々に採取し、関数単位で差分を出す。
//        - unit-only（E2E-gap）= E2Eの利用シナリオが到達していない関数 → 意味あるE2Eシナリオ追加候補
//        - e2e-only（unit-gap）= unit testの局所契約保証がない関数 → function-tester委譲候補
//        - uncovered = どちらも未到達
//        依存ゼロ（node組み込みのみ）。read-onlyの感覚器であり、カバレッジ数値でブロックしない
//        （exit≠0 になるのは物理的破綻＝テストコマンド自体の失敗のみ。v1.4「ヒントであり矯正ではない」）。
// @tags: SPEC

import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ---------- CLI 引数 ----------
function parseArgs(argv) {
	const args = { unit: null, e2e: null, source: ".", json: false, cwd: process.cwd() };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--unit") args.unit = argv[++i];
		else if (a === "--e2e") args.e2e = argv[++i];
		else if (a === "--source") args.source = argv[++i];
		else if (a === "--cwd") args.cwd = argv[++i];
		else if (a === "--json") args.json = true;
		else if (a === "--help" || a === "-h") args.help = true;
	}
	return args;
}

const USAGE = `coverage-diff — E2E snowball 手順6–7 の道具（unit と E2E のカバレッジ差分）

使い方:
  node coverage-diff.mjs --unit "node test/core.test.js" --e2e "node e2e.mjs" --source src

オプション:
  --unit <cmd>    unit test 実行コマンド（sh -lc で実行）
  --e2e <cmd>     E2E 実行コマンド（sh -lc で実行）
  --source <p>    計測対象のソースファイル/ディレクトリ（既定: カレント）。node_modules と *test* は自動除外
  --cwd <dir>     コマンドの作業ディレクトリ（既定: カレント）
  --json          機械可読 JSON で出力

出力の読み方:
  unit-only（E2E-gap）  = E2E が到達していない → 意味ある利用シナリオを E2E へ追加する候補
  e2e-only（unit-gap）  = unit test がない → function-tester へ委譲する候補
  uncovered             = どちらも未到達（デッドコード or 完全未検証）`;

// ---------- カバレッジ採取 ----------
async function runWithCoverage(command, cwd) {
	const covDir = await fs.mkdtemp(path.join(os.tmpdir(), "yume-cov-"));
	const result = await new Promise((resolve) => {
		const child = spawn("sh", ["-lc", command], {
			cwd,
			env: { ...process.env, NODE_V8_COVERAGE: covDir },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "", stderr = "";
		child.stdout.on("data", (d) => (stdout += d));
		child.stderr.on("data", (d) => (stderr += d));
		child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
		child.on("error", (err) => resolve({ exitCode: 1, stdout, stderr: stderr + err.message }));
	});
	const covered = new Set(); // "absPath\0startOffset"
	const seen = new Map(); // key -> { path, offset, name }
	try {
		for (const file of await fs.readdir(covDir)) {
			if (!file.startsWith("coverage-") || !file.endsWith(".json")) continue;
			let parsed;
			try {
				parsed = JSON.parse(await fs.readFile(path.join(covDir, file), "utf8"));
			} catch {
				continue; // 中断されたプロセスの不完全な JSON はスキップ
			}
			for (const entry of parsed.result || []) {
				if (!entry.url || !entry.url.startsWith("file://")) continue;
				let abs;
				try {
					abs = fileURLToPath(entry.url.split("?")[0]);
				} catch {
					continue;
				}
				for (const fn of entry.functions || []) {
					const range = fn.ranges && fn.ranges[0];
					if (!range) continue;
					const key = `${abs}\0${range.startOffset}`;
					if (!seen.has(key)) {
						seen.set(key, {
							path: abs,
							offset: range.startOffset,
							name: fn.functionName || (range.startOffset === 0 ? "(module)" : "(anonymous)"),
						});
					}
					if (range.count > 0) covered.add(key);
				}
			}
		}
	} finally {
		await fs.rm(covDir, { recursive: true, force: true });
	}
	return { ...result, covered, seen };
}

// ---------- 対象フィルタと行番号解決 ----------
function isTarget(absPath, sourceRoot) {
	if (absPath.includes(`${path.sep}node_modules${path.sep}`)) return false;
	const base = path.basename(absPath);
	if (/(^|[.\-_])(test|spec|e2e)s?([.\-_]|$)/i.test(base)) return false; // テスト入口自身は対象外
	const rel = path.relative(sourceRoot, absPath);
	return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function offsetToLine(cache, absPath, offset) {
	if (!cache.has(absPath)) {
		try {
			cache.set(absPath, await fs.readFile(absPath, "utf8"));
		} catch {
			cache.set(absPath, null);
		}
	}
	const text = cache.get(absPath);
	if (text == null) return 0;
	let line = 1;
	for (let i = 0; i < offset && i < text.length; i++) if (text[i] === "\n") line++;
	return line;
}

// ---------- 差分計算 ----------
export async function coverageDiff({ unit, e2e, source, cwd }) {
	// @why: [2026-08-27] macOS では os.tmpdir() が /var（→ /private/var への symlink）を返す一方、
	//        V8 カバレッジの file:// URL は実パス（/private/var/...）で記録される。sourceRoot を realpath に
	//        揃えないと isTarget が全件対象外と誤判し分類が空になる（E2E シナリオ8で検出された実バグ）。
	const sourceRoot = await fs.realpath(path.resolve(cwd, source)).catch(() => path.resolve(cwd, source));
	const unitRun = await runWithCoverage(unit, cwd);
	const e2eRun = await runWithCoverage(e2e, cwd);

	// 両ランで観測された全関数を統合（module ラッパは除外: 到達＝ロードでしかなくノイズ）
	const all = new Map();
	for (const run of [unitRun, e2eRun]) {
		for (const [key, info] of run.seen) {
			if (!isTarget(info.path, sourceRoot)) continue;
			if (info.name === "(module)") continue;
			if (!all.has(key)) all.set(key, info);
		}
	}
	const fileCache = new Map();
	const functions = [];
	for (const [key, info] of all) {
		functions.push({
			file: path.relative(cwd, info.path),
			line: await offsetToLine(fileCache, info.path, info.offset),
			name: info.name,
			unit: unitRun.covered.has(key),
			e2e: e2eRun.covered.has(key),
		});
	}
	functions.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

	const classify = (f) => (f.unit && f.e2e ? "both" : f.unit ? "unit-only" : f.e2e ? "e2e-only" : "uncovered");
	const summary = { total: functions.length, both: 0, "unit-only": 0, "e2e-only": 0, uncovered: 0 };
	for (const f of functions) summary[classify(f)]++;

	return {
		summary,
		functions: functions.map((f) => ({ ...f, class: classify(f) })),
		unitExit: unitRun.exitCode,
		e2eExit: e2eRun.exitCode,
		unitOutputTail: (unitRun.stdout + unitRun.stderr).slice(-2000),
		e2eOutputTail: (e2eRun.stdout + e2eRun.stderr).slice(-2000),
	};
}

// ---------- レポート整形 ----------
function renderReport(result, args) {
	const lines = [];
	lines.push("## Coverage Diff (unit vs E2E) — E2E snowball 手順6–7");
	lines.push(`- source: ${args.source}`);
	lines.push(`- unit: \`${args.unit}\` (exit ${result.unitExit})`);
	lines.push(`- e2e:  \`${args.e2e}\` (exit ${result.e2eExit})`);
	lines.push("");
	const section = (title, cls, hint) => {
		const rows = result.functions.filter((f) => f.class === cls);
		lines.push(`### ${title}（${rows.length}件）${hint}`);
		for (const f of rows) lines.push(`- ${f.file}:${f.line} ${f.name}`);
		if (rows.length === 0) lines.push("- （なし）");
		lines.push("");
	};
	section("unit-only / E2E-gap", "unit-only", " → 意味ある利用シナリオを E2E へ追加する候補");
	section("e2e-only / unit-gap", "e2e-only", " → function-tester へ委譲する候補");
	section("uncovered", "uncovered", " → デッドコード or 完全未検証");
	const s = result.summary;
	lines.push(`### Summary`);
	lines.push(`- 関数 ${s.total} 件: both ${s.both} / unit-only ${s["unit-only"]} / e2e-only ${s["e2e-only"]} / uncovered ${s.uncovered}`);
	lines.push("");
	lines.push("> これはヒントであり矯正ではない。数値でブロックしない。追加すべきは「意味のある利用シナリオ」であり、数字だけの空テストは snowball ではない。");
	return lines.join("\n");
}

// ---------- main ----------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const args = parseArgs(process.argv.slice(2));
	if (args.help || !args.unit || !args.e2e) {
		console.log(USAGE);
		process.exit(args.help ? 0 : 2);
	}
	const result = await coverageDiff(args);
	if (args.json) console.log(JSON.stringify(result, null, 2));
	else console.log(renderReport(result, args));
	// @why: カバレッジ差分では絶対にブロックしない。exit≠0 は物理的破綻（テストコマンド自体の失敗）のみ。
	if (result.unitExit !== 0 || result.e2eExit !== 0) {
		console.error(`\n💥 テストコマンド自体が失敗しています (unit exit ${result.unitExit} / e2e exit ${result.e2eExit})。カバレッジ差分の前に全PASSへ戻してください。`);
		process.exit(1);
	}
	process.exit(0);
}
