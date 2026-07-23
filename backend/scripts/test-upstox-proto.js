// scripts/test-upstox-proto.js
// Proves the protobuf decoder by round-tripping: build a FeedResponse plain
// object → encode to binary (same schema) → decode → assert we recover LTP/cp
// and the derived change%. This validates decoder LOGIC and that the .proto
// compiles. (It does NOT validate field numbers against live Upstox — that
// needs one real captured frame; see UPSTOX_WS_ENABLED notes.)
//   node scripts/test-upstox-proto.js
'use strict';
const proto = require('../src/ws/upstoxProto');

let pass = 0, fail = 0;
const approx = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const ok = (n, c, x = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`));

(async () => {
  console.log('upstoxProto — round-trip decode');

  // ltpc-mode feed for RELIANCE + an index full-feed for NIFTY.
  const plain = {
    type: 1,  // live_feed (encode wants the numeric enum; decode returns the name)
    currentTs: 1739000000000,
    feeds: {
      'NSE_EQ|INE002A01018': { ltpc: { ltp: 1327.2, cp: 1310, ltt: 1739000000000, ltq: 5 } },
      'NSE_INDEX|Nifty 50':  { fullFeed: { indexFF: { ltpc: { ltp: 23500.5, cp: 23400 } } } },
      'NSE_EQ|INE467B01029': { fullFeed: { marketFF: { ltpc: { ltp: 4001.1, cp: 4050 }, atp: 4020 } } },
    },
  };

  const buf = proto._encodeForTest(plain);
  ok('encodes to a non-empty buffer', Buffer.isBuffer(buf) && buf.length > 0, `len=${buf.length}`);

  const d = proto.decode(buf);
  ok('decodes 3 feeds', Object.keys(d.feeds).length === 3, `got ${Object.keys(d.feeds).length}`);

  const r = d.feeds['NSE_EQ|INE002A01018'];
  ok('ltpc: RELIANCE ltp 1327.2', r && approx(r.ltp, 1327.2), JSON.stringify(r));
  ok('ltpc: RELIANCE cp 1310', r && approx(r.cp, 1310));
  ok('ltpc: change +17.2', r && approx(r.change, 17.2), `got ${r && r.change}`);
  ok('ltpc: change% ≈ +1.31', r && approx(r.changePct, +((17.2 / 1310) * 100).toFixed(2)), `got ${r && r.changePct}`);

  const idx = d.feeds['NSE_INDEX|Nifty 50'];
  ok('indexFF ltp extracted 23500.5', idx && approx(idx.ltp, 23500.5), JSON.stringify(idx));

  const mkt = d.feeds['NSE_EQ|INE467B01029'];
  ok('marketFF ltp extracted 4001.1', mkt && approx(mkt.ltp, 4001.1), JSON.stringify(mkt));
  ok('marketFF negative change -48.9', mkt && approx(mkt.change, -48.9), `got ${mkt && mkt.change}`);

  ok('currentTs preserved', d.currentTs === 1739000000000, `${d.currentTs}`);

  // Zero/absent LTP feeds are dropped, not surfaced as ₹0.
  const plain2 = { type: 1, feeds: { 'X|1': { ltpc: { ltp: 0, cp: 100 } } } };
  const d2 = proto.decode(proto._encodeForTest(plain2));
  ok('drops zero-ltp feed', Object.keys(d2.feeds).length === 0, JSON.stringify(d2.feeds));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
