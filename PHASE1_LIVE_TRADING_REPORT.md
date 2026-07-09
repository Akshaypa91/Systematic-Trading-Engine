# SYSTRA — Live Trading Phase 1 Report

**Scope delivered:** Broker connection + live data + Paper/Live mode selector.
**Deliberately NOT in this phase:** real order placement, order confirmation modal,
live order book, live positions/portfolio sync, emergency controls, full risk engine,
audit expansion. Those are Phase 2/3 (see *Deferred* at the end).

**Guiding constraint:** Paper Trading is untouched and fully isolated. Nothing in this
phase can place a real order — it is read-only broker + market data only.

---

## 1. Files Changed

### Backend
| File | Change |
|---|---|
| `backend/src/services/brokerAdapter.js` | Added `getProfile(userId)` → `GET /v2/user/profile` for account identity. |
| `backend/src/controllers/liveController.js` | Added `getBrokerStatus`, `brokerReconnect`, `brokerDisconnect`, `brokerRefresh`. Composes token + WS + profile + funds into one status payload; never throws (each remote call isolated). Disconnect forces the user back to PAPER. |
| `backend/src/routes/live.js` | New routes: `GET /broker/status`, `POST /broker/reconnect`, `POST /broker/disconnect`, `POST /broker/refresh`. |
| `backend/src/services/marketDataService.js` | (Earlier fix, still relevant) SIM prices no longer cached; real-provider (Upstox/NSE) prices preferred; cache TTL env fixed. |
| `backend/src/engine/signalEngine.js` | (Earlier fix) Correct LIVE vs SIM source labelling. |

### Frontend
| File | Change |
|---|---|
| `frontend/src/context/TradingModeContext.jsx` | **New.** Single source of truth for PAPER/LIVE mode + broker-connected state. Safety invariant: LIVE cannot be active while broker is disconnected. |
| `frontend/src/components/BrokerStatusCard.jsx` | **New.** Replaces "Connect Upstox". Shows broker, connected state, client ID, account name, funds/margin/equity, segment, connection time, token expiry, WS state + Reconnect / Disconnect / Refresh. |
| `frontend/src/components/LiveModeBanner.jsx` | **New.** Green "🟢 LIVE TRADING — Real Money Enabled" top banner (broker, account, funds, market status, latency). Renders only in LIVE mode. |
| `frontend/src/components/TradingModeToggle.jsx` | PAPER = **blue**, LIVE = **green** (per spec, was red); added the "🟢 LIVE ACCOUNT / Real Money Trading Enabled" active indicator. |
| `frontend/src/components/Navbar.jsx` | Mode selector now lives in the global top-right nav (always visible). |
| `frontend/src/pages/Trade.jsx` | Consumes the shared context; renders the Broker Status Card + LIVE banner; removed the old inline "Connect Upstox" pill and duplicate toggle. |
| `frontend/src/App.jsx` | Wrapped the app in `TradingModeProvider`. |
| `frontend/src/services/api.js` | Added `liveAPI.brokerStatus / brokerReconnect / brokerDisconnect / brokerRefresh`. |

---

## 2. Database Changes

**None in Phase 1.** The status endpoint reads the in-memory Upstox token + WS state
and live Upstox REST (profile/funds); it falls back to the existing `broker_accounts`
row via `brokerAdapter._getToken`. No migrations required.

> Phase 2 (order execution) will use the existing `orders` / `broker_accounts` tables and
> add an `order_audit` trail — not yet touched.

---

## 3. API Changes (all under `/api/live`, `requireAuth`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/live/broker/status` | Rich broker status card payload: `{ connected, broker, websocket, token, profile{clientId,accountName,segment…}, funds{available,used,margin,equity,collateral}, connectionTime, tokenExpiry, errors{} }`. |
| POST | `/live/broker/reconnect` | Re-establish the Upstox market-data WebSocket using the existing token. |
| POST | `/live/broker/disconnect` | Drop WS + clear token; forces the user to PAPER (safety). |
| POST | `/live/broker/refresh` | Re-fetch profile + funds (same payload as status). |

Existing endpoints (`/live/status`, `/live/mode`, `/auth/upstox/login|callback|status`) are unchanged.

---

## 4. Security Improvements / Safety Invariants

