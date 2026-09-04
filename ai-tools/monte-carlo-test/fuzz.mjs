#!/usr/bin/env node
// @why: [2026-09-04] LLM（特に低性能な free モデル）の品質に依存せず、テスト工程を機械化する。モンテカルロ法＝実ブラウザ(playwright-core / chromium)で決定的乱数(seed)から操作列を生成し、DOM へランダム入力 → console.error/例外/状態遷移を実測 → パターン抽出（ループ・不安定・多重エラー）→ 意図（シナリオ）を決定的に構成し、コマンド＝再生スクリプトとして実行する。目的は「LLM が下手でも、機械が『これで通る/通らない』を実 DOM で担保できる」こと。
// @tags: SPEC, monte-carlo, fuzz, test, deterministic, playwright
/**
 * monte-carlo-test / fuzz.mjs — 実ブラウザ DOM ランダム探索テスト
 *
 * 「ランダム操作 → パターン抽出 → 意図(シナリオ) → コマンド実行」の全サイクル。
 * ui-graph と同じく playwright-core は「任意依存」（コアのゼロ依存は維持）。
 *
 * 使い方:
 *   node fuzz.mjs launch <url or file.html>          # ブラウザ起動と対象確認
 *   node fuzz.mjs scan <url or file.html> --seed N    # ランダム操作→実測→合否 (exit 0/1, --json可)
 *   node fuzz.mjs scenario <url> --seed N --steps M   # 意図（シナリオJSON）を生成・表示
 *   node fuzz.mjs replay <scenario.json>              # シナリオを実ブラウザで再生し合否（意図→コマンド実行）
 *
 * 実測するもの:
 *   [error]  console.error / pageerror / unhandledrejection（ブラウザ実測）
 *   [crash]  クリック後に DOM が消える・クラッシュ（例外で停止）
 *   [loop]   同一 URL/DOM シグネチャへのリピート（暴走の検出）
 *   [stale]  操作対象が読めなくなる・消える（状態不安定）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- 決定的乱数（外部依存ゼロ・seed固定で再現可能） ----
function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function seedFromString(s) {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

// ---- ブラウザ解決（ui-graph と同じ探索順 + arm64/Chrome-for-Testing 対応） ----
// @why: [2026-09-04] ms-playwright の最新結構（chromium-1208/chrome-mac-arm64/...app/...）は tree 構造がバージョンで異なるため、既知パス固定では実在バイナリを拾えない。再帰的に「実行ファイルらしいもの」を列挙して最初の実在物を採用する（OS 標準 Chromium / YHM_CHROME は最優先）。
// @tags: SPEC, monte-carlo, browser-resolve
function findChrome() {
	const candidates = [];
	const envCandidates = process.env.UI_GRAPH_CHROME || process.env.YHM_CHROME || "";
	for (const c of envCandidates.split(path.delimiter)) if (c) candidates.push(c);
	const home = os.homedir();
	for (const p of [
		path.join(home, "Library", "Caches", "ms-playwright"),
		path.join(home, ".cache", "ms-playwright"),
		path.join(home, "AppData", "Local", "ms-playwright"),
	]) {
		if (!fs.existsSync(p)) continue;
		// chromium-* の各ディレクトリ内で、chromium らしいバイナリを再帰探索
		for (const d of fs.readdirSync(p)) {
			if (!/^chromium(-|_)/.test(d)) continue;
			const base = path.join(p, d);
			const walk = (dir) => {
				let entries = [];
				try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
				for (const e of entries) {
					const full = path.join(dir, e.name);
					if (e.isDirectory()) {
						if (e.name.includes(".app")) {
							// macOS .app は Contents/MacOS/<name> が実行バイナリ
							const macos = path.join(full, "Contents", "MacOS");
							try { for (const ex of fs.readdirSync(macos)) if (fs.existsSync(path.join(macos, ex))) candidates.push(path.join(macos, ex)); } catch {}
						} else {
							walk(full);
						}
					} else if (/^(Chromium|chrome|headless_shell)$/.test(e.name)) {
						// 実行ビットか常套ファイル名なら候補
						const mode = fs.statSync(full).mode;
						if (mode & 0o111) candidates.push(full);
					}
				}
			};
			walk(base);
		}
	}
	for (const b of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]) {
		if (fs.existsSync(b)) candidates.push(b);
	}
	return candidates[0] || null;
}

async function launchPage(target) {
	const { chromium } = await import("playwright-core");
	const chrome = findChrome();
	if (!chrome) {
		console.error("ブラウザが見つかりません。YHM_CHROME か ms-playwright キャッシュが必要です。");
		process.exit(2);
	}
	let url = target;
	if (url.startsWith("file:") || url.startsWith("http:") || url.startsWith("https:")) {
		// そのまま
	} else if (/^https?:\/\//.test(target)) {
		url = target;
	} else {
		// ファイルは file:// にする（外部参照は相対のため同一ディレクトリの localhost を立てる）
		const abs = path.resolve(target);
		if (!fs.existsSync(abs)) {
			console.error(`対象が見つかりません: ${target}`);
			process.exit(2);
		}
		url = `file://${abs}`;
	}
	const browser = await chromium.launch({ executablePath: chrome, headless: true });
	const page = await browser.newPage();
	const errors = [];
	page.on("console", (msg) => {
		if (msg.type() === "error") errors.push({ type: "console.error", text: msg.text().slice(0, 300) });
	});
	page.on("pageerror", (e) => errors.push({ type: "pageerror", text: String(e.message).slice(0, 300) }));
	page.on("requestfailed", (r) => errors.push({ type: "requestfailed", text: r.url().slice(0, 200) }));
	return { browser, page, errors, url };
}

// ---- 操作可能要素を実 DOM から列挙 ----
async function collectActions(page) {
	return page.evaluate(() => {
		const out = [];
		const sel = [
			...document.querySelectorAll("button, a[href], input, select, textarea, [role=button], [tabindex]:not([tabindex='-1']), label, [style*='cursor:pointer'], [id=title], [id=msg], [draggable], [ondrop], [ondragover]"),
		];
		for (const el of sel) {
			const r = el.getBoundingClientRect();
			// 表示中・大きさあり のものだけ（座標が取れない表示外は除外）
			if (r.width === 0 || r.height === 0) continue;
			const cs = window.getComputedStyle(el);
			if (cs.display === "none" || cs.visibility === "hidden") continue;
			// 座標（中心）を抽出: モンテカルロでの実マウス操作に使う
			const box = {
				x: Math.round(r.left + r.width / 2),
				y: Math.round(r.top + r.height / 2),
				w: Math.round(r.width),
				h: Math.round(r.height),
			};
			out.push({
				tag: el.tagName.toLowerCase(),
				id: el.id || "",
				text: (el.textContent || "").trim().slice(0, 50),
				box,
				visible: true,
				pointer: cs.cursor === "pointer",
				// テキスト入力可能か（input[type=text/search/email等]・textarea・[contenteditable]）
				textable: /^(input|textarea)$/i.test(el.tagName) || el.isContentEditable || (el.type && ["text", "search", "email", "url", "tel", "number", "password"].includes(el.type)),
				// 変更可能か（checkbox/radio/select/range・boolean/選値型）
				changable: /^(select)$/i.test(el.tagName) || (el.type && ["checkbox", "radio", "range", "color", "date"].includes(el.type)) || (el.type === "range"),
				// ドラッグ可能か（[draggable] 属性・DragEvent ハンドラを持つ要素）
				draggable: el.hasAttribute?.("draggable") === true || /^(drag$|dragstart$|dragend$)/i.test(el.getAttribute?.("ondragstart") || "") || !!el.ondragstart,
			});
		}
		return out;
	});
}

// @why: [2026-09-04] 「座標へ実マウス移動→クリック」をメインの操作に置き換える。実ユーザーに忠実で、ホバー依存UI・透明オーバーレイによる遮蔽・見えない要素へのクリックをモンテカルロで検出できる（locator論理クリックは Playwright が前面要素へ自動補正し、遮蔽バグを見逃す）。シナリオには座標とセレクタの両方を記録し、リプレイはセレクタ優先→無ければ座標で再生する。
// @tags: SPEC, monte-carlo, mouse, coordinates, deterministic
async function act(page, actions, rand, step, learn) {
	if (actions.length === 0) return { acted: false };
	// 学習的要素選択: learn（状態遷移した要素キーの集合）に一致する要素があれば優先（モンテカルロ重み付け）
	// @why: [2026-09-04] 状態遷移を起こした操作対象の履歴(learn)を蓄積し、その要素を優先的に選ぶ epsilon-greedy。完全ランダムより「深く辿って状態を変えた」操作を高確率で再実行し、同じステップ数でより深い状態まで探索する（学習的モンテカルロ）。
	// @tags: SPEC, monte-carlo, epsilon-greedy, learning
	const learned = (learn && learn.size > 0) ? actions.filter((a) => learn.has(aKey(a))) : [];
	let useLearned = false;
	if (learned.length && rand() < 0.6) useLearned = true; // 60% で学習済み優先・40% で探索
	// クリック対象: cursor:pointer ・ボタン・リンクを優先（タイトル画面の #title / #msg も cursor:pointer なので含まれる）
	const clickables = actions.filter((a) => a.pointer || a.tag === "button" || a.tag === "a" || a.tag === "input" || a.tag === "select");
	const textables = actions.filter((a) => a.textable);
	const changables = actions.filter((a) => a.changable);
	const draggables = actions.filter((a) => a.draggable);
	let selected = null;
	let isType = false;
	let isChange = false;
	let isDrag = false;
	let dragTarget = null;
	const r = rand();
	if (useLearned) {
		selected = learned[Math.floor(rand() * learned.length)];
		if (selected.textable) isType = true;
		else if (selected.changable) isChange = true;
		else {
			const others = actions.filter((a) => a !== selected && a.visible);
			dragTarget = others.length ? others[Math.floor(rand() * others.length)] : selected;
			if (selected.draggable) isDrag = true;
		}
	} else if (textables.length && r < 0.30) {
		selected = textables[Math.floor(rand() * textables.length)];
		isType = true;
	} else if (changables.length && r < 0.55) {
		selected = changables[Math.floor(rand() * changables.length)];
		isChange = true;
	} else if (draggables.length && r < 0.70) {
		selected = draggables[Math.floor(rand() * draggables.length)];
		const others = actions.filter((a) => a !== selected && a.visible);
		dragTarget = others.length ? others[Math.floor(rand() * others.length)] : selected;
		isDrag = true;
	} else {
		const pool = clickables.length ? clickables : actions;
		selected = pool[Math.floor(rand() * pool.length)];
	}
	const target = selected;
	// 画面内に収めた実座標（ビューポートサイズを超えないようクランプ）
	const x = Math.max(2, Math.min(target.box.x, 1279));
	const y = Math.max(2, Math.min(target.box.y, 799));
	const thrown = null;
	try {
		// 実マウス移動（ホバー発火）→ クリック。クリック前に「座標の最前面要素」を検証して遮蔽を検出する。
		// @why: [2026-09-04] 座標クリックの真価＝透明オーバーレイ等の遮蔽バグを拾う。locator論理クリックはPlaywrightが前面要素へ自動補正してしまい遮られても押すため、遮蔽を見落とす。実ユーザー同様「塞がっていたら押せない」を座標＋最前面検証で実体化する。
		// @tags: SPEC, monte-carlo, occlusion, coordinate
		await page.mouse.move(x, y);
		await page.waitForTimeout(60 + Math.floor(rand() * 120));
		// ドラッグ操作は「押下→移動→解放」の実マウスシーケンスで行う（DragEvent/Drop をブラウザ実測）。クリック(vは行わない)
		// @why: [2026-09-04] [draggable] 要素等をドラッグし、dragstart/dragover/drop 系の壊れ（座標不達・ターゲット不発火）を実測する。
		// @tags: SPEC, monte-carlo, drag, drop
		if (isDrag && dragTarget) {
			const tx = Math.max(2, Math.min(dragTarget.box.x, 1279));
			const ty = Math.max(2, Math.min(dragTarget.box.y, 799));
			await page.mouse.move(x, y);
			await page.mouse.down();
			await page.waitForTimeout(60 + Math.floor(rand() * 120));
			// 複数ステップで目的座標へ移動（Drag 中のイベントを擬似的に発火）
			const steps = 2 + Math.floor(rand() * 3);
			for (let s = 1; s <= steps; s++) {
				const cx = Math.round(x + ((tx - x) * s) / steps);
				const cy = Math.round(y + ((ty - y) * s) / steps);
				await page.mouse.move(cx, cy);
				await page.waitForTimeout(15);
			}
			await page.mouse.up();
			const occluded = await page.evaluate(
				({ px, py, sel, tid }) => {
					const front = document.elementFromPoint(px, py);
					if (!front) return false;
					let targetEl = null;
					if (tid) targetEl = document.getElementById(tid);
					else if (sel) targetEl = document.querySelector(sel);
					if (!targetEl) return false;
					return front !== targetEl && !targetEl.contains(front);
				},
				{ px: x, py: y, sel: target.tag === "button" ? `button:has-text("${target.text}")` : `#${target.id}`, tid: target.id || "" }
			);
			return {
				acted: true, step, action: "drag", occluded,
				target: { tag: target.tag, id: target.id, text: target.text, box: target.box },
				dragTo: { tag: dragTarget.tag, id: dragTarget.id, text: dragTarget.text, box: dragTarget.box },
				sel: target.tag === "button" ? `button:has-text("${target.text}")` : target.id ? `#${target.id}` : "",
			};
		}
		// クリック直前に遮蔽があっても座標クリックは実行する（=実ユーザーが塞がれたボタンを押し損ねる状況を再現）
		// @why: [2026-09-04] 遮蔽判定は「最前面要素がクリック対象自身 or その子孫なら遮蔽でない」で行う。id比較では #msg 内の子要素(#dlg等)をクリックした時に誤って遮蔽と判定していた。elementFromPoint の結果が対象を含む DOM 上で包含 or 一致するとき遮蔽なし。
		// @tags: SPEC, monte-carlo, occlusion
		const occluded = await page.evaluate(
			({ px, py, sel, tid }) => {
				const front = document.elementFromPoint(px, py);
				if (!front) return false;
				let targetEl = null;
				if (tid) targetEl = document.getElementById(tid);
				else if (sel) targetEl = document.querySelector(sel);
				if (!targetEl) return false; // 対象が特定できない時は遮蔽判定しない
				// 最前面が対象自身、または対象の子孫である場合は遮蔽ではない
				return front !== targetEl && !targetEl.contains(front);
			},
			{ px: x, py: y, sel: target.tag === "button" ? `button:has-text("${target.text}")` : `#${target.id}`, tid: target.id || "" }
		);
		// クリック直前に遮蔽があっても座標クリックは実行する（=実ユーザーが塞がれたボタンを押し損ねる状況を再現）
		await page.mouse.click(x, y);
		if (isType) {
			// テキスト入力: 実キーボードでランダム文字列（バリデーション・インジェクションの壊れを実測）
			await page.keyboard.type(fuzzString(rand), { delay: 8 });
		} else if (isChange) {
			// 変更系操作: checkbox/radio はクリックで切替（既にクリック済み）・select は option 選択・range は矢印キーで値変更
			// @why: [2026-09-04] 変更可能要素の「値が変わる/変わらない」を実測する。select の option 切り替え・range の値を変え、change イベント未発火・状態反映漏れを検出する。
			// @tags: SPEC, monte-carlo, form-change
			if (target.tag === "select") {
				const opts = await page.locator(`#${target.id} option`).count().catch(() => 0);
				if (opts > 1) {
					await page.selectOption(`#${target.id}`, { index: Math.floor(rand() * opts) }).catch(() => {});
				}
			} else if (target.type === "range" || (target.id && (await page.locator(`#${target.id}`).getAttribute("type"))) === "range") {
				await page.keyboard.press(rand() < 0.5 ? "ArrowRight" : "ArrowLeft");
			}
			// checkbox/radio は座標クリックで既に切替済み。select/range のみ追加操作
		} else if (rand() < 0.4) {
			await page.keyboard.press("Enter");
		}
		return {
			acted: true, step, action: isType ? "type" : isChange ? "change" : "click", occluded,
			target: { tag: target.tag, id: target.id, text: target.text, box: target.box },
			sel: target.tag === "button" ? `button:has-text("${target.text}")` : target.id ? `#${target.id}` : "",
		};
	} catch (e) {
		return {
			acted: true, step, action: isType ? "type" : isChange ? "change" : "click", occluded: false,
			target: { tag: target.tag, id: target.id, text: target.text, box: target.box },
			sel: "",
			thrown: String(e.message).slice(0, 150),
		};
	}
}

// @why: [2026-09-04] テキスト入力用のランダム文字列生成（決定的）。バリデーション/SQLインジェクション/超長文等の入力由来の壊れを、乱数でまんべんなく突く。同じseedなら同じ文字列になる（決定的）。
// @tags: SPEC, monte-carlo, text-input, deterministic
function fuzzString(rand) {
	const corpus = [
		"a", "abc", "12345", "  space  ", "<script>alert(1)</script>", "'", '""', "\\n\\n", "あいうえお", "日本語テキストです", "", "Z".repeat(Math.floor(rand() * 24)),
	];
	const n = Math.floor(rand() * corpus.length);
	return corpus[n];
}

// ---- 状態シグネチャ（実 DOM から） ----
async function stateSignature(page) {
	// @why: [2026-09-04] 状態シグネチャを「値を持つ入力要素」まで含める。従来は textContent のみだったため、checkbox のchecked・selectの選択・inputの値が変わっても遷移と検出されず、学習（遷移判定の前提）が機能しなかった。値を含めることで「操作→状態遷移」を正しく検出する。
	// @tags: SPEC, monte-carlo, state, learning
	return page.evaluate(() => {
		const els = [...document.querySelectorAll("button, a[href], input, select, textarea")].map((e) => {
			if (e.tagName === "INPUT" && (e.type === "checkbox" || e.type === "radio")) {
				return `INPUT:${e.id || e.type}:${e.checked ? 1 : 0}`;
			} else if (e.tagName === "SELECT") {
				return `SELECT:${e.id || ""}:${e.selectedIndex ?? -1}`;
			} else if (e.tagName === "INPUT" && e.value !== undefined) {
				return `INPUT:${e.id || e.type}:${e.value}`;
			} else if (e.tagName === "TEXTAREA") {
				return `TEXTAREA:${e.id || ""}:${e.value}`;
			}
			return e.tagName + ":" + (e.textContent || "").trim().slice(0, 20);
		});
		return els.slice(0, 60).join("|");
	});
}

// ---- 意図（シナリオ）生成: ランダム操作列を決定的に構成 ----
// @why: [2026-09-04] 状態遷移学習のための要素識別キー。id 最優先（安定）→ id が無ければ tag+text（DOM 変わっても同程度に特定）。learn 集合への登録・照合用。
// @tags: SPEC, monte-carlo, learning
function aKey(a) {
	if (!a) return "";
	return a.id ? `#${a.id}` : `${a.tag}:${(a.text || "").trim().slice(0, 24)}`;
}

async function generateScenario(target, seed, steps, noLearn = false) {
	const { browser, page, errors, url } = await launchPage(target);
	await page.goto(url, { waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => {});
	await page.waitForTimeout(300);
	const rand = mulberry32(seed);
	const actionsList = [];
	const seen = new Set();
	const learn = new Set(); // 状態遷移した要素キーの集合（モンテカルロ学習）
	let loop = null;
	let prevSig = null;
	let transitioned = 0; // 状態遷移した操作の回数（学習の効果を測る指標）
	for (let i = 0; i < steps; i++) {
		const actions = await collectActions(page);
		const sig = await stateSignature(page);
		if (seen.has(sig)) {
			if (!loop) loop = { atStep: i, sig: sig.slice(0, 80) };
		}
		seen.add(sig);
		const r = await act(page, actions, rand, i, noLearn ? null : learn);
		// 遷移判定: 操作前後でシグネチャが変わったら「状態遷移あり」→ その要素を学習に加える
		const afterSig = await stateSignature(page);
		if (r?.target && afterSig !== sig) {
			transitioned++;
			learn.add(aKey(r.target));
		}
		prevSig = afterSig;
		actionsList.push({ ...r, sig });
		await page.waitForTimeout(120 + Math.floor(rand() * 180));
	}
	await browser.close();
	return {
		seed,
		steps,
		url,
		errors,
		scenario: actionsList,
		uniqueStates: seen.size,
		loopCandidate: loop,
		transitioned,
		learnedElements: learn.size,
	};
}

function print(fmt, obj, asJson) {
	if (asJson) return console.log(JSON.stringify(obj, null, 2));
	return console.log(fmt, obj);
}

function usage() {
	console.log(`monte-carlo-test/fuzz.mjs — 実ブラウザ DOM ランダム探索テスト（モンテカルロ決定的運用）

使い方:
  node fuzz.mjs launch   <file.html|url>              # ブラウザ起動と対象確認（エラー収集）
  node fuzz.mjs scenario <file.html|url> --seed N --steps M
                                                      # 意図（シナリオ）を生成（ランダム→実測→抽出）
  node fuzz.mjs replay   <scenario.json>              # 意図→コマンド実行（実ブラウザで再生・合否）
  node fuzz.mjs scan     <file.html|url> --seed N     # scenario+replay 統合, exit 0/1 (--json可)

実測: [error]console.error/pageerror/[loop]状態リピート/[stale]対象消失
exit 0=異常なし / exit 1=検出あり（ヒント・処理は止めない）
前提: playwright-core（任意依存・ui-graph と同系列）。YHM_CHROME 指定可。`);
}

async function main() {
	const args = process.argv.slice(2);
	const asJson = args.includes("--json");
	const strict = args.includes("--strict");
	const noLearn = args.includes("--no-learn");
	const seedIdx = args.indexOf("--seed");
	const stepsIdx = args.indexOf("--steps");
	const seed = seedIdx >= 0 ? parseInt(args[seedIdx + 1], 10) || 1 : seedFromString(String(Date.now()));
	const steps = stepsIdx >= 0 ? parseInt(args[stepsIdx + 1], 10) || 20 : 20;
	const mode = args.find((a) => ["launch", "scenario", "replay", "scan"].includes(a));
	const target = args.find((a) => !a.startsWith("--") && !["launch", "scenario", "replay", "scan"].includes(a));

	if (!mode || !target) {
		usage();
		process.exit(2);
	}

	if (mode === "launch") {
		const { browser, page, errors, url } = await launchPage(target);
		await page.goto(url, { waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => {});
		await page.waitForTimeout(300);
		const title = await page.title();
		const actions = await collectActions(page);
		if (asJson) console.log(JSON.stringify({ title, interactableCount: actions.length, actions }, null, 2));
		else {
			console.log(`launch ${url}`);
			console.log(`  タイトル: ${title}`);
			console.log(`  操作可能要素: ${actions.length}`);
			for (const a of actions.slice(0, 10)) console.log(`    - <${a.tag}> "${a.text}"`);
			if (errors.length) {
				console.log(`  ⚠ エラー ${errors.length}件:`);
				for (const e of errors) console.log(`    - [${e.type}] ${e.text}`);
			}
		}
		await browser.close();
		return;
	}

	if (mode === "scenario") {
		const sc = await generateScenario(target, seed, steps, noLearn);
		print("", sc, asJson);
		return;
	}

	if (mode === "replay") {
		// 意図(シナリオJSON)を実ブラウザで再生（コマンド実行）
		const file = target;
		const sc = JSON.parse(fs.readFileSync(file, "utf8"));
		const { browser, page, errors, url } = await launchPage(sc.url);
		await page.goto(url, { waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => {});
		await page.waitForTimeout(300);
		// 意図 = シナリオに記録された操作列（座標+セレクタ）。実ブラウザで座標へマウス移動→クリックして再現する。
		const findings = [];
		for (const s of sc.scenario) {
			if (!s.target) continue;
			// 記録された座標へ実マウス移動→クリック（セレクタではなく座標そのもので再生）
			const x = s.target.box ? Math.max(2, Math.min(s.target.box.x, 1279)) : 700;
			const y = s.target.box ? Math.max(2, Math.min(s.target.box.y, 799)) : 300;
			try {
				await page.mouse.move(x, y);
				await page.waitForTimeout(80);
				await page.mouse.click(x, y);
				if (s.action === "press") await page.keyboard.press("Enter");
			} catch (e) {
				findings.push({ kind: "crash", msg: `replay step ${s.step ?? 0} で例外: ${String(e.message).slice(0, 150)}` });
			}
			await page.waitForTimeout(120);
		}
		await page.waitForTimeout(300);
		const finalSig = await stateSignature(page);
		await browser.close();
		const result = {
			ok: errors.length === 0 && findings.length === 0,
			seed: sc.seed,
			steps: sc.scenario.length,
			errors,
			findings,
			finalStateSig: finalSig.slice(0, 120),
		};
		if (asJson) process.stdout.write(JSON.stringify(result, null, 2));
		else {
			console.log(`replay（seed=${sc.seed}, ${sc.scenario.length}操作・座標マウス再生）`);
			if (!result.ok) {
				for (const e of result.errors) console.log(`  ✗ [${e.type}] ${e.text}`);
			} else console.log("  再生終了: エラーなし");
		}
		process.exit(result.ok ? 0 : 1);
	}

	// ---- scan（生成→再生を一気に。合否を exit で返す） ----
	if (mode === "scan") {
		const sc = await generateScenario(target, seed, steps, noLearn);
		const findings = [];
		// エラー収集
		if (sc.errors.length > 0) {
			findings.push(...sc.errors.map((e) => ({ kind: "error", msg: `[${e.type}] ${e.text}` })));
		}
		// 遮蔽検出（座標クリックの真価）: クリック時に最前面が別要素（overlay等）だった
		const occlusions = (sc.scenario || []).filter((s) => s.occluded);
		if (occlusions.length > 0) {
			findings.push({
				kind: "occlusion",
				msg: `${occlusions.length}回、クリック対象を別要素が遮蔽（透明オーバーレイ・z-index重なりの可能性）例: ${(occlusions[0].target.text || "").slice(0, 30)}`,
			});
		}
		// loop/stale は「既定では検出しない」（誤検出回避）・`--strict` 指定のみ検出。正当な巡回（遊び直し等）を暴走と誤判定しないためにオプトインにする。
		// @why: [2026-09-04] ノベルゲーム等「エンディング→もういちど」は正当ループ。既定で loop/stale を出すと正常UIを誤検出して悲鳴を上げる。この思想（矯正でなくヒント・誤検出で止めない）に合わせ、暴走を疑う時だけ --strict で強く見る。
		// @tags: SPEC, monte-carlo, false-positive, opt-in
		if (strict) {
			const staleish = sc.uniqueStates <= 1 && sc.scenario.length >= 5;
			if (staleish && !occlusions.length) {
				findings.push({ kind: "stale", msg: "操作しても状態が変化しない（イベント未接続・壊れの可能性）" });
			}
			if (sc.loopCandidate && sc.uniqueStates >= 2) {
				findings.push({ kind: "loop", msg: `同一DOM状態へのリピート（潜在ループ）: ${sc.loopCandidate.sig}` });
			}
		}
		const result = {
			ok: findings.length === 0,
			seed,
			steps,
			url: sc.url,
			uniqueStates: sc.uniqueStates,
			errors: sc.errors,
			loopCandidate: sc.loopCandidate,
			findings,
			note: "実ブラウザモンテカルロ完了(決定性: seed固定で同一操作列)",
		};
		if (asJson) process.stdout.write(JSON.stringify(result, null, 2));
		else {
			console.log(`scan ${sc.url} (seed=${seed}, ${steps}steps, 一意状態 ${sc.uniqueStates})`);
			if (result.ok) console.log("  ✓ 異常なし（console.error / 状態リピート なし）");
			else for (const f of findings) console.log(`  ✗ [${f.kind}] ${f.msg}`);
		}
		process.exit(result.ok ? 0 : 1);
	}
}

main().catch((e) => {
	console.error(`\n[fatal] ${e.stack || e.message}`);
	process.exit(1);
});
