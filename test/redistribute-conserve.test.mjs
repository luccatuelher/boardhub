import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { pomoRedistributePlan, pomoRedistributeApply } = load(['date', 'rank']);

const sum = m => Object.values(m || {}).reduce((a, b) => a + (Number(b) || 0), 0);
const dayTotals = b => Object.fromEntries(Object.entries(b.dailyAllocations).map(([d, m]) => [d, sum(m)]));
const row = (id, key, secs, day, extra = {}) => ({ id, status: 'saved', date: day, durationSeconds: secs, targetKey: key, ...extra });
const mk = (rows, alloc, daily) => ({ days: { '2026-10-01': 9000 }, allocations: alloc, dailyAllocations: daily, rank: { sessions: rows } });

const cases = [
  ['none -> category', 'none', [{ key: 'cat:a', label: 'A' }]],
  ['none -> project', 'none', [{ key: 'project:p', label: 'P' }]],
  ['none -> section', 'none', [{ key: 'sec:a:s1', catKey: 'cat:a', sectionId: 's1', label: 'A › S' }]],
  ['category -> project', 'cat:a', [{ key: 'project:p', label: 'P' }]],
  ['category -> other category', 'cat:a', [{ key: 'cat:b', label: 'B' }]],
  ['category -> own section', 'cat:a', [{ key: 'sec:a:s1', catKey: 'cat:a', sectionId: 's1', label: 'A › S' }]],
  ['removed category -> category', 'orphan', [{ key: 'cat:b', label: 'B' }]],
];
for (const [name, source, targets] of cases) {
  test('move keeps every total: ' + name, () => {
    const key = source === 'none' ? 'none' : source === 'orphan' ? 'cat:gone' : source;
    const rows = [row('1', key, 1800, '2026-10-01'), row('2', key, 1200, '2026-10-01')];
    const alloc = key === 'none' ? { 'cat:z': 500 } : { [key]: 3000, 'cat:z': 500 };
    const daily = { '2026-10-01': key === 'none' ? { 'cat:z': 500 } : { [key]: 3000, 'cat:z': 500 } };
    const base = mk(rows, alloc, daily);
    const plan = pomoRedistributePlan(base, { source, targets, live: ['cat:a', 'cat:b', 'cat:z'] });
    assert.equal(plan.count, 2);
    const out = pomoRedistributeApply(base, plan, 'b');
    // 'none' sessions were never in the ledgers: they add 3000, everything else only moves.
    const added = key === 'none' ? 3000 : 0;
    assert.equal(sum(out.allocations), sum(base.allocations) + added);
    assert.equal(JSON.stringify(dayTotals(out)), JSON.stringify(Object.fromEntries(Object.entries(dayTotals(base)).map(([d, v]) => [d, v + added]))));
    assert.equal(JSON.stringify(out.days), JSON.stringify(base.days)); // the day totals never change
    // a second run changes nothing
    const again = pomoRedistributeApply(out, plan, 'b');
    assert.equal(JSON.stringify([again.allocations, again.dailyAllocations]), JSON.stringify([out.allocations, out.dailyAllocations]));
  });
}
