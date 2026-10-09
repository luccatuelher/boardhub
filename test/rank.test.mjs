import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const R = load(['date', 'stable', 'sync', 'rank']);
const { rankReconcileDecay, rankDecayForSeconds, rankDefault, rankSeasonForDate, pomoRankMaintain, pomoMergeProgress, pomoNormalize, rankPosition, RANK_MAX } = R;

const NOW = new Date('2026-10-08T12:00:00'); // Thursday
// pomoMergeProgress/pomoNormalize read the system clock; pin it.
const pinned = fn => () => {
  mock.timers.enable({ apis: ['Date'], now: NOW });
  try { return fn(); } finally { mock.timers.reset(); }
};
const rank = o => ({ ...rankDefault(new Date('2026-09-01T12:00:00')), ...o });

test('seasons: three per year, four months each', () => {
  assert.equal(rankSeasonForDate(new Date('2026-01-15T12:00:00')).id, '2026-1');
  assert.equal(rankSeasonForDate(new Date('2026-05-01T12:00:00')).id, '2026-2');
  assert.equal(rankSeasonForDate(new Date('2026-12-31T12:00:00')).id, '2026-3');
});

test('decay tiers: halved from 2026-09-01, old tiers before', () => {
  assert.equal(rankDecayForSeconds(0, '2026-10-05'), 250);
  assert.equal(rankDecayForSeconds(0, '2026-08-31'), 500);
  assert.equal(rankDecayForSeconds(14 * 60, '2026-08-31'), 500);
  assert.equal(rankDecayForSeconds(15 * 60, '2026-08-31'), 400);
  assert.equal(rankDecayForSeconds(89 * 60, '2026-10-05'), 50);
  assert.equal(rankDecayForSeconds(90 * 60, '2026-10-05'), 0);
});

test('rankPosition is monotonic and bounded', () => {
  assert.equal(rankPosition(0).rankIndex, 0);
  assert.ok(rankPosition(RANK_MAX).rankIndex >= rankPosition(RANK_MAX / 2).rankIndex);
});

test('reconcile: refunds a day that really had 90+ minutes of focus', () => {
  const v = rank({ points: 750, decayApplied: { '2026-10-05': 250 }, decayLoss: { '2026-10-05': 250 } });
  const out = rankReconcileDecay(v, { '2026-10-05': 90 * 60 }, NOW);
  assert.equal(out.points, 1000);
  assert.equal(out.decayLoss['2026-10-05'], 0);
  assert.equal(out.decayApplied['2026-10-05'], 0);
  const notice = out.notices.find(n => n.type === 'refund');
  assert.equal(notice.refund, 250);
  assert.equal(notice.id, 'decay-refund-2026-10-08-750');
});

test('reconcile: re-running is a no-op (same object)', () => {
  const v = rank({ points: 750, decayApplied: { '2026-10-05': 250 }, decayLoss: { '2026-10-05': 250 } });
  const once = rankReconcileDecay(v, { '2026-10-05': 90 * 60 }, NOW);
  assert.equal(rankReconcileDecay(once, { '2026-10-05': 90 * 60 }, NOW), once);
});

test('reconcile: a correctly charged day is untouched', () => {
  const v = rank({ points: 750, decayApplied: { '2026-10-05': 250 }, decayLoss: { '2026-10-05': 250 } });
  assert.equal(rankReconcileDecay(v, {}, NOW), v);
});

test('reconcile: today is never refunded or touched', () => {
  const v = rank({ points: 750, decayApplied: { '2026-10-08': 250 }, decayLoss: { '2026-10-08': 250 } });
  assert.equal(rankReconcileDecay(v, { '2026-10-08': 90 * 60 }, NOW), v);
});

test('reconcile: refund is computed from the real loss when the score was clamped at zero', () => {
  // 100 points, 250 charged but only 100 really taken; the day truly cost 0.
  const v = rank({ points: 0, decayApplied: { '2026-10-05': 250 }, decayLoss: { '2026-10-05': 100 } });
  const out = rankReconcileDecay(v, { '2026-10-05': 90 * 60 }, NOW);
  assert.equal(out.points, 100);
});

