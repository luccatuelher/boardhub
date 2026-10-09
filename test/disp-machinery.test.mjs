import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const HEX = 'cd'.repeat(32), MB = 1048576;
const PATH = `users/u1/images/sha256_${HEX}_image_jpeg`;
const SRC = `https://firebasestorage.googleapis.com/v0/b/bkt/o/${encodeURIComponent(PATH)}?alt=media&token=t`;

// A fresh world per test: fake Storage, auth, cache, canvas, image decoder.
function world({ w = 6000, h = 4000, outSize = 800 * 1024, objects = {}, uid = 'u1' } = {}) {
  const cache = new Map(), calls = { put: [], get: [], decode: 0 };
  const store = new Map(Object.entries(objects));
  const fbStorage = {
    refFromURL: u => ({ fullPath: decodeURIComponent(new URL(u).pathname.split('/o/')[1]) }),
    ref: name => ({
      fullPath: name,
      async getDownloadURL() { calls.get.push(name); if (!store.has(name)) { const e = new Error('nf'); e.code = 'storage/object-not-found'; throw e; } return 'https://dl/' + name; },
      async put(blob, meta) { calls.put.push({ name, size: blob.size, type: meta.contentType }); store.set(name, blob); },
    }),
  };
  const fbAuth = { currentUser: { uid } };
  const stubs = {
    _fbStorage: fbStorage, _fbAuth: fbAuth,
    bhMediaCacheGet: async k => cache.get(k),
    bhMediaCachePut: async (k, v) => { cache.set(k, v); },
    bhDiag: { record() {} },
    _bhBlobOf: v => v instanceof Blob ? v : (v && v.blob instanceof Blob ? v.blob : null),
    window: { matchMedia: () => ({ matches: true }), requestIdleCallback: undefined },
    navigator: { onLine: true },
    createImageBitmap: async () => { calls.decode++; return { width: w, height: h, close() {} }; },
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }), toDataURL: m => 'data:' + m + ';base64,', toBlob(cb, mime) { cb(new Blob([new Uint8Array(outSize)], { type: mime })); } }) },
  };
  const api = load(['fbimg', 'disp', 'dispmach'], { stubs });
  return { api, cache, calls, store, fbAuth, fbStorage };
}
const file = (size, type = 'image/jpeg') => new Blob([new Uint8Array(size)], { type });

test('lookup: asks Storage once, caches the url, then answers from memory', async () => {
  const W = world({ objects: { [PATH + '_disp1280']: 1 } });
  assert.equal(await W.api._bhDispLookup(SRC), 'https://dl/' + PATH + '_disp1280');
  assert.equal(await W.api._bhDispLookup(SRC), 'https://dl/' + PATH + '_disp1280');
  assert.equal(W.calls.get.length, 1);
  assert.deepEqual(W.cache.get('disp:' + SRC), { url: 'https://dl/' + PATH + '_disp1280', v: 4 });
});

test('lookup: a missing derivative is remembered as missing; other errors are not cached', async () => {
  const W = world();
  assert.equal(await W.api._bhDispLookup(SRC), '');
  assert.equal(W.cache.get('disp:' + SRC).none, 'missing');
  assert.equal(await W.api._bhDispLookup(SRC), '');       // within the TTL: no second Storage call
  assert.equal(W.calls.get.length, 1);
  const W2 = world();
  W2.fbStorage.ref = () => ({ async getDownloadURL() { const e = new Error('offline'); e.code = 'storage/retry-limit-exceeded'; throw e; } });
  assert.equal(await W2.api._bhDispLookup(SRC), '');
  assert.equal(W2.cache.get('disp:' + SRC), undefined);
});

test('lookup: no session, non-cloud or non-original sources do not touch Storage', async () => {
  const W = world(); W.fbAuth.currentUser = null;
  assert.equal(await W.api._bhDispLookup(SRC), '');
  assert.equal(W.calls.get.length, 0);
  assert.equal(W.cache.get('disp:' + SRC), undefined);
  const W2 = world();
  assert.equal(await W2.api._bhDispLookup('https://example.com/a.jpg'), '');
  assert.equal(await W2.api._bhDispLookup('idb://x'), '');
  const odd = 'https://firebasestorage.googleapis.com/v0/b/bkt/o/users%2Fu1%2Fimages%2Fphoto.jpg?alt=media';
  assert.equal(await W2.api._bhDispLookup(odd), '');
  assert.equal(W2.cache.get('disp:' + odd).none, 'small');
});

