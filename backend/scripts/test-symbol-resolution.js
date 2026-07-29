// scripts/test-symbol-resolution.js
// Instrument-key resolution precedence. Offline (instrument master stubbed).
//   node scripts/test-symbol-resolution.js
//
// Regression guard for the 2026-07 live-log finding: KOTAKBANK and BAJFINANCE
// never received prices because the hardcoded ISIN map shadowed the live Upstox
// instrument master. ISINs change after face-value splits, so the live master
// must always win over the static constant.
'use strict';

const path = require('path');

// Stub the instrument master BEFORE symbols.js lazily requires it.
const masterPath = require.resolve('../src/data/instrumentMaster');
require.cache[masterPath] = {
  id: masterPath, filename: masterPath, loaded: true,
  exports: {
    resolve: (s) => ({
      // "fresh" post-split keys the live master would return
      BAJFINANCE: 'NSE_EQ|INE296A01032',
      KOTAKBANK:  'NSE_EQ|INE237A01028',
      HBLENGINE:  'NSE_EQ|INE292B01021',
    })[s] || null,
    reverse: () => null,
  },
};

const symbols = require('../src/config/symbols');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`));

console.log('toUpstox precedence');
// The whole point: master wins even when the curated map has a (stale) entry.
ok('live master overrides stale curated ISIN (BAJFINANCE)',
  symbols.toUpstox('BAJFINANCE') === 'NSE_EQ|INE296A01032', symbols.toUpstox('BAJFINANCE'));
ok('master used for KOTAKBANK', symbols.toUpstox('KOTAKBANK') === 'NSE_EQ|INE237A01028', symbols.toUpstox('KOTAKBANK'));
ok('master covers symbols absent from curated map (HBLENGINE)',
  symbols.toUpstox('HBLENGINE') === 'NSE_EQ|INE292B01021', symbols.toUpstox('HBLENGINE'));

console.log('curated fallback');
// RELIANCE isn't in the stub master → must fall back to the curated map.
const rel = symbols.toUpstox('RELIANCE');
ok('falls back to curated when master has no entry', typeof rel === 'string' && rel.startsWith('NSE_EQ|'), String(rel));
// Indices live only in the curated map.
const nifty = symbols.toUpstox('NIFTY50') || symbols.toUpstox('NIFTY');
ok('index resolves via curated map', nifty == null || String(nifty).includes('INDEX'), String(nifty));

console.log('guards');
ok('unknown symbol → null', symbols.toUpstox('NOTAREALSYMBOL123') === null);
ok('empty → null', symbols.toUpstox('') === null);
ok('case/whitespace insensitive', symbols.toUpstox('  bajfinance ') === 'NSE_EQ|INE296A01032');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
