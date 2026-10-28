import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { BH_LS_PACKED, bhLsPack, bhLsIsPacked, bhLsUnpack } = load(['lsstate']);

const bigState = () => JSON.stringify({
  galleryPosts: Array.from({ length: 400 }, (_, i) => ({
    id: 'p' + i, title: 'Romanos ' + i + ' ✓ 😀 ção',
    images: Array.from({ length: 5 }, (_, j) => `https://firebasestorage.googleapis.com/v0/b/x/o/users%2Fu%2Fimages%2Fsha256_${i}_${j}_image_jpeg?alt=media&token=${i}-${j}-abc`),
  })),
});

test('a packed state reads back byte for byte and is much smaller', () => {
  const text = bigState();
  const packed = bhLsPack(text);
  assert.equal(bhLsIsPacked(packed), true);
  assert.equal(packed.startsWith(BH_LS_PACKED), true);
  assert.equal(bhLsUnpack(packed), text);
  assert.ok(packed.length < text.length / 3, `packed ${packed.length} vs ${text.length}`);
});

test('plain JSON is never mistaken for a packed value and passes through', () => {
  const plain = JSON.stringify({ a: 1, b: ['x'] });
  assert.equal(bhLsIsPacked(plain), false);
  assert.equal(bhLsUnpack(plain), plain);
});

test('empty and odd inputs round-trip; a damaged packed value reads as null, not as data', () => {
  for (const t of ['{}', '[]', '"é"', JSON.stringify({ s: 'a'.repeat(100000) })]) assert.equal(bhLsUnpack(bhLsPack(t)), t);
  assert.equal(bhLsUnpack(BH_LS_PACKED), null);
  const good = bhLsPack(bigState());
  const cut = good.slice(0, Math.floor(good.length / 2));
  const out = bhLsUnpack(cut);
  assert.ok(out == null || out !== bigState());
});

test('a damaged packed value that still decodes to something is refused by its length check', () => {
  const text = bigState();
  const packed = bhLsPack(text);
  const at = packed.indexOf(':', BH_LS_PACKED.length);
  const forged = BH_LS_PACKED + (text.length + 7) + packed.slice(at);
  assert.equal(bhLsUnpack(forged), null);
  assert.equal(bhLsUnpack(BH_LS_PACKED + 'abc:xyz'), null);
});
