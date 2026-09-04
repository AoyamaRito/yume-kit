// @why: 長時間自走するサブエージェントのブラックボックス化・暴走・トークン浪費を防ぐため、実行状態の監視（Watchdog）、異常示唆（Hint）、一時停止（SIGSTOP）、直近ログ検査（Inspect）、中間報告（Interim Report）、軌道修正/再開（SIGCONT/Resume）を統合した介入プロトコルを提供する。
// @tags: SPEC, SWMR, WATCHDOG

import { EventEmitter } from "node:events";

/**
 * サブエージェントの監視・介入・健全性診断クラス
 */
export class SubagentWatchdog extends EventEmitter {
	/**
	 * @param {object} [options]
	 * @param {number} [options.silentTimeoutMs=120000] 無反応検知閾値 (ms)
	 * @param {number} [options.maxTurns=15] ターン数肥大閾値
	 * @param {number} [options.maxToolChurn=3] 同一ツール空回り閾値
	 * @param {number} [options.maxConsecutiveErrors=3] 連続エラー閾値
	 */
	constructor(options = {}) {
		super();
		this.silentTimeoutMs = options.silentTimeoutMs ?? 120000;
		this.maxTurns = options.maxTurns ?? 15;
		this.maxToolChurn = options.maxToolChurn ?? 3;
		this.maxConsecutiveErrors = options.maxConsecutiveErrors ?? 3;

		/** @type {Map<string, SubagentEntry>} */
		this.agents = new Map();
	}

	/**
	 * サブエージェントを登録
	 * @param {object} params
	 * @param {string} params.id 一意識別子
	 * @param {number} [params.pid] プロセスID
	 * @param {string} params.agent エージェント種別 (e.g. "inspect", "research", "dev")
	 * @param {string} params.task 担当タスク内容
	 * @param {import("node:child_process").ChildProcess} [params.process] 子プロセスインスタンス
	 */
	register({ id, pid, agent, task, process: proc }) {
		const now = Date.now();
		const entry = {
			id,
			pid: pid ?? proc?.pid,
			agent,
			task,
			process: proc,
			startTime: now,
			lastActivityTime: now,
			status: "running", // 'running' | 'paused' | 'aborted' | 'completed'
			turns: 0,
			toolCalls: [],
			logs: [],
			consecutiveErrors: 0,
			steerHistory: [],
			interimReports: [],
		};

		this.agents.set(id, entry);
		this.emit("registered", entry);
		return entry;
	}

	/**
	 * サブエージェントの登録解除
	 * @param {string} id
	 */
	unregister(id) {
		const entry = this.agents.get(id);
		if (entry) {
			this.agents.delete(id);
			this.emit("unregistered", entry);
			return true;
		}
		return false;
	}

	/**
	 * エントリ取得
	 * @param {string} id
	 */
	get(id) {
		return this.agents.get(id);
	}

	/**
	 * 全エントリ一覧
	 */
	list() {
		return Array.from(this.agents.values());
	}

	/**
	 * アクティビティ・イベントを記録
	 * @param {string} id
	 * @param {object} event
	 * @param {'turn' | 'tool_call' | 'tool_result' | 'log' | 'error' | 'message'} event.type
	 * @param {any} [event.data]
	 */
	recordActivity(id, event) {
		const entry = this.agents.get(id);
		if (!entry) return;

		const now = Date.now();
		entry.lastActivityTime = now;

		switch (event.type) {
			case "turn":
				entry.turns++;
				break;
			case "tool_call": {
				const callData = {
					name: event.data?.name || "unknown",
					args: event.data?.args || {},
					timestamp: now,
				};
				entry.toolCalls.push(callData);
				// ログにも保持
				entry.logs.push({
					type: "tool_call",
					text: `Tool: ${callData.name}(${JSON.stringify(callData.args)})`,
					timestamp: now,
				});
				break;
			}
			case "tool_result": {
				const isError = Boolean(event.data?.error || event.data?.isError);
				if (isError) {
					entry.consecutiveErrors++;
				} else {
					entry.consecutiveErrors = 0;
				}
				entry.logs.push({
					type: "tool_result",
					text: event.data?.output ? String(event.data.output).slice(0, 500) : (event.data?.error || "ok"),
					isError,
					timestamp: now,
				});
				break;
			}
			case "error": {
				entry.consecutiveErrors++;
				entry.logs.push({
					type: "error",
					text: String(event.data || "Unknown error"),
					timestamp: now,
				});
				break;
			}
			case "log":
			case "message": {
				entry.logs.push({
					type: event.type,
					text: String(event.data || ""),
					timestamp: now,
				});
				break;
			}
		}

		// 異常の自動診断と通知
		const diagnosis = this.diagnoseAgent(entry, now);
		if (diagnosis.anomalies.length > 0) {
			this.emit("anomaly", { entry, diagnosis });
		}
	}