- **LIVE gated on real connection.** `TradingModeContext` refuses to switch to LIVE unless the broker reports connected, and **auto-reverts to PAPER** if the broker drops mid-session (client) — the server-side `brokerDisconnect` also forces `trading_mode = paper`.
- **No order path shipped.** This phase exposes read-only broker data only; there is literally no new code path that can submit an order.
- **Status endpoint never leaks a stack trace or throws** — each Upstox call is isolated in `Promise.allSettled`; failures surface as `errors.{profile,funds}` strings.
- **Token stays server-side.** The access token is never sent to the browser; the card only shows `hasToken`, granted/expiry timestamps.

---

## 5. Risk Controls (present vs deferred)

- **Present:** market-data source labelling (SIM vs LIVE) so simulated prices are never mistaken for real; broker-connection gating of LIVE mode.
- **Deferred to Phase 2/3:** pre-trade checks (market open, funds, freeze/circuit limits, quantity), daily-loss limit, max exposure, max position size, max orders, kill switch UI, emergency square-off. The backend `riskManager.js` already has fixed-fractional / Kelly sizing + `validateTrade` to build on.

---

## 6. Testing Steps

**Backend (against Upstox sandbox first, per your choice):**
1. Set env (below), restart backend. Complete OAuth: open `/api/auth/upstox/login`, log in.
2. `GET /api/live/broker/status` → expect `connected:true`, populated `profile.clientId`, `profile.accountName`, and `funds`.
   - ⚠️ **Verify the funds mapping** against your real payload. Code assumes Upstox shape `{ equity: { available_margin, used_margin, collateral } }`. If your account returns a different shape, tell me the JSON and I'll adjust `getBrokerStatus`.
3. `POST /api/live/broker/reconnect` → WS reconnects; `websocket.connected:true`.
4. `POST /api/live/broker/disconnect` → `connected:false`, and your user's `trading_mode` is now `paper`.
5. Confirm prices: `GET /api/data/quote/RELIANCE` should now return `source: LIVE_UPSTOX` (not SIM) during market hours.

**Frontend:**
6. Hard-refresh. Top-right shows the **PAPER (blue) / LIVE (green)** selector on every page.
7. With broker connected, the **Broker Status Card** on `/trade` shows all fields; Reconnect/Disconnect/Refresh work.
8. Switch to LIVE → green "🟢 LIVE ACCOUNT" indicator + top "🟢 LIVE TRADING" banner appear.
9. Disconnect broker → LIVE auto-reverts to PAPER and the LIVE pill disables.
10. **Paper regression:** in PAPER mode, place a paper order, reset portfolio, view signals — all behave exactly as before.

**Automated checks already run:** backend `node --check` (pass), ESLint (0 errors), `vite build` (pass).

---

## 7. Deployment Instructions (Render backend + Vercel frontend)

**This is the step that also fixes the "prices stuck on SIM" problem — production has no Upstox token yet.**

On **Render** (backend service → Environment), set:
```
UPSTOX_API_KEY=<your Upstox app client id>
UPSTOX_API_SECRET=<your Upstox app client secret>
UPSTOX_REDIRECT_URI=https://systra.onrender.com/api/auth/upstox/callback
# optional shortcut for a day's session without the OAuth click:
UPSTOX_ACCESS_TOKEN=<daily token>
```
- The redirect URI must **exactly** match what's registered in the Upstox developer console.
- Upstox tokens expire at midnight IST — re-run `/api/auth/upstox/login` each trading day (or refresh `UPSTOX_ACCESS_TOKEN`).
- On boot, `app.js` auto-connects the Upstox WS when a valid token exists; prices then flip SIM → LIVE_UPSTOX automatically.

**Frontend (Vercel):** no new env needed (`VITE_API_URL` / `VITE_WS_URL` already point at Render). Just redeploy from `main` so the new components ship.

**Git:** changes are committed locally; run `git push origin main` to trigger both deploys (I can't push from here — no credentials in this environment).

---

## 8. Deferred to Phase 2 / 3 (not built yet)

- **Phase 2:** LIVE order panel (Market/Limit/SL/SL-M, product CNC/MIS/NRML, validity DAY/IOC/AMO, disclosed qty), order confirmation modal with charges/GST/stamp-duty/margin, real order execution via Upstox Orders API (sandbox first), Live Order Book page.
- **Phase 3:** live positions + exit, Upstox portfolio/holdings sync, funds page, full risk engine + kill switch UI, emergency square-off, audit-log expansion for every request/response/order.

Say the word and I'll start Phase 2 — order execution wired against the Upstox **sandbox** so you can test placement with zero financial risk before going live.
