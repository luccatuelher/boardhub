import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhSectionGroups, bhSectionBlockOrder, bhMoveIntoSection, bhPlaceLoose } = load(['notesections']);
const { bhNoteCreateAt } = load(['notecreate']);
const N = id => ({ id, type: 'note' });
const S = id => ({ id, type: 'section' });
const ids = l => l.map(x => x.id).join(',');

test('a section groups the items after it, up to the next section; loose items come first', () => {
  const g = bhSectionGroups([N('a'), S('s1'), N('b'), N('c'), S('s2'), S('s3'), N('d')]);
  assert.deepEqual(g.map(x => [x.section && x.section.id, ids(x.members)]), [[null, 'a'], ['s1', 'b,c'], ['s2', ''], ['s3', 'd']]);
  assert.deepEqual(bhSectionGroups([S('s1')]).map(x => x.section.id), ['s1']);
  assert.deepEqual(bhSectionGroups([]), []);
});

test('dropping a section moves it with its group, above/below whole sections', () => {
  const list = [N('a'), S('s1'), N('b'), N('c'), S('s2'), N('d'), S('s3'), N('e')];
  assert.equal(bhSectionBlockOrder(list, 's3', 'd').join(), 'a,s1,b,c,s3,e,s2,d', 'up onto an item of s2: above s2');
  assert.equal(bhSectionBlockOrder(list, 's1', 'd').join(), 'a,s2,d,s1,b,c,s3,e', 'down onto an item of s2: below all of s2');
  assert.equal(bhSectionBlockOrder(list, 's2', 'a').join(), 'a,s2,d,s1,b,c,s3,e', 'up onto a loose item: the loose group stays above');
  assert.equal(bhSectionBlockOrder(list, 's1', 'b'), null, 'onto its own item: nothing');
  assert.equal(bhSectionBlockOrder(list, 'a', 'b'), null, 'only sections move this way');
});

test('an item dropped on a section header becomes its first member', () => {
  const notes = [{ id: 'n1', type: 'note' }, { id: 's', type: 'section', parentId: 'cat' }, { id: 'n2', type: 'note', parentId: 'cat' }];
  const out = bhMoveIntoSection(notes, 'n1', 's');
  assert.deepEqual(out.map(x => x.id), ['s', 'n1', 'n2']);
  assert.equal(out[1].parentId, null, 'sections are root-level, so is what joins them');
  assert.equal(bhMoveIntoSection(notes, 's', 's'), notes);
});

test('a new section goes above the open note (like a folder)', () => {
  const notes = [{ id: 'a', type: 'note', parentId: null }, { id: 'b', type: 'note', parentId: null }];
  const out = bhNoteCreateAt(notes, { kind: 'note', id: 'b' }, 'section', { id: 's', type: 'section' });
  assert.deepEqual(out.notes.map(x => x.id), ['a', 's', 'b']);
});

test('an item moved to a level goes to its loose group, not into a section', () => {
  const notes = [{ id: 'a' }, { id: 's1', type: 'section' }, { id: 'b' }, { id: 'x', parentId: null }];
  assert.deepEqual(bhPlaceLoose(notes, 'x').map(n => n.id), ['a', 'x', 's1', 'b']);
  const ok = [{ id: 'x' }, { id: 's1', type: 'section' }];
  assert.equal(bhPlaceLoose(ok, 'x'), ok, 'already above the first section');
  const none = [{ id: 'a' }, { id: 'x' }];
  assert.equal(bhPlaceLoose(none, 'x'), none, 'no sections: nothing to do');
  const nested = [{ id: 's', type: 'section', parentId: 'cat' }, { id: 'y', parentId: 'other' }];
  assert.equal(bhPlaceLoose(nested, 'y'), nested, 'sections of another level do not count');
});

test('a section is always created at the root, above the top-level container of the open note', () => {
  const notes = [{ id: 'x', type: 'note', parentId: null }, { id: 'cat', type: 'category', parentId: null }, { id: 'sub', type: 'category', parentId: 'cat' }, { id: 'n', type: 'note', parentId: 'sub' }];
  const out = bhNoteCreateAt(notes, { kind: 'note', id: 'n' }, 'section', { id: 's', type: 'section' });
  assert.deepEqual(out.notes.map(x => x.id), ['x', 's', 'cat', 'sub', 'n']);
  assert.equal(out.notes[1].parentId, null);
  const inFolder = [{ id: 'f', type: 'project', parentId: 'cat', entries: [{ id: 'e' }] }, { id: 'cat', type: 'category', parentId: null }];
  const out2 = bhNoteCreateAt(inFolder, { kind: 'entry', id: 'e', folderId: 'f' }, 'section', { id: 's', type: 'section' });
  assert.equal(out2.notes.find(x => x.id === 's').parentId, null);
});

test('a section left with a parent by older data still counts as root-level', () => {
  const notes = [{ id: 'a' }, { id: 's', type: 'section', parentId: 'cat' }, { id: 'x', parentId: 'cat' }];
  assert.deepEqual(bhPlaceLoose([{ id: 'a' }, { id: 's', type: 'section', parentId: 'cat' }, { id: 'y', parentId: null }], 'y').map(n => n.id), ['a', 'y', 's']);
  const out = bhMoveIntoSection(notes, 'a', 's');
  assert.equal(out.find(n => n.id === 'a').parentId, null);
});
