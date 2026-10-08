import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhMergeSync, bhSyncPlan, bhSyncRankPoints, bhEqual, bhStableStringify, bhSplitState, bhUtf8Bytes } =
  load(['stable', 'sync', 'rank', 'date']);

const ids = list => list.map(x => String(x.id));

test('stable stringify ignores key order and drops undefined', () => {
  assert.equal(bhStableStringify({ b: 1, a: { d: 1, c: undefined } }), '{"a":{"d":1},"b":1}');
  assert.ok(bhEqual({ a: 1, b: 2 }, { b: 2, a: 1 }));
  const circular = {}; circular.self = circular;
  assert.throws(() => bhStableStringify(circular), /circular/);
});

test('bhUtf8Bytes matches TextEncoder, lone surrogates count as U+FFFD', () => {
  for (const s of ['abc', 'ação', '日本語', '😀', 'a\ud800b']) {
    assert.equal(bhUtf8Bytes(s), new TextEncoder().encode(s).length, s);
  }
});

test('merge: unchanged side adopts the other side', () => {
  assert.deepEqual(bhMergeSync({ a: 1 }, { a: 1 }, { a: 2 }), { a: 2 });
  assert.deepEqual(bhMergeSync({ a: 1 }, { a: 3 }, { a: 1 }), { a: 3 });
});

test('merge: additions on both sides survive', () => {
  const base = [{ id: 1 }];
  const out = bhMergeSync(base, [{ id: 1 }, { id: 2 }], [{ id: 1 }, { id: 3 }]);
  assert.deepEqual(ids(out).sort(), ['1', '2', '3']);
});

test('merge: concurrent delete beats an edit', () => {
  const base = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }];
  const local = [{ id: 1, t: 'a' }, { id: 2, t: 'edited' }];
  const remote = [{ id: 1, t: 'a' }]; // device B deleted id 2
  assert.deepEqual(ids(bhMergeSync(base, local, remote)), ['1']);
});

test('merge: independent field edits on one record are combined', () => {
  const base = [{ id: 1, title: 'a', done: false }];
  const out = bhMergeSync(base, [{ id: 1, title: 'b', done: false }], [{ id: 1, title: 'a', done: true }]);
  assert.deepEqual(out, [{ id: 1, title: 'b', done: true }]);
});

test('merge: a record flagged deleted on one side stays deleted', () => {
  const base = [{ id: 1, t: 'a' }];
  const out = bhMergeSync(base, [{ id: 1, t: 'edit' }], [{ id: 1, t: 'a', deleted: true }]);
  assert.equal(out[0].deleted, true);
});

test('merge: no common base merges both sides as additions', () => {
  const out = bhMergeSync(undefined, [{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }]);
  assert.deepEqual(ids(out).sort(), ['1', '2', '3']);
  assert.deepEqual(bhMergeSync(undefined, { a: 1 }, { b: 2 }), { a: 1, b: 2 });
});

test('merge: lists of id-less items merge by value', () => {
  const out = bhMergeSync(['a', 'b'], ['a', 'b', 'c'], ['a', 'd']);
  assert.deepEqual([...out].sort(), ['a', 'c', 'd']);
});

test('merge: ids 1 and "1" are the same record', () => {
  const out = bhMergeSync([{ id: 1, t: 'a' }], [{ id: 1, t: 'x' }], [{ id: '1', t: 'a', n: 1 }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].t, 'x');
  assert.equal(out[0].n, 1);
});

