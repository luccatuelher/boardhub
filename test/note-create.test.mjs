import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhNoteCreateAt } = load(['notecreate']);

const base = () => [
  { id: 'c1', type: 'category', title: 'Curso' },
  { id: 'f1', type: 'project', title: 'Narrativa', parentId: 'c1', entries: [{ id: 'e1', title: 'Aula 1' }, { id: 'e2', title: 'Aula 2' }] },
  { id: 'n1', type: 'note', title: 'Dentro', parentId: 'c1' },
  { id: 'n2', type: 'note', title: 'Solta' },
  { id: 'n3', type: 'note', title: 'Outra solta' },
];
const item = (id, type, extra = {}) => ({ id, type, title: 'novo', ...extra });
const ids = r => r.notes.map(n => n.id);

test('nothing open: appended at the root', () => {
  const r = bhNoteCreateAt(base(), null, 'note', item('x', 'note'));
  assert.deepEqual(ids(r), ['c1', 'f1', 'n1', 'n2', 'n3', 'x']);
  assert.equal(r.notes.at(-1).parentId, null);
});

test('loose note: new note goes below it, new folder / category above it', () => {
  const sel = { kind: 'note', id: 'n2' };
  assert.deepEqual(ids(bhNoteCreateAt(base(), sel, 'note', item('x', 'note'))), ['c1', 'f1', 'n1', 'n2', 'x', 'n3']);
  assert.deepEqual(ids(bhNoteCreateAt(base(), sel, 'folder', item('x', 'project', { entries: [] }))), ['c1', 'f1', 'n1', 'x', 'n2', 'n3']);
  assert.deepEqual(ids(bhNoteCreateAt(base(), sel, 'category', item('x', 'category'))), ['c1', 'f1', 'n1', 'x', 'n2', 'n3']);
});

test('note inside a category: stays in that category', () => {
  const sel = { kind: 'note', id: 'n1' };
  const a = bhNoteCreateAt(base(), sel, 'note', item('x', 'note'));
  assert.equal(a.notes.find(n => n.id === 'x').parentId, 'c1');
  assert.deepEqual(a.expand, ['c1']);
  const b = bhNoteCreateAt(base(), sel, 'folder', item('y', 'project', { entries: [] }));
  assert.equal(b.notes.find(n => n.id === 'y').parentId, 'c1');
  assert.deepEqual(ids(b), ['c1', 'f1', 'y', 'n1', 'n2', 'n3']);
  // a category cannot nest: it goes right after the category of the open note
  const c = bhNoteCreateAt(base(), sel, 'category', item('z', 'category'));
  assert.equal(c.notes.find(n => n.id === 'z').parentId, null);
  assert.deepEqual(ids(c), ['c1', 'z', 'f1', 'n1', 'n2', 'n3']);
});

test('entry of a folder: new note is a new entry right below it', () => {
  const r = bhNoteCreateAt(base(), { kind: 'entry', id: 'e1', folderId: 'f1' }, 'note', item('x', 'note', { content: '<p>a</p>', date: '1/1' }));
  assert.equal(r.entryOf, 'f1');
  assert.deepEqual(r.notes.find(n => n.id === 'f1').entries.map(e => e.id), ['e1', 'x', 'e2']);
  assert.deepEqual(ids(r), ['c1', 'f1', 'n1', 'n2', 'n3']);
  assert.deepEqual(Object.keys(r.notes.find(n => n.id === 'f1').entries[1]).sort(), ['content', 'date', 'id', 'title']);
});

test('entry of a folder: folder goes after the folder (same category), category after its category', () => {
  const sel = { kind: 'entry', id: 'e2', folderId: 'f1' };
  const f = bhNoteCreateAt(base(), sel, 'folder', item('y', 'project', { entries: [] }));
  assert.equal(f.notes.find(n => n.id === 'y').parentId, 'c1');
  assert.deepEqual(ids(f), ['c1', 'f1', 'y', 'n1', 'n2', 'n3']);
  const c = bhNoteCreateAt(base(), sel, 'category', item('z', 'category'));
  assert.deepEqual(ids(c), ['c1', 'z', 'f1', 'n1', 'n2', 'n3']);
});

test('stale selection, trashed anchor and garbage input fall back to the end', () => {
  assert.deepEqual(ids(bhNoteCreateAt(base(), { kind: 'note', id: 'gone' }, 'note', item('x', 'note'))).at(-1), 'x');
  const trashed = base(); trashed[3].deleted = true;
  assert.equal(ids(bhNoteCreateAt(trashed, { kind: 'note', id: 'n2' }, 'note', item('x', 'note'))).at(-1), 'x');
  assert.deepEqual(ids(bhNoteCreateAt(null, null, 'note', item('x', 'note'))), ['x']);
});
