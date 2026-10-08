// Loads the pure-logic regions of index.html for unit tests.
//
// index.html stays a single file with no build step. Pure blocks are wrapped in
//   // @bh-test-begin <name>   ...   // @bh-test-end <name>
// comments. Every line outside those regions is blanked (line numbers are kept,
// so stack traces point at the real index.html lines) and the rest is compiled
// with vm.compileFunction in THIS realm, which mirrors how the app runs the
// Babel output inside `new Function`. A region must stay free of JSX.
process.env.TZ = process.env.TZ || 'America/Sao_Paulo';

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

const BEGIN = /^\s*\/\/ @bh-test-begin (\S+)\s*$/;
const END = /^\s*\/\/ @bh-test-end (\S+)\s*$/;

export const EXPECTED = {
  date: ['localDateISO'],
  stable: ['bhCanonicalState', 'bhStableStringify'],
  sync: ['bhEqual', 'bhMergeSync', 'bhSyncRankPoints', 'bhSyncPlan', 'bhSplitState', 'bhUtf8Bytes'],
  entity: ['bhEntityPack', 'bhEntityUnpack'],
  safehref: ['safeHref'],
  rank: ['RANK_MAX', 'rankDefault', 'rankReconcileDecay', 'pomoRankMaintain', 'pomoMergeProgress', 'pomoNormalize', 'rankSeasonOrdinal', 'rankPosition', 'rankDecayForSeconds', 'rankSeasonForDate', 'rankNormalize'],
  dup: ['bhDuplicateProject'],
  embed: ['bhEmbedCheck', 'bhEmbedParse', 'sanitizeHTML'],
};

export function parseRegions(source = html) {
  const open = new Map();
  const regions = new Map();
  source.split('\n').forEach((line, i) => {
    let m = BEGIN.exec(line);
    if (m) {
      if (open.has(m[1]) || regions.has(m[1])) throw new Error(`duplicate region ${m[1]} at line ${i + 1}`);
      open.set(m[1], i);
      return;
    }
    m = END.exec(line);
    if (m) {
      if (!open.has(m[1])) throw new Error(`end without begin: ${m[1]} at line ${i + 1}`);
      regions.set(m[1], [open.get(m[1]), i]);
      open.delete(m[1]);
    }
  });
  if (open.size) throw new Error('unterminated region(s): ' + [...open.keys()].join(', '));
  return regions;
}

// stubs: values for the globals the regions read from the browser.
export function load(names, { stubs = {}, document = undefined } = {}) {
  const regions = parseRegions();
  const keep = new Set();
  for (const n of names) {
    const r = regions.get(n);
    if (!r) throw new Error('unknown region ' + n);
    for (let i = r[0]; i <= r[1]; i++) keep.add(i);
  }
  const code = html.split('\n').map((l, i) => (keep.has(i) ? l : '')).join('\n');
  const exported = names.flatMap(n => EXPECTED[n] || []);
  const globals = {
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { onLine: true },
    document,
    bhLog() {},
    SYNCED_UID_KEY: 'boardhub_synced_uid',
    ...stubs,
  };
  const keys = Object.keys(globals);
  const fn = vm.compileFunction(`${code}\nreturn {${exported.join(',')}};`, keys, { filename: join(root, 'index.html') });
  return fn(...keys.map(k => globals[k]));
}
