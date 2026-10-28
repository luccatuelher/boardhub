import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const { bhIsoToBR, bhBRToIso } = load(['brdate']);

test('ISO dates show as dd/mm/aaaa and typed dd/mm/aaaa goes back to ISO', () => {
  assert.equal(bhIsoToBR('2026-10-26'), '26/10/2026');
  assert.equal(bhIsoToBR('2026-10-26T12:00:00'), '26/10/2026');
  assert.equal(bhIsoToBR(''), '');
  assert.equal(bhIsoToBR(null), '');
  assert.equal(bhBRToIso('26/10/2026'), '2026-10-26');
  assert.equal(bhBRToIso('01/02/2024'), '2024-02-01');
});

test('impossible or partial dates are not accepted', () => {
  for (const bad of ['31/02/2026', '32/01/2026', '00/10/2026', '10/13/2026', '26/10/26', '26/10/', '', '2026-10-26', '26/10/1800']) assert.equal(bhBRToIso(bad), null, bad);
  assert.equal(bhBRToIso('29/02/2028'), '2028-02-29');
  assert.equal(bhBRToIso('29/02/2026'), null);
});