test('reconcile: a day before 2026-09-01 is judged with the old tiers', () => {
  const v = rank({ seasonId: '2026-2', startedOn: '2026-08-25', points: 500, decayApplied: { '2026-08-28': 500 }, decayLoss: { '2026-08-28': 500 } });
  // 20 min of focus = 400 under old tiers, so 100 comes back.
  const out = rankReconcileDecay(v, { '2026-08-28': 20 * 60 }, NOW);
  assert.equal(out.decayApplied['2026-08-28'], 400);
  assert.equal(out.points, 600);
});

test('reconcile: estimate path runs when decayLoss was never recorded', () => {
  const v = rank({ points: 750, decayApplied: { '2026-10-05': 250 }, decayLoss: {} });
  const out = rankReconcileDecay(v, { '2026-10-05': 90 * 60 }, NOW);
  assert.ok(out.points >= 750 && out.points <= 1000);
  assert.ok(out.decayLoss['2026-10-05'] !== undefined);
});

test('maintain: charges the full tier for a skipped weekday, once', () => {
  const data = { days: {}, allocations: {}, rank: rank({ points: 2000, startedOn: '2026-10-05' }) };
  const out = pomoRankMaintain(data, NOW);
  // Mon 10-05, Tue 10-06, Wed 10-07, Thu 10-08 (today counts as settled through today)
  const settled = Object.keys(out.rank.decayApplied);
  assert.ok(settled.includes('2026-10-05') && settled.includes('2026-10-07'));
  assert.ok(out.rank.points < 2000);
  const again = pomoRankMaintain(out, NOW);
  assert.deepEqual(again.rank.decayApplied, out.rank.decayApplied);
  assert.equal(again.rank.points, out.rank.points);
});

test('maintain: weekends are free', () => {
  const data = { days: {}, allocations: {}, rank: rank({ points: 2000, startedOn: '2026-10-03' }) }; // Saturday
  const out = pomoRankMaintain(data, new Date('2026-10-04T12:00:00')); // Sunday
  assert.equal(out.rank.points, 2000);
});

test('maintain: a stored season from the past closes into history and restarts at 0', () => {
  const data = { days: {}, allocations: {}, rank: rank({ seasonId: '2026-2', points: 2500, startedOn: '2026-08-31' }) };
  const out = pomoRankMaintain(data, NOW);
  assert.equal(out.rank.seasonId, '2026-3');
  assert.ok(out.rank.history.some(h => String(h.seasonId) === '2026-2'));
});

test('maintain: a season one ahead that starts within a week (clock skew) keeps its points and is not closed', () => {
  const data = { days: {}, allocations: {}, rank: rank({ seasonId: '2027-1', points: 3000, startedOn: '2027-01-01' }) };
  const out = pomoRankMaintain(data, new Date('2026-12-30T12:00:00'));
  assert.equal(out.rank.seasonId, '2027-1');
  assert.equal(out.rank.points, 3000);
  assert.deepEqual(out.rank.history, data.rank.history);
  assert.deepEqual(out.rank.decayApplied, {});
});

test('maintain: a season one ahead that starts more than a week away resets', () => {
  const data = { days: {}, allocations: {}, rank: rank({ seasonId: '2027-1', points: 3000, startedOn: '2027-01-01' }) };
  assert.equal(pomoRankMaintain(data, NOW).rank.points, 0);
});

test('maintain: seasons more than one ahead, or garbage ids, still reset', () => {
  for (const seasonId of ['2027-2', '2030-1', 'x', '']) {
    const data = { days: {}, allocations: {}, rank: rank({ seasonId, points: 3000, startedOn: '2027-01-02' }) };
    assert.equal(pomoRankMaintain(data, NOW).rank.points, 0, seasonId);
  }
});


test('merge progress: an empty current state adopts the incoming one', pinned(() => {
  const incoming = { days: { '2026-10-07': 1800 }, allocations: {}, rank: rank({ points: 1500, startedOn: '2026-10-08' }) };
  const out = pomoMergeProgress({}, incoming);
  assert.equal(out.days['2026-10-07'], 1800);
}));

test('merge progress: per-day focus takes the max, same season higher score wins', pinned(() => {
  const cur = { days: { '2026-10-07': 600 }, allocations: {}, rank: rank({ seasonId: rankSeasonForDate(new Date()).id, points: 1000, startedOn: localToday() }) };
  const inc = { days: { '2026-10-07': 1800, '2026-10-06': 300 }, allocations: {}, rank: { ...cur.rank, points: 1400 } };
  const out = pomoMergeProgress(cur, inc);
  assert.equal(out.days['2026-10-07'], 1800);
  assert.equal(out.days['2026-10-06'], 300);
  assert.equal(out.rank.points, 1400);
}));

