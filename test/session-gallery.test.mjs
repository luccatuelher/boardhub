import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const g = load(['date', 'sessgallery']);
const { bhIsSessionPost, bhSessionRange, bhSessionList, bhSessionPage, bhSessionArchive, bhIsoShift } = g;

const post = (id, date, extra = {}) => ({ id, date, title: 't' + id, images: [], deleted: false, folder: 'f', ...extra });
const posts = [
  post('a', '2026-11-03', { sourceSessionId: 's1', sourceSessionIds: ['s1'] }),
  post('b', '2026-11-02', { sourceSessionIds: ['s2', 's3'] }),
  post('c', '2026-09-01', { sourceSessionId: 's4' }),
  post('d', '2026-11-01'),                                  // not a session post
  post('e', '2026-11-02', { sourceSessionId: 's5', deleted: true }),
  post('f', '2026-11-02', { sourceSessionId: 's6', sessionArchived: true }),
];
const rows = [
  { id: 's1', durationSeconds: 1800, endedAt: '2026-11-03T11:54:00Z' },
  { id: 's2', durationSeconds: 600, endedAt: '2026-11-02T20:00:00Z' },
  { id: 's3', durationSeconds: 1200, endedAt: '2026-11-02T21:45:00Z' },
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
  assert.deepEqual(bhSessionRange('custom', today, { from: '2026-10-10', to: '' }), { from: '2026-10-10', to: '' });
  assert.equal(bhIsoShift('2026-03-31', { months: -1 }), '2026-02-28');
});

test('list: range, newest first, focus minutes summed, archived and deleted kept apart', () => {
  const r = bhSessionRange('30d', '2026-11-03');
  const list = bhSessionList(posts, rows, r);
  assert.deepEqual(list.map(x => x.post.id), ['a', 'b']);
  assert.equal(list[1].secs, 1800);
  assert.equal(list[1].endedAt, '2026-11-02T21:45:00Z');
  assert.deepEqual(bhSessionList(posts, rows, { ...r, archived: true }).map(x => x.post.id), ['f']);
  assert.deepEqual(bhSessionList(posts, rows, { from: '', to: '' }).map(x => x.post.id), ['a', 'b', 'c']);
  assert.deepEqual(bhSessionList(posts, rows, { query: 't3' }).map(x => x.post.id), []);
  assert.deepEqual(bhSessionList(posts, rows, { query: 'ta' }).map(x => x.post.id), ['a']);
});

test('pages clamp and cover every item once', () => {
  const list = Array.from({ length: 50 }, (_, i) => i);
  assert.equal(bhSessionPage(list, 0, 24).pageCount, 3);
  assert.equal(bhSessionPage(list, 9, 24).page, 2);
  assert.deepEqual([0, 1, 2].flatMap(p => bhSessionPage(list, p, 24).items), list);
  assert.equal(bhSessionPage([], 0).pageCount, 1);
});

test('archive touches only the flag of that session post; others and non-session posts are untouched', () => {
  const next = bhSessionArchive(posts, 'a', true);
  assert.equal(next.find(p => p.id === 'a').sessionArchived, true);
  assert.deepEqual({ ...next.find(p => p.id === 'a'), sessionArchived: undefined }, { ...posts[0], sessionArchived: undefined });
  assert.equal(next.length, posts.length);
  assert.equal(next.find(p => p.id === 'b'), posts[1]);
  assert.equal(bhSessionArchive(next, 'a', false).find(p => p.id === 'a').sessionArchived, false);
  assert.equal(bhSessionArchive(posts, 'd', true).find(p => p.id === 'd'), posts[3]);
  assert.equal(next.some(p => p.deleted && p.id === 'a'), false);
});

test('a session appended to an old post moves it into the range', () => {
  const old = [post('o', '2026-09-01', { sourceSessionIds: ['n1'] }), post('p', '2026-09-01', { sourceSessionId: 'x', lastSessionAt: '2026-11-03T15:00:00.000Z' })];
  const r = [{ id: 'n1', durationSeconds: 60, endedAt: '2026-11-03T14:00:00.000Z' }];
  const list = bhSessionList(old, r, bhSessionRange('30d', '2026-11-03'));
  assert.deepEqual(list.map(x => x.post.id).sort(), ['o', 'p']);
});
