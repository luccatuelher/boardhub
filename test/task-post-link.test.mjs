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
