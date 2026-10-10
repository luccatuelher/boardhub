import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const stubs = {
  isProjectScopedPost: p => !!p && p.storageScope === 'project',
  pomoProjectKey: id => 'project:' + String(id),
  pomoCategoryKey: id => 'cat:' + String(id),
};
const { pomoLinkedExtra, bhProjectGalleryScope, bhLinkedPostCount, pomoSectionSeconds, pomoSectionProjectSeconds } = load(['gallinks'], { stubs });

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

test('today: the same rules, for one day only', () => {
  const data = {
    allocations: { 'cat:F': 9000, 'project:1': 900 },
    dailyAllocations: { '2026-10-10': { 'cat:F': 1500, 'project:1': 300 }, '2026-10-09': { 'cat:F': 7500 } },
    rank: { sessions: [
      sess({ id: 'a', date: '2026-10-10', targetKey: 'cat:F', galleryPostId: 'p3' }),
      sess({ id: 'b', date: '2026-10-09', targetKey: 'cat:F', galleryPostId: 'p3' }),
    ] },
  };
  const folderLink = pomoLinkedExtra(data, [{ id: 1, galleryFolder: 'F' }], folders, posts, '2026-10-10');
  assert.equal(folderLink['project:1'], 1500);
  assert.equal(folderLink['cat:F'], 300);
  const sectionLink = pomoLinkedExtra(data, [{ id: 1, galleryFolder: 'F', gallerySection: 's1' }], folders, posts, '2026-10-10');
  assert.equal(sectionLink['project:1'], 600); // only today's session
  assert.equal(pomoLinkedExtra(data, [{ id: 1, galleryFolder: 'F', gallerySection: 's1' }], folders, posts)['project:1'], 1200); // totals unchanged
});

test('section time: filed into its posts, or unfiled with that section picked; once each, category sessions only', () => {
  const ids = new Set(['p3', 'p4']);
  const sessions = [
    sess({ id: 'a', targetKey: 'cat:F', galleryPostId: 'p3', durationSeconds: 600 }),            // filed in the section
    sess({ id: 'b', targetKey: 'cat:F', galleryPostId: null, sectionId: 's1', durationSeconds: 300 }), // not filed yet, section picked
    sess({ id: 'c', targetKey: 'cat:F', galleryPostId: 'p3', sectionId: 's1', durationSeconds: 100 }), // filed AND tagged: one count
    sess({ id: 'd', targetKey: 'cat:F', galleryPostId: 'p5', durationSeconds: 900 }),            // another section
    sess({ id: 'e', targetKey: 'cat:F', galleryPostId: null, sectionId: 's2', durationSeconds: 50 }), // other section, unfiled
    sess({ id: 'f', targetKey: 'project:1', galleryPostId: 'p3', durationSeconds: 70 }),         // project session
  ];
  assert.equal(pomoSectionSeconds(sessions, ids, 's1', 'cat:F'), 1000);
  assert.equal(pomoSectionSeconds(sessions, null, 's1', 'cat:F'), 300); // no posts known: only the unfiled one
  assert.equal(pomoSectionSeconds(null, ids, 's1', 'cat:F'), 0);
});

test('section time includes the projects linked to that section (their time belongs to it)', () => {
  const alloc = { 'project:1': 4000, 'project:2': 900, 'project:3': 70, 'project:4': 5 };
  const ids = new Set(['p3', 'p4']);
  const projects = [
    { id: 1, galleryFolder: 'F', gallerySection: 's1' },        // linked to the section
    { id: 2, galleryFolder: 'F', galleryPost: 'p3' },            // linked to a post inside it
    { id: 3, galleryFolder: 'F', gallerySection: 's2' },         // another section
    { id: 4, galleryFolder: 'G', gallerySection: 's1' },         // same section id, other folder
    { id: 5, deleted: true, galleryFolder: 'F', gallerySection: 's1' },
  ];
  assert.equal(pomoSectionProjectSeconds(projects, alloc, 'F', 's1', ids), 4900);
  assert.equal(pomoSectionProjectSeconds(projects, alloc, 'F', 's1', null), 4000);
  assert.equal(pomoSectionProjectSeconds(null, alloc, 'F', 's1', ids), 0);
});

test('a project and its section chip: project time + category sessions in the section, once', () => {
  const sessions = [sess({ id: 'a', targetKey: 'cat:F', galleryPostId: 'p3', durationSeconds: 600 }), sess({ id: 'b', targetKey: 'project:1', galleryPostId: null, durationSeconds: 4000 })];
  const ids = new Set(['p3', 'p4']);
  const total = pomoSectionSeconds(sessions, ids, 's1', 'cat:F') + pomoSectionProjectSeconds([{ id: 1, galleryFolder: 'F', gallerySection: 's1' }], { 'project:1': 4000 }, 'F', 's1', ids);
  assert.equal(total, 4600);
});
