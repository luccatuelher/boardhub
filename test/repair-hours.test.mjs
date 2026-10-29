import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { pomoRepairAvailable, pomoRepairApply, pomoApplyRetargets, pomoMergeProgress } = load(['date', 'rank']);
const WORK = [['2026-03-04', 1549], ['2026-03-05', 1534], ['2026-03-06', 11723], ['2026-03-07', 7245], ['2026-03-09', 6851], ['2026-03-25', 415], ['2026-03-26', 1786], ['2026-03-27', 1793], ['2026-04-06', 1763], ['2026-04-14', 1799], ['2026-04-16', 3541], ['2026-04-17', 1799], ['2026-07-26', 6464], ['2026-07-27', 3598], ['2026-07-28', 6319], ['2026-08-03', 4505], ['2026-08-04', 12623], ['2026-08-05', 7226], ['2026-08-07', 5327], ['2026-08-08', 943], ['2026-08-10', 5404], ['2026-08-11', 6602], ['2026-08-12', 7200], ['2026-08-16', 1887], ['2026-08-17', 3600]];
const sum = m => Object.values(m || {}).reduce((a, b) => a + (Number(b) || 0), 0);
const P = 'project:1771504227732';
function state() {
  const days = {}, daily = {};
  WORK.forEach(([d, s]) => { days[d] = s; daily[d] = { 'cat:work': s }; });
  days['2026-08-28'] = 1800; daily['2026-08-28'] = { 'cat:movie-studies': 1800 };
  days['2026-09-07'] = 1861; daily['2026-09-07'] = { 'cat:movie-studies': 1861 };
  days['2026-09-09'] = 1740 + 3600; daily['2026-09-09'] = { 'cat:movie-studies': 1740, [P]: 3600 };
  const allocations = {}; Object.values(daily).forEach(m => Object.entries(m).forEach(([k, v]) => { allocations[k] = (allocations[k] || 0) + v; }));
  return { days, allocations, dailyAllocations: daily, rank: { sessions: [] } };
}

test('repair moves Work days to 3 Palavrinhas and marks Movie Studies hours; every total is kept', () => {
  const base = state();
  assert.ok(pomoRepairAvailable(base) > 0);
  const out = pomoRepairApply(base);
  assert.equal(sum(out.allocations), sum(base.allocations));
  assert.equal(out.allocations['cat:work'] || 0, 0);
  assert.equal(out.allocations['cat:movie-studies'], 1800 + 1861 + 1740); // marking only
  assert.equal(JSON.stringify(out.days), JSON.stringify(base.days));
  Object.keys(base.dailyAllocations).forEach(d => assert.equal(sum(out.dailyAllocations[d]), sum(base.dailyAllocations[d])));
  const ms = out.rank.sessions.filter(r => r.sectionId === 'smuwplssmeah');
  assert.equal(ms.reduce((n, r) => n + r.durationSeconds, 0), 5401);
});

test('repair runs once and only on matching data', () => {
  const out = pomoRepairApply(state());
  assert.equal(pomoRepairAvailable(out), 0);
  assert.equal(JSON.stringify(pomoRepairApply(out)), JSON.stringify(out));
  const other = state(); other.dailyAllocations['2026-03-04']['cat:work'] = 1; // data differs: no Work move
  const o2 = pomoRepairApply(other);
  assert.equal(o2.allocations['cat:work'], other.allocations['cat:work']);
});

test('a stale device gets the same result once, never a double count', () => {
  const base = state();
  const fixed = pomoRepairApply(base);
  const stale = pomoApplyRetargets(base, fixed);
  assert.equal(stale.allocations['cat:work'] || 0, 0);
  assert.equal(stale.allocations[P], fixed.allocations[P]);
  const merged = pomoMergeProgress(stale, fixed);
  assert.equal(merged.allocations[P], fixed.allocations[P]);
  assert.equal(sum(merged.allocations), sum(base.allocations));
});
