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

test('notes in trashed tasks are materialized and relinked too', () => {
  const projects = [linkedProject()];
  const imgs = new Map([['post9', ['z.png']]]);
  const out = bhMaterializeNotes(projects, imgs);
  const n9 = out[0].taskTrash[0].mini.innerNotes[0];
  assert.equal(n9.galleryPostId, undefined);
  assert.deepEqual(n9.images, ['z.png']);
  assert.equal(bhRelinkNotes(out, imgs)[0].taskTrash[0].mini.innerNotes[0].galleryPostId, 'post9');
});

const { bhHtmlToText, bhPublishSessionNote } = load(['tasklinks']);

test('publishing an old session note moves its images into a linked post', () => {
  const note = { id: 'session-note-s1', title: 'Sessão 1', date: '2026-10-01', sessionIds: ['s1'], images: ['a.png', 'v.mp4', 'a.png'], content: '<div>um</div><div>dois<br>três</div>' };
  const out = bhPublishSessionNote(note, { galleryFolder: 'f1' }, 'season-1');
  assert.equal(out.post.id, 'session-post-s1');
  assert.equal(out.post.folder, 'f1');
  assert.deepEqual(out.post.images, ['a.png', 'v.mp4']);
  assert.equal(out.post.bannerImage, 'a.png');
  assert.equal(out.post.content, 'um\ndois\ntrês');
  assert.deepEqual(out.note.images, []);
  assert.equal(out.note.galleryPostId, 'session-post-s1');
  assert.equal(out.post.sourceTargetKey, 'none');
});

test('publishing does not apply without a session, a Gallery folder, or when already linked', () => {
  const note = { id: 'n', sessionIds: ['s1'], images: [] };
  assert.equal(bhPublishSessionNote({ id: 'n', images: [] }, { galleryFolder: 'f1' }), null);
  assert.equal(bhPublishSessionNote(note, {}), null);
  assert.equal(bhPublishSessionNote({ ...note, galleryPostId: 'p' }, { galleryFolder: 'f1' }), null);
  assert.equal(bhHtmlToText('a &amp; b<br>c'), 'a & b\nc');
});

const { bhLegacyPostImages } = load(['tasklinks']);

test('an old linked post gets back what it showed: task images, then its own, in its order, minus hidden', () => {
  const mini = { frames: ['f1.png', 'f2.png'], notes: '<img src="inline.png">', innerNotes: [
    { id: 'a', images: ['n1.png'] }, { id: 'b', images: ['hidden-note.png'], hideInGallery: true }, { id: 'c', galleryPostId: 'x', images: ['linked.png'] }] };
  assert.deepEqual(bhLegacyPostImages(mini, { images: ['own.png'] }), ['f1.png', 'f2.png', 'inline.png', 'n1.png', 'own.png']);
  assert.deepEqual(bhLegacyPostImages(mini, { images: ['own.png'], imageOrder: ['own.png', 'f2.png'], hiddenImages: ['f1.png'] }), ['own.png', 'f2.png', 'inline.png', 'n1.png']);
  assert.deepEqual(bhLegacyPostImages({ frames: [] }, { images: ['own.png'] }), ['own.png']);
});

const { bhIsChildTask, bhGroupByParent, bhNormalizeTaskTree, bhNestedLabel, bhPromoteSubTasks } = load(['tasklinks']);

test('children are placed right after their parent, orphans stay top-level, a grouped list is returned as is', () => {
  const a = { id: 'a' }, b = { id: 'b' }, c1 = { id: 'c1', parentId: 'a' }, d = { id: 'd' }, c2 = { id: 'c2', parentId: 'a' }, orphan = { id: 'o', parentId: 'gone' };
  assert.deepEqual(bhGroupByParent([c1, a, b, c2, d, orphan]).map(x => x.id), ['a', 'c1', 'c2', 'b', 'd', 'o']);
  const grouped = [a, c1, c2, b];
  assert.equal(bhGroupByParent(grouped), grouped);
  assert.equal(bhGroupByParent([a, { id: 'x', parentId: 'x' }]).length, 2, 'a task is never its own child');
  const project = { projectTasks: [c1, a], miniProjects: [c1, a] };
  assert.deepEqual(bhNormalizeTaskTree(project).projectTasks.map(x => x.id), ['a', 'c1']);
  const ok = { projectTasks: [a, c1], miniProjects: [a, c1] };
  assert.equal(bhNormalizeTaskTree(ok), ok);
  assert.equal(bhIsChildTask(orphan, new Set(['a'])), false);
  assert.equal(bhNestedLabel(c1, new Set(['a', 'c1']), 'Rodada 1'), '   ↳ Rodada 1');
  assert.equal(bhNestedLabel(a, new Set(['a']), 'Tarefa'), 'Tarefa');
});

