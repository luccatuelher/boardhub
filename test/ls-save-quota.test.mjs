import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// lsSave/lsLoadResult run against a fake localStorage with a small character cap.
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const a = html.indexOf("const LS_KEY = 'boardhub_v2';");
const b = html.indexOf('// - GLOBAL TRASH AUTO-PURGE -');
assert.ok(a > 0 && b > a);
const code = html.slice(a, b);

const makeEnv = (cap, initial = {}) => {
  const data = new Map(Object.entries(initial));
  const used = () => [...data].reduce((n, [k, v]) => n + k.length + v.length, 0);
  const localStorage = {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      const next = used() - (data.has(k) ? k.length + data.get(k).length : 0) + k.length + String(v).length;
      if (next > cap) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      data.set(k, String(v));
    },
    removeItem: k => data.delete(k),
  };
  const ctx = vm.createContext({ localStorage, console, bhPersistenceBusy: () => false, bhLog: () => {}, BH_EMERGENCY_KEY: 'em', BH_FALLBACK_KEY: 'fb', BH_LOG_KEY: 'log', window: {}, globalThis: {} });
  vm.runInContext(code + '\n;this.lsSave=lsSave;this.lsLoadResult=lsLoadResult;this.getPacked=()=>_lsPacked;', ctx);
  return { data, ctx };
};
const state = n => ({ galleryPosts: Array.from({ length: n }, (_, i) => ({ id: 'p' + i, images: Array.from({ length: 5 }, (_, j) => `https://example.com/o/images%2Fsha256_${i}_${j}?alt=media&token=${i}${j}`) })) });

test('a state that no longer fits as plain text is stored compressed and loads back identically', () => {
  const s = state(300);
  const plainLen = JSON.stringify(s).length;
  const { data, ctx } = makeEnv(Math.floor(plainLen / 2), { em: 'x'.repeat(1000), log: 'y'.repeat(1000) });
  const r = ctx.lsSave(s);
  assert.equal(r.ok, true);
  assert.equal(ctx.getPacked(), true);
  assert.ok(data.get('boardhub_v2').startsWith('bhlz1:'));
  const back = ctx.lsLoadResult();
  assert.equal(back.status, 'valid');
  assert.equal(JSON.stringify(back.state), JSON.stringify(s));
  // Saving the same state again changes nothing; a changed one is stored compressed too.
  assert.equal(ctx.lsSave(s).ok, true);
  const s2 = state(301);
  assert.equal(ctx.lsSave(s2).ok, true);
  assert.equal(JSON.stringify(ctx.lsLoadResult().state), JSON.stringify(s2));
});

test('a state that fits stays plain JSON; one too big even compressed still reports the failure', () => {
  const s = state(50);
  const plain = makeEnv(10_000_000);
  assert.equal(plain.ctx.lsSave(s).ok, true);
  assert.equal(plain.data.get('boardhub_v2').startsWith('{'), true);
  const tiny = makeEnv(100);
  const r = tiny.ctx.lsSave(s);
  assert.equal(r.ok, false);
  assert.equal(tiny.data.has('boardhub_v2'), false);
});

test('once packed, a state that shrinks well under the cap goes back to plain JSON', () => {
  const big = state(300);
  const { data, ctx } = makeEnv(Math.floor(JSON.stringify(big).length / 2));
  assert.equal(ctx.lsSave(big).ok, true);
  assert.equal(ctx.getPacked(), true);
  const small = state(5);
  assert.equal(ctx.lsSave(small).ok, true);
  assert.equal(ctx.getPacked(), false);
  assert.equal(data.get('boardhub_v2').startsWith('{'), true);
  assert.equal(JSON.stringify(ctx.lsLoadResult().state), JSON.stringify(small));
});