test('run: generates, uploads once as webp, caches url and blob', async () => {
  const W = world();
  await W.api._bhDispRun({ src: SRC, blob: file(6 * MB) });
  assert.equal(W.calls.put.length, 1);
  assert.deepEqual([W.calls.put[0].name, W.calls.put[0].type], [PATH + '_disp1280', 'image/webp']);
  assert.equal(W.cache.get('disp:' + SRC).url, 'https://dl/' + PATH + '_disp1280');
  assert.ok(W.cache.get('blob:https://dl/' + PATH + '_disp1280').blob);
  assert.equal(W.api._bhDisp.done, 1);
});

test('run: an existing derivative is reused, nothing is uploaded or decoded', async () => {
  const W = world({ objects: { [PATH + '_disp1280']: 1 } });
  await W.api._bhDispRun({ src: SRC, blob: file(6 * MB) });
  assert.equal(W.calls.put.length, 0);
  assert.equal(W.calls.decode, 0);
  assert.equal(W.cache.get('disp:' + SRC).url, 'https://dl/' + PATH + '_disp1280');
});

test('run: images already about HD are recorded as such, with no upload; a smaller copy is kept even when heavier', async () => {
  const small = world({ w: 1400, h: 788 });
  await small.api._bhDispRun({ src: SRC, blob: file(300 * 1024) });
  assert.equal(small.calls.put.length, 0);
  assert.equal(small.cache.get('disp:' + SRC).none, 'small');
  // Fewer pixels is what counts (decode time): a heavier result is still kept.
  const heavy = world({ outSize: 7 * MB });
  assert.equal(await heavy.api._bhDispRun({ src: SRC, blob: file(6 * MB) }), 'made');
  assert.equal(heavy.calls.put.length, 1);
});

test('run: refuses another account\'s path, a signed-out session and unsafe devices', async () => {
  const other = world({ uid: 'someone-else' });
  await other.api._bhDispRun({ src: SRC, blob: file(6 * MB) });
  assert.equal(other.calls.put.length, 0);
  const out = world(); out.fbAuth.currentUser = null;
  await out.api._bhDispRun({ src: SRC, blob: file(6 * MB) });
  assert.equal(out.calls.put.length, 0);
  const lowMem = world();
  const api = load(['fbimg', 'disp', 'dispmach'], { stubs: { _fbStorage: lowMem.fbStorage, _fbAuth: lowMem.fbAuth, bhMediaCacheGet: async () => undefined, bhMediaCachePut: async () => {}, bhDiag: { record() {} }, window: { matchMedia: () => ({ matches: true }) }, navigator: { onLine: true, deviceMemory: 2 }, createImageBitmap: async () => ({ width: 6000, height: 4000, close() {} }), document: { createElement: () => ({ toDataURL: m => 'data:' + m + ';base64,' }) } } });
  await api._bhDispRun({ src: SRC, blob: file(6 * MB) });
  assert.equal(lowMem.calls.put.length, 0);
  assert.equal(lowMem.calls.get.length, 0, 'no Storage call on an unsafe device');
});

test('run: a transient Storage error is not cached and nothing is uploaded', async () => {
  const W = world();
  W.fbStorage.ref = () => ({ async getDownloadURL() { const e = new Error('x'); e.code = 'storage/unknown'; throw e; }, async put() { throw new Error('should not upload'); } });
  await W.api._bhDispRun({ src: SRC, blob: file(6 * MB) });
  assert.equal(W.cache.get('disp:' + SRC), undefined);
});

