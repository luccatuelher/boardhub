import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const g = load(['date', 'sessgallery']);
const { bhIsSessionPost, bhSessionRange, bhSessionEntries, bhSessionFilter, bhDailyGroups, bhDailyPage, bhIsoShift } = g;

const post = (id, date, extra = {}) => ({ id, date, title: 't' + id, images: [], deleted: false, folder: 'f', ...extra });
const row = (id, date, hhmm, extra = {}) => ({ id, date, endedAt: `${date}T${hhmm}:00-03:00`, durationSeconds: 3600, imageCount: 0, ...extra });

test('session posts are recognised', () => {
  assert.equal(bhIsSessionPost(post('a', '2026-11-03', { sourceSessionId: 's1' })), true);
  assert.equal(bhIsSessionPost(post('a', '2026-11-03')), false);
});

test('presets: default 30 days; month, 3 months, semester, year, all, custom', () => {
  const today = '2026-11-03';
  assert.deepEqual(bhSessionRange('30d', today), { from: '2026-10-05', to: today });
  assert.deepEqual(bhSessionRange('month', today), { from: '2026-11-01', to: today });
  assert.deepEqual(bhSessionRange('3m', today), { from: '2026-08-04', to: today });
  assert.deepEqual(bhSessionRange('6m', today), { from: '2026-05-04', to: today });
  assert.deepEqual(bhSessionRange('year', today), { from: '2025-11-04', to: today });
  assert.deepEqual(bhSessionRange('all', today), { from: '', to: '' });
  assert.deepEqual(bhSessionRange('custom', today, { from: '2026-10-10', to: '2026-10-01' }), { from: '2026-10-01', to: '2026-10-10' });
  assert.equal(bhIsoShift('2026-03-31', { months: -1 }), '2026-02-28');
});

// A post with two one-hour sessions (2 + 1 images), plus one single-session post and one plain post.
const posts = [
  post('A', '2026-11-03', { sourceSessionIds: ['s1', 's2'], images: ['i1', 'i2', 'i3'] }),
  post('B', '2026-11-03', { sourceSessionId: 's3', images: ['b1'] }),
  post('P', '2026-11-03'),
  post('D', '2026-11-03', { sourceSessionId: 's9', deleted: true }),
];
const rows = [
  row('s1', '2026-11-03', '10:00', { imageCount: 2 }),
  row('s2', '2026-11-03', '15:00', { imageCount: 1 }),
  row('s3', '2026-10-20', '09:00', { imageCount: 1 }),
];

test('one entry per session; each session gets the images it added; plain and deleted posts are left out', () => {
  const e = bhSessionEntries(posts, rows);
  assert.deepEqual(e.map(x => x.sid), ['s1', 's2', 's3']);
  assert.deepEqual(e[0].images, ['i1', 'i2']);
  assert.deepEqual(e[1].images, ['i3']);
  assert.deepEqual(e[2].images, ['b1']);
  assert.equal(e[0].day, '2026-11-03');
});

test('images the post had before its sessions are skipped; counts that exceed the images give none; unknown counts keep the old behaviour', () => {
  const own = bhSessionEntries([post('A', '2026-11-03', { sourceSessionIds: ['s1', 's2'], images: ['own', 'i1', 'i2', 'i3'] })], rows);
  assert.deepEqual(own[0].images, ['i1', 'i2']);
  assert.deepEqual(own[1].images, ['i3']);
  const fewer = bhSessionEntries([post('A', '2026-11-03', { sourceSessionIds: ['s1', 's2'], images: ['i1'] })], rows);
  assert.equal(fewer[0].images, null);
  const legacy = bhSessionEntries([post('L', '2026-11-03', { sourceSessionId: 'old', images: ['a', 'b'] })], [{ id: 'old', date: '2026-11-03', endedAt: '2026-11-03T10:00:00-03:00', durationSeconds: 60 }]);
  assert.deepEqual(legacy[0].images, ['a', 'b']);
});

