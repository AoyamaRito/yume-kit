#!/usr/bin/env node
/**
 * ga4-monitor.mjs — GA4 データ状態の自前継続監視 (zero-dependency)
 *
 * やること:
 *   1. データ鮮度: dateHourMinute の最新行から ingestion lag(分) を測定
 *   2. ボリューム異常: 直近3h のイベント数を前日同時刻と比較 (% drop 検知)
 *   3. (任意) Measurement Protocol テストヒット送信 --ping + 受信到達の検証
 *   4. 異常時: コンソール + Slack webhook に通知、exit code 1
 *
 * 使い方:
 *   cp .env.example .env   # 中身を埋める
 *   node ga4-monitor.mjs             # 監視チェック (cron で定期実行)
 *   node ga4-monitor.mjs --ping      # MP テストヒットを送信 (1日1回程度)
 *   node ga4-monitor.mjs --verbose   # 詳細ログ
 *
 * 環境変数 (./.env からも読み込む):
 *   GA4_PROPERTY_ID          必須 GA4 プロパティID (例: 123456789)
 *   GA4_CREDENTIALS_FILE     必須 サービスアカウント JSON のパス
 *   GA4_TZ_OFFSET_HOURS      プロパティのタイムゾーン (UTC+9 => 9, デフォルト 0)
 *   MAX_LAG_MIN              鮮度アラート閾値(分, デフォルト 15)
 *   DROP_THRESHOLD_PCT       ボリューム異常閾値(%, デフォルト -80)
 *   MP_API_SECRET            (任意) Measurement Protocol API シークレット
 *   MP_MEASUREMENT_ID        (任意) G-XXXXXXXX
 *   PING_TIMEOUT_MIN         ping 受信タイムアウト(分, デフォルト 30)
 *   SLACK_WEBHOOK_URL        (任意) Slack Incoming Webhook URL
 *   STATE_FILE               (任意) ping 状態の保存先 (デフォルト ./state.json)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { URL } from 'node:url';

// ---------- config ----------
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);

function loadDotEnv() {
  const p = path.join(SCRIPT_DIR, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

const ENV = (k, d) => process.env[k] ?? d;
const PROPERTY = ENV('GA4_PROPERTY_ID', '');
const CREDS_FILE = ENV('GA4_CREDENTIALS_FILE', '');
const TZ_OFFSET_H = Number(ENV('GA4_TZ_OFFSET_HOURS', '0'));
const MAX_LAG_MIN = Number(ENV('MAX_LAG_MIN', '15'));
const DROP_PCT = Number(ENV('DROP_THRESHOLD_PCT', '-80'));
const MP_SECRET = ENV('MP_API_SECRET', '');
const MP_MID = ENV('MP_MEASUREMENT_ID', '');
const PING_TIMEOUT_MIN = Number(ENV('PING_TIMEOUT_MIN', '30'));
const SLACK_URL = ENV('SLACK_WEBHOOK_URL', '');
const STATE_FILE = ENV('STATE_FILE', path.join(SCRIPT_DIR, 'state.json'));
const VERBOSE = process.argv.includes('--verbose');
const MODE = process.argv.includes('--ping') ? 'ping' : 'check';

// ---------- http / auth ----------
function httpJson(method, url, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      method, hostname: u.hostname, path: u.pathname + u.search, headers,
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode} ${method} ${url}: ${data.slice(0, 500)}`));
        try { resolve(data ? JSON.parse(data) : {}); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function signJwt(claims, pemKey) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64(claims);
  return data + '.' + crypto.sign('RSA-SHA256', Buffer.from(data), pemKey).toString('base64url');
}

async function getAccessToken(creds) {
  const now = Math.floor(Date.now() / 1000);
  const jwt = signJwt({
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }, creds.private_key);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  });
  const res = await httpJson('POST', 'https://oauth2.googleapis.com/token',
    { 'Content-Type': 'application/x-www-form-urlencoded' }, body.toString());
  return res.access_token;
}

async function runReport(token, body) {
  return httpJson('POST', `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY}:runReport`, {
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
  }, JSON.stringify(body));
}

// YYYYMMDDHHMM (property tz) -> real UTC epoch ms
function tzStringToMs(str) {
  const s = String(str).padStart(12, '0');
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12))
    - TZ_OFFSET_H * 3600e3;
}

// ---------- checks ----------
async function checkFreshness(token) {
  const res = await runReport(token, {
    dateRanges: [{ startDate: '2daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'dateHourMinute' }],
    metrics: [{ name: 'eventCount' }],
    orderBys: [{ dimension: { dimensionName: 'dateHourMinute', orderType: 'NUMERIC' }, desc: true }],
    limit: 30,
  });
  const rows = (res.rows || []).map((r) => ({
    dhm: r.dimensionValues[0].value,
    count: Number(r.metricValues[0].value),
  }));
  const latest = rows.find((r) => r.count > 0);
  if (!latest) return { lagMin: null, lastMinute: null };
  return {
    lagMin: Math.max(0, Math.round((Date.now() - tzStringToMs(latest.dhm)) / 60000)),
    lastMinute: latest.dhm,
  };
}

async function checkVolume(token) {
  const res = await runReport(token, {
    dateRanges: [{ startDate: 'yesterday', endDate: 'today' }],
    dimensions: [{ name: 'dateHour' }],
    metrics: [{ name: 'eventCount' }],
    orderBys: [{ dimension: { dimensionName: 'dateHour', orderType: 'NUMERIC' }, desc: true }],
    limit: 48,
  });
  const byKey = new Map((res.rows || []).map((r) => [r.dimensionValues[0].value, Number(r.metricValues[0].value)]));
  const nowP = new Date(Date.now() + TZ_OFFSET_H * 3600e3); // プロパティ現地時刻
  const today = nowP.toISOString().slice(0, 10).replace(/-/g, '');
  const yest = new Date(nowP.getTime() - 86400e3).toISOString().slice(0, 10).replace(/-/g, '');
  let todaySum = 0, yestSum = 0;
  for (let back = 0; back < 3; back++) {
    const hh = String((nowP.getUTCHours() - back + 24) % 24).padStart(2, '0');
    todaySum += byKey.get(today + hh) || 0;
    yestSum += byKey.get(yest + hh) || 0;
  }
  return {
    todaySum, yestSum,
    pctChange: yestSum > 0 ? ((todaySum - yestSum) / yestSum) * 100 : null,
  };
}

// ---------- ping (Measurement Protocol v2) ----------
function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } }
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

async function sendPing() {
  if (!MP_SECRET || !MP_MID) { console.log('[info] ping: スキップ (MP_API_SECRET / MP_MEASUREMENT_ID 未設定)'); return null; }
  const state = loadState();
  state.clientId = state.clientId || 'ga4-monitor-' + crypto.randomBytes(6).toString('hex');
  const payload = {
    client_id: state.clientId,
    user_id: 'ga4-monitor',
    events: [{ name: 'monitor_ping', params: { sent_ms: Date.now() } }],
  };
  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${MP_MID}&api_secret=${MP_SECRET}`;
  await httpJson('POST', url, { 'Content-Type': 'application/json' }, JSON.stringify(payload));
  state.lastPing = { sentMs: Date.now() };
  saveState(state);
  return state.lastPing;
}

async function checkPingArrival(token) {
  const state = loadState();
  if (!state.lastPing) return { status: 'idle' };
  const since = new Date(Math.max(Date.now() - 86400e3, state.lastPing.sentMs));
  const start = since.toISOString().slice(0, 10);
  const res = await runReport(token, {
    dateRanges: [{ startDate: start, endDate: 'today' }],
    dimensions: [{ name: 'dateHourMinute' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: ['monitor_ping'] } } },
    orderBys: [{ dimension: { dimensionName: 'dateHourMinute', orderType: 'NUMERIC' }, desc: true }],
    limit: 5,
  });
  const ageMin = Math.round((Date.now() - state.lastPing.sentMs) / 60000);
  const arrived = (res.rows || []).some((r) => Number(r.metricValues[0].value) > 0);
  return {
    status: !arrived ? (ageMin > PING_TIMEOUT_MIN ? 'missing' : 'pending') : 'ok',
    ageMin,
  };
}

// ---------- notify ----------
function alert(level, msg) {
  console.log(`[${new Date().toISOString()}] ${level}: ${msg}`);
  if (SLACK_URL) {
    httpJson('POST', SLACK_URL, { 'Content-Type': 'application/json' },
      JSON.stringify({ text: `GA4 monitor ${level}: ${msg}` }))
      .catch((e) => console.error('slack notify failed:', e.message));
  }
}

// ---------- main ----------
async function mainCheck() {
  if (!PROPERTY || !CREDS_FILE) {
    console.error('GA4_PROPERTY_ID と GA4_CREDENTIALS_FILE が必要です (.env 参照)');
    process.exit(2);
  }
  const creds = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));
  const token = await getAccessToken(creds);

  const problems = [];
  const info = [];

  const f = await checkFreshness(token);
  if (f.lagMin == null) {
    info.push('freshness: 2日以内にデータ行なし');
  } else {
    info.push(`freshness: 最新データ ${f.lastMinute} (lag ${f.lagMin} min)`);
    if (f.lagMin > MAX_LAG_MIN) problems.push(`データ鮮度: 最終更新 ${f.lagMin}分前 (閾値 ${MAX_LAG_MIN}分)`);
  }

  const v = await checkVolume(token);
  const pctStr = v.pctChange == null ? 'baselineなし(前日同時刻0)' : v.pctChange.toFixed(0) + '%';
  info.push(`volume: 直近3h ${v.todaySum} vs 前日同時刻 ${v.yestSum} (${pctStr})`);
  if (v.pctChange != null && v.pctChange <= DROP_PCT) problems.push(`ボリューム異常: 前日同時刻比 ${v.pctChange.toFixed(0)}% (閾値 ${DROP_PCT}%)`);

  const p = await checkPingArrival(token);
  const pStr = p.status === 'idle' ? '未送信(--pingで送信)' : `${p.status} (送信${p.ageMin}分前)`;
  info.push(`ping: ${pStr}`);
  if (p.status === 'missing') problems.push(`MP pingが ${PING_TIMEOUT_MIN}分超受信されていない (受信経路の疑い)`);

  console.log('[info] ' + info.join('\n[info] '));
  if (VERBOSE && problems.length) console.log('[info] 問題: ' + problems.join(' / '));
  if (problems.length) {
    for (const msg of problems) alert('ALERT', msg);
    process.exitCode = 1;
  } else {
    console.log('[ok] all checks passed');
  }
}

if (MODE === 'ping') {
  const r = await sendPing();
  if (r) console.log('[ok] ping sent (seq sent_ms=' + r.sentMs + ')');
} else {
  try { await mainCheck(); }
  catch (e) { alert('ERROR', e.message); process.exitCode = 1; }
}
