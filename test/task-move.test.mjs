import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhTaskMoveBundle, bhTaskMoveAdd, bhTaskMoveRemove } = load(['tasklinks']);
const { pomoMoveTaskSessions } = load(['rank']);

const A = {
  id: 'A',
  miniProjects: [
    { id: 't1', title: 'Romanos', innerNotes: [{ id: 'n1', sessionIds: ['s1'] }], galleryPostId: 'post1' },
    { id: 't1b', title: 'V2', parentId: 't1', innerNotes: [{ id: 'n2', sessionIds: ['s2'] }] },
    { id: 't2', title: 'Outra', innerNotes: [] },
  ],
  projectTasks: [{ id: 't1', text: 'Romanos' }, { id: 't1b', text: 'V2', parentId: 't1' }, { id: 't2', text: 'Outra' }],
};
const B = { id: 'B', miniProjects: [{ id: 'x' }], projectTasks: [{ id: 'x' }] };

test('the bundle is the task, its sub-tasks, their notes and the sessions of those notes', () => {
  const b = bhTaskMoveBundle(A, 't1');
  assert.deepEqual(b.ids.sort(), ['t1', 't1b']);
  assert.deepEqual(b.sessionIds.sort(), ['s1', 's2']);
  assert.equal(b.minis.find(m => m.id === 't1b').parentId, 't1');
  assert.equal(b.minis.find(m => m.id === 't1').galleryPostId, 'post1', 'the post link travels with the task');
  assert.equal(bhTaskMoveBundle(A, 'nope'), null);
});

test('a sub-task moved on its own becomes a task of the other project', () => {
  const b = bhTaskMoveBundle(A, 't1b');
  assert.deepEqual(b.ids, ['t1b']);
  assert.equal('parentId' in b.minis[0], false);
  assert.equal('parentId' in b.tasks[0], false);
});

test('add puts it in the destination once and remove takes it out of the source', () => {
  const b = bhTaskMoveBundle(A, 't1');
  const to = bhTaskMoveAdd(B, b);
  assert.deepEqual(to.miniProjects.map(m => m.id), ['x', 't1', 't1b']);
  assert.deepEqual(to.projectTasks.map(m => m.id), ['x', 't1', 't1b']);
  assert.equal(bhTaskMoveAdd(to, b).miniProjects.length, 3, 'adding twice changes nothing');
  const from = bhTaskMoveRemove(A, b);
  assert.deepEqual(from.miniProjects.map(m => m.id), ['t2']);
  assert.deepEqual(from.projectTasks.map(m => m.id), ['t2']);
});

const pomo = () => ({
  days: { '2026-10-26': 3600, '2026-10-27': 1800 },
  allocations: { 'project:A': 5400, 'cat:c1': 600 },
  dailyAllocations: { '2026-10-26': { 'project:A': 3600 }, '2026-10-27': { 'project:A': 1800, 'cat:c1': 600 } },
  rank: { sessions: [
    { id: 's1', status: 'saved', targetKey: 'project:A', date: '2026-10-26', durationSeconds: 3600, taskId: 't1', taskProjectId: 'A' },
    { id: 's2', status: 'saved', targetKey: 'project:A', date: '2026-10-27', durationSeconds: 1800, taskId: 't1b', taskProjectId: 'A' },
    { id: 's3', status: 'saved', targetKey: 'cat:c1', date: '2026-10-27', durationSeconds: 600, taskId: 't1', taskProjectId: 'A' },
    { id: 's4', status: 'saved', targetKey: 'project:A', date: '2026-10-27', durationSeconds: 100, taskId: 't2', taskProjectId: 'A' },
  ] },
});

test('project time moves with the task: totals, per-day totals and the session rows', () => {
  const out = pomoMoveTaskSessions(pomo(), ['t1', 't1b'], 'A', { id: 'B', title: 'Projeto B' }, ['s1', 's2']);
  assert.equal(out.allocations['project:A'] || 0, 0);
  assert.equal(out.allocations['project:B'], 5400);
  assert.equal(out.allocations['cat:c1'], 600, 'category time stays');
  assert.equal(out.dailyAllocations['2026-10-26']['project:B'], 3600);
  assert.equal(out.dailyAllocations['2026-10-27']['project:B'], 1800);
  const row = id => out.rank.sessions.find(s => s.id === id);
  assert.equal(row('s1').targetKey, 'project:B');
  assert.equal(row('s1').taskProjectId, 'B');
  assert.equal(row('s1').retarget.from, 'project:A');
  assert.equal(row('s3').targetKey, 'cat:c1', 'a category session keeps its category');
  assert.equal(row('s3').taskProjectId, 'B', 'but is now filed under the other project');
  assert.equal(row('s4').targetKey, 'project:A', 'other tasks stay');
});

test('nothing to move leaves the data untouched', () => {
  const base = pomo();
  assert.equal(pomoMoveTaskSessions(base, ['zzz'], 'A', { id: 'B', title: 'B' }, []), base);
  assert.equal(pomoMoveTaskSessions(base, ['t1'], 'A', { id: 'A', title: 'A' }, []), base);
});

test('move there and back: per-day time returns to the original days', () => {
  const row = { id: 's1', taskId: 't1', targetKey: 'project:A', durationSeconds: 3600, date: '2026-10-09',
    chunks: [{ targetKey: 'project:A', dateKey: '2026-10-08', secs: 1800 }, { targetKey: 'project:A', dateKey: '2026-10-09', secs: 1800 }] };
  const base = { allocations: { 'project:A': 3600 }, dailyAllocations: { '2026-10-08': { 'project:A': 1800 }, '2026-10-09': { 'project:A': 1800 } }, rank: { sessions: [row] } };
  const there = pomoMoveTaskSessions(base, ['t1'], 'A', { id: 'B', title: 'B' }, []);
  const back = pomoMoveTaskSessions(there, ['t1'], 'B', { id: 'A', title: 'A' }, []);
  assert.equal(JSON.stringify(back.dailyAllocations['2026-10-08']), JSON.stringify({ 'project:A': 1800 }));
  assert.equal(back.allocations['project:A'], 3600);
  assert.equal(back.allocations['project:B'] || 0, 0);
});
