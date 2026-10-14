import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhProjectPostPaid, bhProjectUnpaidShare, bhProjectTogglePaid, bhProjectSetAllPaid } = load(['gallinks']);
const ids = ['a', 'b', 'c', 'd'];

test('a post is received when the master switch is on or it is listed', () => {
  assert.equal(bhProjectPostPaid({ paid: true }, 'a'), true);
  assert.equal(bhProjectPostPaid({ paidPosts: ['a'] }, 'a'), true);
  assert.equal(bhProjectPostPaid({ paidPosts: ['a'] }, 'b'), false);
  assert.equal(bhProjectPostPaid(null, 'a'), false);
});

test('the share still to receive follows the unpaid posts', () => {
  assert.equal(bhProjectUnpaidShare({ paid: true }, ids), 0);
  assert.equal(bhProjectUnpaidShare({}, ids), 1);
  assert.equal(bhProjectUnpaidShare({ paidPosts: ['a'] }, ids), 0.75);
  assert.equal(bhProjectUnpaidShare({ paidPosts: ['a'] }, []), 1, 'no posts to split by: all or nothing');
});

test('marking posts one by one turns the master switch on with the last one', () => {
  let p = {};
  p = { ...p, ...bhProjectTogglePaid(p, ids, 'a') };
  assert.deepEqual(p, { paid: false, paidPosts: ['a'] });
  p = { ...p, ...bhProjectTogglePaid(p, ids, 'b') };
  p = { ...p, ...bhProjectTogglePaid(p, ids, 'c') };
  p = { ...p, ...bhProjectTogglePaid(p, ids, 'd') };
  assert.deepEqual(p, { paid: true, paidPosts: [] });
});

test('unmarking one post while everything is received spreads the rest over the others', () => {
  const p = { paid: true, paidPosts: [] };
  assert.deepEqual(bhProjectTogglePaid(p, ids, 'b'), { paid: false, paidPosts: ['a', 'c', 'd'] });
  assert.deepEqual(bhProjectTogglePaid({ paidPosts: ['a', 'b'] }, ids, 'a'), { paid: false, paidPosts: ['b'] });
  assert.deepEqual(bhProjectSetAllPaid(true), { paid: true, paidPosts: [] });
  assert.deepEqual(bhProjectSetAllPaid(false), { paid: false, paidPosts: [] });
});
