import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhDispName, bhDispPlan, bhDispAccept, bhIsAnimated, bhDispCacheState } = load(['disp']);
const HEX = 'ab'.repeat(32);
const MB = 1048576;

test('name: appends _disp2880 to an original path, refuses derivatives and non-original paths', () => {
  assert.equal(bhDispName(`users/u1/images/sha256_${HEX}_image_jpeg`), `users/u1/images/sha256_${HEX}_image_jpeg_disp2880`);
  assert.equal(bhDispName(`users/u1/images/sha256_${HEX}_image_jpeg_thumb480`), '');
  assert.equal(bhDispName(`users/u1/images/sha256_${HEX}_image_jpeg_disp2880`), '');
  assert.equal(bhDispName('users/u1/images/photo.jpg'), '');
  assert.equal(bhDispName(`users/u1/images/sha256_short_image_jpeg`), '');
  assert.equal(bhDispName(null), '');
});

test('plan: big images get a downscaled WebP, aspect ratio kept', () => {
  const p = bhDispPlan({ w: 6000, h: 4000, bytes: 6 * MB, type: 'image/jpeg' });
  assert.deepEqual([p.needed, p.targetW, p.targetH, p.mime], [true, 2880, 1920, 'image/webp']);
  const tall = bhDispPlan({ w: 3000, h: 9000, bytes: 5 * MB, type: 'image/jpeg' });
  assert.deepEqual([tall.targetW, tall.targetH], [960, 2880]);
});

test('plan: small dimensions but heavy file are re-encoded at the same size', () => {
  const p = bhDispPlan({ w: 2000, h: 1000, bytes: 3 * MB, type: 'image/png' });
  assert.deepEqual([p.needed, p.targetW, p.targetH, p.quality], [true, 2000, 1000, 0.9]);
});

test('plan: small light images, other types and bad input need nothing', () => {
  assert.deepEqual(bhDispPlan({ w: 1920, h: 1080, bytes: 400000, type: 'image/jpeg' }), { needed: false, reason: 'small' });
  assert.equal(bhDispPlan({ w: 6000, h: 4000, bytes: 9 * MB, type: 'image/gif' }).reason, 'type');
  assert.equal(bhDispPlan({ w: 6000, h: 4000, bytes: 9 * MB, type: 'image/svg+xml' }).reason, 'type');
  assert.equal(bhDispPlan({ w: 6000, h: 4000, bytes: 9 * MB, type: 'image/avif' }).reason, 'type');
  assert.equal(bhDispPlan({ w: 6000, h: 4000, bytes: 9 * MB, type: 'video/mp4' }).reason, 'type');
  assert.equal(bhDispPlan({ w: 6000, h: 4000, bytes: 9 * MB, type: 'image/png', animated: true }).reason, 'animated');
  assert.equal(bhDispPlan({ w: 0, h: 10, bytes: 9 * MB, type: 'image/png' }).reason, 'size');
  assert.equal(bhDispPlan().needed, false);
});

test('accept: only a clearly lighter result is kept', () => {
  assert.ok(bhDispAccept(6 * MB, 1 * MB));
  assert.ok(!bhDispAccept(1 * MB, 900000));
  assert.ok(!bhDispAccept(1 * MB, 0));
});

const png = (...chunks) => {
  const out = [137, 80, 78, 71, 13, 10, 26, 10];
  for (const [type, len] of chunks) {
    out.push((len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...[...type].map(c => c.charCodeAt(0)), ...Array(len).fill(0), 0, 0, 0, 0);
  }
  return Uint8Array.from(out);
};

test('animated: APNG has acTL before IDAT; a plain PNG does not', () => {
  assert.ok(bhIsAnimated(png(['IHDR', 13], ['acTL', 8], ['IDAT', 4], ['IEND', 0]), 'image/png'));
  assert.ok(!bhIsAnimated(png(['IHDR', 13], ['IDAT', 4], ['acTL', 8], ['IEND', 0]), 'image/png'));
  assert.ok(!bhIsAnimated(png(['IHDR', 13], ['IDAT', 4], ['IEND', 0]), 'image/png'));
  assert.ok(!bhIsAnimated(new Uint8Array(4), 'image/png'));
});

test('animated: WebP VP8X animation flag', () => {
  const webp = flags => { const b = new Uint8Array(30); [...'RIFF'].forEach((c, i) => b[i] = c.charCodeAt(0)); [...'WEBP'].forEach((c, i) => b[8 + i] = c.charCodeAt(0)); [...'VP8X'].forEach((c, i) => b[12 + i] = c.charCodeAt(0)); b[20] = flags; return b; };
  assert.ok(bhIsAnimated(webp(0x02), 'image/webp'));
  assert.ok(!bhIsAnimated(webp(0x10), 'image/webp'));
  assert.ok(!bhIsAnimated(new Uint8Array(30), 'image/webp'));
  assert.ok(!bhIsAnimated(new Uint8Array(30), 'image/jpeg'));
});

test('cache state: lookup, url, and negative results with their TTLs', () => {
  const now = 1e12, day = 864e5;
  assert.deepEqual(bhDispCacheState(undefined, now), { state: 'lookup' });
  assert.deepEqual(bhDispCacheState({ url: 'https://x' }, now), { state: 'url', url: 'https://x' });
  assert.equal(bhDispCacheState({ none: 'missing', at: now - day }, now).state, 'skip');
  assert.equal(bhDispCacheState({ none: 'missing', at: now - 4 * day }, now).state, 'lookup');
  assert.equal(bhDispCacheState({ none: 'failed', at: now - 2 * day }, now).state, 'lookup');
  assert.equal(bhDispCacheState({ none: 'failed', at: now - 1000 }, now).state, 'skip');
  assert.equal(bhDispCacheState({ none: 'small', at: 0 }, now).state, 'skip', 'small/notSmaller never expire');
  assert.equal(bhDispCacheState({ none: 'notSmaller', at: 0 }, now).state, 'skip');
  assert.equal(bhDispCacheState({ junk: 1 }, now).state, 'lookup');
});
