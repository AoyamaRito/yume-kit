#!/usr/bin/env node
// ctxlog — タグ付きコンテキストログ CLI（依存ゼロ・Node >= 18）
// @why: [2026-09-04] pi のセッション履歴は全文が重く、タグ検索ができない。重要な決定・進捗を
// 1行=1エントリの JSONL で保存し、session id / project / kind / tags でフィルタできる
// 圧縮コンテキストログ。新セッション引き継ぎの外部メモリと検索基盤を兼ねる。
// @tags: SPEC
const fs = require('fs');
const path = require('path');

// 既定ログ: 実行ディレクトリの .pi/ctxlog.jsonl。プロジェクトごとに分離。
// @why: [2026-09-04] pi_root の .pi/ はプロジェクトローカル設定の置き場。cwd 基準にすることで
// 複数プロジェクトの履歴を混ぜず、仕事場単位で引き継ぎ知識を管理できる。
function defaultLogFile() {
  return path.join(process.cwd(), '.pi', 'ctxlog.jsonl');
}

function resolveLogFile(options) {
  // 優先順: --file > CTXLOG_FILE 環境変数 > cwd/.pi/ctxlog.jsonl
  if (options.file) return options.file;
  if (process.env.CTXLOG_FILE) return process.env.CTXLOG_FILE;
  return defaultLogFile();
}

function help() {
  console.log(`Usage: ctxlog <command> [options]

Commands:
  write <title>            新しいエントリを書く
    --summary <text>       要約（自由文、必要ならクォート）
    --session <id>         セッションID（省略可）
    --project <name>       プロジェクト名（既定: cwd のディレクトリ名）
    --kind <type>          種別: note / task / research / decision / ui / code / bugfix（既定 note）
    --tags <a,b,c>         カンマ区切りタグ（AND 検索に使用）
    --file <path>          保存先を別指定

  ls [--limit N] [--json]  最新エントリ一覧（既定 10 件・新しい順）

  search [query]           キーワード検索（title/summary/project/tags を部分一致）
    --session <id>         セッションIDで絞り込み
    --project <name>       プロジェクト名で絞り込み
    --kind <a,b>           種別で絞り込み（カンマは OR）
    --tags <a,b>           タグで絞り込み（カンマは AND）
    --limit N              最大件数（既定 20）
    --json                 機械可読（JSON 配列）

  get --session <id> [--json]  セッションID指定で全エントリを表示

Options:
  -h, --help               このヘルプ
`);
}

// ---- 書き込み ----

function writeEntry(title, options) {
  const file = resolveLogFile(options);
  const cwdName = path.basename(process.cwd());
  const entry = {
    ts: new Date().toISOString(),
    session: options.session || null,
    project: options.project || cwdName,
    kind: options.kind || 'note',
    tags: options.tags ? options.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    title,
    summary: options.summary || '',
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  if (options.json) {
    console.log(JSON.stringify({ ok: true, file, entry }, null, 2));
  } else {
    console.log(`ctxlog: wrote "${title}" -> ${file}`);
    console.log(`  ts: ${entry.ts} kind: ${entry.kind} project: ${entry.project}`);
  }
  return entry;
}

// ---- 読み込み・フィルタ ----

function readEntries(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null; // 壊れた行は無視（推論を止めない）
      }
    })
    .filter(Boolean);
}

function norm(s) {
  return String(s || '').toLowerCase();
}

function matchesEntry(e, { session, project, kind, tags, query }) {
  if (session && !norm(e.session).startsWith(norm(session))) return false;
  if (project && !norm(e.project).includes(norm(project))) return false;
  if (kind) {
    const kinds = kind.split(',').map((k) => norm(k.trim())).filter(Boolean);
    if (kinds.length && !kinds.includes(norm(e.kind))) return false;
  }
  if (tags) {
    const and = tags.split(',').map((t) => norm(t.trim())).filter(Boolean);
    const mine = new Set((e.tags || []).map(norm));
    if (and.length && !and.every((t) => mine.has(t))) return false;
  }
  if (query) {
    const hay = norm([e.title, e.summary, e.project, (e.tags || []).join(' ')].join(' '));
    if (!hay.includes(norm(query))) return false;
  }
  return true;
}

function fmtEntry(e, i) {
  const ts = e.ts ? e.ts.slice(0, 16).replace('T', ' ') : '';
  const tags = (e.tags || []).length ? ` [${e.tags.join(',')}]` : '';
  const ses = e.session ? ` s:${e.session}` : '';
  return `#${i} ${ts} ${e.kind} project=${e.project}${ses}${tags}\n   ${e.title}${e.summary ? `\n   ${e.summary}` : ''}`;
}

function cmdLs(file, options) {
  const entries = readEntries(file).slice().reverse(); // 新しい順
  const limit = options.limit === '0' ? entries.length : Number(options.limit || 10);
  const sliced = entries.slice(0, limit);
  if (options.json) return console.log(JSON.stringify(sliced, null, 2));
  console.log(`ctxlog: ${entries.length} entries (showing ${sliced.length}) in ${file}`);
  sliced.forEach((e, i) => console.log(fmtEntry(e, i + 1)));
}

function cmdSearch(file, query, options) {
  const hits = readEntries(file)
    .slice()
    .reverse()
    .filter((e) => matchesEntry(e, { session: options.session, project: options.project, kind: options.kind, tags: options.tags, query }));
  const limit = options.limit === '0' ? hits.length : Number(options.limit || 20);
  const sliced = hits.slice(0, limit);
  if (options.json) return console.log(JSON.stringify(sliced, null, 2));
  console.log(`ctxlog: ${hits.length} hit(s) (showing ${sliced.length}) in ${file}`);
  sliced.forEach((e, i) => console.log(fmtEntry(e, i + 1)));
}

function cmdGet(file, sessionId, options) {
  const hits = readEntries(file).filter((e) => matchesEntry(e, { session: sessionId }));
  if (options.json) return console.log(JSON.stringify(hits, null, 2));
  console.log(`ctxlog: ${hits.length} entry/ies for session ${sessionId}`);
  hits.forEach((e, i) => console.log(fmtEntry(e, i + 1)));
}

// ---- エントリポイント ----

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === '-h' || cmd === '--help') {
    help();
    return;
  }

  const options = {};
  const positional = [];
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        options[key] = next;
        i++;
      } else {
        options[key] = true;
      }
    } else {
      positional.push(a);
    }
  }

  const file = resolveLogFile(options);

  switch (cmd) {
    case 'write':
      if (!positional[0]) {
        console.error('ctxlog: <title> is required for write');
        process.exit(1);
      }
      writeEntry(positional[0], options);
      break;
    case 'ls':
      cmdLs(file, options);
      break;
    case 'search':
      cmdSearch(file, positional[0], options);
      break;
    case 'get':
      if (!options.session) {
        console.error('ctxlog: --session is required for get');
        process.exit(1);
      }
      cmdGet(file, options.session, options);
      break;
    default:
      console.error(`ctxlog: unknown command '${cmd}'`);
      process.exit(1);
  }
}

main();