import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhSessionPostTitle, bhPlaceInSection, pomoRetargetSession, pomoSessionParts, pomoRetargetPlan, pomoApplyRetargets, pomoNormalize, pomoMergeProgress } = load(['date', 'sesstitle', 'rank']);

test('default post title: day/month, a dash, then what the session was about', () => {
  assert.equal(bhSessionPostTitle('2026-10-08', 'Back from the brink'), '08/10 - Back from the brink');
  assert.equal(bhSessionPostTitle('2026-01-31T10:00:00', '  Roteiro '), '31/01 - Roteiro');
});

test('no label falls back to "Sem categoria"; an unreadable date leaves just the name', () => {
  assert.equal(bhSessionPostTitle('2026-03-02', ''), '02/03 - Sem categoria');
  assert.equal(bhSessionPostTitle('', 'X'), 'X');
  assert.equal(bhSessionPostTitle(undefined, undefined), 'Sem categoria');
});

test('a new session post goes right after its section marker (top of the section)', () => {
  const order = ['a', 'sec:s1', 'b', 'c', 'sec:s2', 'd'];
  assert.deepEqual(bhPlaceInSection(order, 'x', 's1'), ['a', 'sec:s1', 'x', 'b', 'c', 'sec:s2', 'd']);
  assert.deepEqual(bhPlaceInSection(order, 'x', 's2'), ['a', 'sec:s1', 'b', 'c', 'sec:s2', 'x', 'd']);
  assert.deepEqual(bhPlaceInSection(order, 'c', 's1'), ['a', 'sec:s1', 'c', 'b', 'sec:s2', 'd']);
});

test('missing section marker or bad input leaves the order alone', () => {
  const order = ['a', 'b'];
  assert.equal(bhPlaceInSection(order, 'x', 'nope'), order);
  assert.deepEqual(bhPlaceInSection(null, 'x', 's1'), []);
});

test('retarget: seconds move from one category to the other, all-time and per day', () => {
  const base = { allocations: { 'cat:a': 5000, 'cat:b': 100, 'project:1': 7 }, dailyAllocations: { '2026-10-09': { 'cat:a': 3000 }, '2026-10-10': { 'cat:a': 2000 } }, days: { x: 1 } };
  const r = pomoRetargetSession(base, 'cat:a', 'cat:b', [{ dateKey: '2026-10-09', secs: 1200 }, { dateKey: '2026-10-10', secs: 600 }]);
  assert.equal(r.allocations['cat:a'], 3200);
  assert.equal(r.allocations['cat:b'], 1900);
  assert.equal(r.allocations['project:1'], 7);
  assert.deepEqual(r.dailyAllocations['2026-10-09'], { 'cat:a': 1800, 'cat:b': 1200 });
  assert.deepEqual(r.dailyAllocations['2026-10-10'], { 'cat:a': 1400, 'cat:b': 600 });
  assert.equal(base.allocations['cat:a'], 5000); // input untouched
});

test('retarget: a key that reaches zero is dropped; never goes negative', () => {
  const base = { allocations: { 'cat:a': 300 }, dailyAllocations: { '2026-10-09': { 'cat:a': 100 } } };
  const r = pomoRetargetSession(base, 'cat:a', 'cat:b', [{ dayKey: '2026-10-09', secs: 300 }]);
  assert.equal('cat:a' in r.allocations, false);
  assert.equal(r.allocations['cat:b'], 300);
  assert.equal('cat:a' in r.dailyAllocations['2026-10-09'], false);
});

test('retarget: project and same-key moves change nothing', () => {
  const base = { allocations: { 'cat:a': 10 }, dailyAllocations: {} };
  const parts = [{ dateKey: '2026-10-09', secs: 5 }];
  assert.equal(pomoRetargetSession(base, 'cat:a', 'project:1', parts), base);
  assert.equal(pomoRetargetSession(base, 'project:1', 'cat:a', parts), base);
  assert.equal(pomoRetargetSession(base, 'cat:a', 'cat:a', parts), base);
  assert.equal(pomoRetargetSession(base, 'cat:a', 'cat:b', []), base);
  assert.equal(pomoRetargetSession(base, 'none', 'none', parts), base);
});

