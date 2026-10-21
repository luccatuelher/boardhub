import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { BH_STUDY_KINDS, bhNewStudy, bhStudyMatches, bhStudyList } = load(['studies'], { stubs: { bhNewId: () => 'id-1' } });

test('bhNewStudy: every field present, overrides win, own refs array each time', () => {
  const a = bhNewStudy({ title: 'Spider-Verse', year: 2018 });
  assert.equal(a.id, 'id-1');
  assert.equal(a.title, 'Spider-Verse');
  assert.equal(a.year, 2018);
  assert.equal(a.deleted, false);
  assert.ok(BH_STUDY_KINDS.includes(a.kind));
  for (const k of ['studio', 'artists', 'language', 'breakdown', 'analysis', 'links']) assert.equal(a[k], '');
  assert.notEqual(a.refs, bhNewStudy().refs);
  assert.equal(bhNewStudy({}, () => 'x').id, 'x');
});

test('bhStudyMatches: accent/case-insensitive across the text fields', () => {
  const s = bhNewStudy({ title: 'Ação Nº1', studio: 'Sony Pictures Animation', artists: 'Justin K. Thompson' });
  assert.ok(bhStudyMatches(s, ''));
  assert.ok(bhStudyMatches(s, 'acao'));
  assert.ok(bhStudyMatches(s, 'SONY'));
  assert.ok(bhStudyMatches(s, 'thompson'));
  assert.ok(!bhStudyMatches(s, 'pixar'));
  assert.ok(!bhStudyMatches(null, 'x'));
});

test('bhStudyList: hides deleted, filters kind, sorts by year desc or title', () => {
  const list = [
    { id: 1, title: 'B', kind: 'Filme', year: 2000 },
    { id: 2, title: 'A', kind: 'Série', year: 2020 },
    { id: 3, title: 'C', kind: 'Filme', year: '' },
    { id: 4, title: 'D', kind: 'Filme', year: 2030, deleted: true },
    null,
  ];
  assert.deepEqual(bhStudyList(list).map(s => s.id), [2, 1, 3]);
  assert.deepEqual(bhStudyList(list, { sort: 'title' }).map(s => s.id), [2, 1, 3]);
  assert.deepEqual(bhStudyList(list, { kind: 'Filme' }).map(s => s.id), [1, 3]);
  assert.deepEqual(bhStudyList(list, { sort: 'manual' }).map(s => s.id), [1, 2, 3]);
  assert.deepEqual(bhStudyList(list, { query: 'a' }).map(s => s.id), [2]);
  assert.deepEqual(bhStudyList(undefined), []);
});

test('sync: studies travel with the state, and old data without them stays valid', () => {
  const { bhSplitState, bhMergeSync } = load(['stable', 'sync', 'rank', 'date']);
  const st = { projects: [], studies: [{ id: 's1', title: 'X' }] };
  assert.deepEqual(bhSplitState(st).state.studies, [{ id: 's1', title: 'X' }]);
  assert.equal('studies' in bhSplitState({ projects: [] }).state, false);
  // another device (no base yet) added a study while this one added another: both survive
  const merged = bhMergeSync(undefined, [{ id: 'a', title: 'A' }], [{ id: 'b', title: 'B' }]);
  assert.deepEqual(merged.map(s => s.id).sort(), ['a', 'b']);
});

test('sync: the acked base leaves out an empty studies list, keeps a filled one', () => {
  const { bhSyncAck, _bhSyncBases } = load(['stable', 'sync', 'rank', 'date']);
  bhSyncAck('u', { projects: [], studies: [] });
  assert.equal('studies' in _bhSyncBases.get('u'), false);
  bhSyncAck('u', { projects: [], studies: [{ id: 's1' }] });
  assert.deepEqual(_bhSyncBases.get('u').studies, [{ id: 's1' }]);
});
