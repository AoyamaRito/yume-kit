// yume-min / cover.js — ヘッドレス検証の目（V8 精密カバレッジ）
//
// 出自: V4.3 "Headless Verification" / V9.4 "Log-Only Repro" / yume-files cover.js
// 動機: 単一AIが長時間まわすとき「テストは通った」だけでは足りない。
//       「どの行がまだ実行されていないか」まで見えて初めて緑ゲートが信頼できる。
// これは並列とは無関係の「検証の目」。gaps（未実行の意味ある区間）を自動で指摘する。
//
// 使い方: 検証したい関数を runWithCoverage に渡し、対象メンバのファイルURLを指定する。

import { pathToFileURL } from 'node:url';

export async function runWithCoverage(testFn, targetFileUrl) {
  const { Session } = await import('node:inspector/promises');
  const session = new Session();
  session.connect();
  await session.post('Profiler.enable');
  // 重要: 計測したいモジュールの import は testFn 内（coverage 開始後）に行うこと。
  // そうしないと未実行関数が V8 に登録されず、gaps 検出ができない。
  await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });

  await testFn();

  const { result } = await session.post('Profiler.takePreciseCoverage');
  await session.post('Profiler.stopPreciseCoverage');
  await session.post('Profiler.disable');
  session.disconnect();

  // URL はクエリ/ハッシュが付く場合があるので、pathname で照合する。
  const targetPath = new URL(targetFileUrl).pathname;
  const script = result.find(r => {
    try { return new URL(r.url).pathname === targetPath; } catch { return false; }
  });
  return script ? script.functions : [];
}

// 実行されなかった「意味のある区間」だけを抽出する。
export function analyzeCoverageGaps(functions, sourceText) {
  const gaps = [];
  for (const fn of functions) {
    for (const range of fn.ranges) {
      if (range.count === 0) {
        const snippet = sourceText.substring(range.startOffset, range.endOffset);
        if (snippet.trim().length > 0) {
          gaps.push({ fn: fn.functionName || '(anonymous)', start: range.startOffset, end: range.endOffset, snippet });
        }
      }
    }
  }
  return gaps;
}
