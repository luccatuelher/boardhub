import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const N = load(['narrative'], { stubs: { bhNewId: (p = '') => p + Math.random().toString(36).slice(2) } });

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

test('board: add, edit, move, remove; junk is dropped; counts as outline progress', () => {
  let n = N.bhNarrativeBoardAdd(undefined, 'Abertura');
  n = N.bhNarrativeBoardAdd(n, 'Virada', { x: 300.4, y: -5 });
  assert.equal(n.board.length, 2);
  const [a, b] = n.board;
  assert.notEqual(a.id, b.id);
  assert.deepEqual([b.x, b.y], [300, 0]);
  n = N.bhNarrativeBoardEdit(n, a.id, 'Abertura 2');
  n = N.bhNarrativeBoardMove(n, a.id, 55.6, 120);
  assert.deepEqual(n.board[0], { id: a.id, text: 'Abertura 2', x: 56, y: 120 });
  assert.ok(N.bhNarrativeProgress(n) >= 1);
  n = N.bhNarrativeBoardRemove(n, a.id);
  assert.equal(n.board.length, 1);
  assert.deepEqual(N.bhNarrativeNormalize({ board: [null, 5, { id: 'k', text: 3, x: 'a' }, { text: 'sem id' }] }).board, [{ id: 'k', text: '', x: 0, y: 0 }]);
  assert.deepEqual(N.bhNarrativeNormalize(undefined).board, []);
});

test('virgin\'s promise template exists with 12 beats', () => {
  assert.equal(N.bhNarrativeTemplate('virgins-promise').beats.length, 12);
});

test('layout: every template has its own kind, one node per beat, all inside the box and apart', () => {
  const kinds = new Set();
  for (const t of N.BH_NARRATIVE_TEMPLATES) {
    const lay = N.bhNarrativeLayout(t);
    kinds.add(lay.kind);
    assert.notEqual(lay.kind, 'row', t.id);
    assert.deepEqual(lay.nodes.map(n => n.id), t.beats.map(b => b.id));
    for (const n of lay.nodes) assert.ok(n.x - lay.r >= 0 && n.x + lay.r <= lay.w && n.y - lay.r >= 0 && n.y + lay.r <= lay.h, t.id + ' ' + n.n);
    for (let i = 0; i < lay.nodes.length; i++) for (let j = i + 1; j < lay.nodes.length; j++) {
      const a = lay.nodes[i], b = lay.nodes[j];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= lay.r * 1.6, t.id + ' overlap ' + a.n + '/' + b.n);
    }
  }
  assert.equal(kinds.size, N.BH_NARRATIVE_TEMPLATES.length);
  assert.equal(N.bhNarrativeLayout(N.bhNarrativeTemplate('story-circle')).kind, 'circle');
});

test('story plots: unique ids, stages ordered along the story, values in range; plot choice persists', () => {
  assert.ok(N.BH_STORY_PLOTS.length >= 7);
  assert.equal(new Set(N.BH_STORY_PLOTS.map(p => p.id)).size, N.BH_STORY_PLOTS.length);
  for (const p of N.BH_STORY_PLOTS) {
    assert.ok(p.name && p.phrase && p.stages.length >= 4);
    p.stages.forEach((s, i) => { assert.ok(s.label && s.text && s.y >= 0 && s.y <= 1 && s.x > 0 && s.x < 100); if (i) assert.ok(s.x > p.stages[i - 1].x); });
  }
  const n = N.bhNarrativeSetPlot(undefined, 'rags');
  assert.equal(n.plot, 'rags');
  assert.equal(N.bhNarrativeSetPlot(n, 'ghost').plot, '');
  assert.equal(N.bhNarrativeNormalize({ plot: 'nope' }).plot, '');
});

test('every template explains itself and every beat has a hint', () => {
  for (const t of N.BH_NARRATIVE_TEMPLATES) {
    assert.ok((N.BH_NARRATIVE_ABOUT[t.id] || '').length > 40, t.id);
    for (const b of t.beats) assert.ok(b.hint, b.id);
  }
});
