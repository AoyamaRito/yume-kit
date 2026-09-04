// arbitrate.mjs — AI 判定器（OpenRouter + DeepSeek v4 Flash、fetch のみ・依存ゼロ）
// @why: [2026-09-04] kantoku の「判定」層。watch の JSON レポートを受け取り、OpenRouter 経由で DeepSeek に「続行/修正/中止」を問い、3 値（proceed/refine/halt）の verdict を返す。人間の代わりに中間判定を仰ぐ用途（AGENTS.md「AI が判断を仰ぐ」の実装補助）。haiku_plus の Anthropic 直結ではなく、pi_root 全体の provider である OpenRouter に統一した（ユーザー指示 2026-09-04）。
// @tags: SPEC

import { resolveApiKey, resolveModel } from './env.mjs';

const OR_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

const SYSTEM_PROMPT = `あなたは中間判定者（kantoku）です。
与えられた状態レポート JSON を読み、次のアクションを 3 値で判定してください。
- proceed: 問題なし、続行してよい
- refine: 修正が必要（何を直すべきか reason に簡潔に）
- halt: 停止が必要（原因や診断を reason に簡潔に）

回答は以下の JSON のみを返すこと（余計な文を付けない）:
{"verdict":"proceed|refine|halt","reason":"..."}`;

/** report JSON（オブジェクト or 文字列）と質問文を受け取り、判定を返す。 */
export async function arbitrate(report, question = 'この状態で続行してよい？') {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    return {
      ok: false,
      error: 'OPENROUTER_API_KEY が見つかりません。環境変数 or .env を設定してください。',
    };
  }
  const model = resolveModel();

  const reportText = typeof report === 'string' ? report : JSON.stringify(report, null, 2);

  const resp = await fetch(OR_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `状態レポート:\n${reportText}\n\n質問: ${question}` },
      ],
      temperature: 0,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    return { ok: false, model, error: `OpenRouter HTTP ${resp.status}: ${body.slice(0, 500)}` };
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content ?? '';
  const verdict = parseVerdict(content);
  return {
    ok: true,
    model: data.model ?? model,
    verdict: verdict.verdict,
    reason: verdict.reason,
    raw: content,
  };
}

/** モデル応答から verdict を頑健に抽出（JSON でなくても 3 値の出現を拾う）。 */
export function parseVerdict(content) {
  const text = String(content ?? '').trim();
  // JSON ブロック抽出を優先
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      if (obj.verdict) {
        return { verdict: normalize(obj.verdict), reason: obj.reason ?? '' };
      }
    } catch {
      /* fallthrough */
    }
  }
  // フォールバック: 単語で拾う
  const lower = text.toLowerCase();
  if (/\bhalt\b/.test(lower)) return { verdict: 'halt', reason: text.slice(0, 300) };
  if (/\brefine\b/.test(lower)) return { verdict: 'refine', reason: text.slice(0, 300) };
  if (/\bproceed\b/.test(lower)) return { verdict: 'proceed', reason: text.slice(0, 300) };
  return { verdict: 'halt', reason: text.slice(0, 300) || '(判定不能 → halt 扱い)' };
}

function normalize(v) {
  const s = String(v).toLowerCase().trim();
  if (['proceed', 'continue', 'ok', 'go'].includes(s)) return 'proceed';
  if (['refine', 'fix', 'revise', 'warning'].includes(s)) return 'refine';
  if (['halt', 'stop', 'block', 'error'].includes(s)) return 'halt';
  return 'halt';
}

// CLI からの呼び出し（node lib/arbitrate.mjs <report.json|-> <question>）
// 主眼は「ライブラリとしての利用（pi スキルから import）」だが、単体でも動作する。
import { readFileSync } from 'node:fs';
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [,, reportArg, questionArg] = process.argv;
  if (!reportArg) {
    console.error('usage: node lib/arbitrate.mjs <report.json|-> <question>');
    process.exit(2);
  }
  const report = reportArg === '-' ? readFileSync(0, 'utf8') : readFileSync(reportArg, 'utf8');
  const question = questionArg ?? 'この状態で続行してよい？';
  const result = await arbitrate(report, question);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}