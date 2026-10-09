import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhDispName, bhDispPlan, bhDispAccept, bhIsAnimated, bhDispCacheState } = load(['disp']);
const HEX = 'ab'.repeat(32);
const MB = 1048576;

test('name: appends _disp1280 to an original path, refuses derivatives and non-original paths', () => {
  assert.equal(bhDispName(`users/u1/images/sha256_${HEX}_image_jpeg`), `users/u1/images/sha256_${HEX}_image_jpeg_disp1280`);
  assert.equal(bhDispName(`users/u1/images/sha256_${HEX}_image_jpeg_thumb480`), '');
  assert.equal(bhDispName(`users/u1/images/sha256_${HEX}_image_jpeg_disp2880`), '');
  assert.equal(bhDispName(`users/u1/images/sha256_${HEX}_image_jpeg_disp1280`), '');
  assert.equal(bhDispName('users/u1/images/photo.jpg'), '');
  assert.equal(bhDispName(`users/u1/images/sha256_short_image_jpeg`), '');
  assert.equal(bhDispName(null), '');
});

test('plan: fits inside 1280×720 (720×1280 portrait), aspect ratio kept, WebP', () => {
  const fhd = bhDispPlan({ w: 1920, h: 1080, bytes: 400000, type: 'image/jpeg' });
  assert.deepEqual([fhd.needed, fhd.targetW, fhd.targetH, fhd.mime, fhd.quality], [true, 1280, 720, 'image/webp', 0.9]);
  const scope = bhDispPlan({ w: 3840, h: 1634, bytes: 2 * MB, type: 'image/png' });
  assert.deepEqual([scope.targetW, scope.targetH, scope.quality], [1280, 545, 0.92], '2.35:1 scope keeps its shape');
  const uhd = bhDispPlan({ w: 3840, h: 2160, bytes: 3 * MB, type: 'image/webp' });
  assert.deepEqual([uhd.targetW, uhd.targetH], [1280, 720]);
  const fourThree = bhDispPlan({ w: 2000, h: 1500, bytes: MB, type: 'image/jpeg' });
  assert.deepEqual([fourThree.targetW, fourThree.targetH], [960, 720], 'the short side is held to 720 too');
  const tall = bhDispPlan({ w: 1080, h: 1920, bytes: MB, type: 'image/jpeg' });
  assert.deepEqual([tall.targetW, tall.targetH], [720, 1280], 'portrait uses the rotated box');
  const tiny = bhDispPlan({ w: 2, h: 3000, bytes: MB, type: 'image/png' });
  assert.ok(tiny.targetW >= 1);
});

test('plan: images already about HD are kept as they are, whatever their weight', () => {
  for (const [w, h] of [[1280, 720], [1366, 768], [1400, 788], [960, 540], [720, 1280], [1280, 545], [800, 800]])
    assert.deepEqual(bhDispPlan({ w, h, bytes: 3 * MB, type: 'image/png' }), { needed: false, reason: 'small' }, `${w}×${h}`);
  assert.equal(bhDispPlan({ w: 1500, h: 844, bytes: MB, type: 'image/jpeg' }).needed, true, 'more than 15% over HD gets a copy');
});

test('plan: other types and bad input need nothing', () => {
  assert.equal(bhDispPlan({ w: 6000, h: 4000, bytes: 9 * MB, type: 'image/gif' }).reason, 'type');
  assert.equal(bhDispPlan({ w: 6000, h: 4000, bytes: 9 * MB, type: 'image/svg+xml' }).reason, 'type');
  assert.equal(bhDispPlan({ w: 6000, h: 4000, bytes: 9 * MB, type: 'image/avif' }).reason, 'type');
  assert.equal(bhDispPlan({ w: 6000, h: 4000, bytes: 9 * MB, type: 'video/mp4' }).reason, 'type');
  assert.equal(bhDispPlan({ w: 6000, h: 4000, bytes: 9 * MB, type: 'image/png', animated: true }).reason, 'animated');
  assert.equal(bhDispPlan({ w: 0, h: 10, bytes: 9 * MB, type: 'image/png' }).reason, 'size');
  assert.equal(bhDispPlan().needed, false);
});

test('accept: the copy is kept only when lighter than what it replaces', () => {
  assert.ok(bhDispAccept(6 * MB, 1 * MB));
  assert.ok(bhDispAccept(1 * MB, 900000));
  assert.ok(!bhDispAccept(1 * MB, MB));
  assert.ok(bhDispAccept(1 * MB, 2 * MB, true), 'fewer pixels: kept even if heavier (decode cost)');
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

test('cache state: lookup, url, and negative results with their TTLs (current rules)', () => {
  const now = 1e12, day = 864e5, v = 4;
  assert.deepEqual(bhDispCacheState(undefined, now), { state: 'lookup' });
  assert.deepEqual(bhDispCacheState({ url: 'https://x', v }, now), { state: 'url', url: 'https://x' });
  assert.equal(bhDispCacheState({ none: 'missing', at: now - day, v }, now).state, 'skip');
  assert.equal(bhDispCacheState({ none: 'missing', at: now - 4 * day, v }, now).state, 'lookup');
  assert.equal(bhDispCacheState({ none: 'failed', at: now - 2 * day, v }, now).state, 'lookup');
  assert.equal(bhDispCacheState({ none: 'failed', at: now - 1000, v }, now).state, 'skip');
  assert.equal(bhDispCacheState({ none: 'small', at: 0, v }, now).state, 'skip', 'small/notSmaller never expire under the same rules');
  assert.equal(bhDispCacheState({ none: 'notSmaller', at: 0, v }, now).state, 'skip');
  assert.equal(bhDispCacheState({ junk: 1, v }, now).state, 'lookup');
});

test('cache state: every record from older rules is looked at again (2880 px copies, old thresholds)', () => {
  const now = 1e12;
  assert.equal(bhDispCacheState({ url: 'https://old_disp2880' }, now).state, 'lookup');
  assert.equal(bhDispCacheState({ none: 'small', at: 0, v: 3 }, now).state, 'lookup');
  assert.equal(bhDispCacheState({ none: 'missing', at: now }, now).state, 'lookup');
  assert.equal(bhDispCacheState({ none: 'notSmaller', at: now, v: 2 }, now).state, 'lookup');
});
