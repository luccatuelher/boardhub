import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhProjectTotal } = load(['projtotal']);

test('total is value × animatics', () => {
  assert.equal(bhProjectTotal(500, 5), 2500);
  assert.equal(bhProjectTotal('250.5', '4'), 1002);
});

test('no animatics yet: the value is the whole price (legacy budgets keep working)', () => {
  assert.equal(bhProjectTotal(2500, 0), 2500);
  assert.equal(bhProjectTotal('2500', ''), 2500);
  assert.equal(bhProjectTotal(2500, undefined), 2500);
});

test('empty, zero, negative or garbage value gives 0', () => {
  for (const v of ['', 0, -3, 'abc', null, undefined]) assert.equal(bhProjectTotal(v, 3), 0);
});
