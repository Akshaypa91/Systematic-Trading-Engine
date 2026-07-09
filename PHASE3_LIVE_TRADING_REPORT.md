# SYSTRA — Live Trading Phase 3 Report

**Scope delivered:** live positions + exit, portfolio holdings & funds sync,
configurable risk limits + kill switch, and the emergency panel (stop / exit-all /
cancel-all / square-off). Plus status-bar Broker / Orders API / Exchange indicators.

This completes the original spec across Phases 1–3. **Paper Trading remains fully
isolated and untouched.**

> ⚠️ Still sandbox-gated: exit/square-off place **real market orders** through the
> same broker path, so they route to the sandbox host while `UPSTOX_SANDBOX=true`.

---

## 1. Files Changed

### Backend
| File | Change |
|---|---|
| `backend/src/risk/riskLimits.js` | **New.** Configurable limits (daily loss, max exposure, max position size, max orders/day) persisted in `system_flags`. |
| `backend/src/services/brokerAdapter.js` | Added `getHoldings` (long-term holdings). |
| `backend/src/services/liveTradingService.js` | Normalized `getPositions` (qty, avg, LTP, day/overall PnL, MTM, position id); `getFundsNormalized` (cash/margin/collateral/buying power/opening balance); `getHoldings` (invested/current/gains + allocation + sector allocation); `exitPosition`, `squareOffAll`, `cancelAllOrders`; risk-limit enforcement in `placeOrder` (max position size + max orders/day); `getRiskLimits`/`setRiskLimits`/`isKillSwitchEngaged`. |
| `backend/src/controllers/liveController.js` | Handlers for holdings, normalized funds, exit, emergency stop/square-off/cancel-all, risk get/put, user kill-switch toggle. |
| `backend/src/routes/live.js` | New routes (see §3). |

### Frontend
| File | Change |
|---|---|
| `frontend/src/pages/LivePortfolio.jsx` | **New.** Positions table (qty, avg, LTP, day/overall PnL, MTM, **Exit**), Funds panel, Holdings + gains, risk/emergency sidebar. Route `/positions`. |
| `frontend/src/components/RiskEmergencyPanel.jsx` | **New.** Kill switch, editable risk limits, and confirm-gated Exit All / Cancel All / Emergency Stop. |
| `frontend/src/components/StatusBar.jsx` | Added **Broker** indicator with Orders-API + Exchange rows. |
| `frontend/src/components/Sidebar.jsx` | Added **Portfolio** nav item (`/positions`). |
| `frontend/src/App.jsx` | Registered `/positions` route. |
| `frontend/src/services/api.js` | Added `fundsNormalized, holdings, exitPosition, risk, setRisk, killSwitch, emergencyStop, squareOffAll, cancelAllOrders`. |

---

## 2. Database Changes

**None.** Risk limits reuse the existing `system_flags` key/value table
(`risk.daily_loss_limit`, `risk.max_exposure`, `risk.max_position_size`,
`risk.max_orders_per_day`). No migration required. (Phase 2's `live_orders`
migration is still the only DB change across the three phases.)

---

## 3. API Changes (`/api/live`, `requireAuth`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/live/positions` | Normalized positions (qty, avg, ltp, dayPnl, overallPnl, mtm, positionId). |
| POST | `/live/positions/exit` | Square off one position (opposite market order). Body `{ symbol }`. |
| GET | `/live/funds/normalized` | Cash / used margin / collateral / buying power / opening balance. |
| GET | `/live/holdings` | Holdings + summary (invested, current value, today/total gain, allocation, sector allocation). |
| GET / PUT | `/live/risk` | Read / update risk limits. |
| POST | `/live/kill-switch` | Toggle kill switch. Body `{ engaged }`. |
| POST | `/live/emergency/stop` | Engage kill switch + cancel all + square off all + force PAPER. |
| POST | `/live/emergency/square-off` | Exit all positions. |
| POST | `/live/emergency/cancel-all` | Cancel all open orders. |

---

## 4. Security / Safety Invariants

