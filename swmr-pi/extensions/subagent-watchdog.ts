import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { globalWatchdog } from "../watchdog.mjs";

// @why: サブエージェントの長時間の迷走・無反応・トークン浪費を防ぎ、親AI/人間が状態を検知（Watchdog）、一時停止（Pause）、点検（Inspect）、中間報告（Report）、軌道修正・再開（Resume）できるようにするためのpi拡張ツール群。
// @why: [2026-08-27] REQ-015: 全ツールを handler→execute 形式に修正。初版は registerCommand 用の handler(args) シグネチャを registerTool に誤用し、ライブセッションで "definition.execute is not a function" となった（E2E は watchdog.mjs を直接叩くため検出できず。読むだけの4モデルレビューも検出できず、実呼び出しで初めて発覚）。pi 正式 IF は execute(toolCallId, params, signal, onUpdate, ctx) + { content: [...] } 返却（隣の function-tester.ts と同形）。
// @tags: SPEC, SWMR, WATCHDOG

/** ツール返却の共通形: pi は { content: [{type:"text",...}], details } を期待する */
function toolResult(data: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
		details: (data && typeof data === "object" ? data : { value: data }) as Record<string, unknown>,
	};
}

export default function subagentWatchdogExtension(pi: ExtensionAPI) {
	// 1. subagent_ps: サブエージェント一覧と健全性診断
	pi.registerTool({
		name: "subagent_ps",
		label: "Subagent PS",
		description: "実行中・登録済みのサブエージェント一覧、稼働時間、ターン数、健全性、異常兆候アラートを取得する（read-only）。",
		parameters: Type.Object({
			onlyAnomalies: Type.Optional(Type.Boolean({ description: "異常が検知されたエージェントのみに絞り込むか (既定: false)" })),
		}),
		async execute(_toolCallId, params) {
			const diagnostics = globalWatchdog.diagnoseAll();

			const results = diagnostics
				.filter((d: any) => !params.onlyAnomalies || !d.healthy)
				.map((d: any) => {
					const agent = globalWatchdog.get(d.id);
					return {
						id: d.id,
						pid: agent?.pid,
						agent: agent?.agent,
						task: agent?.task,
						status: agent?.status,
						elapsedSec: Math.round(d.elapsedMs / 1000),
						silentSec: Math.round(d.silentMs / 1000),
						turns: d.turns,
						healthy: d.healthy,
						anomalies: d.anomalies,
						suggestions: d.suggestions,
					};
				});

			const hasAnomalies = results.some((r: any) => !r.healthy);
			const alertSummary = results
				.filter((r: any) => !r.healthy)
				.map((r: any) => globalWatchdog.formatAlert(r))
				.join("\n\n");

			return toolResult({
				total: results.length,
				anomaliesDetected: hasAnomalies,
				summary: alertSummary || "全エージェント正常稼働中",
				agents: results,
			});
		},
	});

	// 2. subagent_inspect: 直近ログと状態の安全な点検
	pi.registerTool({
		name: "subagent_inspect",
		label: "Subagent Inspect",
		description: "指定サブエージェントの直近ログ、ツール呼び出し履歴、中間報告、現在状態を read-only で点検する。",
		parameters: Type.Object({
			id: Type.String({ description: "対象サブエージェントのID" }),
			tail: Type.Optional(Type.Number({ description: "取得する直近ログ件数 (既定: 20)" })),
		}),
		async execute(_toolCallId, params) {
			try {
				return toolResult(globalWatchdog.inspect(params.id, { tail: params.tail }));
			} catch (err: any) {
				return toolResult({ error: err.message });
			}
		},
	});

	// 3. subagent_pause: 一時凍結 (SIGSTOP)
	pi.registerTool({
		name: "subagent_pause",
		label: "Subagent Pause",
		description: "暴走または長時間無反応のサブエージェントプロセスを一時停止（SIGSTOP）し凍結する。",
		parameters: Type.Object({
			id: Type.String({ description: "対象サブエージェントのID" }),
		}),
		async execute(_toolCallId, params) {
			try {
				return toolResult(globalWatchdog.pause(params.id));
			} catch (err: any) {
				return toolResult({ error: err.message });
			}
		},
	});

	// 4. subagent_resume: 再開 (SIGCONT) + 是正指示注入
	pi.registerTool({
		name: "subagent_resume",
		label: "Subagent Resume",
		description: "一時停止中のサブエージェントを再開（SIGCONT）する。必要に応じて是正指示（ヒント）を注入可能。",
		parameters: Type.Object({
			id: Type.String({ description: "対象サブエージェントのID" }),
			steerPrompt: Type.Optional(Type.String({ description: "サブエージェントに与える追加の是正指示・ヒント" })),
		}),
		async execute(_toolCallId, params) {
			try {
				return toolResult(globalWatchdog.resume(params.id, { steerPrompt: params.steerPrompt }));
			} catch (err: any) {
				return toolResult({ error: err.message });
			}
		},
	});

	// 5. subagent_report: 中間報告の記録
	pi.registerTool({
		name: "subagent_report",
		label: "Subagent Report",
		description: "サブエージェントから提出された中間報告（仮説・完了作業・障害・残り手数）を記録・構造化する。",
		parameters: Type.Object({
			id: Type.String({ description: "対象サブエージェントのID" }),
			report: Type.String({ description: "中間報告テキストまたは要約" }),
		}),
		async execute(_toolCallId, params) {
			try {
				return toolResult({ success: true, parsed: globalWatchdog.recordInterimReport(params.id, params.report) });
			} catch (err: any) {
				return toolResult({ error: err.message });
			}
		},
	});

	// 6. subagent_abort: 強制終了
	pi.registerTool({
		name: "subagent_abort",
		label: "Subagent Abort",
		description: "迷走したサブエージェントを強制終了（SIGTERM/SIGKILL）する。",
		parameters: Type.Object({
			id: Type.String({ description: "対象サブエージェントのID" }),
		}),
		async execute(_toolCallId, params) {
			try {
				return toolResult(globalWatchdog.abort(params.id));
			} catch (err: any) {
				return toolResult({ error: err.message });
			}
		},
	});
}
