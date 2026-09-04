#!/usr/bin/env node
// kantoku.js — CLI 入口（run <file.js> → JSON レポート）
// @why: [2026-09-04] kantoku-v5 の bin に相当する存在を yume-kit/kantoku-watch/bin に置く。v5 の kantoku.js（run のみ）を継承し、import パスを ../runtime/watch.js に調整。観測層の入口であり、判定（arbitrate）とは分離して単体で CI にも使える（「見る」と「判断する」を分ける = clearify）。
// @tags: SPEC

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { report, reset } from '../runtime/watch.js';

async function main(argv) {
  const [cmd, target] = argv;
  if (!cmd || cmd === '-h' || cmd === '--help') {
    printHelp();
    return 0;
  }
  if (cmd !== 'run') {
    console.error(JSON.stringify({ ok: false, error: `unknown command: ${cmd}` }, null, 2));
    return 1;
  }
  if (!target) {
    console.error(JSON.stringify({ ok: false, error: 'usage: node bin/kantoku.js run <file.js>' }, null, 2));
    return 1;
  }

  reset();
  const targetPath = resolve(process.cwd(), target);
  try {
    const mod = await import(pathToFileURL(targetPath).href);
    if (typeof mod.default === 'function') {
      await mod.default();
    }
    console.log(JSON.stringify(report(), null, 2));
    return 0;
  } catch (error) {
    console.error(
      JSON.stringify(
        { ok: false, error: error.message, stack: error.stack, report: report() },
        null,
        2
      )
    );
    return 1;
  }
}

function printHelp() {
  console.log(`kantoku-watch v1

Usage:
  node bin/kantoku.js run <file.js>

The target file imports ../runtime/watch.js and calls watch("REAL_state", value).
Kantoku prints a JSON report of watched REAL_* state.
For AI verdict, pipe into: node lib/arbitrate.mjs - '<question>'`);
}

const code = await main(process.argv.slice(2));
process.exitCode = code;