test('merge progress: sessions are not duplicated and dismissed notices stay dismissed', pinned(() => {
  const season = rankSeasonForDate(new Date()).id;
  const session = { id: 's1', date: localToday(), durationSeconds: 100, pointsAwarded: 10 };
  const base = rank({ seasonId: season, points: 10, startedOn: localToday(), sessions: [session] });
  const cur = { days: { x: 1 }, allocations: {}, rank: { ...base, notices: [{ id: 'n1' }] } };
  const inc = { days: { x: 1 }, allocations: {}, rank: { ...base, notices: [{ id: 'n1', dismissed: true }] } };
  const out = pomoMergeProgress(cur, inc);
  assert.equal(out.rank.sessions.filter(s => s.id === 's1').length, 1);
  assert.equal(out.rank.notices.find(n => n.id === 'n1').dismissed, true);
}));

test('merge progress: an older incoming season goes to history without lowering a row', pinned(() => {
  const season = rankSeasonForDate(new Date()).id;
  const cur = { days: { x: 1 }, allocations: {}, rank: rank({ seasonId: season, points: 100, startedOn: localToday(),
    history: [{ seasonId: '2025-1', points: 9000, rankIndex: 1, rankName: 'Allievo', division: 1, divisionRoman: 'I' }] }) };
  const inc = { days: { x: 1 }, allocations: {}, rank: rank({ seasonId: '2025-1', points: 500, startedOn: '2025-01-02' }) };
  const out = pomoMergeProgress(cur, inc);
  const row = out.rank.history.find(h => String(h.seasonId) === '2025-1');
  assert.ok(row);
  assert.equal(row.points, 9000);
}));

test('normalize: garbage input yields a usable default', () => {
  const out = pomoNormalize(null);
  assert.ok(out.days && out.rank && Array.isArray(out.rank.sessions));
});

function localToday() { return R.localDateISO ? R.localDateISO() : new Date().toLocaleDateString('sv-SE'); }


test('retention safety: past-season sessions do not influence maintain or reconcile', pinned(() => {
  const mk = sessions => ({
    days: { '2026-10-05': 60 * 60 },
    allocations: {},
    rank: rank({ seasonId: '2026-3', points: 1500, startedOn: '2026-10-01', sessions,
      decayApplied: { '2026-10-05': 100 }, decayLoss: { '2026-10-05': 100 } }),
  });
  const past = { id: 'old', seasonId: '2026-2', date: '2026-06-10', durationSeconds: 3600, pointsAwarded: 400 };
  const cur = { id: 'cur', seasonId: '2026-3', date: '2026-10-05', durationSeconds: 3600, pointsAwarded: 400 };
  const withPast = pomoRankMaintain(mk([past, cur]), NOW);
  const withoutPast = pomoRankMaintain(mk([cur]), NOW);
  for (const k of ['points', 'seasonId', 'decayApplied', 'decayLoss']) assert.deepEqual(withPast.rank[k], withoutPast.rank[k], k);
  assert.deepEqual(withPast.rank.notices.map(n => n.id), withoutPast.rank.notices.map(n => n.id));
}));

test('keep-local reconcile: the cloud focus log is taken before decay, so no stale charge', () => {
  const { bhMergeFocusDays } = R;
  const local = { days: { '2026-10-05': 60 }, allocations: {}, rank: rank({ points: 2000, startedOn: '2026-10-05' }) };
  const cloudDays = { '2026-10-05': 3 * 3600, '2026-10-06': 3 * 3600, '2026-10-07': 3 * 3600 };
  const merged = bhMergeFocusDays(local, cloudDays);
  assert.equal(merged.days['2026-10-05'], 3 * 3600);
  assert.equal(bhMergeFocusDays(merged, { '2026-10-05': 10 }), merged, 'a smaller value never lowers the log');
  const out = pomoRankMaintain(merged, NOW);
  assert.equal(out.rank.points, 2000);
  assert.ok(!(out.rank.notices || []).some(n => n.type === 'decay'));
});
