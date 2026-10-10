import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhSessionPostTitle, bhPlaceInSection } = load(['sesstitle']);

test('default post title: day/month, a dash, then what the session was about', () => {
  assert.equal(bhSessionPostTitle('2026-10-08', 'Back from the brink'), '08/10 - Back from the brink');
  assert.equal(bhSessionPostTitle('2026-01-31T10:00:00', '  Roteiro '), '31/01 - Roteiro');
});

test('no label falls back to "Sem categoria"; an unreadable date leaves just the name', () => {
  assert.equal(bhSessionPostTitle('2026-03-02', ''), '02/03 - Sem categoria');
  assert.equal(bhSessionPostTitle('', 'X'), 'X');
  assert.equal(bhSessionPostTitle(undefined, undefined), 'Sem categoria');
});

test('a new session post goes right after its section marker (top of the section)', () => {
  const order = ['a', 'sec:s1', 'b', 'c', 'sec:s2', 'd'];
  assert.deepEqual(bhPlaceInSection(order, 'x', 's1'), ['a', 'sec:s1', 'x', 'b', 'c', 'sec:s2', 'd']);
  assert.deepEqual(bhPlaceInSection(order, 'x', 's2'), ['a', 'sec:s1', 'b', 'c', 'sec:s2', 'x', 'd']);
  assert.deepEqual(bhPlaceInSection(order, 'c', 's1'), ['a', 'sec:s1', 'c', 'b', 'sec:s2', 'd']);
});

test('missing section marker or bad input leaves the order alone', () => {
  const order = ['a', 'b'];
  assert.equal(bhPlaceInSection(order, 'x', 'nope'), order);
  assert.deepEqual(bhPlaceInSection(null, 'x', 's1'), []);
});
