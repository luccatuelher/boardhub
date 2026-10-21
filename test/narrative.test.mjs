import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const N = load(['narrative']);

test('template catalogue: unique ids, beat ids unique across templates and prefixed by their template', () => {
  const tpls = N.BH_NARRATIVE_TEMPLATES;
  assert.ok(tpls.length >= 8);
  assert.ok(['save-the-cat', 'mckee', 'three-act'].every(id => N.bhNarrativeTemplate(id)));
  assert.equal(new Set(tpls.map(t => t.id)).size, tpls.length);
  const beats = tpls.flatMap(t => t.beats.map(b => b.id));
  assert.equal(new Set(beats).size, beats.length);
  for (const t of tpls) assert.ok(t.beats.length >= 4 && t.beats.every(b => b.label));
  assert.equal(N.bhNarrativeTemplate('nope'), null);
  assert.equal(N.bhNarrativeTemplate(undefined), null);
});

test('normalize: old data (no narrative) and junk give a complete empty narrative', () => {
  for (const bad of [undefined, null, 5, 'x', [], { tpl: 'ghost', logline: 7, outline1: [1], outline2: { a: 1, b: 'ok' } }]) {
    const n = N.bhNarrativeNormalize(bad);
    assert.equal(n.tpl, ''); assert.equal(n.logline, ''); assert.equal(n.script, '');
    assert.deepEqual(n.outline1, {});
  }
  assert.deepEqual(N.bhNarrativeNormalize({ outline2: { a: 1, b: 'ok' } }).outline2, { b: 'ok' });
  assert.equal(N.bhNarrativeProgress(undefined), 0);
});

test('setField only touches the four text stages and stamps updatedAt', () => {
  const a = N.bhNarrativeSetField(undefined, 'logline', 'Um gato perdido.');
  assert.equal(a.logline, 'Um gato perdido.');
  assert.ok(!Number.isNaN(Date.parse(a.updatedAt)));
  assert.equal(N.bhNarrativeSetField(a, 'tpl', 'x').tpl, '');
  assert.equal(N.bhNarrativeSetField(a, 'script', 5).script, '');
});

test('beats: pass 1 and 2 are separate; switching template keeps the text; unknown beats are rejected', () => {
  let n = N.bhNarrativeSetTemplate(undefined, 'save-the-cat');
  n = N.bhNarrativeSetBeat(n, 1, 'stc.opening', 'Chuva.');
  n = N.bhNarrativeSetBeat(n, 2, 'stc.opening', 'Sol.');
  assert.equal(n.outline1['stc.opening'], 'Chuva.');
  assert.equal(n.outline2['stc.opening'], 'Sol.');
  const m = N.bhNarrativeSetTemplate(n, 'three-act');
  assert.equal(m.outline1['stc.opening'], 'Chuva.', 'text of the other template is kept');
  assert.equal(N.bhNarrativeSetBeat(m, 1, 'bogus', 'x').outline1.bogus, undefined);
  assert.equal(N.bhNarrativeSetTemplate(n, 'ghost').tpl, '');
});

test('copyOutline fills only empty beats of the second pass', () => {
  let n = N.bhNarrativeSetTemplate(undefined, 'freytag');
  n = N.bhNarrativeSetBeat(n, 1, 'freytag.exposition', 'A');
  n = N.bhNarrativeSetBeat(n, 1, 'freytag.rising', 'B');
  n = N.bhNarrativeSetBeat(n, 2, 'freytag.rising', 'B2');
  const c = N.bhNarrativeCopyOutline(n);
  assert.equal(c.outline2['freytag.exposition'], 'A');
  assert.equal(c.outline2['freytag.rising'], 'B2');
  assert.deepEqual(N.bhNarrativeFilled(c, 1), { done: 2, total: 5 });
  assert.deepEqual(N.bhNarrativeFilled(undefined, 1), { done: 0, total: 0 });
});

test('progress counts logline, synopsis, argument, outline (either pass) and script', () => {
  let n = N.bhNarrativeSetField(undefined, 'logline', 'a');
  n = N.bhNarrativeSetField(n, 'script', 'b');
  assert.equal(N.bhNarrativeProgress(n), 2);
  n = N.bhNarrativeSetBeat(N.bhNarrativeSetTemplate(n, 'mckee'), 2, 'mckee.crisis', 'c');
  assert.equal(N.bhNarrativeProgress(n), 3);
  assert.equal(N.bhNarrativeProgress(N.bhNarrativeSetField(n, 'synopsis', '   ')), 3, 'whitespace does not count');
});
