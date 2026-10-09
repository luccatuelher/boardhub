import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhHoldMask, bhFrameDiff, BH_HOLD_PRESETS, bhGroupHolds, bhHoldPick, bhNaturalCompare } = load(['holds']);
const W = 128, H = 72, mask = bhHoldMask(W, H);

// A synthetic frame: light background, a few dark "strokes", optional shift and timecode noise.
const frame = ({ strokes = [[20, 30, 60, 3], [40, 50, 50, 2]], dx = 0, timecode = 0 } = {}) => {
  const a = new Uint8Array(W * H).fill(220);
  for (const [x0, y0, len, th] of strokes) for (let t = 0; t < th; t++) for (let k = 0; k < len; k++) {
    const x = x0 + k + dx, y = y0 + t; if (x >= 0 && x < W && y >= 0 && y < H) a[y * W + x] = 20;
  }
  // the burned-in timecode (top-right) changes every frame
  for (let k = 0; k < 20; k++) a[3 * W + (100 + k)] = (timecode * 37 + k * 11) % 255;
  return a;
};

test('mask hides the top-right overlay and the borders', () => {
  assert.equal(mask[3 * W + 110], 0);
  assert.equal(mask[40 * W + 60], 1);
  assert.equal(mask[0], 0);
});

test('diff: identical frames with a changing timecode are 0', () => {
  assert.equal(bhFrameDiff(frame({ timecode: 1 }), frame({ timecode: 2 }), W, H, mask), 0);
});

test('diff: a small camera move is absorbed by the shift search', () => {
  assert.equal(bhFrameDiff(frame(), frame({ dx: 2 }), W, H, mask, 3, 1), 0);
  assert.ok(bhFrameDiff(frame(), frame({ dx: 2 }), W, H, mask, 0, 0) > 0);
});

test('diff: a redrawn panel is a real change', () => {
  const other = frame({ strokes: [[70, 10, 40, 4], [10, 60, 90, 3]] });
  assert.ok(bhFrameDiff(frame(), other, W, H, mask) > 2);
});

test('group: static hold, a pan, a cut and a second hold', () => {
  const consec = [0, 0.1, 0.0, 0.1, 0.6, 0.7, 0.6, 0.5, 0.7, 2.4, 0.1, 0.0, 0.1];
  //               ^ hold A (0-3)   ^ pan continues A (4-8)     ^ cut at 9 -> hold B (9-12)
  assert.deepEqual(bhGroupHolds(consec, null, BH_HOLD_PRESETS.normal), [[0, 8], [9, 12]]);
});

test('group: a hard cut always splits; slow drift splits via the anchor', () => {
  assert.deepEqual(bhGroupHolds([0, 0.2, 9, 0.2], null, BH_HOLD_PRESETS.normal), [[0, 1], [2, 3]]);
  const consec = [0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  const anchor = (s, i) => (i - s) * 3; // drifts 3% per frame from the hold's first frame
  assert.deepEqual(bhGroupHolds(consec, anchor, BH_HOLD_PRESETS.normal), [[0, 3], [4, 6]]);
});

test('group: sensitivity presets go from fewer to more holds', () => {
  const consec = [0, 0.3, 1.5, 0.3, 0.3, 3, 0.3, 0.3, 1, 0.3];
  const n = k => bhGroupHolds(consec, null, BH_HOLD_PRESETS[k]).length;
  assert.ok(n('fewer') <= n('normal') && n('normal') <= n('more'));
  assert.equal(n('fewer'), 2);
  assert.equal(n('more'), 4);
});

test('group: empty and single-frame input', () => {
  assert.deepEqual(bhGroupHolds([], null), []);
  assert.deepEqual(bhGroupHolds([0], null), [[0, 0]]);
});

test('pick: the middle frame of each hold', () => {
  assert.equal(bhHoldPick([0, 0]), 0);
  assert.equal(bhHoldPick([0, 91]), 45);
  assert.equal(bhHoldPick([92, 142]), 117);
});

test('natural order: frame_2 before frame_10', () => {
  assert.deepEqual(['frame_10.webp', 'frame_2.webp', 'frame_0001.webp'].sort(bhNaturalCompare), ['frame_0001.webp', 'frame_2.webp', 'frame_10.webp']);
});
