import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { pomoBlankRows, pomoUnallocatedSeconds, pomoRedistributePlan, pomoRedistributeApply, pomoApplyRetargets, pomoRetargetSession } = load(['date', 'rank']);

const row = (id, secs, day, extra = {}) => ({ id, status: 'saved', date: day, durationSeconds: secs, targetKey: 'none', ...extra });
const mk = (rows, extra = {}) => ({
  days: { '2026-10-01': 5400, '2026-10-02': 3600 }, allocations: {}, dailyAllocations: {},
  rank: { sessions: rows }, ...extra,
});
const rows = () => [row('a', 3600, '2026-10-01'), row('b', 1800, '2026-10-01'), row('c', 3600, '2026-10-02')];
const sum = m => Object.values(m || {}).reduce((a, b) => a + b, 0);

test('blank rows: skips pending, project, category and already-moved sessions; honors dates', () => {
  const base = mk([...rows(), row('p', 60, '2026-10-01', { status: 'pending' }), row('q', 60, '2026-10-01', { targetKey: 'project:1' }),
    row('r', 60, '2026-10-01', { targetKey: 'cat:x' }), row('s', 60, '2026-10-01', { retarget: { from: 'none', to: 'cat:x' } }), row('z', 0, '2026-10-01')]);
  assert.deepEqual(pomoBlankRows(base).map(r => r.id), ['a', 'b', 'c']);
  assert.deepEqual(pomoBlankRows(base, { since: '2026-10-02' }).map(r => r.id), ['c']);
  assert.deepEqual(pomoBlankRows(base, { until: '2026-10-01' }).map(r => r.id), ['a', 'b']);
});

test('plan: even split keeps every second and balances targets', () => {
  const plan = pomoRedistributePlan(mk(rows()), { targets: [{ key: 'cat:1', label: 'A' }, { key: 'cat:2', label: 'B' }] });
  assert.equal(plan.totalSecs, 9000);
  assert.equal(plan.perTarget[0].secs + plan.perTarget[1].secs, 9000);
  assert.equal(plan.assignments.length, 3);
  assert.ok(Math.abs(plan.perTarget[0].secs - plan.perTarget[1].secs) <= 3600);
});

test('plan: weights and invalid targets', () => {
  const plan = pomoRedistributePlan(mk([row('a', 100, '2026-10-01'), row('b', 100, '2026-10-01'), row('c', 100, '2026-10-01'), row('d', 100, '2026-10-01')]),
    { targets: [{ key: 'cat:1', weight: 3 }, { key: 'cat:2', weight: 1 }, { key: 'project:9' }, { key: 'cat:3', weight: 0 }] });
  assert.deepEqual(plan.perTarget.map(t => t.secs), [300, 100]);
  assert.equal(pomoRedistributePlan(mk(rows()), { targets: [] }).assignments.length, 0);
});

test('apply: ledgers gain exactly the moved seconds, day totals untouched', () => {
  const base = mk(rows());
  const plan = pomoRedistributePlan(base, { targets: [{ key: 'cat:1', label: 'A' }, { key: 'cat:2', label: 'B' }] });
  const out = pomoRedistributeApply(base, plan, 'b1');
  assert.equal(sum(out.allocations), 9000);
  assert.equal(sum(out.dailyAllocations['2026-10-01']) + sum(out.dailyAllocations['2026-10-02']), 9000);
  assert.equal(sum(out.days), sum(base.days));
  out.rank.sessions.forEach(r => { assert.ok(r.targetKey.startsWith('cat:')); assert.equal(r.retarget.from, 'none'); assert.equal(r.redistribute.batch, 'b1'); });
  assert.equal(pomoUnallocatedSeconds(out), 0);
  assert.equal(pomoUnallocatedSeconds(base), 9000);
});

test('apply twice is a no-op (no double count)', () => {
  const base = mk(rows());
  const plan = pomoRedistributePlan(base, { targets: [{ key: 'cat:1' }] });
  const once = pomoRedistributeApply(base, plan, 'b1');
  const twice = pomoRedistributeApply(once, plan, 'b2');
  assert.equal(twice, once);
  assert.equal(pomoRedistributeApply(base, { assignments: [] }, 'x'), base);
});

test('rows without a valid local date or with foreign chunks are not moved', () => {
  const base = mk([{ id: 'x', status: 'saved', endedAt: '2026-10-01T12:00:00Z', durationSeconds: 60, targetKey: 'none' },
    row('y', 60, '2026-10-01', { chunks: [{ targetKey: 'cat:z', secs: 60, dateKey: '2026-10-01' }] }), row('ok', 60, '2026-10-01')]);
  assert.deepEqual(pomoBlankRows(base).map(r => r.id), ['ok']);
});

test('sync: the other device applying our retarget markers counts each session once', () => {
  const base = mk(rows());
  const moved = pomoRedistributeApply(base, pomoRedistributePlan(base, { targets: [{ key: 'cat:1' }] }), 'b1');
  const other = pomoApplyRetargets(base, moved);
  assert.equal(sum(other.allocations), 9000);
  assert.equal(pomoApplyRetargets(moved, moved).allocations['cat:1'], moved.allocations['cat:1']);
});
