/**
 * yume-spec — 履歴に内蔵された「仕様の why」を一気に俯瞰する（yume-min / ai-desk 規約由来）
 *
 * 思想: これはヒントであり、矯正ではない。矯正はLLMを「従う機械」にし、思考と創造を殺す。
 * ヒントは気づきだけを渡し、あなたの判断と創造を信じる。だから本ツールは全部 read-only で、
 * テストを止めたりブロックしたりしない。
 *
 * 習慣（ai-desk BIBLE:126「履歴は本体」/ :157「SPEEC を versions に埋め込み spec・impl 交互」）:
 *   AI はコードを編集するとき、その変更の仕様上の由来(why)を「コメント行」として内蔵すると、
 *   未来のどのAIも「ファイルを開くだけで」仕様の変遷を成層状に読める（忘れても壊れない。ヒントだから）:
 *       // @why: 認証をトークン式に変更(ログイン失敗の再発防止)
 *       // @tags: SPEC
 *   Scrap & Build しても why コメントは消さない(Delete What, Keep Why)。
 *
 * このツールは、その in-band な spec/why マーカーをファイル順・出現順に
 * 一気に返す =「仕様の変遷の俯瞰」。
 * read-only。既存ツール(git/read/bash)に何も足さず、上の習慣だけを実体化する。
 *
 * Install:
 *   - pi パッケージ: pi install ./yume-spec
 *   - グローバルリンク: ln -s /path/to/yume-spec/extensions/yume-spec.ts ~/.pi/agent/extensions/
 *   - 単一ファイルコピー: cp extensions/yume-spec.ts ~/.pi/agent/extensions/
 *   - 有効化: pi で /reload
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

// ---- git と同期した版履歴（並列ジャーナルは持たない）----
function git(args: string[], cwd: string): string | null {
	try {
		return execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			maxBuffer: 16 * 1024 * 1024,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return null;
	}
}

// ---- 内蔵 reason マーカー（コメント行に書く）----
// @why: 文字列リテラルや説明文内の「@why」誤検知を防ぐため、コメント接頭辞（//, *, #, <!--, --）直後のマーカーのみを対象にする
// @tags: SPEC
const COMMENT_LINE_RE = /^\s*(?:\/\/|\*|#|<!--|--)\s*@(why|spec|tags|targets?)\b/i;
const REASON_RE = /@(?:why|spec)\s*:\s*(.+)$/i;
const SPEC_TAG_RE = /@tags\s*:\s*([^\s,，]+)/i;
const TARGET_TAG_RE = /@targets?\s*:\s*([^\s,，]+)/i;

// yume エンブレム境界（所属 BLOCK id の追跡に使用）
const EMBLEM_OPEN_RE = /^\s*(?:\/\/|#|\*)\s*(?:>>>\s+)?BLOCK\s+(\S+)/;
const EMBLEM_CLOSE_RE = /^\s*(?:\/\/|#|\*)\s*<<<\s*\/?BLOCK/;

const EXT_SCAN = new Set([".js", ".ts", ".mjs", ".cjs", ".jsx", ".tsx", ".md", ".py", ".go", ".rs", ".rb", ".html", ".yume.js"]);

/**
 * 構文シグネチャから現在のスコープ名を自動判定する正規表現群
 */
