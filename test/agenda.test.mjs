import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhAgendaSnapshot, bhAgendaSig, bhAgendaPost, BH_AGENDA_URL } = load(['stable', 'agenda']);

const TODAY = '2026-10-14';
const T = (id, text, o = {}) => ({ id, text, status: 'Pendente', startDate: '2026-10-01', dueDate: '2026-10-20', notes: 'secret', ...o });
const P = (id, title, o = {}) => ({ id, type: 'work', title, client: 'Acme', status: 'Em Andamento', startDate: '2026-10-01', deadline: '2026-10-30', deleted: false, budget: 5000, notes: 'private', cover: 'data:x', projectTasks: [], ...o });

test('closed, cancelled and deleted projects and tasks are left out', () => {
  const s = bhAgendaSnapshot([
    P(1, 'open', { projectTasks: [T(1, 'a'), T(2, 'done', { status: 'Concluído' }), T(3, 'gone', { deleted: true })], taskTrash: [T(9, 'trash')] }),
    P(2, 'finished', { status: 'Concluído' }), P(3, 'cancelled', { status: 'Cancelado' }), P(4, 'deleted', { deleted: true }),
  ], [], TODAY, 'now');
  assert.deepEqual(s.projects.map(p => p.title), ['open']);
  assert.deepEqual(s.projects[0].tasks.map(t => t.text), ['a']);
});

test('paused and late projects stay; undated tasks and empty undated projects go', () => {
  const s = bhAgendaSnapshot([
    P(1, 'paused', { status: 'Pausado' }),
    P(2, 'late', { status: 'Atrasado', projectTasks: [T(1, 'nodate', { startDate: '', dueDate: '' })] }),
    P(3, 'nodates', { startDate: '', deadline: '' }),
    P(4, 'tasksonly', { startDate: '', deadline: '', projectTasks: [T(1, 'x')] }),
  ], [], TODAY, 'now');
  assert.deepEqual(s.projects.map(p => p.title).sort(), ['late', 'paused', 'tasksonly']);
  assert.equal(s.projects.find(p => p.title === 'late').tasks.length, 0);
});

test('only the allow-listed fields leave the app', () => {
  const s = bhAgendaSnapshot([P(1, 'p', { projectTasks: [T(1, 't')] })], [], TODAY, 'now');
  assert.deepEqual(Object.keys(s.projects[0]).sort(), ['client', 'daysElapsed', 'daysLeft', 'deadline', 'focusMinutes', 'id', 'overdue', 'startDate', 'status', 'tasks', 'title', 'type']);
  assert.deepEqual(Object.keys(s.projects[0].tasks[0]).sort(), ['daysElapsed', 'daysLeft', 'dueDate', 'focusMinutes', 'id', 'overdue', 'parent', 'startDate', 'status', 'text']);
  const json = JSON.stringify(s);
  for (const leak of ['secret', 'private', 'data:x', '5000']) assert.ok(!json.includes(leak), leak);
});

test('bad dates become empty, ids become strings, text is trimmed and capped', () => {
  const s = bhAgendaSnapshot([P(7, '  ' + 'x'.repeat(300) + ' ', { startDate: '10/10/2026', deadline: '2026-10-30T10:00', projectTasks: [T(5, 'a\n b', { startDate: 'nope', dueDate: '2026-11-02' })] })], [], TODAY, 'now');
  const p = s.projects[0];
  assert.equal(p.id, '7'); assert.equal(p.title.length, 200);
  assert.equal(p.startDate, ''); assert.equal(p.deadline, '');
  assert.equal(p.tasks[0].id, '5'); assert.equal(p.tasks[0].text, 'a b'); assert.equal(p.tasks[0].startDate, '');
});

test('a sub-task carries its parent name (also when the parent is already done)', () => {
  const s = bhAgendaSnapshot([P(1, 'p', { projectTasks: [
    T(1, 'Animatic'), T(2, 'Round 2', { parentId: 1 }), T(3, 'Old', { status: 'Concluído' }), T(4, 'Fix', { parentId: 3 }),
    T(5, 'orphan', { parentId: 99 }), T(6, 'self', { parentId: 6 }),
  ] })], [], TODAY, 'now');
  const by = Object.fromEntries(s.projects[0].tasks.map(t => [t.text, t.parent]));
  assert.deepEqual(by, { Animatic: '', 'Round 2': 'Animatic', Fix: 'Old', orphan: '', self: '' });
});

test('order is deterministic and the input is not mutated', () => {
  const input = [P(2, 'b', { deadline: '2026-11-01' }), P(1, 'a', { deadline: '2026-10-05', projectTasks: [T(2, 'late', { dueDate: '2026-10-09' }), T(1, 'soon', { dueDate: '2026-10-02' })] }), P(3, 'c', { deadline: '' })];
  const copy = JSON.stringify(input);
  const s = bhAgendaSnapshot(input, [], TODAY, 'now');
  assert.deepEqual(s.projects.map(p => p.title), ['a', 'b', 'c']);
  assert.deepEqual(s.projects[0].tasks.map(t => t.text), ['soon', 'late']);
  assert.equal(JSON.stringify(input), copy);
});

test('garbage input gives an empty list', () => {
  for (const bad of [null, undefined, 5, 'x', {}, [null, 3, 'a']]) assert.deepEqual(bhAgendaSnapshot(bad, [], TODAY, 'now').projects, []);
});

