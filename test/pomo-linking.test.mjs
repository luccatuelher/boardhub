import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const stubs = {
  isProjectScopedPost: p => !!p && p.storageScope === 'project',
  pomoProjectKey: id => 'project:' + String(id),
  pomoCategoryKey: id => 'cat:' + String(id),
};
const { pomoLinkedExtra, bhProjectGalleryScope, bhLinkedPostCount } = load(['gallinks'], { stubs });

const folders = [{ id: 'F', label: 'Storyboards', sections: [{ id: 's1', label: 'Brink' }, { id: 's2', label: 'Other' }], manualOrder: ['p1', 'p2', 'sec:s1', 'p3', 'p4', 'sec:s2', 'p5'] }];
const posts = ['p1', 'p2', 'p3', 'p4', 'p5'].map(id => ({ id, folder: 'F', title: id, date: '2026-10-01', images: [] }));
const sess = (o) => ({ status: 'saved', durationSeconds: 600, ...o });

test('whole-folder link: the category total, and the category gets the project time (once)', () => {
  const data = { allocations: { 'cat:F': 5000, 'project:1': 700 }, rank: { sessions: [] } };
  const extra = pomoLinkedExtra(data, [{ id: 1, galleryFolder: 'F' }], folders, posts);
  assert.equal(extra['project:1'], 5000);
  assert.equal(extra['cat:F'], 700);
});

test('section link counts only sessions filed into the section posts', () => {
  const data = { allocations: {}, rank: { sessions: [
    sess({ id: 'a', targetKey: 'cat:F', galleryPostId: 'p3' }),
    sess({ id: 'b', targetKey: 'cat:F', galleryPostId: 'p5' }), // another section
  ] } };
  assert.equal(pomoLinkedExtra(data, [{ id: 1, galleryFolder: 'F', gallerySection: 's1' }], folders, posts)['project:1'], 600);
});

test('a category session filed into a task of THIS project counts even if its post is outside the scope (once)', () => {
  const data = { allocations: {}, rank: { sessions: [
    sess({ id: 'a', targetKey: 'cat:F', taskProjectId: '1', galleryPostId: null }),
    sess({ id: 'b', targetKey: 'cat:F', taskProjectId: '1', galleryPostId: 'p3' }), // in scope AND via task: one count
    sess({ id: 'c', targetKey: 'cat:F', taskProjectId: '2', galleryPostId: null }), // another project's task
  ] } };
  assert.equal(pomoLinkedExtra(data, [{ id: 1, galleryFolder: 'F', gallerySection: 's1' }], folders, posts)['project:1'], 1200);
});

test('a section moved to another folder keeps counting for its project (sessions keep the old category key)', () => {
  const moved = [{ id: 'G', label: 'New', sections: [{ id: 's1', label: 'Brink' }], manualOrder: ['sec:s1', 'p3', 'p4'] }];
  const movedPosts = [{ id: 'p3', folder: 'G' }, { id: 'p4', folder: 'G' }];
  const data = { allocations: {}, rank: { sessions: [sess({ id: 'a', targetKey: 'cat:F', galleryPostId: 'p3' })] } };
  assert.equal(pomoLinkedExtra(data, [{ id: 1, galleryFolder: 'G', gallerySection: 's1' }], moved, movedPosts)['project:1'], 600);
});

test('trashed posts of a section still belong to its scope', () => {
  const withTrash = posts.map(p => (p.id === 'p3' ? { ...p, deleted: true } : p));
  const scope = bhProjectGalleryScope({ galleryFolder: 'F', gallerySection: 's1' }, folders, withTrash);
  assert.deepEqual([...scope.postIds].sort(), ['p3', 'p4']);
  const data = { allocations: {}, rank: { sessions: [sess({ id: 'a', targetKey: 'cat:F', galleryPostId: 'p3' })] } };
  assert.equal(pomoLinkedExtra(data, [{ id: 1, galleryFolder: 'F', gallerySection: 's1' }], folders, withTrash)['project:1'], 600);
  // but the live count (animatics) skips the trashed one
  assert.equal(bhLinkedPostCount({ galleryFolder: 'F', gallerySection: 's1' }, folders, withTrash), 1);
});

test('single linked post, deleted projects and unlinked projects', () => {
  const data = { allocations: { 'project:2': 50 }, rank: { sessions: [sess({ id: 'a', targetKey: 'cat:F', galleryPostId: 'p4' })] } };
  const extra = pomoLinkedExtra(data, [{ id: 1, galleryFolder: 'F', galleryPost: 'p4' }, { id: 2, deleted: true, galleryFolder: 'F' }, { id: 3 }], folders, posts);
  assert.equal(extra['project:1'], 600);
  assert.equal(extra['project:2'], undefined);
  assert.equal(extra['project:3'], undefined);
});
