#!/usr/bin/env node
// @why: ヘッドレスブラウザ上でWeb UIを読み込み、ロジカルグラフ抽出（extractor.js）を実行し、AIおよび開発者向けにツリー・異常レポート・Mermaid形式を出力するCLI
// @tags: SPEC

import { chromium } from 'playwright-core';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractUIGraph } from './extractor.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// @why: MacだけでなくLinux(CI環境)・Windows・システムChromeパスまで網羅し、環境依存なく動作するクロスプラットフォーム検出
// @tags: SPEC
function findBrowser() {
  for (const envKey of ['UI_GRAPH_CHROME', 'WEBQA_CHROME', 'CHROME_PATH', 'PUPPETEER_EXECUTABLE_PATH']) {
    if (process.env[envKey] && existsSync(process.env[envKey])) return process.env[envKey];
  }

  const home = homedir();
  const cacheCandidates = [
    path.join(home, 'Library/Caches/ms-playwright'),
    path.join(home, '.cache/ms-playwright'),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : null,
  ].filter(Boolean);

  for (const cache of cacheCandidates) {
    if (!existsSync(cache)) continue;
    for (const prefix of ['chromium_headless_shell-', 'chromium-']) {
      const dirs = readdirSync(cache).filter(d => d.startsWith(prefix)).sort();
      for (const d of dirs.reverse()) {
        const cands = [
          path.join(cache, d, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
          path.join(cache, d, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell'),
          path.join(cache, d, 'chrome-mac', 'Chromium'),
          path.join(cache, d, 'chromium', 'chrome-mac', 'Chromium'),
          path.join(cache, d, 'chrome-linux', 'chrome'),
          path.join(cache, d, 'chrome-headless-shell-linux', 'chrome-headless-shell'),
          path.join(cache, d, 'chrome-win', 'chrome.exe'),
          path.join(cache, d, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
        ];
        for (const cand of cands) {
          if (existsSync(cand)) return cand;
        }
      }
    }
  }

  const systemPaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const p of systemPaths) {
    if (existsSync(p)) return p;
  }

  return null;
}

const EXE = findBrowser();
if (!EXE) {
  console.error('ブラウザが見つかりません。UI_GRAPH_CHROME または ms-playwright キャッシュが必要です');
  process.exit(2);
}

const arg = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? (process.argv[i + 1] ?? dflt) : dflt;
};
const hasFlag = flag => process.argv.includes(flag);

/* ---------- ページ読み込み ---------- */
async function loadTarget(browser, targetUrl, isMobile, width, height) {
  const page = await browser.newPage({
    viewport: isMobile
      ? { width: width || 390, height: height || 844 }
      : { width: width || 1280, height: height || 800 },
    deviceScaleFactor: isMobile ? 2 : 1,
    isMobile: isMobile,
    hasTouch: isMobile,
  });

  let url = targetUrl;
  if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
    const absPath = path.resolve(process.cwd(), url);
    if (existsSync(absPath)) {
      url = `file://${absPath}`;
    } else {
      url = `http://${url}`;
    }
  }

  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  const waitMs = +arg('--wait', 300);
  if (waitMs > 0) {
    await page.waitForTimeout(waitMs);
  }
  return page;
}

/* ---------- ロジカルグラフ抽出実行 ---------- */
export async function runUIGraph(targetUrl, options = {}) {
  const isMobile = options.mobile || hasFlag('--mobile');
  const width = options.width || (arg('--width', null) ? +arg('--width') : null);
  const height = options.height || (arg('--height', null) ? +arg('--height') : null);

  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  });

  try {
    const page = await loadTarget(browser, targetUrl, isMobile, width, height);
    
    // ブラウザ内で extractor を実行
    const result = await page.evaluate(extractUIGraph, options);
    result.target = targetUrl;
    return result;
  } finally {
    await browser.close();
  }
}

/* ---------- フォーマッター: 階層ツリー表示 ---------- */
function renderTree(graph) {
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  const childMap = new Map();
  for (const edge of graph.edges.filter(e => e.type === 'dom_child')) {
    if (!childMap.has(edge.from)) childMap.set(edge.from, []);
    childMap.get(edge.from).push(edge.to);
  }

  const rootNodes = graph.nodes.filter(n => !graph.edges.some(e => e.type === 'dom_child' && e.to === n.id));

  const lines = [];
  lines.push(`📱 Viewport: ${graph.viewport.width}x${graph.viewport.height} | Nodes: ${graph.summary.totalNodes} | Edges: ${graph.summary.totalEdges}`);
  lines.push('');

  function printNode(nodeId, prefix = '', isLast = true) {
    const node = nodeMap.get(nodeId);
    if (!node) return;

    const marker = isLast ? '└── ' : '├── ';
    let label = `${node.selector}`;
    if (node.text) label += ` "${node.text}"`;
    label += ` [${node.rect.x},${node.rect.y} ${node.rect.w}x${node.rect.h}]`;

    if (node.layout.position !== 'static') label += ` [pos:${node.layout.position}]`;
    if (node.layout.display.includes('flex') || node.layout.display.includes('grid')) {
      label += ` [${node.layout.display}]`;
    }

    // 異常バッジ
    const errors = node.anomalies.filter(a => a.severity === 'error');
    const warns = node.anomalies.filter(a => a.severity === 'warn');
    if (errors.length > 0) label += ` 🚨 ${errors.map(e => e.code).join(',')}`;
    if (warns.length > 0) label += ` ⚠️ ${warns.map(w => w.code).join(',')}`;

    lines.push(`${prefix}${marker}${label}`);

    const children = childMap.get(nodeId) || [];
    const nextPrefix = prefix + (isLast ? '    ' : '│   ');
    children.forEach((childId, idx) => {
      printNode(childId, nextPrefix, idx === children.length - 1);
    });
  }

  for (let i = 0; i < rootNodes.length; i++) {
    printNode(rootNodes[i].id, '', i === rootNodes.length - 1);
  }

  return lines.join('\n');
}