test('merge: local reorder plus a remote addition keeps both', () => {
  const base = [{ id: 1 }, { id: 2 }];
  const out = bhMergeSync(base, [{ id: 2 }, { id: 1 }], [{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.deepEqual(ids(out), ['2', '1', '3']);
});

test('merge: duplicate ids keep the other device\'s addition', () => {
  const base = [{ id: 1, t: 'a' }];
  const local = [{ id: 1, t: 'a' }, { id: 1, t: 'dup' }];
  const remote = [{ id: 1, t: 'a' }, { id: 2, t: 'new' }];
  const out = bhMergeSync(base, local, remote);
  assert.deepEqual(out.map(x => x.t).sort(), ['a', 'dup', 'new']);
});

test('merge: a duplicate already in the base merges field by field', () => {
  const base = [{ id: 1, t: 'a' }, { id: 1, t: 'b' }];
  const out = bhMergeSync(base, [{ id: 1, t: 'a' }, { id: 1, t: 'B!' }], [{ id: 1, t: 'A!' }, { id: 1, t: 'b' }, { id: 2, t: 'n' }]);
  assert.deepEqual(out.map(x => x.t), ['A!', 'B!', 'n']);
});

test('merge: deleting one of two duplicates propagates', () => {
  const base = [{ id: 1, t: 'a' }, { id: 1, t: 'b' }];
  const out = bhMergeSync(base, [{ id: 1, t: 'a' }], base);
  assert.deepEqual(out.map(x => x.t), ['a']);
});

test('merge: unique-id lists behave as before (order, adds, deletes)', () => {
  const base = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const out = bhMergeSync(base, [{ id: 3 }, { id: 1 }, { id: 2 }], [{ id: 1 }, { id: 3 }, { id: 4 }]);
  assert.deepEqual(ids(out), ['3', '1', '4']);
});

test('merge: concurrent note edits keep the local HTML (remote text is lost)', () => {
  const base = [{ id: 1, content: '<p>a</p>' }];
  const out = bhMergeSync(base, [{ id: 1, content: '<p>local</p>' }], [{ id: 1, content: '<p>remote</p>' }]);
  assert.equal(out[0].content, '<p>local</p>');
});

test('merge: the losing note version is preserved in contentConflicts', () => {
  const out = bhMergeSync([{ id: 1, content: 'a' }], [{ id: 1, content: 'L' }], [{ id: 1, content: 'R' }]);
  assert.equal(out[0].content, 'L');
  assert.deepEqual(Object.values(out[0].contentConflicts), ['R']);
});

test('merge: note conflicts converge across two devices and are idempotent', () => {
  const base = [{ id: 1, content: 'a' }];
  const A = [{ id: 1, content: 'L' }], B = [{ id: 1, content: 'R' }];
  const mergedA = bhMergeSync(base, A, B);          // device A merges B's push
  const mergedB = bhMergeSync(base, B, mergedA);    // device B merges A's result the other way round
  assert.equal(mergedB[0].content, 'R');
  assert.deepEqual(Object.values(mergedB[0].contentConflicts), ['L']);
  // Re-running a merge changes nothing.
  assert.deepEqual(bhMergeSync(base, A, B), mergedA);
  // A device whose local state is unchanged since its last ack adopts the other side as it is.
  assert.deepEqual(bhMergeSync(mergedA, mergedA, mergedB), mergedB);
});

test('merge: no conflict copy when only one side edited, or both wrote the same text', () => {
  const base = [{ id: 1, content: 'a' }];
  assert.ok(!('contentConflicts' in bhMergeSync(base, [{ id: 1, content: 'L' }], base)[0]));
  assert.ok(!('contentConflicts' in bhMergeSync(base, [{ id: 1, content: 'S' }], [{ id: 1, content: 'S' }])[0]));
});

test('merge: a conflict copy equal to the winning text is dropped; discarding a copy propagates', () => {
  const key = Object.keys(bhMergeSync([{ id: 1, content: 'a' }], [{ id: 1, content: 'L' }], [{ id: 1, content: 'R' }])[0].contentConflicts)[0];
  const base = [{ id: 1, content: 'L', contentConflicts: { [key]: 'R' } }];
  // the user discards the stored copy on device A while device B edits something else
  const out = bhMergeSync(base, [{ id: 1, content: 'L' }], [{ id: 1, content: 'L', contentConflicts: { [key]: 'R' }, title: 't' }]);
  assert.ok(!('contentConflicts' in out[0]));
  assert.equal(out[0].title, 't');
});

const pomo = (days, rank) => ({ days, allocations: {}, rank: { seasonId: '2026-3', points: 0, decayApplied: {}, ...rank } });

test('merge: concurrent focus on the same day takes the larger value, not the sum', () => {
  const base = pomo({ '2026-10-07': 0 });
  const out = bhMergeSync(base, pomo({ '2026-10-07': 1800 }), pomo({ '2026-10-07': 1200 }));
  assert.equal(out.days['2026-10-07'], 1800);
});

test('rank points: null without base, season mismatch or missing base day', () => {
  const r = (points, loss) => ({ seasonId: '2026-3', points, decayApplied: loss, decayLoss: loss });
  assert.equal(bhSyncRankPoints(undefined, r(1, {}), r(1, {}), '2026-3'), null);
  assert.equal(bhSyncRankPoints(r(1000, {}), r(1, {}), r(1, {}), '2026-2'), null);
  assert.equal(bhSyncRankPoints(r(1000, { '2026-10-05': 250 }), r(1, {}), r(1, { '2026-10-05': 250 }), '2026-3'), null);
});

test('rank points: local credit plus remote decay combine (1000 +200 credit, -250 decay = 950)', () => {
  const base = { seasonId: '2026-3', points: 1000, decayApplied: {}, decayLoss: {} };
  const local = { ...base, points: 1200 };
  const remote = { ...base, points: 750, decayApplied: { '2026-10-07': 250 }, decayLoss: { '2026-10-07': 250 } };
  assert.equal(bhSyncRankPoints(base, local, remote, '2026-3'), 950);
});

test('rank points: a day settled on both sides is charged once, at the lower loss', () => {
  const base = { seasonId: '2026-3', points: 1000, decayApplied: {}, decayLoss: {} };
  const local = { ...base, points: 750, decayApplied: { '2026-10-07': 250 }, decayLoss: { '2026-10-07': 250 } };
  const remote = { ...base, points: 850, decayApplied: { '2026-10-07': 150 }, decayLoss: { '2026-10-07': 150 } };
  assert.equal(bhSyncRankPoints(base, local, remote, '2026-3'), 850);
});

test('rank points: result is clamped to RANK_MAX', () => {
  const { RANK_MAX } = load(['rank', 'stable', 'date']);
  const base = { seasonId: '2026-3', points: RANK_MAX - 10, decayApplied: {}, decayLoss: {} };
  const out = bhSyncRankPoints(base, { ...base, points: RANK_MAX + 5000 }, { ...base, points: RANK_MAX - 5 }, '2026-3');
  assert.equal(out, RANK_MAX);
});

test('rank merge: both sides moved points, decay ledger takes the smaller loss', () => {
  const rank = (points, loss) => ({ seasonId: '2026-3', points, decayApplied: loss, decayLoss: loss });
  const base = pomo({}, rank(1000, {}));
  const out = bhMergeSync(base, pomo({}, rank(750, { '2026-10-07': 250 })), pomo({}, rank(850, { '2026-10-07': 150 })));
  assert.equal(out.rank.points, 850);
  assert.equal(out.rank.decayApplied['2026-10-07'], 150);
});

test('clock skew: a remote season in the future is adopted when local is unchanged', () => {
  const base = pomo({}, { points: 3000 });
  const remote = pomo({}, { seasonId: '2027-1', points: 0 });
  assert.equal(bhMergeSync(base, base, remote).rank.seasonId, '2027-1');
});

test('sync plan: no change is empty, notes-only change touches only the notes doc', () => {
  const state = { projects: [{ id: 1 }], notes: [{ id: 1, content: 'a' }], galleryPosts: [] };
  assert.deepEqual(bhSyncPlan(state, state), []);
  const plan = bhSyncPlan(state, { ...state, notes: [{ id: 1, content: 'b' }] });
  assert.deepEqual(plan.map(p => p.id), ['notes']);
  assert.ok(Object.keys(plan[0].fields).includes('notes'));
});

test('sync plan: a null base plans every non-empty section', () => {
  const plan = bhSyncPlan(null, { projects: [{ id: 1 }], notes: [{ id: 1 }] });
  assert.deepEqual(plan.map(p => p.id).sort(), ['notes', 'state']);
});

test('split state routes notes and gallery out of the main doc', () => {
  const { state, notes, gallery } = bhSplitState({ projects: [1], notes: [2], galleryPosts: [3] });
  assert.ok(state.projects && !state.notes && !state.galleryPosts);
  assert.ok(notes.notes);
  assert.ok(gallery && Object.keys(gallery).length);
});
