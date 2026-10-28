import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhProjectPostPaid, bhProjectUnpaidShare, bhProjectTogglePaid, bhProjectSetAllPaid, bhProjectPostValue, bhProjectSetPostValues } = load(['gallinks']);
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

test('the share still to receive is weighted by each animatic value', () => {
  const p = { unitValue: 100, postValues: { a: 400 }, paidPosts: ['a'] };
  // a=400 (received), b,c,d = 100 each (to receive): 300 of 700.
  assert.equal(Math.round(bhProjectUnpaidShare(p, ids) * 700), 300);
  // A typed animatic count other than the number of posts: money still adds up.
  const more = { unitValue: 100, animatics: 10, postValues: { a: 1000 }, paidPosts: ['a'] };
  assert.equal(Math.round(bhProjectUnpaidShare(more, ['a', 'b']) * 1900), 900);
  const fewer = { unitValue: 100, animatics: 2, postValues: { a: 300 }, paidPosts: ['a'] };
  assert.equal(Math.round(bhProjectUnpaidShare(fewer, ['a', 'b', 'c', 'd', 'e']) * 400), 100);
  assert.equal(bhProjectUnpaidShare({ ...p, paid: true }, ids), 0);
  // Without their own values the share is the plain count ratio, as before.
  assert.equal(bhProjectUnpaidShare({ unitValue: 100, paidPosts: ['a'] }, ids), 0.75);
  assert.equal(bhProjectUnpaidShare({ paidPosts: ['a'], postValues: {} }, ids), 0.75, 'no Valor at all: count ratio');
});

test('a post value is its own or Valor, and setting values for a group is reversible', () => {
  const p = { unitValue: 100, postValues: { a: 250 } };
  assert.equal(bhProjectPostValue(p, 'a'), 250);
  assert.equal(bhProjectPostValue(p, 'b'), 100);
  assert.equal(bhProjectPostValue({ budget: 80 }, 'b'), 80, 'older projects use the stored budget as Valor');
  assert.deepEqual(bhProjectSetPostValues(p, ['b', 'c'], '300'), { a: 250, b: 300, c: 300 });
  assert.deepEqual(bhProjectSetPostValues({ postValues: { a: 250, b: 300 } }, ['b'], ''), { a: 250 });
  assert.deepEqual(bhProjectSetPostValues({}, ['a'], '1,5'), { a: 1.5 });
  assert.deepEqual(bhProjectSetPostValues({ postValues: { a: 5 } }, ['a'], 'abc'), { a: 5 }, 'unreadable input changes nothing');
});
