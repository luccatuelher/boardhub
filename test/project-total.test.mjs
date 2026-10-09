import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhProjectTotal, bhProjectBudget, bhProjectAnimatics } = load(['projtotal']);

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

test('budget: a project without unitValue uses its stored budget as the value', () => {
  assert.equal(bhProjectBudget({ budget: '2500' }, 0), 2500);
  assert.equal(bhProjectBudget({ budget: '500' }, 3), 1500);
  assert.equal(bhProjectBudget({ budget: 2500, animatics: 3 }, 7), 7500);
  assert.equal(bhProjectBudget({}, 7), 0);
  assert.equal(bhProjectBudget(null, 7), 0);
});

test('animatics: typed number wins, else the linked posts', () => {
  assert.equal(bhProjectAnimatics({ animatics: 4 }, 9), 4);
  assert.equal(bhProjectAnimatics({}, 3), 3);
  assert.equal(bhProjectAnimatics({ animatics: 0 }, 0), 0);
  assert.equal(bhProjectAnimatics(null, 2), 2);
});