	/**
	 * 単一エージェントの健全性・異常兆候を診断
	 * @param {SubagentEntry} entry
	 * @param {number} [now=Date.now()]
	 */
	diagnoseAgent(entry, now = Date.now()) {
		if (entry.status !== "running") {
			return { id: entry.id, healthy: true, anomalies: [], suggestions: [] };
		}

		const anomalies = [];
		const suggestions = [];

		const silentMs = now - entry.lastActivityTime;
		const elapsedMs = now - entry.startTime;

		// 1. 沈黙検知 (Silent Timeout)
		if (silentMs >= this.silentTimeoutMs) {
			anomalies.push({
				type: "SILENT_TIMEOUT",
				message: `直近 ${Math.round(silentMs / 1000)}秒間、応答・アクティビティが途絶えています (閾値: ${this.silentTimeoutMs / 1000}s)`,
				silentMs,
			});
			suggestions.push("一時停止 (`pause`) して `inspect` または中間報告 (`report`) を要求してください。");
		}

		// 2. ターン数肥大 (Turn Bloat)
		if (entry.turns >= this.maxTurns) {
			anomalies.push({
				type: "TURN_BLOAT",
				message: `ターン数が ${entry.turns} に達しました (閾値: ${this.maxTurns} turns)`,
				turns: entry.turns,
			});
			suggestions.push("目的を見失っている可能性があります。中間報告を要求し、軌道修正または終了を判断してください。");
		}

		// 3. 同一ツールの空回り (Tool Churn)
		if (entry.toolCalls.length >= this.maxToolChurn) {
			const recentCalls = entry.toolCalls.slice(-this.maxToolChurn);
			const first = recentCalls[0];
			const isSame = recentCalls.every(
				(c) => c.name === first.name && JSON.stringify(c.args) === JSON.stringify(first.args)
			);
			if (isSame) {
				anomalies.push({
					type: "TOOL_CHURN",
					message: `同一ツール [${first.name}] が全く同じ引数で ${this.maxToolChurn} 回連続実行されています`,
					tool: first.name,
				});
				suggestions.push("ツール実行が堂々巡りしています。一時停止して指示（ヒント）を与えて再開 (`resume`) してください。");
			}
		}

		// 4. 連続エラー (Consecutive Errors)
		if (entry.consecutiveErrors >= this.maxConsecutiveErrors) {
			anomalies.push({
				type: "CONSECUTIVE_ERRORS",
				message: `ツール実行エラーが ${entry.consecutiveErrors} 回連続して発生しています`,
				consecutiveErrors: entry.consecutiveErrors,
			});
			suggestions.push("エラーから自己復帰できていません。直近ログを確認し、前提条件を正してください。");
		}

		return {
			id: entry.id,
			healthy: anomalies.length === 0,
			elapsedMs,
			silentMs,
			turns: entry.turns,
			anomalies,
			suggestions,
		};
	}

	/**
	 * 全エージェントの診断を実行し、異常がある候補一覧を返す
	 */
	diagnoseAll() {
		const now = Date.now();
		const results = [];
		for (const entry of this.agents.values()) {
			const diag = this.diagnoseAgent(entry, now);
			results.push(diag);
		}
		return results;
	}

