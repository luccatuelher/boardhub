import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhDuplicateProject } = load(['date', 'dup']);
const { bhEntityPack, bhEntityUnpack } = load(['stable', 'sync', 'entity']);
const { bhMergeSync } = load(['stable', 'sync', 'rank', 'date']);
const { localDateISO } = load(['date']);

test('localDateISO uses the local calendar day, not UTC', () => {
  assert.equal(localDateISO(new Date('2026-10-08T23:30:00')), '2026-10-08');
  assert.equal(localDateISO(new Date(2026, 0, 5, 0, 5)), '2026-01-05');
});

test('duplicate project: new ids, shared remap between tasks and minis, reset fields', () => {
  const src = {
    id: 5, title: 'Job', status: 'Concluído', paid: true, startDate: '2026-01-01', deadline: '2026-02-01', timelineEvents: [1],
    projectTasks: [{ id: 10, title: 'T', status: 'Feito', startDate: 'x', dueDate: 'y' }],
    miniProjects: [{ id: 10, galleryPostId: 9, title: 'M', status: 'Feito', innerNotes: [] }, { id: 11, title: 'M2', status: 'Feito', innerNotes: [] }],
  };
  const copy = bhDuplicateProject(src);
  assert.notEqual(copy.id, src.id);
  assert.match(copy.title, /\(cópia\)$/);
  assert.equal(copy.status, 'Em Andamento');
  assert.equal(copy.paid, false);
  assert.deepEqual(copy.timelineEvents, []);
  assert.equal(copy.projectTasks[0].id, copy.miniProjects[0].id, 'task and mini that shared an id keep sharing the new id');
  assert.notEqual(copy.miniProjects[0].id, copy.miniProjects[1].id);
  assert.ok(!('galleryPostId' in copy.miniProjects[0]));
  assert.equal(src.projectTasks[0].id, 10, 'source untouched');
});

test('entity pack/unpack round-trips state, including mixed numeric and string ids', () => {
  const state = {
    projects: [{ id: 1, title: 'a' }, { id: '1699999999999-ab12', title: 'b' }],
    notes: [{ id: 3, content: '<p>' + 'x'.repeat(10) + '</p>' }],
    pomoData: { days: { '2026-10-07': 60 }, rank: { points: 1 } },
    identity: { name: 'çã 日本' },
  };
  const docs = bhEntityPack(state);
  assert.deepEqual(bhEntityUnpack(docs), state);
});

test('entity unpack rejects a missing referenced entity', () => {
  const docs = bhEntityPack({ projects: [{ id: 1 }] });
  const partial = new Map([...docs].filter(([k]) => k === 'v4_root'));
  assert.throws(() => bhEntityUnpack(partial), /aguardando|incomplet/i);
});

test('mixed numeric and string ids merge as the same record', () => {
  const base = [{ id: 1, t: 'a' }, { id: 'u-1', t: 'b' }];
  const out = bhMergeSync(base, [{ id: 1, t: 'x' }, { id: 'u-1', t: 'b' }], [{ id: 1, t: 'a' }, { id: 'u-1', t: 'y' }, { id: 'u-2', t: 'n' }]);
  assert.deepEqual(out.map(x => [String(x.id), x.t]), [['1', 'x'], ['u-1', 'y'], ['u-2', 'n']]);
});

test('duplicate project: inner notes get fresh unique ids', () => {
  const { bhDuplicateProject: dup } = load(['date', 'dup']);
  const src = { id: 1, title: 'P', projectTasks: [], miniProjects: [{ id: 2, title: 'M', innerNotes: [{ id: 7, t: 'a' }, { id: 8, t: 'b' }] }] };
  const copy = dup(src);
  const inner = copy.miniProjects[0].innerNotes.map(n => n.id);
  assert.equal(new Set(inner).size, 2);
  assert.ok(!inner.includes(7) && !inner.includes(8));
});
