// @why: [2026-09-04] kantoku-v5（~/context-compress/PJs/kantoku-v5/runtime/watch.js）から yume-kit/kantoku-watch へ移入。スクリプト実行中の REAL_* 状態だけを観測し JSON レポートに集約する依存ゼロの感覚器。kantoku の「観測」層として保持（判定は lib/arbitrate.mjs が担う）。
// @tags: SPEC
const registry = new Map();
const events = [];

export function watch(name, initialValue, options = {}) {
  if (!name || typeof name !== 'string') throw new Error('watch(name, value) requires a string name');
  const isWatched = /^REAL_[A-Za-z0-9_$]+$/.test(name);
  const cell = {
    name,
    isWatched,
    createdAt: Date.now(),
    value: initialValue,
    changeCount: 0,
    assignmentCount: 0,
    unchangedAssignmentCount: 0,
    issues: [],
    options,
    set(nextValue, reason = 'set') {
      const before = this.value;
      const changed = !sameJSON(before, nextValue);
      this.assignmentCount++;
      if (changed) this.changeCount++;
      else this.unchangedAssignmentCount++;
      this.value = nextValue;
      record({
        kind: 'real_assign',
        name: this.name,
        isWatched: this.isWatched,
        reason,
        changed,
        before: cloneForLog(before),
        after: cloneForLog(nextValue),
      });
      collectValueIssues(this, nextValue);
      return nextValue;
    },
    get() {
      return this.value;
    },
    toJSON() {
      return summarizeCell(this);
    },
  };

  registry.set(name, cell);
  record({
    kind: 'real_init',
    name,
    isWatched,
    value: cloneForLog(initialValue),
  });
  if (!isWatched) {
    cell.issues.push({
      kind: 'not_real_name',
      message: 'watch target should use REAL_* when it is a watched source state',
    });
  }
  collectValueIssues(cell, initialValue);
  return cell;
}

export function report() {
  const watched = Array.from(registry.values()).map(summarizeCell);
  const issues = watched.flatMap(cell =>
    cell.issues.map(issue => ({ name: cell.name, ...issue }))
  );
  for (const cell of watched) {
    if (cell.isWatched && cell.assignmentCount > 0 && cell.changeCount === 0) {
      issues.push({
        name: cell.name,
        kind: 'real_state_frozen',
        message: `${cell.name} was assigned ${cell.assignmentCount} time(s) but never changed`,
      });
    }
  }
  return {
    ok: issues.length === 0,
    watched,
    issues,
    eventCount: events.length,
    events: events.slice(),
  };
}

export function reset() {
  registry.clear();
  events.length = 0;
}

export function getWatched(name) {
  return registry.get(name) || null;
}

function record(entry) {
  events.push({ at: Date.now(), ...entry });
}

function summarizeCell(cell) {
  return {
    name: cell.name,
    isWatched: cell.isWatched,
    assignmentCount: cell.assignmentCount,
    changeCount: cell.changeCount,
    unchangedAssignmentCount: cell.unchangedAssignmentCount,
    lastValue: cloneForLog(cell.value),
    issues: cell.issues.slice(),
  };
}

function collectValueIssues(cell, value) {
  const bad = findBadValues(value);
  for (const path of bad) {
    const key = `bad_value:${path}`;
    if (cell.issues.some(i => i.key === key)) continue;
    cell.issues.push({
      key,
      kind: 'bad_real_value',
      path,
      message: `${cell.name} contains non-finite or undefined value at ${path}`,
    });
  }
  if (!isJSONSerializable(value)) {
    const key = 'not_json_serializable';
    if (!cell.issues.some(i => i.key === key)) {
      cell.issues.push({
        key,
        kind: 'not_json_serializable',
        message: `${cell.name} should be JSON serializable`,
      });
    }
  }
}

function findBadValues(value, path = '$') {
  if (value === undefined) return [path];
  if (typeof value === 'number' && !Number.isFinite(value)) return [path];
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => findBadValues(v, `${path}[${i}]`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => findBadValues(v, `${path}.${k}`));
  }
  return [];
}

function sameJSON(a, b) {
  return JSON.stringify(cloneForLog(a)) === JSON.stringify(cloneForLog(b));
}

function isJSONSerializable(value) {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

function cloneForLog(value) {
  if (value === undefined) return { __kantoku: 'undefined' };
  if (typeof value === 'number' && Number.isNaN(value)) return { __kantoku: 'NaN' };
  if (typeof value === 'number' && value === Infinity) return { __kantoku: 'Infinity' };
  if (typeof value === 'number' && value === -Infinity) return { __kantoku: '-Infinity' };
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { __kantoku: 'unserializable', type: typeof value };
  }
}
