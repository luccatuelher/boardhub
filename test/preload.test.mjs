import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhPreloadWindow, bhPreloadBudget, bhEvictPlan } = load(['preload']);

test('window: current, next, previous, rest ahead, rest behind', () => {
  assert.deepEqual(bhPreloadWindow(5, 40, 4, 2, 1), [5, 6, 4, 7, 8, 9, 3]);
});

test('window: travelling backwards swaps ahead/behind', () => {
  assert.deepEqual(bhPreloadWindow(5, 40, 4, 2, -1), [5, 4, 6, 3, 2, 1, 7]);
});

test('window: clipped at both ends, no duplicates, empty for bad input', () => {
  assert.deepEqual(bhPreloadWindow(0, 3, 4, 2, 1), [0, 1, 2]);
  assert.deepEqual(bhPreloadWindow(2, 3, 4, 2, 1), [2, 1, 0]);
  assert.deepEqual(bhPreloadWindow(0, 1, 4, 2), [0]);
  for (const bad of [[-1, 5], [5, 5], [0, 0], [1.5, 5], [NaN, 5]]) assert.deepEqual(bhPreloadWindow(bad[0], bad[1], 4, 2), [], String(bad));
});

test('window: zero ahead/behind keeps only the current', () => {
  assert.deepEqual(bhPreloadWindow(3, 10, 0, 0), [3]);
  assert.deepEqual(bhPreloadWindow(3, 10, 1, 0), [3, 4]);
});

test('budget: save-data and 2g are minimal, 3g reduced, default full, low memory caps ahead', () => {
  assert.deepEqual(bhPreloadBudget({ saveData: true }), { ahead: 1, behind: 0, conc: 1 });
  assert.deepEqual(bhPreloadBudget({ effectiveType: '2g' }), { ahead: 1, behind: 0, conc: 1 });
  assert.deepEqual(bhPreloadBudget({ effectiveType: 'slow-2g' }), { ahead: 1, behind: 0, conc: 1 });
  assert.deepEqual(bhPreloadBudget({ effectiveType: '3g' }), { ahead: 2, behind: 1, conc: 2 });
  assert.deepEqual(bhPreloadBudget({ effectiveType: '4g' }), { ahead: 4, behind: 2, conc: 3 });
  assert.deepEqual(bhPreloadBudget(), { ahead: 4, behind: 2, conc: 3 });
  assert.deepEqual(bhPreloadBudget({ deviceMemory: 4 }), { ahead: 2, behind: 2, conc: 3 });
});

const E = (key, dist, bytes = 10, wanted = true) => ({ key, dist, bytes, wanted });

test('evict: anything outside the window goes first', () => {
  assert.deepEqual(bhEvictPlan([E('a', 0), E('b', 1), E('c', Infinity, 10, false)], 5, 1000), ['c']);
});

test('evict: over the count cap, the farthest go; the current one never does', () => {
  const plan = bhEvictPlan([E('cur', 0), E('n1', 1), E('n2', 2), E('n3', 3)], 2, 1000);
  assert.deepEqual(plan.sort(), ['n2', 'n3']);
  assert.ok(!bhEvictPlan([E('cur', 0)], 0, 0).includes('cur'));
});

test('evict: over the byte cap, drop farthest until it fits', () => {
  const plan = bhEvictPlan([E('cur', 0, 60), E('n1', 1, 60), E('n2', 2, 60)], 10, 130);
  assert.deepEqual(plan, ['n2']);
});

test('evict: nothing to do when under both caps', () => {
  assert.deepEqual(bhEvictPlan([E('cur', 0), E('n1', 1)], 5, 1000), []);
});
