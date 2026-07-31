// scripts/test-swing-outcomes.js — swing signal scoring. Offline, no network.
//   node scripts/test-swing-outcomes.js
//
// The two rules worth testing are judgement calls, not arithmetic:
//   • A daily bar that touches BOTH the target and the stop is scored as a
//     STOP. Daily data cannot tell you which came first, and assuming the
//     target is how a backtest invents an edge that dies in production.
//   • Signals that haven't resolved yet are excluded from win rate entirely —
//     neither counted as wins nor written off as losses.
'use strict';
const { resolveOutcome, summarise } = require('../src/services/swingOutcomes');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`));

const bar = (date, low, high, close = (low + high) / 2) => ({ date, low, high, close });
// Entry 100, stop 90 (risk 10), target 120 → planned payoff 2R.
const SIG = { entry: 100, sl: 90, t1: 120 };

console.log('\ntarget and stop detection');
{
  const t = resolveOutcome(SIG, [bar('2026-01-02', 98, 105), bar('2026-01-03', 104, 121)]);
  ok('target hit → TARGET', t.outcome === 'TARGET', t.outcome);
  ok('exits at the target price', t.exitPrice === 120, String(t.exitPrice));
  ok('R-multiple is +2', t.rMultiple === 2, String(t.rMultiple));
  ok('reports bars held', t.barsHeld === 2, String(t.barsHeld));

  const s = resolveOutcome(SIG, [bar('2026-01-02', 97, 103), bar('2026-01-03', 89, 99)]);
  ok('stop hit → STOPPED', s.outcome === 'STOPPED', s.outcome);
  ok('a stop is exactly -1R', s.rMultiple === -1, String(s.rMultiple));
  ok('exits at the stop price', s.exitPrice === 90, String(s.exitPrice));
}

console.log('\nsame-bar ambiguity resolves pessimistically');
{
  // One bar spans 88 → 125: it touched the stop AND the target.
  const both = resolveOutcome(SIG, [bar('2026-01-02', 88, 125)]);
  ok('scored as STOPPED, not TARGET', both.outcome === 'STOPPED', both.outcome);
  ok('and as -1R', both.rMultiple === -1, String(both.rMultiple));

  // Order within the array must not change the verdict either.
  const later = resolveOutcome(SIG, [bar('2026-01-02', 95, 105), bar('2026-01-05', 85, 130)]);
  ok('still STOPPED on a later ambiguous bar', later.outcome === 'STOPPED', later.outcome);
}

console.log('\nopen vs expired');
{
  const o = resolveOutcome(SIG, [bar('2026-01-02', 98, 108), bar('2026-01-03', 99, 110)]);
  ok('neither level touched, short history → OPEN', o.outcome === 'OPEN', o.outcome);
  ok('an OPEN trade has no R-multiple', o.rMultiple === null, String(o.rMultiple));

  // 30 quiet bars: the breakout failed to do anything. That is a result.
  const quiet = Array.from({ length: 30 }, (_, i) => bar(`2026-02-${String(i + 1).padStart(2, '0')}`, 97, 108, 103));
  const e = resolveOutcome(SIG, quiet);
  ok('horizon exceeded → EXPIRED', e.outcome === 'EXPIRED', e.outcome);
  ok('marked to the last close (+0.3R)', Math.abs(e.rMultiple - 0.3) < 0.001, String(e.rMultiple));
}

console.log('\nmalformed signals are refused, not guessed');
{
  const bad = resolveOutcome({ entry: 100, sl: 100, t1: 120 }, [bar('2026-01-02', 90, 130)]);
  ok('zero risk → no score', bad.rMultiple === null && bad.outcome === 'OPEN', JSON.stringify(bad));
  const inverted = resolveOutcome({ entry: 100, sl: 110, t1: 120 }, [bar('2026-01-02', 90, 130)]);
  ok('stop above entry → no score', inverted.rMultiple === null, String(inverted.rMultiple));
}

console.log('\nmonthly aggregation');
{
  const rows = [
    { signal_date: '2026-07-05', entry: 100, sl: 90, t1: 120, outcome: 'TARGET',  r_multiple: 2 },
    { signal_date: '2026-07-11', entry: 100, sl: 90, t1: 120, outcome: 'STOPPED', r_multiple: -1 },
    { signal_date: '2026-07-19', entry: 100, sl: 90, t1: 120, outcome: 'STOPPED', r_multiple: -1 },
    { signal_date: '2026-07-28', entry: 100, sl: 90, t1: 120, outcome: 'OPEN',    r_multiple: null },
    { signal_date: '2026-06-09', entry: 100, sl: 90, t1: 120, outcome: 'TARGET',  r_multiple: 2 },
  ];
  const { months, overall } = summarise(rows);

  ok('groups by month', months.length === 2, String(months.length));
  ok('newest month first', months[0].month === '2026-07', months[0].month);

  const jul = months[0];
  ok('counts all signals in the month', jul.signals === 4, String(jul.signals));
  ok('open trades are tracked separately', jul.open === 1, String(jul.open));
  // 3 decided, 1 win → 33.3%. The open trade must not dilute this to 25%.
  ok('win rate excludes open trades', jul.winRatePct === 33.3, String(jul.winRatePct));
  ok('expectancy in R', jul.avgR === 0, String(jul.avgR));   // (2 −1 −1)/3
  ok('breakeven win rate from real R:R', jul.breakevenWinRatePct === 33.3, String(jul.breakevenWinRatePct));

  ok('overall decided count', overall.decided === 4, String(overall.decided));
  ok('overall win rate', overall.winRatePct === 50, String(overall.winRatePct));
  ok('overall total R', overall.totalR === 2, String(overall.totalR));
  ok('flags a small sample as unreliable', overall.reliable === false);
  ok('verdict names the sample size', /Only 4 resolved/.test(overall.verdict), overall.verdict);
}

console.log('\na high win rate with poor payoff is still called out');
{
  // R:R 0.6 → breakeven needs 62.5%. Winning 60% of the time still loses money,
  // which is precisely the trap a bare "win rate" number hides.
  const rows = Array.from({ length: 10 }, (_, i) => ({
    signal_date: '2026-07-01', entry: 100, sl: 90, t1: 106,
    outcome: i < 6 ? 'TARGET' : 'STOPPED',
    r_multiple: i < 6 ? 0.6 : -1,
  }));
  const { overall } = summarise(rows);
  ok('win rate is 60%', overall.winRatePct === 60, String(overall.winRatePct));
  ok('but expectancy is negative', overall.avgR < 0, String(overall.avgR));
  ok('breakeven is above the win rate', overall.breakevenWinRatePct > overall.winRatePct,
     `${overall.breakevenWinRatePct} vs ${overall.winRatePct}`);
}

console.log('\nno data');
{
  const { months, overall } = summarise([]);
  ok('no months', months.length === 0);
  ok('win rate is null, not 0%', overall.winRatePct === null, String(overall.winRatePct));
  ok('says nothing has resolved', /nothing to score/i.test(overall.verdict), overall.verdict);
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