/* ---------- フォーマッター: 異常レポート ---------- */
function renderAnomalies(graph) {
  const lines = [];
  lines.push('====================================================');
  lines.push(`🔍 UI GRAPH ANOMALY REPORT: ${graph.target || 'target'}`);
  lines.push(`   Status: ${graph.summary.pass ? '✅ PASS (No blocking errors)' : '❌ FAIL (Errors found)'}`);
  lines.push(`   Errors: ${graph.summary.errorCount} | Warnings: ${graph.summary.warnCount}`);
  lines.push('====================================================');

  if (graph.anomalies.length === 0) {
    lines.push('✨ レイアウト破綻・遮蔽・サイズ異常などの問題は検出されませんでした。');
    return lines.join('\n');
  }

  graph.anomalies.forEach((a, i) => {
    const icon = a.severity === 'error' ? '🚨 [ERROR]' : '⚠️ [WARN]';
    lines.push(`\n${i + 1}. ${icon} ${a.code} on \`${a.selector}\` (${a.nodeId})`);
    lines.push(`   理由: ${a.message}`);
    lines.push(`   詳細: ${JSON.stringify(a.detail)}`);
  });

  return lines.join('\n');
}

/* ---------- フォーマッター: Mermaid グラフ ---------- */
function renderMermaid(graph) {
  const lines = ['flowchart TD'];
  
  for (const n of graph.nodes) {
    let text = n.selector;
    if (n.text) text += `\\n"${n.text}"`;
    text += `\\n(${n.rect.w}x${n.rect.h})`;

    if (n.anomalies.some(a => a.severity === 'error')) {
      lines.push(`  ${n.id}["🚨 ${text}"]:::errorNode`);
    } else if (n.isInteractive) {
      lines.push(`  ${n.id}["🔘 ${text}"]:::interactiveNode`);
    } else {
      lines.push(`  ${n.id}["${text}"]`);
    }
  }

  for (const e of graph.edges) {
    if (e.type === 'dom_child') {
      lines.push(`  ${e.from} --> ${e.to}`);
    } else if (e.type === 'containing_block') {
      lines.push(`  ${e.from} -. cb .-> ${e.to}`);
    } else if (e.type === 'occluded_by') {
      lines.push(`  ${e.from} ==>|OCCLUDED BY| ${e.to}`);
    } else if (e.type.startsWith('logical_')) {
      lines.push(`  ${e.from} -. ${e.type} .-> ${e.to}`);
    }
  }

  lines.push('  classDef errorNode fill:#ffdddd,stroke:#ff0000,stroke-width:2px;');
  lines.push('  classDef interactiveNode fill:#e1f5fe,stroke:#0288d1,stroke-width:2px;');

  return lines.join('\n');
}

/* ---------- CLI メイン処理 ---------- */
async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const cmd = args[0] || 'scan';
  const target = args[1] || (cmd !== 'scan' && cmd !== 'tree' && cmd !== 'mermaid' && cmd !== 'json' ? cmd : null);

  if (!target) {
    console.log(`
ui-graph — Web UIからロジカルグラフを自動生成し、異常（はみ出し・遮蔽・縮退）を検知する

使い方:
  node ui-graph.mjs scan <url or file.html>      ... 異常サマリーと診断結果を表示（CI/合否判定用）
  node ui-graph.mjs tree <url or file.html>      ... ターミナル用コンパクトツリー（座標・異常付き）
  node ui-graph.mjs anomalies <url or file.html> ... 検出された異常の詳細レポート
  node ui-graph.mjs mermaid <url or file.html>   ... Mermaid.js 記法のグラフ定義を出力
  node ui-graph.mjs json <url or file.html>      ... 全グラフ構造をJSON出力

オプション:
  --mobile         390x844 (モバイルビュー) でテスト
  --width <px>     画面幅を指定
  --height <px>    画面高さを指定
  --wait <ms>      ページ読み込み後の追加待機時間 (既定: 300ms)
`);
    process.exit(0);
  }

  const actualCmd = ['scan', 'tree', 'anomalies', 'mermaid', 'json'].includes(cmd) ? cmd : 'scan';

  try {
    const graph = await runUIGraph(target);

    if (actualCmd === 'json') {
      console.log(JSON.stringify(graph, null, 2));
    } else if (actualCmd === 'tree') {
      console.log(renderTree(graph));
      console.log('\n' + renderAnomalies(graph));
    } else if (actualCmd === 'mermaid') {
      console.log(renderMermaid(graph));
    } else if (actualCmd === 'anomalies' || actualCmd === 'scan') {
      console.log(renderAnomalies(graph));
    }

    if (!graph.summary.pass) {
      process.exit(1);
    }
  } catch (err) {
    console.error('実行エラー:', err.message);
    process.exit(2);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
