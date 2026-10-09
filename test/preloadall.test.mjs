import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const fb = n => `https://firebasestorage.googleapis.com/v0/b/x/o/sha256_${String(n).padStart(2, '0').repeat(32)}_image_png`;
function world() {
  const calls = [];let live = 0, peak = 0, released = 0;
  const stubs = {
    bhIsFirebaseImage: u => typeof u === 'string' && u.startsWith('https://firebasestorage'),
    isVideoSrc: u => /_video_/.test(u),
    bhRemoteDisplay: async (src, v) => { calls.push([src, v]); live++; peak = Math.max(peak, live); await new Promise(r => setTimeout(r, 5)); live--; return { url: 'blob:x', release() { released++; } }; },
  };
  const { bhPreloadAllPosts } = load(['preloadall'], { stubs });
  return { bhPreloadAllPosts, calls, get peak() { return peak; }, get released() { return released; } };
}

test('loads thumbnail and full view of every live post image once, newest posts first', async () => {
  const W = world();
  const posts = [
    { id: 1, date: '2026-01-01', images: [fb(1), fb(2)] },
    { id: 2, date: '2026-09-01', images: [fb(3), fb(1), 'idb://local', 'https://example.com/a.png', fb(4).replace('_image_png', '_video_mp4')] },
    { id: 3, date: '2026-10-01', deleted: true, images: [fb(9)] },
  ];
  const progress = [];
  const r = await W.bhPreloadAllPosts(posts, (d, t) => progress.push([d, t]), () => false);
  assert.deepEqual(r, { total: 3, done: 3, failed: 0, cors: false, already: 0, all: 3 });
  assert.deepEqual(W.calls.filter(c => c[1] === 'thumb').map(c => c[0]).sort(), [fb(1), fb(2), fb(3)].sort());
  assert.deepEqual(W.calls.filter(c => c[1] === 'disp').length, 3);
  assert.equal(W.released, 6, 'every handle is released');
  assert.equal(progress.at(-1)[0], 3);
  // newest post (id 2, Sept) is started before the January one
  assert.ok(W.calls.findIndex(c => c[0] === fb(3)) < W.calls.findIndex(c => c[0] === fb(2)));
});

test('runs 8 images at a time (thumbnail and full view together) and stops when cancelled', async () => {
  const W = world();
  const posts = [{ id: 1, date: 'x', images: Array.from({ length: 20 }, (_, i) => fb(i + 10)) }];
  let stop = false;
  const r = await W.bhPreloadAllPosts(posts, d => { if (d >= 6) stop = true; }, () => stop);
  assert.ok(W.peak <= 16);
  assert.ok(r.done < 20 && r.done >= 6, 'stopped early: ' + r.done);
});

test('a failing image is counted and the rest go on', async () => {
  const W = world();
  const { bhPreloadAllPosts } = load(['preloadall'], { stubs: {
    bhIsFirebaseImage: () => true, isVideoSrc: () => false,
    bhRemoteDisplay: async src => { if (src === 'bad') throw new Error('x'); return { url: '', release() {} }; },
  } });
  const r = await bhPreloadAllPosts([{ images: ['a', 'bad', 'c'] }], () => {}, () => false);
  assert.deepEqual(r, { total: 3, done: 3, failed: 1, cors: false, already: 0, all: 3 });
});

test('images already on this computer are skipped up front: the count is what is left', async () => {
  const W = world();
  const posts = [{ id: 1, date: 'x', images: [fb(1), fb(2), fb(3)] }];
  const progress = [];
  const r = await W.bhPreloadAllPosts(posts, (d, t) => progress.push([d, t]), () => false, new Set([fb(1), fb(3)]));
  assert.deepEqual(W.calls.map(c => c[0]), [fb(2), fb(2)]);
  assert.deepEqual(progress, [[1, 1]]);
  assert.equal(r.already, 2);
  assert.equal(r.all, 3);
});

test('local = thumbnail cached and the full view (display copy when known, else original) cached', () => {
  const { bhImageIsLocal } = load(['preloadall'], { stubs: { bhIsFirebaseImage: () => true, isVideoSrc: () => false, bhRemoteDisplay: async () => ({}) } });
  const rec = (blobs, thumbs, disps = {}) => ({ blobs: new Set(blobs), thumbs: new Map(Object.entries(thumbs)), disps: new Map(Object.entries(disps)) });
  assert.equal(bhImageIsLocal('s', rec(['t', 's'], { s: 't' })), true, 'thumb + original');
  assert.equal(bhImageIsLocal('s', rec(['t', 'd'], { s: 't' }, { s: { url: 'd' } })), true, 'thumb + display copy');
  assert.equal(bhImageIsLocal('s', rec(['t', 's'], { s: 't' }, { s: { url: 'd' } })), false, 'the full view would fetch the display copy');
  assert.equal(bhImageIsLocal('s', rec(['s'], { s: 's' }, { s: { none: 'small' } })), true, 'no separate thumbnail: the original is both');
  const ca = 'users/u/images/sha256_' + 'a'.repeat(64) + '_image_png';
  assert.equal(bhImageIsLocal(ca, rec([ca], {})), false, 'content-addressed upload whose thumbnail was never looked up');
  assert.equal(bhImageIsLocal('s', rec(['t'], { s: 't' }, { s: { none: 'missing' } })), false, 'original not cached');
});

test('older uploads (img_….jpg) have no separate thumbnail: the cached original counts for both', () => {
  const { bhImageIsLocal } = load(['preloadall'], { stubs: { bhIsFirebaseImage: () => true, isVideoSrc: () => false, bhRemoteDisplay: async () => ({}) } });
  const legacy = 'https://firebasestorage.googleapis.com/v0/b/x/o/users%2Fu%2Fimages%2Fimg_1787922414181_4gf8isfs1a7.jpg?alt=media';
  const rec = blobs => ({ blobs: new Set(blobs), thumbs: new Map(), disps: new Map() });
  assert.equal(bhImageIsLocal(legacy, rec([legacy])), true);
  assert.equal(bhImageIsLocal(legacy, rec([])), false);
});

test('cloud image detection: content-addressed, image extensions, and older img_….img/.bin uploads; never videos', () => {
  const { bhIsFirebaseImage } = load(['fbimg']);
  const u = name => 'https://firebasestorage.googleapis.com/v0/b/x/o/' + encodeURIComponent('users/u/images/' + name) + '?alt=media&token=t';
  assert.equal(bhIsFirebaseImage(u('sha256_' + 'a'.repeat(64) + '_image_webp')), true);
  assert.equal(bhIsFirebaseImage(u('img_1787922414181_4gf8isfs1a7.jpg')), true);
  assert.equal(bhIsFirebaseImage(u('img_1788957033185_raeqcd60f5m.img')), true);
  assert.equal(bhIsFirebaseImage(u('img_1785763672937_t71di0u2hhs.bin')), true);
  assert.equal(bhIsFirebaseImage(u('sha256_' + 'a'.repeat(64) + '_video_mp4')), false);
  assert.equal(bhIsFirebaseImage(u('clip.mp4')), false);
  assert.equal(bhIsFirebaseImage(u('notes.bin')), false);
  assert.equal(bhIsFirebaseImage('https://example.com/a.png'), false);
});
