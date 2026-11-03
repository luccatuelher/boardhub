import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const g = load(['date', 'sessgallery']);
const { bhIsSessionPost, bhSessionRange, bhSessionList, bhSessionPage, bhSessionByCategory, bhSessionGroupBy, bhSessionFacts, bhIsoShift } = g;

const post = (id, date, extra = {}) => ({ id, date, title: 't' + id, images: [], deleted: false, folder: 'f', ...extra });
const posts = [
  post('a', '2026-11-03', { sourceSessionId: 's1', sourceSessionIds: ['s1'] }),
  post('b', '2026-11-02', { sourceSessionIds: ['s2', 's3'] }),
  post('c', '2026-09-01', { sourceSessionId: 's4' }),
  post('d', '2026-11-01'),                                  // not a session post
  post('e', '2026-11-02', { sourceSessionId: 's5', deleted: true }),
];

test('only posts a session created count as session posts', () => {
  assert.equal(bhIsSessionPost(posts[0]), true);
  assert.equal(bhIsSessionPost(posts[1]), true);
  assert.equal(bhIsSessionPost(posts[3]), false);
  assert.equal(bhIsSessionPost(null), false);
});

test('presets: default is the last 30 days; month, 3 months, semester, year, all, custom', () => {
  const today = '2026-11-03';
  assert.deepEqual(bhSessionRange('30d', today), { from: '2026-10-05', to: today });
  assert.deepEqual(bhSessionRange(undefined, today), { from: '2026-10-05', to: today });
  assert.deepEqual(bhSessionRange('month', today), { from: '2026-11-01', to: today });
  assert.deepEqual(bhSessionRange('3m', today), { from: '2026-08-04', to: today });
  assert.deepEqual(bhSessionRange('6m', today), { from: '2026-05-04', to: today });
  assert.deepEqual(bhSessionRange('year', today), { from: '2025-11-04', to: today });
  assert.deepEqual(bhSessionRange('all', today), { from: '', to: '' });
  assert.deepEqual(bhSessionRange('custom', today, { from: '2026-10-10', to: '2026-10-01' }), { from: '2026-10-01', to: '2026-10-10' });
  assert.equal(bhIsoShift('2026-03-31', { months: -1 }), '2026-02-28');
});

test('list: range and search by the post date; deleted posts left out; every other gallery post counts; nothing is modified', () => {
  const before = JSON.stringify(posts);
  const r = bhSessionRange('30d', '2026-11-03');
  assert.deepEqual(bhSessionList(posts, r).map(p => p.id), ['a', 'b', 'd']);
  assert.deepEqual(bhSessionList(posts, { from: '', to: '' }).map(p => p.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(bhSessionList(posts, { from: '2026-11-01', to: '2026-11-01' }).map(p => p.id), ['d']);
  assert.deepEqual(bhSessionList(posts, { query: 'ta' }).map(p => p.id), ['a']);
  assert.equal(JSON.stringify(posts), before);
});

test('facts sum the minutes of all sessions of a post', () => {
  const rows = [{ id: 's2', durationSeconds: 600, endedAt: '2026-11-02T20:00:00Z' }, { id: 's3', durationSeconds: 1200, endedAt: '2026-11-02T21:45:00Z' }];
  assert.deepEqual(bhSessionFacts(posts[1], rows), { secs: 1800, endedAt: '2026-11-02T21:45:00Z' });
});

test('inside a group, posts follow category order and keep the date order within a category', () => {
  const ps = ['x1', 'y1', 'x2', 'z1'].map(id => post(id, '2026-11-01'));
  const meta = new Map([['x1', { idx: 1 }], ['y1', { idx: 0 }], ['x2', { idx: 1 }], ['z1', { idx: 2 }]]);
  const out = bhSessionByCategory([['novembro de 2026', ps]], meta);
  assert.deepEqual(out[0][1].map(p => p.id), ['y1', 'x1', 'x2', 'z1']);
});

test('pages cover every post once and keep group labels', () => {
  const mk = (n, pre) => Array.from({ length: n }, (_, i) => post(pre + i, '2026-11-01'));
  const groups = [['nov', mk(20, 'n')], ['out', mk(10, 'o')]];
  const p1 = bhSessionPage(groups, 0, 24), p2 = bhSessionPage(groups, 1, 24);
  assert.equal(p1.pageCount, 2);
  assert.equal(p1.total, 30);
  assert.deepEqual(p1.groups.map(([l, ps]) => [l, ps.length]), [['nov', 20], ['out', 4]]);
  assert.deepEqual(p2.groups.map(([l, ps]) => [l, ps.length]), [['out', 6]]);
  assert.equal(bhSessionPage(groups, 9, 24).page, 1);
  assert.equal(bhSessionPage([], 0).pageCount, 1);
});

test('week (Monday-Sunday) and day groups', () => {
  const ps = [post('a', '2026-11-03'), post('b', '2026-11-02'), post('c', '2026-11-01'), post('u', '')];
  const w = bhSessionGroupBy(ps, 'week');
  assert.deepEqual(w.map(([, x]) => x.map(p => p.id)), [['a', 'b'], ['c'], ['u']]);
  assert.equal(w[2][0], 'Sem data');
  const d = bhSessionGroupBy(ps, 'day');
  assert.deepEqual(d.map(([, x]) => x.length), [1, 1, 1, 1]);
});
