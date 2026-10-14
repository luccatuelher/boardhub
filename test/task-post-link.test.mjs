import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhHtmlMediaSrcs, bhNoteMedia, bhTextToHTML, bhTaskPostLinks, bhLinkedPostView } = load(['tasklinks']);

const project = {
  id: 'p1', title: 'Comercial',
  miniProjects: [
    { id: 't1', title: 'Storyboard', galleryPostId: 'post1', frames: ['task-frame.png'], notes: '<img src="task-note.png">',
      innerNotes: [{ id: 'n1', images: ['note.png'], content: '<p>x</p><img src="inline.png">' }] },
    { id: 't2', title: 'Sem post', frames: ['other.png'] },
  ],
  taskTrash: [{ id: 'old', mini: { id: 't3', title: 'Apagada', galleryPostId: 'post2', frames: ['gone.png'] } }],
};

test('a link names the task and project but carries no images', () => {
  const links = bhTaskPostLinks([project]);
  assert.equal(links.size, 2);
  const link = links.get('post1');
  assert.deepEqual(Object.keys(link).sort(), ['archived', 'projectDeleted', 'projectId', 'projectTitle', 'taskId', 'taskTitle']);
  assert.equal(link.taskTitle, 'Storyboard');
  assert.equal(link.archived, false);
  assert.equal(links.get('post2').archived, true);
});

test('a linked post keeps exactly its own images and only gains linkedTask', () => {
  const post = { id: 'post1', title: 'Post', images: ['post.png'], bannerImage: 'post.png', hiddenImages: ['x.png'], imageOrder: ['y.png'] };
  const view = bhLinkedPostView(post, bhTaskPostLinks([project]).get('post1'));
  assert.deepEqual(view.images, ['post.png']);
  assert.equal(view.bannerImage, 'post.png');
  assert.deepEqual(view.linkedTask, { projectId: 'p1', taskId: 't1', taskTitle: 'Storyboard', projectTitle: 'Comercial', archived: false });
  assert.equal(post.linkedTask, undefined, 'the stored post is not mutated');
});

test('a task note shows its stored images and the ones pasted into its text, once each', () => {
  assert.deepEqual(bhNoteMedia(project.miniProjects[0].innerNotes[0]), ['note.png', 'inline.png']);
  assert.deepEqual(bhNoteMedia({ images: ['a.png'], content: '<img src="a.png"><video src="v.mp4"></video>' }), ['a.png', 'v.mp4']);
  assert.deepEqual(bhNoteMedia(null), []);
  assert.deepEqual(bhHtmlMediaSrcs('<img alt="" src="https://x/a?b=1&amp;c=2">'), ['https://x/a?b=1&c=2']);
});

test('older plain-text note content still renders: escaped, line breaks kept', () => {
  assert.equal(bhTextToHTML('a < b\nc'), 'a &lt; b<br>c');
  assert.equal(bhTextToHTML('<p>rich</p>'), '<p>rich</p>');
  assert.equal(bhTextToHTML(''), '');
});

const { bhNoteImages, bhNotePostLinks, bhMaterializeNotes, bhRelinkNotes } = load(['tasklinks']);

const linkedProject = () => ({
  id: 'p1', title: 'Comercial',
  miniProjects: [{ id: 't1', title: 'Storyboard', innerNotes: [
    { id: 'n1', galleryPostId: 'post1', images: [], content: '' },
    { id: 'n2', images: ['own.png'], content: '<img src="inline.png">' },
  ] }],
  taskTrash: [{ id: 'old', mini: { id: 't9', title: 'Velha', innerNotes: [{ id: 'n9', galleryPostId: 'post9' }] } }],
});

test('a linked note shows its post images (then its own); an unlinked one only its own', () => {
  const [linked, plain] = linkedProject().miniProjects[0].innerNotes;
  const post = { id: 'post1', images: ['a.png', 'b.png'] };
  assert.deepEqual(bhNoteImages(linked, post), ['a.png', 'b.png']);
  assert.deepEqual(bhNoteImages({ ...linked, images: ['b.png', 'c.png'] }, post), ['a.png', 'b.png', 'c.png']);
  assert.deepEqual(bhNoteImages(linked, null), []);
  assert.deepEqual(bhNoteImages(plain, post), ['own.png']);
  assert.deepEqual(bhNoteMedia(plain, post), ['own.png', 'inline.png']);
});

test('notes are found by the post they are linked to, including notes of trashed tasks', () => {
  const links = bhNotePostLinks([linkedProject()]);
  assert.equal(links.get('post1')[0].noteId, 'n1');
  assert.equal(links.get('post1')[0].taskTitle, 'Storyboard');
  assert.equal(links.get('post9')[0].archived, true);
  assert.equal(links.has('post2'), false);
});

test('merging or purging a post leaves its notes individual, each keeping the post images', () => {
  const projects = [linkedProject()];
  const out = bhMaterializeNotes(projects, new Map([['post1', ['a.png', 'b.png']]]));
  const n1 = out[0].miniProjects[0].innerNotes[0];
  assert.equal(n1.galleryPostId, undefined);
  assert.deepEqual(n1.images, ['a.png', 'b.png']);
  assert.equal(n1.mergedFromPost, 'post1');
  assert.equal(out[0].miniProjects[0].innerNotes[1].images[0], 'own.png', 'other notes are untouched');
  assert.equal(bhMaterializeNotes(projects, new Map([['nope', ['x.png']]])), projects, 'nothing linked: same array');
});

test('undoing a merge links a note back only while its images are what the merge wrote', () => {
  const imgs = new Map([['post1', ['a.png', 'b.png']]]);
  const merged = bhMaterializeNotes([linkedProject()], imgs);
  const back = bhRelinkNotes(merged, imgs);
  const n1 = back[0].miniProjects[0].innerNotes[0];
  assert.equal(n1.galleryPostId, 'post1');
  assert.deepEqual(n1.images, []);
  assert.equal(n1.mergedFromPost, undefined);
  // the note was edited after the merge: it stays individual, nothing is lost
  const edited = JSON.parse(JSON.stringify(merged));
  edited[0].miniProjects[0].innerNotes[0].images.push('new.png');
  const kept = bhRelinkNotes(edited, imgs)[0].miniProjects[0].innerNotes[0];
  assert.equal(kept.galleryPostId, undefined);
  assert.deepEqual(kept.images, ['a.png', 'b.png', 'new.png']);
});

test('repeated frames are kept (storyboard holds); only pasted ones already there are skipped', () => {
  const post = { id: 'post1', images: ['a.png', 'a.png', 'b.png'] };
  assert.deepEqual(bhNoteImages({ galleryPostId: 'post1', images: ['a.png', 'c.png'] }, post), ['a.png', 'a.png', 'b.png', 'c.png']);
  const out = bhMaterializeNotes([linkedProject()], new Map([['post1', ['a.png', 'a.png']]]));
  assert.deepEqual(out[0].miniProjects[0].innerNotes[0].images, ['a.png', 'a.png']);
});
