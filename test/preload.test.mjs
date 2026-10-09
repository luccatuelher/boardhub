import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhPreloadWindow, bhPreloadBudget, bhPreloadFit } = load(['preload']);

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
  const MB = 1048576;
  assert.deepEqual(bhPreloadBudget({ saveData: true }), { ahead: 1, behind: 0, conc: 1, maxBytes: 80 * MB });
  assert.deepEqual(bhPreloadBudget({ effectiveType: '2g' }), { ahead: 1, behind: 0, conc: 1, maxBytes: 80 * MB });
  assert.deepEqual(bhPreloadBudget({ effectiveType: 'slow-2g' }), { ahead: 1, behind: 0, conc: 1, maxBytes: 80 * MB });
  assert.deepEqual(bhPreloadBudget({ effectiveType: '3g' }), { ahead: 2, behind: 1, conc: 2, maxBytes: 120 * MB });
  assert.deepEqual(bhPreloadBudget({ effectiveType: '4g' }), { ahead: 4, behind: 2, conc: 3, maxBytes: 160 * MB });
  assert.deepEqual(bhPreloadBudget(), { ahead: 4, behind: 2, conc: 3, maxBytes: 160 * MB });
  assert.deepEqual(bhPreloadBudget({ deviceMemory: 4 }), { ahead: 2, behind: 1, conc: 3, maxBytes: 80 * MB });
});

test('fit: keeps the leading images that fit, always at least two', () => {
  assert.equal(bhPreloadFit([10, 10, 10, 10], 100), 4);
  assert.equal(bhPreloadFit([60, 60, 60, 60], 130), 2);
  assert.equal(bhPreloadFit([60, 60, 60, 60], 200), 3);
  assert.equal(bhPreloadFit([500, 500, 500], 100), 2, 'the one on screen and the next are never dropped');
  assert.equal(bhPreloadFit([500], 100), 1);
  assert.equal(bhPreloadFit([], 100), 0);
});

test('fit: later (lower priority) images are the ones dropped, e.g. 12 MP frames in a 160 MB budget', () => {
  const frame = 12e6 * 4; // 46 MB decoded
  const n = bhPreloadFit(Array(7).fill(frame), 160 * 1048576);
  assert.equal(n, 3);
});
