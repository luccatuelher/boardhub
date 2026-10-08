import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhNotesSectionOptions, bhNotesSectionItems } = load(['notessec']);

const notes = [
  { id: 'c1', type: 'category', title: 'Curso de Ilustração' },
  { id: 'c2', type: 'category', title: 'Lixo', deleted: true },
  { id: 'f1', type: 'project', title: 'Semana 1', parentId: 'c1', entries: [{ id: 'e1', title: 'Aula 1' }, { id: 'e2', title: 'Apagada', deleted: true }] },
  { id: 'f2', type: 'project', title: 'Solta', entries: [{ id: 'e3', title: 'Nota solta' }] },
  { id: 'n1', type: 'note', title: 'Resumo', parentId: 'c1' },
  { id: 'n2', type: 'note', title: 'Fora', parentId: null },
  { id: 'n3', title: 'Sem tipo', parentId: 'c1' },
  { id: 'n4', type: 'note', title: 'Na lixeira', parentId: 'c1', deleted: true },
];

test('options: live categories and folders, folders prefixed by their category', () => {
  const opts = bhNotesSectionOptions(notes);
  assert.deepEqual(opts.map(o => [o.id, o.kind, o.label]), [
    ['c1', 'category', 'Curso de Ilustração'],
    ['f1', 'folder', 'Curso de Ilustração › Semana 1'],
    ['f2', 'folder', 'Solta'],
  ]);
});

test('items of a category: loose notes first, then one group per folder with live entries', () => {
  const r = bhNotesSectionItems(notes, 'c1');
  assert.equal(r.section.id, 'c1');
  assert.deepEqual(r.groups.map(g => [g.title, g.items.map(i => i.title)]), [
    ['', ['Resumo', 'Sem tipo']],
    ['Semana 1', ['Aula 1']],
  ]);
  assert.deepEqual(r.groups[0].items[0].target, { kind: 'note', id: 'n1' });
  assert.deepEqual(r.groups[1].items[0].target, { kind: 'entry', id: 'e1', folderId: 'f1' });
});

test('items of a folder are its live entries', () => {
  const r = bhNotesSectionItems(notes, 'f2');
  assert.deepEqual(r.groups.map(g => g.items.map(i => i.title)), [['Nota solta']]);
});

test('items: missing, trashed or non-container sections give null; ids compare as strings', () => {
  assert.equal(bhNotesSectionItems(notes, 'nope'), null);
  assert.equal(bhNotesSectionItems(notes, 'c2'), null);
  assert.equal(bhNotesSectionItems(notes, 'n1'), null);
  assert.equal(bhNotesSectionItems(notes, ''), null);
  assert.equal(bhNotesSectionItems(notes, undefined), null);
  const numeric = [{ id: 7, type: 'category', title: 'N' }, { id: 8, type: 'note', title: 'x', parentId: '7' }];
  assert.deepEqual(bhNotesSectionItems(numeric, '7').groups[0].items.map(i => i.title), ['x']);
});

test('empty category keeps no empty groups; empty folder keeps its header group', () => {
  assert.deepEqual(bhNotesSectionItems([{ id: 1, type: 'category', title: 'C' }], 1).groups, []);
  const r = bhNotesSectionItems([{ id: 1, type: 'category', title: 'C' }, { id: 2, type: 'project', title: 'P', parentId: 1, entries: [] }], 1);
  assert.deepEqual(r.groups.map(g => [g.title, g.items.length]), [['P', 0]]);
});

test('garbage input does not throw', () => {
  assert.deepEqual(bhNotesSectionOptions(null), []);
  assert.equal(bhNotesSectionItems(undefined, 1), null);
  assert.deepEqual(bhNotesSectionOptions([null, undefined, { id: 1, type: 'category' }]).map(o => o.label), ['Categoria']);
});
