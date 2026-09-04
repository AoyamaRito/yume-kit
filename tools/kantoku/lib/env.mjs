// env.mjs — OpenRouter API キーとモデルの解決（依存ゼロ）
// @why: [2026-09-04] 判定層（arbitrate）が OpenRouter を叩くための設定解決。キーは複数の .env に散在している（~/.env は FAL_KEY のみ、OPENROUTER_API_KEY は grok_build/deepseek-spawn/.env と electron-asset-forge/.env）。vision-qa.mjs と同じ「候補を順に探す」方式で、AI に探させず・環境変数を優先して解決する（clearify）。
// @tags: SPEC

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
// @why: [2026-09-04] ポータブル化: .env 候補を os.homedir() で解決し、ユーザー名固定パス（/Users/AoyamaRito）依存を除去

const HERE = dirname(fileURLToPath(import.meta.url));

/** デフォルト判定モデル。pi_root 正本（~/.pi/agent/settings.json defaultModel）と一致。KANTOKU_MODEL で上書き可。 */
export const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash-0731';

/** OPENROUTER_API_KEY を探す .env 候補（先勝ち）。自フォルダを最優先、その後に既知の所在をフォールバック。 */
const ENV_CANDIDATES = [
  join(HERE, '..', '.env'),                              // yume-kit/kantoku-watch/.env
  join(homedir(), 'pi_root', '.env'),                  // pi_root ルート
  join(homedir(), 'grok_build', 'deepseek-spawn', '.env'), // OPENROUTER_API_KEY 実在
  join(homedir(), 'grok_build', 'electron-asset-forge', '.env'), // OPENROUTER_API_KEY 実在
  join(homedir(), '.env'),                           // ホーム直下（FAL_KEY 等）
];

/** ごく簡易な .env パーサ（KEY=value 行のみ。引用符・コメント・エクスポートは対象外）。値は秘密なので返すだけで表示しない。 */
export function loadEnvFile(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const out = {};
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k) out[k] = v;
  }
  return out;
}

/** OPENROUTER_API_KEY を解決（環境変数 → .env 候補の順）。無ければ null。 */
export function resolveApiKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  for (const p of ENV_CANDIDATES) {
    if (existsSync(p)) {
      const env = loadEnvFile(p);
      if (env.OPENROUTER_API_KEY) return env.OPENROUTER_API_KEY;
    }
  }
  return null;
}

/** 判定モデルを解決（KANTOKU_MODEL 環境変数 → .env の KANTOKU_MODEL → DEFAULT_MODEL）。 */
export function resolveModel() {
  if (process.env.KANTOKU_MODEL) return process.env.KANTOKU_MODEL;
  // .env 内に KANTOKU_MODEL が書かれていれば使う（直接の環境変数を優先済み）
  for (const p of ENV_CANDIDATES) {
    if (existsSync(p)) {
      const env = loadEnvFile(p);
      if (env.KANTOKU_MODEL) return env.KANTOKU_MODEL;
    }
  }
  return DEFAULT_MODEL;
}