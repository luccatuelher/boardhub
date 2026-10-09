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
  assert.deepEqual(r, { total: 3, done: 3, failed: 0 });
  assert.deepEqual(W.calls.filter(c => c[1] === 'thumb').map(c => c[0]).sort(), [fb(1), fb(2), fb(3)].sort());
  assert.deepEqual(W.calls.filter(c => c[1] === 'disp').length, 3);
  assert.equal(W.released, 6, 'every handle is released');
  assert.equal(progress.at(-1)[0], 3);
  // newest post (id 2, Sept) is started before the January one
  assert.ok(W.calls.findIndex(c => c[0] === fb(3)) < W.calls.findIndex(c => c[0] === fb(2)));
});

test('runs 4 at a time and stops when cancelled', async () => {
  const W = world();
  const posts = [{ id: 1, date: 'x', images: Array.from({ length: 20 }, (_, i) => fb(i + 10)) }];
  let stop = false;
  const r = await W.bhPreloadAllPosts(posts, d => { if (d >= 6) stop = true; }, () => stop);
  assert.ok(W.peak <= 4);
  assert.ok(r.done < 20 && r.done >= 6, 'stopped early: ' + r.done);
});

test('a failing image is counted and the rest go on', async () => {
  const W = world();
  const { bhPreloadAllPosts } = load(['preloadall'], { stubs: {
    bhIsFirebaseImage: () => true, isVideoSrc: () => false,
    bhRemoteDisplay: async src => { if (src === 'bad') throw new Error('x'); return { url: '', release() {} }; },
  } });
  const r = await bhPreloadAllPosts([{ images: ['a', 'bad', 'c'] }], () => {}, () => false);
  assert.deepEqual(r, { total: 3, done: 3, failed: 1 });
});