	/**
	 * サブエージェントを一時停止 (SIGSTOP)
	 * @param {string} id
	 */
	pause(id) {
		const entry = this.agents.get(id);
		if (!entry) throw new Error(`Agent not found: ${id}`);
		if (entry.status === "paused") return { success: true, message: "Already paused", entry };

		if (entry.pid) {
			try {
				process.kill(entry.pid, "SIGSTOP");
			} catch (err) {
				// プロセスが存在しないなどの例外
				throw new Error(`Failed to send SIGSTOP to pid ${entry.pid}: ${err.message}`);
			}
		}

		entry.status = "paused";
		entry.logs.push({
			type: "control",
			text: `[Watchdog] Process paused (SIGSTOP) at ${new Date().toISOString()}`,
			timestamp: Date.now(),
		});

		this.emit("paused", entry);
		return { success: true, message: `Subagent ${id} (PID ${entry.pid}) paused`, entry };
	}

	/**
	 * サブエージェントを再開 (SIGCONT)
	 * @param {string} id
	 * @param {object} [options]
	 * @param {string} [options.steerPrompt] 追加の是正指示やヒント
	 */
	resume(id, options = {}) {
		const entry = this.agents.get(id);
		if (!entry) throw new Error(`Agent not found: ${id}`);
		if (entry.status !== "paused") {
			return { success: true, message: "Agent was not paused", entry };
		}

		if (options.steerPrompt) {
			entry.steerHistory.push({
				timestamp: Date.now(),
				prompt: options.steerPrompt,
			});
			entry.logs.push({
				type: "steer",
				text: `[Watchdog] Injected guidance: ${options.steerPrompt}`,
				timestamp: Date.now(),
			});
		}

		if (entry.pid) {
			try {
				process.kill(entry.pid, "SIGCONT");
			} catch (err) {
				throw new Error(`Failed to send SIGCONT to pid ${entry.pid}: ${err.message}`);
			}
		}

		entry.status = "running";
		entry.lastActivityTime = Date.now();
		// エラーカウントや空回りをリセット
		entry.consecutiveErrors = 0;

		entry.logs.push({
			type: "control",
			text: `[Watchdog] Process resumed (SIGCONT) at ${new Date().toISOString()}`,
			timestamp: Date.now(),
		});

		this.emit("resumed", entry);
		return { success: true, message: `Subagent ${id} (PID ${entry.pid}) resumed`, entry };
	}

	/**
	 * サブエージェントの直近ログ・状態を検査 (Inspect)
	 * @param {string} id
	 * @param {object} [options]
	 * @param {number} [options.tail=20] 取得ログ件数
	 */
	inspect(id, options = {}) {
		const entry = this.agents.get(id);
		if (!entry) throw new Error(`Agent not found: ${id}`);

		const tail = options.tail ?? 20;
		const recentLogs = entry.logs.slice(-tail);
		const recentTools = entry.toolCalls.slice(-tail);
		const diagnosis = this.diagnoseAgent(entry);

		return {
			id: entry.id,
			pid: entry.pid,
			agent: entry.agent,
			task: entry.task,
			status: entry.status,
			startTime: new Date(entry.startTime).toISOString(),
			elapsedSec: Math.round((Date.now() - entry.startTime) / 1000),
			silentSec: Math.round((Date.now() - entry.lastActivityTime) / 1000),
			turns: entry.turns,
			totalLogs: entry.logs.length,
			recentLogs,
			recentTools,
			diagnosis,
			latestReport: entry.interimReports.slice(-1)[0] || null,
			steerHistory: entry.steerHistory,
		};
	}

	/**
	 * 中間報告（Interim Report）をパースして記録
	 * @param {string} id
	 * @param {string | object} reportTextOrObj
	 */
	recordInterimReport(id, reportTextOrObj) {
		const entry = this.agents.get(id);
		if (!entry) throw new Error(`Agent not found: ${id}`);

		let parsed;
		if (typeof reportTextOrObj === "string") {
			parsed = parseInterimReportText(reportTextOrObj);
		} else {
			parsed = {
				timestamp: Date.now(),
				hypothesis: reportTextOrObj.hypothesis || "不明",
				done: Array.isArray(reportTextOrObj.done) ? reportTextOrObj.done : [],
				blockers: Array.isArray(reportTextOrObj.blockers) ? reportTextOrObj.blockers : [],
				remainingSteps: Number(reportTextOrObj.remainingSteps) || 0,
				rawText: JSON.stringify(reportTextOrObj),
			};
		}

		entry.interimReports.push(parsed);
		entry.logs.push({
			type: "interim_report",
			text: `[Interim Report] 仮説: ${parsed.hypothesis} / 障害: ${parsed.blockers.join(", ") || "なし"}`,
			timestamp: Date.now(),
		});

		this.emit("report", { entry, report: parsed });
		return parsed;
	}