test('a post whose session rows are gone still shows once', () => {
  const e = bhSessionEntries([post('Z', '2026-11-02', { sourceSessionId: 'gone', images: ['z'] })], []);
  assert.equal(e.length, 1);
  assert.equal(e[0].day, '2026-11-02');
});

test('filter by session day and search', () => {
  const e = bhSessionEntries(posts, rows);
  assert.deepEqual(bhSessionFilter(e, { from: '2026-11-01', to: '2026-11-30' }).map(x => x.sid), ['s1', 's2']);
  assert.deepEqual(bhSessionFilter(e, { query: 'tB' }).map(x => x.sid), ['s3']);
});

test('day and week show each session by itself; month and year fold the sessions of a post', () => {
  const e = bhSessionEntries(posts, rows);
  const day = bhDailyGroups(e, 'day', 'newest', new Map());
  assert.deepEqual(day.map(g => g.key), ['2026-11-03', '2026-10-20']);
  assert.deepEqual(day[0].days[0].cards.map(c => c.entries.length), [1, 1]);
  const month = bhDailyGroups(e, 'month', 'newest', new Map());
  assert.deepEqual(month.map(g => g.key), ['2026-11', '2026-10']);
  assert.equal(month[0].days[0].cards.length, 1);
  assert.equal(month[0].days[0].cards[0].entries.length, 2);
  assert.equal(month[0].days[0].cards[0].secs, 7200);
  assert.equal(bhDailyGroups(e, 'year', 'newest', new Map())[0].days[0].cards.length, 2);
  assert.equal(bhDailyGroups(e, 'flat', 'newest', new Map()).length, 1);
});

test('week: one line per weekday that has sessions, Monday first, sessions separate', () => {
  const ps = [post('A', '2026-11-03', { sourceSessionId: 'a' }), post('B', '2026-11-01', { sourceSessionId: 'b' }), post('C', '2026-11-02', { sourceSessionId: 'c' })];
  const rs = [row('a', '2026-11-03', '10:00'), row('b', '2026-11-01', '10:00'), row('c', '2026-11-02', '10:00')]; // Tue, Sun, Mon
  const w = bhDailyGroups(bhSessionEntries(ps, rs), 'week', 'newest', new Map());
  assert.equal(w.length, 2);                       // Sun 1 Nov belongs to the week of Mon 26 Oct
  assert.deepEqual(w[0].days.map(d => d.key), ['2026-11-02', '2026-11-03']);
  assert.deepEqual(w[1].days.map(d => d.key), ['2026-11-01']);
});

test('inside a day the cards follow category order', () => {
  const ps = ['x', 'y', 'z'].map((id, i) => post(id, '2026-11-03', { sourceSessionId: 's' + id }));
  const rs = ['x', 'y', 'z'].map((id, i) => row('s' + id, '2026-11-03', '1' + i + ':00'));
  const meta = new Map([['x', { idx: 2 }], ['y', { idx: 0 }], ['z', { idx: 1 }]]);
  const d = bhDailyGroups(bhSessionEntries(ps, rs), 'day', 'newest', meta);
  assert.deepEqual(d[0].days[0].cards.map(c => c.post.id), ['y', 'z', 'x']);
});

test('pages cover every card once and keep labels', () => {
  const ps = Array.from({ length: 50 }, (_, i) => post('p' + i, '2026-11-03', { sourceSessionId: 's' + i }));
  const rs = ps.map((p, i) => row('s' + i, '2026-11-03', '10:00'));
  const groups = bhDailyGroups(bhSessionEntries(ps, rs), 'day', 'newest', new Map());
  const p1 = bhDailyPage(groups, 0, 36), p2 = bhDailyPage(groups, 1, 36);
  assert.equal(p1.pageCount, 2);
  assert.equal(p1.total, 50);
  assert.equal(p1.groups[0].days[0].cards.length, 36);
  assert.equal(p2.groups[0].days[0].cards.length, 14);
  assert.equal(bhDailyPage(groups, 9, 36).page, 1);
  assert.equal(bhDailyPage([], 0).pageCount, 1);
});
