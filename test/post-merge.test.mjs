import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhStripPostDate, bhMergePosts } = load(['postmerge']);

test('strips a leading day/month (and year) with a dash or colon', () => {
  assert.equal(bhStripPostDate('08/10 - Back from the brink'), 'Back from the brink');
  assert.equal(bhStripPostDate('8/1/2026 – Roteiro'), 'Roteiro');
  assert.equal(bhStripPostDate('29/09: Cena 3'), 'Cena 3');
  assert.equal(bhStripPostDate('Back 08/10 - x'), 'Back 08/10 - x');
  assert.equal(bhStripPostDate('Sem data'), 'Sem data');
  assert.equal(bhStripPostDate(null), '');
});

const posts = [
  { id: 'top', title: '29/09 - Back from the brink', date: '2026-09-29', images: ['t1', 't2'], content: 'novo', bannerImage: 't2' },
  { id: 'mid', title: '15/09 - Back from the brink', date: '2026-09-15', images: ['m1'], content: '' },
  { id: 'bot', title: '09/09 - Back from the brink', date: '2026-09-09', images: ['b1', 'b2'], content: 'velho', sourceSessionId: 's1' },
];

test('frames go from the lowest card (oldest) to the highest (newest)', () => {
  const r = bhMergePosts(posts, ['top', 'mid', 'bot'], 'top');
  assert.deepEqual(r.images, ['b1', 'b2', 'm1', 't1', 't2']);
  assert.equal(r.keepId, 'top');
  assert.deepEqual(r.removedIds.sort(), ['bot', 'mid']);
  assert.equal(r.content, 'velho\n\nnovo');
  assert.equal(bhMergePosts(posts, ['top', 'mid', 'bot'], 'top', ' | ').content, 'velho | novo');
  assert.equal(r.date, '2026-09-29'); // the surviving post keeps its own date
  assert.equal(r.bannerImage, 't2');
  assert.deepEqual(r.sourceSessionIds, ['s1']);
  assert.equal(r.defaultName, 'Back from the brink');
});

test('order follows the screen, not the dates', () => {
  // the owner's manual order puts the September 9th post on top
  const r = bhMergePosts(posts, ['bot', 'top', 'mid'], undefined);
  assert.equal(r.keepId, 'bot');
  assert.deepEqual(r.images, ['m1', 't1', 't2', 'b1', 'b2']);
});

test('dropped on a chosen post: that one survives; posts not on screen count as oldest', () => {
  const r = bhMergePosts(posts, ['top', 'mid'], 'mid');
  assert.equal(r.keepId, 'mid');
  assert.deepEqual(r.images, ['b1', 'b2', 'm1', 't1', 't2']);
});

test('a banner that is gone falls back to the first frame; empty input is null', () => {
  const r = bhMergePosts([{ id: 'a', images: ['x'], bannerImage: 'zzz' }, { id: 'b', images: ['y'] }], ['a', 'b'], 'a');
  assert.equal(r.bannerImage, 'y');
  assert.equal(bhMergePosts([], [], 'a'), null);
  assert.equal(bhMergePosts(null, null, null), null);
});