const SCOPE_PATTERNS = [
	/^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([a-zA-Z0-9_$]+)\s*\(/,
	/^\s*(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/,
	/^\s*(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?function/,
	/^\s*(?:export\s+)?class\s+([a-zA-Z0-9_$]+)/,
	/^\s*(?:(?:public|private|protected|static|async)\s+)*([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/,
	/^\s*(?:test|describe|it)\s*\(\s*['"`]([^'"`]+)['"`]/,
	/^\s*<([a-zA-Z0-9_-]+)(?:\s+[^>]*?(?:id=['"]([^'"]+)['"]|class=['"]([^'"]+)['"]))?[^>]*>/,
	/^\s*([.#]?[a-zA-Z0-9_:-]+(?:\s*,\s*[.#]?[a-zA-Z0-9_:-]+)*)\s*\{/,
];

function extractScopeName(line: string): string | null {
	const trimmed = line.trim();
	if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("<!--")) return null;

	let m = trimmed.match(SCOPE_PATTERNS[0]);
	if (m) return `${m[1]}()`;
	m = trimmed.match(SCOPE_PATTERNS[1]);
	if (m) return `${m[1]}()`;
	m = trimmed.match(SCOPE_PATTERNS[2]);
	if (m) return `${m[1]}()`;
	m = trimmed.match(SCOPE_PATTERNS[3]);
	if (m) return `class ${m[1]}`;
	m = trimmed.match(SCOPE_PATTERNS[5]);
	if (m) return `test("${m[1]}")`;
	m = trimmed.match(SCOPE_PATTERNS[4]);
	if (m && !["if", "for", "while", "switch", "catch"].includes(m[1])) return `${m[1]}()`;
	m = trimmed.match(SCOPE_PATTERNS[6]);
	if (m) {
		const tag = m[1];
		const id = m[2];
		const cls = m[3] ? m[3].split(" ")[0] : null;
		if (id) return `<${tag}#${id}>`;
		if (cls) return `<${tag}.${cls}>`;
		return `<${tag}>`;
	}
	m = trimmed.match(SCOPE_PATTERNS[7]);
	if (m && !trimmed.startsWith("@")) return m[1].trim();

	return null;
}

export interface Hit {
	file: string;
	line: number;
	block: string | null;
	tags: string;
	reason: string | null;
	raw: string;
}

export function scanFile(absFile: string, relFile: string, hits: Hit[]): void {
	let text: string;
	try {
		text = fs.readFileSync(absFile, "utf8");
	} catch {
		return;
	}
	const lines = text.split("\n");
	let block: string | null = null;
	const scopeStack: Array<{ name: string; line: number }> = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const mOpen = line.match(EMBLEM_OPEN_RE);
		const mClose = line.match(EMBLEM_CLOSE_RE);
		if (mOpen) block = mOpen[1];
		else if (mClose) block = null;

		const detectedScope = extractScopeName(line);
		if (detectedScope) {
			scopeStack.push({ name: detectedScope, line: i + 1 });
			if (scopeStack.length > 3) scopeStack.shift();
		}

		const trimmed = line.trim();
		if (!COMMENT_LINE_RE.test(trimmed)) continue;

		const targetMatch = line.match(TARGET_TAG_RE);
		const explicitTarget = targetMatch ? targetMatch[1] : null;

		const reason = line.match(REASON_RE)?.[1].replace(/-->\s*$/, "").trim() ?? null;
		const tag = line.match(SPEC_TAG_RE)?.[1].replace(/-->\s*$/, "").trim() ?? null;
		if (!reason && !tag && !explicitTarget) continue;

		let target = explicitTarget || block;
		if (!target && scopeStack.length > 0) {
			const currentScope = scopeStack[scopeStack.length - 1].name;
			target = `${relFile}#${currentScope}`;
		}

		hits.push({
			file: relFile,
			line: i + 1,
			block: target,
			tags: tag ?? "",
			reason,
			raw: trimmed.slice(0, 200),
		});
	}
}

function walkDir(absDir: string, relBase: string, hits: Hit[]): void {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(absDir, { withFileTypes: true });
	} catch {
		return;
	}
	entries.sort((a, b) => a.name.localeCompare(b.name));
	for (const e of entries) {
		if (e.name === "node_modules" || e.name === ".git" || e.name === ".yume" || e.name.startsWith(".")) continue;
		const abs = path.join(absDir, e.name);
		const rel = path.join(relBase, e.name);
		if (e.isDirectory()) walkDir(abs, rel, hits);
		else if (EXT_SCAN.has(path.extname(e.name)) || e.name.endsWith(".yume.js")) scanFile(abs, rel, hits);
	}
}

function render(hits: Hit[], showRaw: boolean): string {
	if (hits.length === 0) {
		return "（仕様/why マーカーが見つかりません。編集時は `// @why: <理由>` か `// @tags: SPEC` をコメントで内蔵してください）";
	}
	const out = hits.map((h) => {
		const where = h.block ? `[target:${h.block}]` : "";
		const tag = h.tags ? `@tags:${h.tags} ` : "";
		const reason = h.reason ? `@why: ${h.reason}` : "";
		const raw = showRaw && h.reason === null ? `\n        ↳ ${h.raw}` : "";
		return `${h.file}:${h.line}  ${where} ${tag}${reason}${raw}`;
	});
	return out.join("\n");
}

function specLinesFrom(text: string): string[] {
	const out: string[] = [];
	for (const l of text.split("\n")) {
		const t = l.trim();
		if (COMMENT_LINE_RE.test(t)) out.push("    " + t.slice(0, 160));
	}
	return out.slice(0, 8);
}

// @why: 決定論的 Presence 指摘のインライン実装（@why欠落を列挙する。ブロックしない）
// @tags: SPEC
function checkWhyPresenceInline(cwd: string, scope?: string) {
	const pathspec = scope ? ["--", scope] : [];
	let diff = git(["diff", "HEAD", ...pathspec], cwd);
	if (diff == null || diff === "") {
		diff = (git(["diff", "--cached", ...pathspec], cwd) || "") || (git(["diff", ...pathspec], cwd) || "");
	}
	if (!diff || !diff.trim()) {
		return { pass: true, totalFiles: 0, violations: [], note: "検査対象の差分がありません（クリーン）" };
	}

	const lines = diff.split("\n");
	const files: Array<{ file: string; addedLines: string[] }> = [];
	let currentFile: { file: string; addedLines: string[] } | null = null;

	for (const line of lines) {
		if (line.startsWith("diff --git ")) {
			const parts = line.split(" ");
			const bPath = parts[parts.length - 1] || "";
			const cleanPath = bPath.replace(/^[ab]\//, "");
			currentFile = { file: cleanPath, addedLines: [] };
			files.push(currentFile);
		} else if (line.startsWith("+") && !line.startsWith("+++")) {
			if (currentFile) currentFile.addedLines.push(line.slice(1));
		}
	}

	const violations: Array<{ file: string; message: string }> = [];
	for (const f of files) {
		const ext = path.extname(f.file);
		if (!EXT_SCAN.has(ext) && !f.file.endsWith(".yume.js")) continue;

		let addedCodeLines = 0;
		let whyLinesAdded = 0;
		for (const line of f.addedLines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			if (COMMENT_LINE_RE.test(trimmed) && REASON_RE.test(trimmed)) {
				whyLinesAdded++;
			} else {
				addedCodeLines++;
			}
		}

		if (addedCodeLines > 0 && whyLinesAdded === 0) {
			violations.push({
				file: f.file,
				message: `コード変更が ${addedCodeLines} 行あるのに、仕様の由来を示す // @why: コメントが追加されていません`,
			});
		}
	}

	return { pass: violations.length === 0, totalFiles: files.length, violations };
}

// ---- 自動認知：yume系プロジェクトで、規約を毎ターンシステムプロンプトに注入する ----
// @why: yume-min 履歴規約に加え、snowball E2E検証(Evidence over Claims)と UI健全性(yui)の「ヒント」を自動注入に追加。
// @why: v1.4: 不必要な強制をしない。presenceは「@why忘れの指摘」であり、テストを止めるものではない。
// @tags: SPEC
// @why: AGENTS.md がすでに規約本文を載せる場合は、その見出しを検知して二重注入を止め、同一指示による毎ターンのトークン浪費を防ぐ。
// @tags: SPEC
const RULE_HEAD = "[yume-min history & verification rule / 規約]";
const RULE = [
	"[yume-min history & verification rule / 規約]",
	"思想: これはヒントであり矯正ではない。規約の正本は AGENTS.md（同一見出し）に置き、拡張側は重複注入しない（RULE_HEAD検知）。",
	"1. [why-in-band hint] コード編集時は変更の仕様上の由来を // @why: コメントで内蔵し、Scrap & Build でも消さない（Delete What, Keep Why）。",
	"2. [snowball & Evidence] 機能変更時は e2e.mjs / test.js に末尾追記し通し全 PASS を目指す（実測ログを根拠に）。",
	"3. [tools: read-only] 俯瞰=yspec [path]／指摘=yspec presence=true／UI健全=yui [path]",
	"[/yume-min 規約]",
].join("\n");
const YUME_SENTINEL = "yume-min 履歴規約";
let sentinelCache: { cwd: string; hit: boolean } | null = null;

function isYumeProject(cwd: string): boolean {
	if (sentinelCache && sentinelCache.cwd === cwd) return sentinelCache.hit;
	let hit = false;
	let dir = cwd;
	const seen = new Set<string>();
	for (let i = 0; i < 8; i++) {
		if (seen.has(dir) || !dir) break;
		seen.add(dir);
		for (const marker of [path.join(dir, ".pi", "yume-min"), path.join(dir, ".yume-min")]) {
			try { if (fs.statSync(marker).isFile()) { hit = true; break; } } catch {}
		}
		if (!hit) {
			try {
				const s = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
				if (s.includes(YUME_SENTINEL)) hit = true;
			} catch {}
		}
		if (hit) break;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	sentinelCache = { cwd, hit };
	return hit;
}

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event, ctx) => {
		if (!isYumeProject(ctx.cwd)) return;
		// @why: AGENTS.md 由来で規約本文が組み立て済みなら、拡張が同じ本文を追記しない。
		// @tags: SPEC
		if (event.systemPrompt.includes(RULE_HEAD)) return;
		return { systemPrompt: event.systemPrompt + "\n\n" + RULE };
	});

	pi.registerTool({
		name: "yspec",
		label: "Yume Spec overview & presence hint",
		description:
			"yume-min -- ソースに内蔵された仕様のwhy（`// @why:` / `// @tags: SPEC` / `// @targets:`）をファイル順・出現順に一気に返す。`presence: true` でコード変更に対する @why 欠落を指摘レポートする（ブロックしない。ヒント）。",
		parameters: Type.Object({
			path: Type.Optional(
				Type.String({
					description: "対象のファイル or ディレクトリ（省略時は作業ディレクトリ全体）。例: tatetate_v300/core.js",
				})
			),
			showRaw: Type.Optional(
				Type.Boolean({ description: "理由行でない @tags 付き行の生行も見せる（既定 false）" })
			),
			presence: Type.Optional(
				Type.Boolean({
					description: "【ヒント】コード変更があるのに @why コメントが追加されていないファイルを git diff から指摘レポートする（既定 false。ブロックはしない）",
				})
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = ctx.cwd;

			// 1. Presence チェック（ヒント：ブロックしない）
			if (params.presence) {
				// @why: ワークスペースが複数プロジェクトを擁しており、presence を無指定で叩くと全体の未コミット差分まで拾ってしまう。
				//       path 引数（例: yspec tenkai presence=true）で自分の変更分だけにスコープできる。無指定なら全体を見る。
				// @tags: SPEC
				const scope = params.path || undefined;
				const presResult = checkWhyPresenceInline(cwd, scope);
				const reportLines = [
					"====================================================",
					`🔍 SPEC PRESENCE CHECK (@why欠落の指摘レポート)`,
					`   対象: ${scope || "作業ディレクトリ全体"} ／ 変更ファイル: ${presResult.totalFiles}`,
					"====================================================",
				];

				if (presResult.violations.length === 0) {
					reportLines.push(presResult.note || "✨ @why欠落はありません。良い状態です。");
				} else {
					reportLines.push("\n💡 以下のファイルで @why が追加されていません（ヒント: 直すかは判断次第）:");
					presResult.violations.forEach((v, idx) => {
						reportLines.push(`\n${idx + 1}. [MISSING_WHY] ${v.file}`);
						reportLines.push(`   詳細: ${v.message}`);
					});
				}

				return {
					content: [{ type: "text", text: reportLines.join("\n") }],
					details: { violations: presResult.violations },
				};
			}

			const target = params.path ?? ".";
			const absTarget = path.isAbsolute(target) ? target : path.resolve(cwd, target);
			const hits: Hit[] = [];
			let stat: fs.Stats;
			try {
				stat = fs.statSync(absTarget);
			} catch {
				return {
					content: [{ type: "text", text: `エラー: パスが見つかりません — ${target}` }],
					details: {},
				};
			}

			if (stat.isFile()) {
				const rel = path.relative(cwd, absTarget);
				scanFile(absTarget, rel || target, hits);
			} else if (stat.isDirectory()) {
				walkDir(absTarget, path.relative(cwd, absTarget) || ".", hits);
			}

			const text = render(hits, params.showRaw ?? false);
			const n = hits.length;
			return {
				content: [{ type: "text", text: `spec/why マーカー ${n} 件（${stat.isDirectory() ? "ディレクトリ" : "ファイル"}）:\n\n${text}` }],
				details: { count: n },
			};
		},
	});

	// Web UI のロジカルグラフ・レイアウト崩れ・遮蔽検査（read-only）。
	pi.registerTool({
		name: "yui",
		label: "Yume UI Health & Graph inspector",
		description:
			"yume-min -- Web UI（HTMLファイルまたはURL）からロジカルグラフ（包含/スタック/遮蔽/A11y）を自動抽出し、はみ出し（overflow）・ボタン遮蔽（occlusion）・極小タップ領域・ゼロサイズ縮退などのレイアウト破綻を即時検出し合否判定する（read-only）。Web UIの作成・編集時に自律検証するために使う。",
		parameters: Type.Object({
			path: Type.String({ description: "対象のHTMLファイルパス（相対または絶対）またはURL。例: index.html または http://localhost:3000" }),
			mobile: Type.Optional(Type.Boolean({ description: "モバイル画面（390x844）でテストするか（既定 false: 1280x800）" })),
			format: Type.Optional(
				Type.String({
					description: "出力フォーマット: 'tree'（階層ツリー+異常マーク）, 'scan'（異常サマリーのみ）, 'mermaid'（グラフ図）, 'json'（完全データ）。既定: 'tree'",
				})
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = ctx.cwd;
			const target = params.path;
			const isMobile = params.mobile ?? false;
			const format = params.format ?? "tree";

			try {
				// 実体パスから ui/index.js を安全に探索して動的インポート
				let uiModule: any = null;
				const candPaths = [
					path.resolve(cwd, "yume-spec/ui/index.js"),
					path.resolve(cwd, "ui/index.js"),
					path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../ui/index.js"),
					path.resolve(fs.realpathSync(fileURLToPath(import.meta.url)), "../../ui/index.js"),
				];
				for (const cand of candPaths) {
					if (fs.existsSync(cand)) {
						uiModule = await import(`file://${cand}`);
						break;
					}
				}

				if (!uiModule) {
					return {
						content: [{ type: "text", text: "yui 実行エラー: yume-spec/ui/index.js が見つかりません。リポジトリ全体を保持するか npm/git 経由でインストールしてください。" }],
						details: { error: "MODULE_NOT_FOUND" },
					};
				}

				const { runUIGraph, renderTree, renderAnomalies, renderMermaid } = uiModule;
				const graph = await runUIGraph(target, { mobile: isMobile, cwd });

				let outText = "";
				if (format === "json") {
					outText = JSON.stringify(graph, null, 2);
				} else if (format === "mermaid") {
					outText = renderMermaid(graph);
				} else if (format === "scan") {
					outText = renderAnomalies(graph);
				} else {
					outText = renderTree(graph) + "\n\n" + renderAnomalies(graph);
				}

				return {
					content: [{ type: "text", text: outText }],
					details: {
						pass: graph.summary.pass,
						errors: graph.summary.errorCount,
						warnings: graph.summary.warnCount,
						nodes: graph.summary.totalNodes,
					},
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `yui 実行エラー: ${err.message}` }],
					details: { error: err.message },
				};
			}
		},
	});

}