- **Kill switch is authoritative.** When engaged, `placeOrder` refuses new orders (existing `_isLiveTradingEnabled` gate).
- **Emergency Stop is defense-in-depth:** disables live trading, cancels open orders, squares off positions, **and** forces the user to PAPER so nothing further can be sent.
- **Enforced risk limits:** max position size and max orders/day are checked server-side in `placeOrder` (in addition to the Phase 2 qty/value caps, market-hours, duplicate, and confirmation guards). Daily-loss-limit and max-exposure are stored and surfaced; see §5 for enforcement status.
- **Destructive UI is confirm-gated.** Exit All / Cancel All / Emergency Stop each require an explicit modal confirmation.
- **Paper isolation intact.** All Phase 3 endpoints hit the broker/live path only; the sim engine, paper portfolio, and `manualTradeAPI` are untouched.
- **Audit.** Exit, square-off, cancel-all, emergency stop, risk changes, and kill-switch toggles are all `auditLog`-recorded.

---

## 5. Risk Controls — enforcement status

| Control | Status |
|---|---|
| Kill switch | **Enforced** (blocks placement). |
| Max position size (per order ₹) | **Enforced** in `placeOrder`. |
| Max orders / day | **Enforced** (counts today's non-rejected `live_orders`). |
| Max order qty / value | **Enforced** (Phase 2 caps retained). |
| Daily loss limit | **Configurable + surfaced.** Live realized-P&L wiring is the one remaining enforcement gap — it needs a positions/trade-book P&L feed to trigger auto-block; today it's a stored limit shown in the UI. |
| Max exposure | **Configurable + surfaced.** Enforcing requires summing live positions on each order; deferred to keep placement latency low. |

If you want daily-loss and max-exposure to hard-block, say so and I'll wire the P&L/exposure fetch into `placeOrder` (small follow-up).

---

## 6. Testing Steps (sandbox)

1. Ensure Phase 2 is deployed and `UPSTOX_SANDBOX=true`, broker connected.
2. **Funds/holdings:** open `/positions` → Funds panel populates from `/live/funds/normalized`; Holdings from `/live/holdings`.
   - ⚠️ Verify Upstox field names against your sandbox: positions read `quantity/average_price/last_price/pnl/unrealised`, funds read `equity.available_margin/used_margin/collateral`, holdings read `quantity/average_price/last_price/close_price`. Send me one real object of each if the keys differ and I'll adjust the mappers.
3. **Exit:** with an open sandbox position, click **Exit** → opposite market order is sent; position updates on the 5s refresh.
4. **Risk limits:** edit values → Save → confirm `GET /live/risk` reflects them; place an order over Max Position Size → rejected with `MAX_POSITION_SIZE`.
5. **Kill switch:** engage → placing an order returns the kill-switch error; release to resume.
6. **Emergency Stop:** confirm modal → cancels orders, squares off, engages kill switch, and flips you to PAPER.
7. **Status bar:** Broker dot green when connected; hover shows Orders API + Exchange.
8. **Paper regression:** PAPER mode still uses sim positions/portfolio; nothing here affects it.

**Automated checks run:** backend `node --check` (pass), ESLint (0 errors), `vite build` (pass).

---

## 7. Deployment Instructions

No new required env. Optional risk-limit defaults (used until overridden in the UI):
```
LIVE_DAILY_LOSS_LIMIT=25000
LIVE_MAX_EXPOSURE=1000000
LIVE_MAX_POSITION_SIZE=200000
LIVE_MAX_ORDERS_PER_DAY=50
```
Deploy backend + frontend from `main`. No migration for Phase 3.

**Git:** committed locally where possible — see note below about the `.git/index.lock`.

---

## 8. Status vs. original spec

Delivered across Phases 1–3: trading modes, broker status card, live data,
order panel, charges confirmation, real (sandbox) execution, order book,
positions + exit, portfolio/holdings/funds, risk limits, kill switch, emergency
controls, audit, and status-bar indicators.

Remaining hardening (optional): hard-enforce daily-loss + max-exposure with a live
P&L feed, per-user (multi-account) broker tokens in DB, and a fuller instrument
master beyond the top-symbol map. Happy to take any of these next.