	/**
	 * サブエージェントを強制終了 (Abort)
	 * @param {string} id
	 * @param {string} [signal='SIGTERM']
	 */
	abort(id, signal = "SIGTERM") {
		const entry = this.agents.get(id);
		if (!entry) throw new Error(`Agent not found: ${id}`);

		if (entry.pid) {
			try {
				process.kill(entry.pid, signal);
			} catch (err) {
				// 既に終了している場合は無視
			}
		}

		entry.status = "aborted";
		entry.logs.push({
			type: "control",
			text: `[Watchdog] Process aborted with ${signal} at ${new Date().toISOString()}`,
			timestamp: Date.now(),
		});

		this.emit("aborted", entry);
		return { success: true, message: `Subagent ${id} aborted`, entry };
	}

	/**
	 * AI/人間向けの示唆アラートテキストを整形
	 * @param {object} diagnosis
	 */
	formatAlert(diagnosis) {
		if (diagnosis.healthy) return "全サブエージェントは正常に稼働しています。";

		const lines = [
			`⚠️ 【Watchdog 警告】サブエージェント [${diagnosis.id}] に異常兆候が検知されました:`,
			`  - 経過時間: ${Math.round(diagnosis.elapsedMs / 1000)}s / 無反応時間: ${Math.round(diagnosis.silentMs / 1000)}s / ターン数: ${diagnosis.turns}`,
			"  - 異常内容:",
		];

		for (const a of diagnosis.anomalies) {
			lines.push(`    * [${a.type}] ${a.message}`);
		}

		lines.push("  - 推奨アクション:");
		for (const s of diagnosis.suggestions) {
			lines.push(`    👉 ${s}`);
		}

		return lines.join("\n");
	}
}

/**
 * 中間報告の自然言語テキストをパースするヘルパー
 * @param {string} text
 */
export function parseInterimReportText(text) {
	const result = {
		timestamp: Date.now(),
		hypothesis: "",
		done: [],
		blockers: [],
		remainingSteps: 0,
		rawText: text,
	};

	const lines = text.split("\n");
	let currentSection = "";

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		if (/仮説|何を解決|方針/i.test(trimmed)) {
			currentSection = "hypothesis";
			const match = trimmed.replace(/^[#*-:\s【】]+(仮説|何を解決しようとしているか|方針)[:：\s]*/i, "");
			if (match) result.hypothesis = match;
			continue;
		}
		if (/完了|進捗|変更したファイル/i.test(trimmed)) {
			currentSection = "done";
			continue;
		}
		if (/障害|詰まって|ブロック|課題|エラー/i.test(trimmed)) {
			currentSection = "blockers";
			continue;
		}
		if (/残り|予定|ステップ/i.test(trimmed)) {
			currentSection = "remainingSteps";
			const numMatch = trimmed.match(/\d+/);
			if (numMatch) result.remainingSteps = parseInt(numMatch[0], 10);
			continue;
		}

		if (trimmed.startsWith("-") || trimmed.startsWith("*")) {
			const item = trimmed.replace(/^[-*\s]+/, "");
			if (currentSection === "done") result.done.push(item);
			else if (currentSection === "blockers") result.blockers.push(item);
			else if (currentSection === "hypothesis" && !result.hypothesis) result.hypothesis = item;
		} else if (currentSection === "hypothesis" && !result.hypothesis) {
			result.hypothesis = trimmed;
		}
	}

	if (!result.hypothesis) result.hypothesis = text.slice(0, 100);
	return result;
}

// デフォルトのシングルトンインスタンス
export const globalWatchdog = new SubagentWatchdog();
