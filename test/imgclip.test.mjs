import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhImgClipSrcOk, bhImgClipGet, bhImgClipSubscribe, bhImgClipHas, bhImgClipToggle, bhImgClipClear } = load(['imgclip']);

test('only shareable references can be copied', () => {
  assert.equal(bhImgClipSrcOk('https://x/a.png'), true);
  assert.equal(bhImgClipSrcOk('idb://abc'), true);
  assert.equal(bhImgClipSrcOk('blob:http://x/1'), false);
  assert.equal(bhImgClipSrcOk('data:image/png;base64,AAAA'), false);
  assert.equal(bhImgClipSrcOk(''), false);
  assert.equal(bhImgClipSrcOk(null), false);
  assert.equal(bhImgClipToggle('data:image/png;base64,AAAA', 'image'), false);
  assert.deepEqual(bhImgClipGet(), []);
});

test('copying accumulates, copying again takes it back out, clear empties', () => {
  let ticks = 0;
  const off = bhImgClipSubscribe(() => ticks++);
  assert.equal(bhImgClipToggle('https://x/a.png', 'image'), true);
  assert.equal(bhImgClipToggle('idb://v1', 'video'), true);
  assert.deepEqual(bhImgClipGet(), [{ src: 'https://x/a.png', kind: 'image' }, { src: 'idb://v1', kind: 'video' }]);
  assert.equal(bhImgClipHas('idb://v1'), true);
  bhImgClipToggle('https://x/a.png');
  assert.deepEqual(bhImgClipGet().map(i => i.src), ['idb://v1']);
  const before = bhImgClipGet();
  bhImgClipClear();
  assert.deepEqual(bhImgClipGet(), []);
  assert.notEqual(before, bhImgClipGet());
  const t = ticks;
  bhImgClipClear(); // already empty: nothing changes, nobody is notified
  assert.equal(ticks, t);
  off();
  bhImgClipToggle('https://x/b.png');
  assert.equal(ticks, t);
  bhImgClipClear();
});

test('the snapshot keeps its identity until something changes', () => {
  bhImgClipToggle('https://x/c.png');
  assert.equal(bhImgClipGet(), bhImgClipGet());
  bhImgClipClear();
});

test('the clipboard is capped at 50 items, newest kept', () => {
  for (let i = 0; i < 55; i++) bhImgClipToggle('https://x/' + i + '.png');
  const items = bhImgClipGet();
  assert.equal(items.length, 50);
  assert.equal(items[0].src, 'https://x/5.png');
  assert.equal(items[49].src, 'https://x/54.png');
  bhImgClipClear();
});
