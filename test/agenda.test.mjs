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
  assert.deepEqual(Object.keys(s.projects[0]).sort(), ['client', 'colorId', 'daysElapsed', 'daysLeft', 'deadline', 'focusMinutes', 'id', 'overdue', 'startDate', 'status', 'tasks', 'title', 'type']);
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

test('impossible calendar dates are dropped', () => {
  const s = bhAgendaSnapshot([P(1, 'p', { startDate: '2026-02-31', deadline: '2026-13-01', projectTasks: [T(1, 'a', { startDate: '2026-04-31', dueDate: '2026-02-28' })] })], [], TODAY, 'now');
  assert.equal(s.projects[0].startDate, ''); assert.equal(s.projects[0].deadline, '');
  assert.equal(s.projects[0].tasks[0].startDate, ''); assert.equal(s.projects[0].tasks[0].dueDate, '2026-02-28');
});

test('sessions that are not an array are tolerated', () => {
  for (const bad of [null, undefined, 'x', 5, {}, [null, 'a', { id: null }]])
    assert.equal(bhAgendaSnapshot([P(1, 'p', { projectTasks: [T(1, 'a')] })], bad, TODAY, 'now').projects[0].focusMinutes, 0);
});

test('post: follows the redirect, carries an abort signal, and is fatal when the script refuses', async () => {
  let opts;
  const r = await bhAgendaPost(async (u, o) => { opts = o; return { ok: true, json: async () => ({ ok: false }) }; }, URL_OK, 'k', snap);
  assert.equal(opts.redirect, 'follow');
  assert.ok(opts.signal && typeof opts.signal.aborted === 'boolean');
  assert.equal(r.ok, false); assert.equal(r.fatal, true);
  const net = await bhAgendaPost(async () => { throw new TypeError('Failed to fetch'); }, URL_OK, 'k', snap);
  assert.equal(net.ok, false); assert.ok(!net.fatal);
  const http = await bhAgendaPost(async () => ({ ok: false, status: 500 }), URL_OK, 'k', snap);
  assert.ok(!http.fatal);
});

test('post: a body over the script limit is refused up front, as fatal', async () => {
  const huge = { projects: [{ text: 'x'.repeat(450000) }] };
  let called = false;
  const r = await bhAgendaPost(async () => { called = true; return { ok: true, json: async () => ({ ok: true }) }; }, URL_OK, 'k', huge);
  assert.equal(called, false); assert.equal(r.ok, false); assert.equal(r.fatal, true);
});

test('post: a hung request is aborted after the timeout', async () => {
  const realSet = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => realSet(fn, ms === 30000 ? 5 : ms, ...a);
  try {
    const r = await bhAgendaPost((u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' })))), URL_OK, 'k', snap);
    assert.equal(r.ok, false); assert.match(r.err, /demorou/);
  } finally { globalThis.setTimeout = realSet; }
});

test('each open project gets a stable Calendar color; older projects keep theirs', () => {
  const mk = n => Array.from({ length: n }, (_, i) => P(1790000000000 + i * 1000, 'p' + i));
  const a = bhAgendaSnapshot(mk(6), [], TODAY, 'now').projects, b = bhAgendaSnapshot(mk(6), [], TODAY, 'later').projects;
  assert.deepEqual(a.map(p => p.colorId), b.map(p => p.colorId));
  assert.equal(new Set(a.map(p => p.colorId)).size, 6);
  assert.ok(a.every(p => /^(?:[1-79]|1[01])$/.test(p.colorId)));
  // adding a newer project does not recolor the older ones
  const more = bhAgendaSnapshot(mk(7), [], TODAY, 'now').projects;
  const byId = Object.fromEntries(more.map(p => [p.id, p.colorId]));
  a.forEach(p => assert.equal(byId[p.id], p.colorId));
  // even more projects than colors: nobody gets an undefined color
  assert.ok(bhAgendaSnapshot(mk(14), [], TODAY, 'now').projects.every(p => p.colorId));
});

test('recent: focus per day and per project, tasks due in the window with their status', () => {
  const pomo = {
    days: { '2026-10-14': 5400, '2026-10-12': 1800, '2026-09-20': 9999, 'junk': 5 },
    dailyAllocations: { '2026-10-14': { 'project:1': 3600, 'project:2': 1800, 'project:99': 60, study: 600 }, '2026-10-12': { 'project:1': 1800 } },
  };
  const projects = [
    P(1, 'Alpha', { projectTasks: [T(1, 'done', { status: 'Concluído', dueDate: '2026-10-13' }), T(2, 'late', { dueDate: '2026-10-10' }), T(3, 'future', { dueDate: '2026-10-20' }), T(4, 'old', { dueDate: '2026-09-01' })], deadline: '2026-10-14' }),
    P(2, 'Beta', { status: 'Concluído', deadline: '2026-10-11', projectTasks: [] }),
    P(3, 'Gone', { deleted: true, projectTasks: [T(1, 'x', { dueDate: '2026-10-13' })] }),
  ];
  const r = bhAgendaSnapshot(projects, [], TODAY, 'now', pomo).recent;
  assert.equal(r.windowDays, 14); assert.equal(r.from, '2026-10-01'); assert.equal(r.to, TODAY);
  assert.deepEqual(r.focus, [
    { date: '2026-10-12', totalMinutes: 30, projects: { 1: 30 } },
    { date: '2026-10-14', totalMinutes: 90, projects: { 1: 60, 2: 30 } },
  ]);
  assert.deepEqual(r.projectNames, { 1: 'Alpha', 2: 'Beta' });
  assert.deepEqual(r.dueInWindow.map(d => [d.dueDate, d.text, d.status]), [
    ['2026-10-10', 'late', 'Pendente'], ['2026-10-11', 'Entrega: Beta', 'Concluído'], ['2026-10-13', 'done', 'Concluído'], ['2026-10-14', 'Entrega: Alpha', 'Em Andamento'],
  ]);
});

test('recent: no pomodoro data, or no valid today, is tolerated', () => {
  assert.deepEqual(bhAgendaSnapshot([P(1, 'p')], [], TODAY, 'now', null).recent.focus, []);
  assert.deepEqual(bhAgendaSnapshot([P(1, 'p')], [], TODAY, 'now', { days: 5, dailyAllocations: [] }).recent.focus, []);
  assert.equal(bhAgendaSnapshot([P(1, 'p')], [], 'bad', 'now').recent, null);
});
