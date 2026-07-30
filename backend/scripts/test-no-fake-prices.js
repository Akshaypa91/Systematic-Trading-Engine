// scripts/test-no-fake-prices.js — the engine must never invent a price. Offline.
//   node scripts/test-no-fake-prices.js
//
// Background: the dashboard used to show RELIANCE at ₹2,845.25 with RSI 100 and
// a Bollinger band of ₹516–₹2,379 whenever Upstox was disconnected. None of it
// was market data. Three separate layers were fabricating:
//
//   1. marketDataService._simPrice     — random walk from a hardcoded 2024 seed
//   2. simulationEngine._generateHistory — 250-bar random walk per symbol
//   3. signalController's SIM_FALLBACK  — full indicator set over that walk
//
// Each looked exactly like real output on screen. These tests pin the fix: with
// ALLOW_SIM_PRICES off (the default), every path must either return a real
// price or admit it has none.
'use strict';
process.env.ALLOW_SIM_PRICES = 'false';
require('dotenv').config();

const logger = require('../src/config/logger');
logger.info = () => {}; logger.debug = () => {}; logger.warn = () => {};

let pass = 0, fail = 0;
const ok = (n, c, x = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`));

// ── 1. Source code contains no un-gated fabrication ──────────────────────────
console.log('\nno un-gated price fabrication');
{
  const fs = require('fs');
  const path = require('path');
  const src = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

  const mds = src('src/services/marketDataService.js');
  ok('marketDataService gates SIM behind ALLOW_SIM_PRICES',
     /ALLOW_SIM\s*=\s*String\(process\.env\.ALLOW_SIM_PRICES/.test(mds));
  // Every _simPrice call site must sit inside an `if (ALLOW_SIM)` block.
  // `function _simPrice(base)` is the declaration, not a call — exclude it.
  const simCalls = (mds.match(/(?<!function )_simPrice\(base\)/g) || []).length;
  const gatedCalls = (mds.match(/if \(ALLOW_SIM\) \{[\s\S]{0,220}?_simPrice\(base\)/g) || []).length;
  ok(`all ${simCalls} _simPrice call sites are gated`, simCalls > 0 && gatedCalls === simCalls,
     `gated ${gatedCalls}/${simCalls}`);

  const sim = src('src/engine/simulationEngine.js');
  ok('simulationEngine no longer generates a random price history',
     !/_generateHistory/.test(sim));
  ok('simulationEngine no longer walks prices forward',
     !/function _nextPrice/.test(sim));
  ok('simulationEngine has no hardcoded seed prices',
     !/const SEED_PRICES/.test(sim));

  const sc = src('src/controllers/signalController.js');
  ok('signalController has no SIM_FALLBACK strategy', !/SIM_FALLBACK/.test(sc));
  ok('signalController returns NO_MARKET_DATA instead', /NO_MARKET_DATA/.test(sc));
}

// ── 2. marketDataService reports UNAVAILABLE, not a number ───────────────────
console.log('\nmarketDataService with every provider failing');
(async () => {
  const md = require('../src/services/marketDataService');
  md.clearCache();

  // A symbol no provider can resolve. Offline (no network, no broker token) all
  // upstream fetches fail, so this exercises the tail of the chain.
  const r = await md.getLivePrice('___NOT_A_REAL_SYMBOL___');
  ok('price is null, not fabricated', r.price === null, String(r.price));
  ok('source is UNAVAILABLE', r.source === 'UNAVAILABLE', r.source);
  ok('never labels itself SIM', r.source !== 'SIM', r.source);

  const b = await md.getBestPrice('___NOT_A_REAL_SYMBOL___');
  ok('getBestPrice also returns null', b.price === null, String(b.price));
  ok('getBestPrice source is UNAVAILABLE', b.source === 'UNAVAILABLE', b.source);

  // ── 3. signalEngine degrades to a labelled source, never a fake one ────────
  console.log('\nsignalEngine source labelling');
  const se = require('../src/engine/signalEngine');

  // Empty history + no live price → nothing to compute.
  const empty = await se.generateLiveSignal('___NOT_A_REAL_SYMBOL___', []);
  ok('empty history → UNAVAILABLE', empty.source === 'UNAVAILABLE', empty.source);
  ok('empty history → null price', empty.currentPrice === null, String(empty.currentPrice));
  ok('empty history → no signal', empty.signal === null, String(empty.signal));

  // Real closes present but no live feed → LAST_CLOSE, and the price must be
  // the actual last close we handed in, not something derived.
  const closes = Array.from({ length: 120 }, (_, i) => 1000 + Math.sin(i / 6) * 40);
  const lastClose = closes[closes.length - 1];
  const delayed = await se.generateLiveSignal('___NOT_A_REAL_SYMBOL___', closes.slice());
  ok('real history, no feed → LAST_CLOSE', delayed.source === 'LAST_CLOSE', delayed.source);
  ok('price is the real last close',
     Math.abs(delayed.currentPrice - lastClose) < 0.01,
     `${delayed.currentPrice} vs ${lastClose}`);
  ok('never labels a delayed close as LIVE', delayed.source !== 'LIVE', delayed.source);

  // ── 4. simulationEngine skips symbols it has no real data for ─────────────
  console.log('\nsimulationEngine unavailable handling');
  const sim = require('../src/engine/simulationEngine');
  ok('exports no SEED_PRICES', sim.SEED_PRICES === undefined);
  ok('exposes unavailable symbols', typeof sim.getUnavailable === 'function');

  // With no DB connection, loading history fails → symbol reported, not invented.
  const loaded = await sim.ensureHistory('___NOT_A_REAL_SYMBOL___');
  ok('ensureHistory returns null for an unknown symbol', loaded === null, String(loaded));
  ok('history stays empty rather than being generated',
     sim.getPriceHistory('___NOT_A_REAL_SYMBOL___').length === 0);
  const un = sim.getUnavailable();
  ok('symbol is listed as unavailable with a reason',
     un.some(u => u.symbol === '___NOT_A_REAL_SYMBOL___' && !!u.reason),
     JSON.stringify(un.slice(0, 2)));

  // ── 5. The escape hatch still works when explicitly enabled ───────────────
  // Not a licence to use it — it exists so offline UI work is possible — but a
  // flag that silently does nothing is its own kind of lie.
  console.log('\nALLOW_SIM_PRICES=true escape hatch');
  {
    delete require.cache[require.resolve('../src/services/marketDataService')];
    process.env.ALLOW_SIM_PRICES = 'true';
    const md2 = require('../src/services/marketDataService');
    md2.clearCache();
    const r2 = await md2.getLivePrice('___ANOTHER_FAKE_SYMBOL___');
    ok('flag on → a price is produced', typeof r2.price === 'number' && r2.price > 0, String(r2.price));
    ok('flag on → clearly labelled SIM', r2.source === 'SIM', r2.source);
    process.env.ALLOW_SIM_PRICES = 'false';
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e.stack); process.exit(1); });
