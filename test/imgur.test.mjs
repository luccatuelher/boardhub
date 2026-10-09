import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhCollectImgur } = load(['imgur']);

test('collects Imgur links from fields, lists and note HTML, once each', () => {
  const state = {
    galleryPosts: [{ images: ['https://i.imgur.com/AbCdE12.png', 'https://firebasestorage.googleapis.com/v0/b/x/o/a', 'https://i.imgur.com/AbCdE12.png'] }],
    notes: [{ content: '<p>x</p><img src="https://i.imgur.com/ZZZzz99.jpeg"><img src="http://i.imgur.com/QqQqQ11.gif">' }],
    projects: [{ cover: 'https://images.unsplash.com/photo-1?w=800', mentors: [{ photo: 'https://i.imgur.com/MmMmM55.webp' }] }],
  };
  assert.deepEqual([...bhCollectImgur(state)].sort(), [
    'http://i.imgur.com/QqQqQ11.gif',
    'https://i.imgur.com/AbCdE12.png',
    'https://i.imgur.com/MmMmM55.webp',
    'https://i.imgur.com/ZZZzz99.jpeg',
  ]);
});

test('ignores non-Imgur and look-alike hosts', () => {
  assert.equal(bhCollectImgur({ a: 'https://imgur.com/gallery/abc', b: 'https://i.imgur.com.evil.com/AbCdE12.png'.replace('i.imgur.com.evil.com', 'evil.com/i.imgur.com') }).size, 0);
  assert.equal(bhCollectImgur(null).size, 0);
});