test('sub-task folders of the earlier build become child tasks that take their notes', () => {
  const project = { id: 'p', projectTasks: [{ id: 't1', text: 'Cena', status: 'Fazendo', startDate: '2026-10-01', dueDate: '2026-10-09' }],
    miniProjects: [{ id: 't1', title: 'Cena', status: 'Em Andamento', innerNotes: [
      { id: 'n1', title: 'solta' }, { id: 'n2', title: 'na rodada', subTaskId: 's1' }, { id: 'n3', title: 'órfã', subTaskId: 'gone' }],
      subTasks: [{ id: 's1', title: 'Rodada 1', status: 'Concluído', createdAt: '01/10/2026' }] }] };
  const out = bhPromoteSubTasks([project]);
  const minis = out[0].miniProjects, tasks = out[0].projectTasks;
  assert.deepEqual(minis.map(m => m.id), ['t1', 's1']);
  assert.equal(minis[0].subTasks, undefined);
  assert.deepEqual(minis[0].innerNotes.map(n => n.id), ['n1', 'n3']);
  assert.equal(minis[0].innerNotes[1].subTaskId, undefined);
  assert.deepEqual(minis[1].innerNotes.map(n => n.id), ['n2']);
  assert.equal(minis[1].parentId, 't1');
  assert.deepEqual(tasks.map(t => [t.id, t.parentId, t.status, t.startDate]), [['t1', undefined, 'Fazendo', '2026-10-01'], ['s1', 't1', 'Concluído', '2026-10-01']]);
  assert.equal(bhPromoteSubTasks(out), out, 'nothing left to promote: same array');
});

const { bhMoveTaskGroup, bhNudgeTask, bhInsertChild, bhTaskBlock } = load(['tasklinks']);
const ids = l => l.map(x => x.id).join(',');
const T = (id, parentId) => ({ id, ...(parentId ? { parentId } : {}) });

test('moving a task moves its children with it; a child moves among its siblings', () => {
  const list = [T('P'), T('c1', 'P'), T('c2', 'P'), T('Q'), T('R'), T('r1', 'R')];
  assert.deepEqual(bhTaskBlock(list, 0), [0, 3]);
  assert.equal(ids(bhMoveTaskGroup(list, 0, 3)), 'Q,P,c1,c2,R,r1');
  assert.equal(ids(bhMoveTaskGroup(list, 3, 0)), 'Q,P,c1,c2,R,r1');
  assert.equal(ids(bhMoveTaskGroup(list, 0, 5)), 'Q,R,r1,P,c1,c2', 'dropping on a child goes after its whole group');
  assert.equal(ids(bhMoveTaskGroup(list, 4, 1)), 'R,r1,P,c1,c2,Q', 'going up lands before the target group');
  assert.equal(ids(bhMoveTaskGroup(list, 1, 2)), 'P,c2,c1,Q,R,r1');
  assert.equal(bhMoveTaskGroup(list, 0, 1), list, 'onto its own child: nothing');
});

test('nudging jumps over whole groups and never gets undone by the grouping', () => {
  const list = [T('P'), T('c1', 'P'), T('Q'), T('R')];
  assert.equal(ids(bhNudgeTask(list, 0, 1)), 'Q,P,c1,R');
  assert.equal(ids(bhNudgeTask(list, 2, -1)), 'Q,P,c1,R');
  assert.equal(ids(bhNudgeTask(list, 3, -1)), 'P,c1,R,Q');
  assert.equal(bhNudgeTask(list, 0, -1), list);
  assert.equal(bhNudgeTask(list, 3, 1), list);
  assert.equal(bhNudgeTask(list, 1, 1), list, 'a lone child cannot leave its group');
});

test('a new child goes after its parent\'s last child', () => {
  const list = [T('P'), T('c1', 'P'), T('Q')];
  assert.equal(ids(bhInsertChild(list, 'P', T('c2', 'P'))), 'P,c1,c2,Q');
  assert.equal(ids(bhInsertChild(list, 'gone', T('x'))), 'x,P,c1,Q');
});
