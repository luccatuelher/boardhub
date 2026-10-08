import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhNewId, bhIdTime } = load(['date']);

test('bhNewId: unique even when generated in the same millisecond', () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i++) seen.add(bhNewId());
  assert.equal(seen.size, 5000);
});

test('bhNewId: prefix kept, id is a short string that starts with the time', () => {
  const before = Date.now();
  const id = bhNewId('task-');
  assert.match(id, /^task-\d{13}-[0-9a-f]{12}$/);
  assert.ok(id.length < 40);
  assert.ok(bhIdTime(id) >= before && bhIdTime(id) <= Date.now());
});

test('bhIdTime: numeric ids, string ids and ids with no time', () => {
  assert.equal(bhIdTime(1760000000000), 1760000000000);
  assert.equal(bhIdTime('1760000000000'), 1760000000000);
  assert.equal(bhIdTime('task-post-1760000000000-ab12'), 1760000000000);
  for (const none of [1, 2, 'mig-5-0', 'folder', null, undefined, '']) assert.equal(bhIdTime(none), 0, String(none));
});

test('bhIdTime sorts new string ids and old numeric ids together by creation time', () => {
  const list = [{ id: 1760000000000 }, { id: 'n-1760000005000-aaaaaaaaaaaa' }, { id: 1760000003000 }];
  list.sort((a, b) => bhIdTime(b.id) - bhIdTime(a.id));
  assert.deepEqual(list.map(x => bhIdTime(x.id)), [1760000005000, 1760000003000, 1760000000000]);
});

test('bhNewId falls back when crypto.randomUUID is unavailable (plain-http LAN, old Safari)', () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    for (const fake of [{ getRandomValues: c => crypto_fill(c) }, undefined, {}]) {
      Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true });
      assert.match(bhNewId(), /^\d{13}-[0-9a-f]{12}$/);
    }
  } finally { Object.defineProperty(globalThis, 'crypto', real); }
});
function crypto_fill(a) { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255; return a; }
