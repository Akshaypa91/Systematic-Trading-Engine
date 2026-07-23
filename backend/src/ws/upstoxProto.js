// src/ws/upstoxProto.js
// ─────────────────────────────────────────────────────────────────────────────
// Decodes Upstox Market Data Feed V3 binary (protobuf) frames into a plain
// { currentTs, feeds: { instrumentKey: { ltp, cp, ... } } } shape — the same
// shape the old JSON-era code expected, so ws/upstoxWS.js can consume it
// unchanged. LTP is extracted from whichever feed variant arrives (ltpc,
// fullFeed.marketFF, fullFeed.indexFF, or firstLevelWithGreeks).
//
// The FeedResponse type is loaded once from marketDataFeedV3.proto. Decoding is
// pure and unit-tested via an encode→decode round-trip (test-upstox-proto.js).
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const path = require('path');
const protobuf = require('protobufjs');
const logger = require('../config/logger');

const PROTO_PATH = path.join(__dirname, 'marketDataFeedV3.proto');
const MSG_TYPE   = 'com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse';

let _FeedResponse = null;

// Load + cache the compiled message type. Synchronous load keeps callers simple.
function _type() {
  if (_FeedResponse) return _FeedResponse;
  const root = protobuf.loadSync(PROTO_PATH);
  _FeedResponse = root.lookupType(MSG_TYPE);
  return _FeedResponse;
}

// Pull the LTPC block out of any feed variant.
function _ltpcOf(feed) {
  if (!feed) return null;
  if (feed.ltpc) return feed.ltpc;                                  // ltpc mode
  if (feed.fullFeed?.marketFF?.ltpc) return feed.fullFeed.marketFF.ltpc;
  if (feed.fullFeed?.indexFF?.ltpc)  return feed.fullFeed.indexFF.ltpc;
  if (feed.firstLevelWithGreeks?.ltpc) return feed.firstLevelWithGreeks.ltpc;
  return null;
}

const _num = (v) => {
  // protobuf int64 fields come back as Long|number|string depending on config.
  if (v == null) return 0;
  if (typeof v === 'object' && typeof v.toNumber === 'function') return v.toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Decode a binary FeedResponse frame.
 * @param {Buffer|Uint8Array} buffer
 * @returns {{ type: string, currentTs: number, feeds: Object<string,{ltp,cp,ltt,ltq,change,changePct}> }}
 */
function decode(buffer) {
  const FeedResponse = _type();
  const msg = FeedResponse.decode(buffer instanceof Buffer ? buffer : Buffer.from(buffer));
  // toObject with defaults so absent oneof branches are simply undefined.
  const obj = FeedResponse.toObject(msg, { longs: Number, enums: String, defaults: false });

  const out = { type: obj.type, currentTs: _num(obj.currentTs) || Date.now(), feeds: {} };
  const feeds = obj.feeds || {};
  for (const [key, feed] of Object.entries(feeds)) {
    const ltpc = _ltpcOf(feed);
    if (!ltpc) continue;
    const ltp = _num(ltpc.ltp);
    if (!(ltp > 0)) continue;
    const cp  = _num(ltpc.cp) || ltp;
    const change = +(ltp - cp).toFixed(2);
    out.feeds[key] = {
      ltp,
      cp,
      ltt: _num(ltpc.ltt),
      ltq: _num(ltpc.ltq),
      change,
      changePct: cp > 0 ? +((change / cp) * 100).toFixed(2) : 0,
    };
  }
  return out;
}

// Exposed for the round-trip test: encode a plain object as a FeedResponse frame.
function _encodeForTest(plain) {
  const FeedResponse = _type();
  const errMsg = FeedResponse.verify(plain);
  if (errMsg) throw new Error(`proto verify failed: ${errMsg}`);
  return FeedResponse.encode(FeedResponse.create(plain)).finish();
}

module.exports = { decode, _encodeForTest, _ltpcOf };
