import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhProjectTotal, bhProjectBudget } = load(['projtotal']);

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

test('budget: typed animatics win; otherwise each linked post is one animatic', () => {
  assert.equal(bhProjectBudget({ unitValue: '100', animatics: 5 }, 9), 500);
  assert.equal(bhProjectBudget({ unitValue: '100' }, 4), 400);
  assert.equal(bhProjectBudget({ unitValue: 100, animatics: 0 }, 3), 300);
  assert.equal(bhProjectBudget({ unitValue: 100 }, 0), 100); // nothing linked yet: the value is the whole price
  assert.equal(bhProjectBudget({ unitValue: '' }, 3), 0);
});

test('budget: projects without unitValue keep their stored price whatever is linked', () => {
  assert.equal(bhProjectBudget({ budget: '2500' }, 7), 2500);
  assert.equal(bhProjectBudget({ budget: 2500, animatics: 3 }, 7), 2500);
  assert.equal(bhProjectBudget({}, 7), 0);
  assert.equal(bhProjectBudget(null, 7), 0);
});
