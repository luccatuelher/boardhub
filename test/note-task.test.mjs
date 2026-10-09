import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhNoteContainers, bhNoteProjects, bhNoteTasks, bhNewNoteTask } = load(['notetask']);

const notes = [
  { id: 'c1', type: 'category', title: 'Curso' },
  { id: 'f1', type: 'project', title: 'Narrativa', parentId: 'c1', entries: [{ id: 'e1', title: 'Aula 1' }] },
  { id: 'n1', type: 'note', title: 'Dentro', parentId: 'c1' },
  { id: 'n2', type: 'note', title: 'Solta' },
];

test('containers: a note lists its category; an entry its folder then the category', () => {
  assert.deepEqual(bhNoteContainers(notes, { kind: 'note', id: 'n1' }), ['c1']);
  assert.deepEqual(bhNoteContainers(notes, { kind: 'entry', id: 'e1', folderId: 'f1' }), ['f1', 'c1']);
  assert.deepEqual(bhNoteContainers(notes, { kind: 'note', id: 'n2' }), []);
  assert.deepEqual(bhNoteContainers(null, null), []);
});

test('projects: linked through the folder or the category, never deleted ones', () => {
  const projects = [
    { id: 1, title: 'A', notesSection: 'c1' },
    { id: 2, title: 'B', notesSection: 'f1' },
    { id: 3, title: 'C', notesSection: 'f1', deleted: true },
    { id: 4, title: 'D', notesSection: '' },
    { id: 5, title: 'E' },
  ];
  const entry = { kind: 'entry', id: 'e1', folderId: 'f1' };
  assert.deepEqual(bhNoteProjects(projects, notes, entry).map(p => p.id), [1, 2]);
  assert.deepEqual(bhNoteProjects(projects, notes, { kind: 'note', id: 'n1' }).map(p => p.id), [1]);
  assert.deepEqual(bhNoteProjects(projects, notes, { kind: 'note', id: 'n2' }), []);
});

test('numeric ids and string links compare as strings', () => {
  const nums = [{ id: 7, type: 'category' }, { id: 8, type: 'note', parentId: 7 }];
  assert.deepEqual(bhNoteProjects([{ id: 1, notesSection: '7' }], nums, { kind: 'note', id: 8 }).map(p => p.id), [1]);
});

test('a new task points back to its note and is found again', () => {
  const entry = { kind: 'entry', id: 'e1', folderId: 'f1' };
  const t = bhNewNoteTask(entry, 'Roteiro', '2026-10-09', '2026-10-16', 't1');
  assert.deepEqual(t.fromNote, { kind: 'entry', id: 'e1', folderId: 'f1' });
  assert.equal(t.status, 'Pendente');
  const note = bhNewNoteTask({ kind: 'note', id: 'n1' }, 'x', 'a', 'b', 't2');
  assert.deepEqual(note.fromNote, { kind: 'note', id: 'n1' });
  const projects = [{ id: 1, projectTasks: [t, note, { id: 't3', text: 'sem nota' }] }, { id: 2, deleted: true, projectTasks: [t] }];
  assert.deepEqual(bhNoteTasks(projects, entry).map(r => [r.project.id, r.task.id]), [[1, 't1']]);
  // the note keeps its id when it moves (loose note <-> entry): its tasks follow
  assert.deepEqual(bhNoteTasks(projects, { kind: 'entry', id: 'e1', folderId: 'other' }).map(r => r.task.id), ['t1']);
  assert.deepEqual(bhNoteTasks(projects, { kind: 'note', id: 'e1' }).map(r => r.task.id), ['t1']);
  assert.deepEqual(bhNoteTasks(projects, { kind: 'entry', id: 'zz', folderId: 'f1' }), []);
  assert.deepEqual(bhNoteTasks(projects, { kind: 'note', id: 'n1' }).map(r => r.task.id), ['t2']);
});
