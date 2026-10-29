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
    { targets: [{ key: 'cat:1', weight: 3 }, { key: 'cat:2', weight: 1 }, { key: 'bogus:9' }, { key: 'cat:3', weight: 0 }] });
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

test('source category: its sessions move to a project, ledgers follow, source never a target', () => {
  const r = { id: 'w1', targetKey: 'cat:work', durationSeconds: 600, date: '2026-10-01', status: 'registered' };
  const base = { allocations: { 'cat:work': 600 }, dailyAllocations: { '2026-10-01': { 'cat:work': 600 } }, rank: { sessions: [r] } };
  const plan = pomoRedistributePlan(base, { source: 'cat:work', targets: [{ key: 'cat:work' }, { key: 'project:P', label: 'P' }] });
  assert.equal(plan.count, 1);
  assert.equal(plan.perTarget.length, 1);
  const out = pomoRedistributeApply(base, plan, 'b');
  assert.equal(out.allocations['cat:work'] || 0, 0);
  assert.equal(out.allocations['project:P'], 600);
  assert.equal(out.rank.sessions[0].targetKey, 'project:P');
  assert.equal(out.rank.sessions[0].retarget.from, 'cat:work');
});

test('section target inside the source group only sets the section, ledgers unchanged', () => {
  const r = { id: 'w1', targetKey: 'cat:ms', durationSeconds: 600, date: '2026-10-01', status: 'registered' };
  const base = { allocations: { 'cat:ms': 600 }, dailyAllocations: { '2026-10-01': { 'cat:ms': 600 } }, rank: { sessions: [r] } };
  const plan = pomoRedistributePlan(base, { source: 'cat:ms', targets: [{ key: 'sec:ms:s1', catKey: 'cat:ms', sectionId: 's1', label: 'Movie Studies › Noir' }] });
  const out = pomoRedistributeApply(base, plan, 'b');
  assert.equal(out.allocations['cat:ms'], 600);
  assert.equal(out.rank.sessions[0].sectionId, 's1');
  assert.equal(out.rank.sessions[0].sectionLabel, 'Noir');
  assert.equal(out.rank.sessions[0].retarget, undefined);
});

test('unallocated day time can be moved: ledgers gain it once, never more than left', () => {
  const base = { days: { '2026-10-01': 5000 }, allocations: { 'cat:a': 1000 }, dailyAllocations: { '2026-10-01': { 'cat:a': 1000 } }, rank: { sessions: [] } };
  const plan = pomoRedistributePlan(base, { unallocated: true, targets: [{ key: 'cat:b', label: 'B' }] });
  assert.equal(plan.totalSecs, 4000);
  const out = pomoRedistributeApply(base, plan, 'b');
  assert.equal(out.allocations['cat:b'], 4000);
  assert.equal(out.dailyAllocations['2026-10-01']['cat:b'], 4000);
  const again = pomoRedistributeApply(out, plan, 'b');
  assert.equal(again.allocations['cat:b'], 4000);
});

test('source group with noSection skips sessions already in a category of the group', () => {
  const mkr = (id, extra) => ({ id, targetKey: 'cat:ms', durationSeconds: 600, date: '2026-10-01', status: 'registered', ...extra });
  const base = { allocations: { 'cat:ms': 1800 }, dailyAllocations: { '2026-10-01': { 'cat:ms': 1800 } }, rank: { sessions: [mkr('a'), mkr('b', { sectionId: 's9' }), mkr('c', { galleryPostId: 'p1' })] } };
  const plan = pomoRedistributePlan(base, { source: 'cat:ms', noSection: true, targets: [{ key: 'sec:ms:s1', catKey: 'cat:ms', sectionId: 's1', label: 'MS › Noir' }] });
  assert.equal(plan.count, 1);
  assert.equal(plan.assignments[0].id, 'a');
});

test('orphan source: sessions of a category that no longer exists move to a live target', () => {
  const r = { id: 'o1', targetKey: 'cat:gone', durationSeconds: 900, date: '2026-10-01', status: 'registered' };
  const live = ['cat:ms'];
  const base = { allocations: { 'cat:gone': 900 }, dailyAllocations: { '2026-10-01': { 'cat:gone': 900 } }, rank: { sessions: [r, { id: 'o2', targetKey: 'cat:ms', durationSeconds: 100, date: '2026-10-01', status: 'registered' }] } };
  const plan = pomoRedistributePlan(base, { source: 'orphan', live, targets: [{ key: 'cat:ms', label: 'MS' }] });
  assert.equal(plan.count, 1);
  const out = pomoRedistributeApply(base, plan, 'b');
  assert.equal(out.allocations['cat:gone'] || 0, 0);
  assert.equal(out.allocations['cat:ms'], 900);
  assert.equal(out.rank.sessions[0].retarget.from, 'cat:gone');
});