test('retarget: a session with no category only adds to the chosen one', () => {
  const base = { allocations: { 'cat:a': 10 }, dailyAllocations: { '2026-10-09': { 'cat:a': 10 } } };
  const r = pomoRetargetSession(base, 'none', 'cat:b', [{ dateKey: '2026-10-09', secs: 600 }]);
  assert.deepEqual(r.allocations, { 'cat:a': 10, 'cat:b': 600 });
  assert.deepEqual(r.dailyAllocations['2026-10-09'], { 'cat:a': 10, 'cat:b': 600 });
});

test('retarget: moves at most what the old category holds (no seconds are created)', () => {
  const base = { allocations: { 'cat:a': 200, 'cat:b': 0 }, dailyAllocations: { '2026-10-09': { 'cat:a': 50 } } };
  const r = pomoRetargetSession(base, 'cat:a', 'cat:b', [{ dateKey: '2026-10-09', secs: 600 }]);
  assert.equal('cat:a' in r.allocations, false);
  assert.equal(r.allocations['cat:b'], 200);
  assert.deepEqual(r.dailyAllocations['2026-10-09'], { 'cat:b': 50 });
});

test('session parts: its chunks for the old key, else the whole duration on its day', () => {
  const s = { date: '2026-10-10', durationSeconds: 900, chunks: [{ targetKey: 'cat:a', dateKey: '2026-10-09', secs: 400 }, { targetKey: 'cat:a', dateKey: '2026-10-10', secs: 500 }, { targetKey: 'cat:z', dateKey: '2026-10-10', secs: 9 }] };
  assert.deepEqual(pomoSessionParts(s, 'cat:a'), [{ dayKey: '2026-10-09', secs: 400 }, { dayKey: '2026-10-10', secs: 500 }]);
  assert.deepEqual(pomoSessionParts({ date: '2026-10-10', durationSeconds: 900 }, 'cat:a'), [{ dayKey: '2026-10-10', secs: 900 }]);
});

const withSessions = (allocs, rows) => pomoNormalize({ allocations: allocs, dailyAllocations: { '2026-10-10': { ...allocs } }, rank: { sessions: rows } });

test('plan: reads the pending ROW; a saved row, same key or marked row move nothing (retries are safe)', () => {
  const row = { id: 's1', status: 'pending', targetKey: 'cat:a', date: '2026-10-10', durationSeconds: 600 };
  const base = withSessions({ 'cat:a': 600 }, [row]);
  assert.deepEqual(pomoRetargetPlan(base, { id: 's1', targetKey: 'cat:b' }), { from: 'cat:a', to: 'cat:b', parts: [{ dayKey: '2026-10-10', secs: 600 }] });
  assert.equal(pomoRetargetPlan(base, { id: 's1', targetKey: 'cat:a' }), null);
  assert.equal(pomoRetargetPlan(withSessions({}, [{ ...row, status: 'saved' }]), { id: 's1', targetKey: 'cat:b' }), null);
  assert.equal(pomoRetargetPlan(withSessions({}, [{ ...row, retarget: { from: 'cat:a', to: 'cat:b' } }]), { id: 's1', targetKey: 'cat:b' }), null);
  assert.equal(pomoRetargetPlan(base, { id: 'nope', targetKey: 'cat:b' }), null);
});

test('boot/restore merge: an older copy that still counts the time under the old category does not double count', () => {
  const moved = { id: 's1', status: 'saved', targetKey: 'cat:b', retarget: { from: 'cat:a', to: 'cat:b', parts: [{ dayKey: '2026-10-10', secs: 600 }] } };
  const fresh = withSessions({ 'cat:b': 600 }, [moved]);
  const stale = withSessions({ 'cat:a': 600 }, [{ id: 's1', status: 'pending', targetKey: 'cat:a' }]);
  const merged = pomoMergeProgress(fresh, stale);
  assert.equal(merged.allocations['cat:b'], 600);
  assert.equal(merged.allocations['cat:a'] || 0, 0);
  const merged2 = pomoMergeProgress(stale, fresh);
  assert.equal(merged2.allocations['cat:b'], 600);
  assert.equal(merged2.allocations['cat:a'] || 0, 0);
});

test('apply retargets: a side that already counted it is left alone', () => {
  const moved = { id: 's1', retarget: { from: 'cat:a', to: 'cat:b', parts: [{ dayKey: '2026-10-10', secs: 600 }] } };
  const done = withSessions({ 'cat:b': 600 }, [moved]);
  assert.equal(pomoApplyRetargets(done, done), done);
});
