import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { BH_PIN_MAX, bhPinCount, bhIsPinned, bhTogglePin } = load(['notepins']);

const notes = () => [
  { id: 'a', type: 'note' }, { id: 'b', type: 'note' }, { id: 'c', type: 'note', deleted: true, pinned: true },
  { id: 'f', type: 'project', entries: [{ id: 'e1' }, { id: 'e2' }] },
];

test('the limit is four, shared with the projects on the home screen', () => {
  assert.equal(BH_PIN_MAX, 4);
});

test('pinning a note or an entry sets the flag with the time; unpinning removes both', () => {
  const pinnedNote = bhTogglePin(notes(), { kind: 'note', id: 'a' }, 111);
  assert.equal(pinnedNote.ok, true);
  assert.equal(pinnedNote.pinned, true);
  assert.deepEqual([pinnedNote.notes[0].pinned, pinnedNote.notes[0].pinnedAt], [true, 111]);
  const pinnedEntry = bhTogglePin(pinnedNote.notes, { kind: 'entry', id: 'e2', folderId: 'f' }, 222);
  assert.equal(pinnedEntry.notes[3].entries[1].pinned, true);
  assert.equal(bhIsPinned(pinnedEntry.notes, { kind: 'entry', id: 'e2', folderId: 'f' }), true);
  assert.equal(bhIsPinned(pinnedEntry.notes, { kind: 'entry', id: 'e1', folderId: 'f' }), false);
  const back = bhTogglePin(pinnedEntry.notes, { kind: 'note', id: 'a' }, 333);
  assert.equal(back.pinned, false);
  assert.equal('pinned' in back.notes[0] || 'pinnedAt' in back.notes[0], false);
});

test('trashed notes do not count; a fifth pin is refused and nothing changes', () => {
  let list = notes();
  assert.equal(bhPinCount(list), 0, 'the trashed pinned note is not counted');
  list = bhTogglePin(list, { kind: 'note', id: 'a' }, 1).notes;
  list = bhTogglePin(list, { kind: 'note', id: 'b' }, 2).notes;
  list = bhTogglePin(list, { kind: 'entry', id: 'e1', folderId: 'f' }, 3).notes;
  list = bhTogglePin(list, { kind: 'entry', id: 'e2', folderId: 'f' }, 4).notes;
  assert.equal(bhPinCount(list), 4);
  const refused = bhTogglePin([...list, { id: 'g', type: 'note' }], { kind: 'note', id: 'g' }, 5);
  assert.equal(refused.ok, false);
  assert.equal(bhPinCount(refused.notes), 4);
  // unpinning is always allowed at the limit
  assert.equal(bhTogglePin(list, { kind: 'note', id: 'a' }, 6).ok, true);
});
