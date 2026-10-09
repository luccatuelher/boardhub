import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { load } from './harness.mjs';

// A fake Storage with latency, counting requests and the peak of concurrent uploads.
function world({ rtt = 30, existing = [], failPut = null, auth = true } = {}) {
  const store = new Set(existing), calls = { get: 0, put: 0, peak: 0, live: 0, order: [] }, cache = new Map();
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ref = name => ({
    fullPath: name,
    async getDownloadURL() { calls.get++; await wait(rtt); if (!store.has(name)) { const e = new Error('nf'); e.code = 'storage/object-not-found'; throw e; } return 'https://dl/' + name; },
    put(blob, meta) {
      calls.put++; calls.order.push(name);
      const handlers = [];
      let settle;
      const finished = new Promise((res, rej) => { settle = { res, rej }; });
      finished.catch(() => {});
      const task = {
        on(_ev, next, err, done) { handlers.push({ next, err, done }); },
        cancel() {},
        then(a, b) { return finished.then(a, b); }, // like the SDK's UploadTask
      };
      calls.live++; calls.peak = Math.max(calls.peak, calls.live);
      (async () => {
        await wait(rtt * 2);
        calls.live--;
        const code = failPut && failPut(name);
        if (code) { const e = new Error('x'); e.code = code; handlers.forEach(h => h.err(e)); settle.rej(e); return; }
        store.add(name);
        handlers.forEach(h => { h.next({ bytesTransferred: blob.size, totalBytes: blob.size }); h.done(); });
        settle.res();
      })();
      return task;
    },
  });
  const fbAuth = { currentUser: auth ? { uid: 'u1' } : null };
  const stubs = {
    _fbStorage: { ref }, _fbAuth: fbAuth, _fbReady: true,
    _bhUploadInflight: new Map(), _bhThumbUrls: new Map(),
    bhDigest: async buf => createHash('sha256').update(Buffer.from(buf)).digest('hex'),
    bhMediaCacheGet: async k => cache.get(k), bhMediaCachePut: async (k, v) => { cache.set(k, v); },
    bhDiag: { record() {} }, bhLog() {},
    _makeThumbBlob: async f => new Blob([new Uint8Array(Math.max(1, f.size >> 4))], { type: 'image/webp' }),
    bhDispEnqueueUpload() {},
    bhPrepareMedia: async f => f, _compressImage: async f => f, bhMediaPrecheck: async () => null,
    _isVideoFile: f => /^video\//.test(f.type),
    bhStorageErrTransient: e => /retry-limit|canceled|offline/.test(e && e.code || ''),
    _storeIdb: async () => 'idb://local',
  };
  const api = load(['upfb', 'upsingle', 'upmany'], { stubs });
  return { api, calls, store, cache };
}
const img = (n, size = 5000) => { const b = new Uint8Array(size); b[0] = n & 255; b[1] = n >> 8; return new Blob([b], { type: 'image/webp' }); };

test('new file: original and thumbnail go up together, with no thumbnail lookup first', async () => {
  const W = world();
  const url = await W.api.uploadToFirebaseStorage(img(1), 'u1');
  assert.match(url, /^https:\/\/dl\/users\/u1\/images\/sha256_[0-9a-f]{64}_image_webp$/);
  assert.equal(W.calls.put, 2);
  assert.equal(W.calls.peak, 2, 'original and thumbnail uploads overlap');
  assert.equal(W.calls.get, 3, 'one lookup before, two download URLs after; no thumbnail lookup');
  assert.equal(W.cache.get('thumb:' + url), url + '_thumb480');
});

test('existing original: no upload, its thumbnail is looked up', async () => {
  const W = world();
  const first = await W.api.uploadToFirebaseStorage(img(1), 'u1');
  const W2 = world({ existing: [...W.store] });
  const again = await W2.api.uploadToFirebaseStorage(img(1), 'u1');
  assert.equal(again, first);
  assert.equal(W2.calls.put, 0);
  assert.equal(W2.cache.get('thumb:' + again), again + '_thumb480');
});

test('batch: up to 4 files at a time, results in the original order', async () => {
  const W = world({ rtt: 20 });
  const files = Array.from({ length: 10 }, (_, i) => img(i + 1));
  const progress = [];
  const t0 = Date.now();
  const urls = await W.api.uploadImages(files, (done, total) => progress.push([done, total]));
  const elapsed = Date.now() - t0;
  assert.equal(urls.length, 10);
  assert.equal(new Set(urls).size, 10);
  for (let i = 0; i < 10; i++) assert.equal(urls[i], await W.api.uploadToFirebaseStorage(files[i], 'u1')); // same content -> same url (cached)
  assert.ok(W.calls.peak >= 4 && W.calls.peak <= 8, 'peak concurrent puts ' + W.calls.peak);
  assert.equal(progress.at(-1)[0], 10);
  assert.ok(progress.every(([d, t], i) => t === 10 && (i === 0 || d >= progress[i - 1][0] - 1e-9)), 'progress never goes back');
  assert.ok(elapsed < 10 * 20 * 4, 'faster than one by one (' + elapsed + ' ms)');
});

test('batch: identical files are uploaded once even when they run in parallel', async () => {
  const W = world();
  const same = img(7);
  const urls = await W.api.uploadImages([same, same, same, same, img(8)]);
  assert.equal(new Set(urls.slice(0, 4)).size, 1);
  assert.equal(W.calls.order.filter(n => !n.endsWith('_thumb480')).length, 2, 'two distinct originals uploaded');
});

test('batch: a transient failure keeps that file locally and the batch continues', async () => {
  let failed = 0;
  const W = world({ failPut: n => (n.endsWith('_image_webp') && failed++ === 0 ? 'storage/retry-limit-exceeded' : null) });
  const urls = await W.api.uploadImages([img(1), img(2), img(3)]);
  assert.equal(urls.length, 3);
  assert.ok(urls.includes('idb://local'));
  assert.ok(urls.filter(u => u.startsWith('https://')).length >= 1);
});

test('videos keep going one at a time', async () => {
  const W = world();
  const vids = [1, 2, 3].map(n => new Blob([new Uint8Array(100 + n)], { type: 'video/mp4' }));
  await W.api.uploadImages(vids);
  assert.equal(W.calls.peak, 1);
});
