import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhAutoMigrateDecision, BH_AUTO_MIGRATE, bhEntityPack, bhEntityUnpack, bhNestDepth } = load(['stable', 'sync', 'entity', 'automigrate']);

const NOW = 10 * 86400000;
const ready = (over = {}) => ({
  now: NOW, disabled: false, modeActive: false, signedIn: true, migrating: false, reconciled: true, hasRemoteData: true,
  rulesOk: true, firstSeenAt: NOW - 2 * 86400000, retryAt: 0, hardFailures: 0,
  pending: false, blocked: false, needsChoice: false, restoreBusy: false, pushBusy: false, pushActive: false,
  online: true, visible: true, hasLocalMedia: false, lastEditMs: NOW - 60000, readySince: NOW - 120000, estimate: 300,
  equalToBase: () => true, ...over,
});

test('goes only when every condition holds', () => {
  assert.deepEqual(bhAutoMigrateDecision(ready()), { go: true });
});

test('each blocker stops it, with a code', () => {
  const cases = {
    disabled: { disabled: true }, active: { modeActive: true }, 'signed-out': { signedIn: false }, running: { migrating: true },
    'not-ready': { reconciled: false }, rules: { rulesOk: false }, 'rules-unknown': { rulesOk: null },
    soak: { firstSeenAt: NOW - 1000 }, backoff: { retryAt: NOW + 1000 }, failed: { hardFailures: BH_AUTO_MIGRATE.MAX_HARD_FAILURES },
    unsynced: { pending: true }, busy: { pushBusy: true }, offline: { online: false }, 'local-media': { hasLocalMedia: true },
    editing: { lastEditMs: NOW - 1000 }, settling: { readySince: NOW - 1000 }, estimate: { estimate: null },
    'too-big': { estimate: BH_AUTO_MIGRATE.MAX_ENTITIES + 1 }, differs: { equalToBase: () => false },
  };
  for (const [code, over] of Object.entries(cases)) {
    const v = bhAutoMigrateDecision(ready(over));
    assert.equal(v.go, false, code);
    assert.equal(v.code, code);
  }
});

test('the expensive equality check only runs when nothing cheaper blocks', () => {
  let calls = 0;
  const equalToBase = () => { calls++; return true; };
  bhAutoMigrateDecision(ready({ pending: true, equalToBase }));
  bhAutoMigrateDecision(ready({ rulesOk: false, equalToBase }));
  assert.equal(calls, 0);
  bhAutoMigrateDecision(ready({ equalToBase }));
  assert.equal(calls, 1);
});

test('nesting depth counts maps and arrays', () => {
  assert.equal(bhNestDepth({ a: 1 }), 1);
  assert.equal(bhNestDepth({ a: [{ b: 1 }] }), 3);
  let o = { v: 1 }; for (let i = 0; i < 25; i++) o = { n: o };
  assert.equal(bhNestDepth(o), 26);
});

test('pack refuses a state that would exceed Firestore nesting before anything is written', () => {
  let o = { v: 1 }; for (let i = 0; i < 25; i++) o = { n: o };
  assert.throws(() => bhEntityPack({ projects: [{ id: 'a', deep: o }] }), /aninhamento/);
});

test('pack/unpack round-trips a realistic state including emoji at the 40k cut', () => {
  const big = 'x'.repeat(39999) + '😀' + 'y'.repeat(50000);
  const state = {
    projects: [{ id: 'p1', title: 'ação', tasks: [{ id: 't1', done: true }] }, { id: 2, title: 'num' }],
    notes: [{ id: 'n1', type: 'note', content: big }],
    galleryPosts: [{ id: 'g1', images: ['a', 'b'] }],
    identity: { hub: 'H' }, pomoData: { days: { '2026-10-01': 10 } },
  };
  const docs = bhEntityPack(state);
  const back = bhEntityUnpack(new Map([...docs].map(([id, v]) => [id, JSON.parse(JSON.stringify(v))])));
  assert.deepEqual(back, state);
});