test('signature ignores the timestamp but follows the content', () => {
  const a = bhAgendaSnapshot([P(1, 'p')], [], TODAY, 't1'), b = bhAgendaSnapshot([P(1, 'p')], [], TODAY, 't2'), c = bhAgendaSnapshot([P(1, 'q')], [], TODAY, 't1');
  assert.equal(bhAgendaSig(a), bhAgendaSig(b));
  assert.notEqual(bhAgendaSig(a), bhAgendaSig(c));
});

const URL_OK = 'https://script.google.com/macros/s/AKfycbx123/exec';
const snap = bhAgendaSnapshot([P(1, 'p')], [], TODAY, 'now');

test('url check accepts only Apps Script /exec links', () => {
  assert.ok(BH_AGENDA_URL.test(URL_OK));
  assert.ok(BH_AGENDA_URL.test('https://script.google.com/a/macros/studio.com/s/AKfy/exec'));
  for (const bad of ['http://script.google.com/macros/s/A/exec', 'https://evil.com/macros/s/A/exec', 'https://script.google.com/macros/s/A/dev', ''])
    assert.ok(!BH_AGENDA_URL.test(bad), bad);
});

test('post: sends key and snapshot as a simple request (no Content-Type)', async () => {
  let seen;
  const r = await bhAgendaPost(async (u, o) => { seen = { u, o }; return { ok: true, json: async () => ({ ok: true }) }; }, ' ' + URL_OK + ' ', ' k1 ', snap);
  assert.deepEqual(r, { ok: true });
  assert.equal(seen.u, URL_OK);
  assert.equal(seen.o.method, 'POST');
  assert.equal(seen.o.headers, undefined);
  assert.deepEqual(JSON.parse(seen.o.body), { key: 'k1', snapshot: snap });
});

test('post: failures come back as {ok:false, err} and never throw', async () => {
  const bad = [
    [async () => ({ ok: false, status: 500 }), URL_OK, 'k'],
    [async () => ({ ok: true, json: async () => ({ ok: false }) }), URL_OK, 'k'],
    [async () => ({ ok: true, json: async () => { throw new Error('html'); } }), URL_OK, 'k'],
    [async () => { throw new TypeError('Failed to fetch'); }, URL_OK, 'k'],
    [async () => { throw new Error('must not be called'); }, 'https://evil.com/x', 'k'],
    [async () => { throw new Error('must not be called'); }, URL_OK, ''],
    [null, URL_OK, 'k'],
  ];
  for (const [f, u, k] of bad) {
    const r = await bhAgendaPost(f, u, k, snap);
    assert.equal(r.ok, false); assert.ok(typeof r.err === 'string' && r.err);
  }
});

test('timing: days elapsed since start, days left (negative = overdue), overdue flag', () => {
  const s = bhAgendaSnapshot([P(1, 'p', { startDate: '2026-10-04', deadline: '2026-10-12', projectTasks: [
    T(1, 'today', { startDate: '2026-10-14', dueDate: '2026-10-14' }), T(2, 'later', { startDate: '2026-10-10', dueDate: '2026-10-20' }),
    T(3, 'nostart', { startDate: '', dueDate: '2026-10-15' }), T(4, 'nodue', { startDate: '2026-10-01', dueDate: '' }),
  ] })], [], TODAY, 'now');
  const p = s.projects[0], t = Object.fromEntries(p.tasks.map(x => [x.text, x]));
  assert.deepEqual([p.daysElapsed, p.daysLeft, p.overdue], [10, -2, true]);
  assert.deepEqual([t.today.daysElapsed, t.today.daysLeft, t.today.overdue], [0, 0, false]);
  assert.deepEqual([t.later.daysElapsed, t.later.daysLeft, t.later.overdue], [4, 6, false]);
  assert.deepEqual([t.nostart.daysElapsed, t.nostart.daysLeft], [null, 1]);
  assert.deepEqual([t.nodue.daysElapsed, t.nodue.daysLeft, t.nodue.overdue], [13, null, false]);
  assert.equal(s.today, TODAY);
});

test('a task without text takes the name of its task card', () => {
  const s = bhAgendaSnapshot([P(1, 'p', { projectTasks: [T(1, ''), T(2, '   ')], miniProjects: [{ id: 1, title: 'Card name' }] })], [], TODAY, 'now');
  assert.deepEqual(s.projects[0].tasks.map(t => t.text), ['Card name']);
});

test('focus minutes: note sessions counted once, old taskId sessions, project total', () => {
  const sess = [
    { id: 's1', durationSeconds: 1500, targetKey: 'project:1' },
    { id: 's2', durationSeconds: 600, targetKey: 'project:1', taskId: 1 },
    { id: 's3', durationSeconds: 3000, targetKey: 'project:1', taskId: 2, taskNoteId: 'n9' },
    { id: 's4', durationSeconds: 900, targetKey: 'project:2' },
  ];
  const minis = [{ id: 1, title: 'a', innerNotes: [{ sessionIds: ['s1', 's1'] }, { sessionIds: ['s1'] }] }, { id: 2, title: 'b', innerNotes: [] }];
  const s = bhAgendaSnapshot([P(1, 'p', { projectTasks: [T(1, 'a'), T(2, 'b')], miniProjects: minis })], sess, TODAY, 'now');
  const p = s.projects[0];
  assert.equal(p.focusMinutes, 85);
  assert.deepEqual(p.tasks.map(t => [t.text, t.focusMinutes]), [['a', 35], ['b', 0]]);
});

test('signature follows today (days change) but not the timestamp', () => {
  const a = bhAgendaSnapshot([P(1, 'p')], [], '2026-10-14', 't1'), b = bhAgendaSnapshot([P(1, 'p')], [], '2026-10-15', 't1');
  assert.notEqual(bhAgendaSig(a), bhAgendaSig(b));
});
