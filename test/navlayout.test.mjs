import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { BH_NAV_DEFAULT, bhNavLayout, bhNavMove } = load(['navlayout']);

test('no saved layout gives the three default groups', () => {
  assert.deepEqual(bhNavLayout(undefined), BH_NAV_DEFAULT);
  assert.deepEqual(bhNavLayout('junk'), BH_NAV_DEFAULT);
});

test('saved order is kept; unknown and duplicate ids dropped; missing ids return to default group', () => {
  const out = bhNavLayout([['gallery', 'x', 'dashboard'], ['studies', 'gallery'], ['sync']]);
  assert.deepEqual(out, [['gallery', 'dashboard', 'projects'], ['studies', 'ideas', 'mentors'], ['sync', 'social', 'clients']]);
  assert.equal(out.flat().length, 9);
});

test('move reorders within and across groups without mutating', () => {
  const l = bhNavLayout();
  assert.deepEqual(bhNavMove(l, 'gallery', 0, 0)[0], ['gallery', 'dashboard', 'projects']);
  const m = bhNavMove(l, 'sync', 1, 1);
  assert.deepEqual(m[1], ['ideas', 'sync', 'studies', 'mentors']);
  assert.deepEqual(m[2], ['social', 'clients']);
  assert.deepEqual(l, BH_NAV_DEFAULT);
  assert.equal(bhNavMove(l, 'nope', 0, 0), l);
});