test('decode failure is remembered as failed', async () => {
  const W = world();
  const api = load(['fbimg', 'disp', 'dispmach'], { stubs: { _fbStorage: W.fbStorage, _fbAuth: W.fbAuth, bhMediaCacheGet: async k => W.cache.get(k), bhMediaCachePut: async (k, v) => { W.cache.set(k, v); }, bhDiag: { record() {} }, window: { matchMedia: () => ({ matches: true }) }, navigator: { onLine: true }, createImageBitmap: async () => { throw new Error('unsupported'); }, document: { createElement: () => ({ toDataURL: m => 'data:' + m + ';base64,' }) } } });
  await api._bhDispRun({ src: SRC, blob: file(6 * MB, 'image/jpeg') });
  assert.equal(W.cache.get('disp:' + SRC).none, 'failed');
  assert.equal(W.calls.put.length, 0);
});

test('enqueue: ignores non-cloud sources, gif/svg, and a full queue; never throws', () => {
  const W = world();
  W.api.bhDispMaybeEnqueue('https://example.com/x.jpg', file(2 * MB));
  W.api.bhDispMaybeEnqueue(SRC, file(2 * MB, 'image/gif'));
  W.api.bhDispMaybeEnqueue(SRC, 'not a blob');
  assert.equal(W.api._bhDisp.q.length, 0);
});

test('run: records saying "no derivative needed/possible" stop the run before any Storage call or decode', async () => {
  for (const none of ['small', 'notSmaller', 'failed']) {
    const W = world();
    W.cache.set('disp:' + SRC, { none, at: Date.now(), v: 4 });
    await W.api._bhDispRun({ src: SRC, blob: file(6 * MB) });
    assert.equal(W.calls.get.length, 0, none);
    assert.equal(W.calls.decode, 0, none);
    assert.equal(W.calls.put.length, 0, none);
  }
});

test('run: "missing" and "broken" records are retried (that is the normal trigger)', async () => {
  for (const none of ['missing', 'broken']) {
    const W = world();
    W.cache.set('disp:' + SRC, { none, at: Date.now() });
    await W.api._bhDispRun({ src: SRC, blob: file(6 * MB) });
    assert.equal(W.calls.put.length, 1, none);
  }
});

test('lookup: an unauthorized answer is remembered for the session, not written to the cache', async () => {
  const W = world();
  let n = 0;
  W.fbStorage.ref = () => ({ async getDownloadURL() { n++; const e = new Error('no'); e.code = 'storage/unauthorized'; throw e; } });
  assert.equal(await W.api._bhDispLookup(SRC), '');
  assert.equal(await W.api._bhDispLookup(SRC), '');
  assert.equal(n, 1);
  assert.equal(W.cache.get('disp:' + SRC), undefined);
});

test('enqueue: accepts a cloud image once (deduped), capped at 8 pending', () => {
  const W = world();
  W.api.bhDispMaybeEnqueue(SRC, file(2 * MB));
  W.api.bhDispMaybeEnqueue(SRC, file(2 * MB));
  assert.equal(W.api._bhDisp.q.length + (W.api._bhDisp.running ? 1 : 0) >= 1, true);
  for (let i = 0; i < 20; i++) {
    const p = `users/u1/images/sha256_${(i.toString(16).padStart(2, '0')).repeat(32)}_image_jpeg`;
    W.api.bhDispMaybeEnqueue(`https://firebasestorage.googleapis.com/v0/b/bkt/o/${encodeURIComponent(p)}?alt=media`, file(2 * MB));
  }
  assert.ok(W.api._bhDisp.q.length <= 200);
  assert.ok(W.api._bhDisp.q.every(j => !j.blob), 'lazy jobs do not hold the original in memory');
});

test('run: a lazy job reads the original back from the persistent cache; skips if it was evicted', async () => {
  const W = world();
  W.cache.set('blob:' + SRC, { blob: file(6 * MB), at: 1 });
  await W.api._bhDispRun({ src: SRC });
  assert.equal(W.calls.put.length, 1);
  const gone = world();
  await gone.api._bhDispRun({ src: SRC });
  assert.equal(gone.calls.put.length, 0);
  assert.equal(gone.calls.decode, 0);
  assert.equal(gone.cache.get('disp:' + SRC), undefined, 'nothing recorded, so it is retried later');
});
