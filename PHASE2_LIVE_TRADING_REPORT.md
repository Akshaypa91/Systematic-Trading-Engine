# SYSTRA — Live Trading Phase 2 Report

**Scope delivered:** real order execution (sandbox-first), full order panel, charges
confirmation modal, and the Live Order Book.
**Still deferred (Phase 3):** live positions/exit, Upstox portfolio & holdings sync,
funds page, full risk engine + kill-switch UI, emergency square-off.

**Guiding constraint (unchanged):** Paper Trading is untouched and fully isolated.
Live order code only runs in LIVE mode; the paper `TradePanel` / sim flow is exactly
as before.

> ⚠️ **Sandbox first.** Order placement routes to Upstox's sandbox host when
> `UPSTOX_SANDBOX=true`. Verify end-to-end there before switching to live.

---

## 1. Files Changed

### Backend
| File | Change |
|---|---|
| `backend/src/services/brokerAdapter.js` | Sandbox vs live host switch (`UPSTOX_SANDBOX`, `UPSTOX_SANDBOX_BASE`, `UPSTOX_SANDBOX_TOKEN`); order calls now use the order host. `placeOrder` extended to full spec (order_type MARKET/LIMIT/SL/SL-M, product CNC/MIS/NRML→D/I, validity DAY/IOC, trigger_price, disclosed_quantity, is_amo). Added `getCharges` (Upstox brokerage API + local estimate fallback) and `isSandbox`. |
| `backend/src/services/liveTradingService.js` | `placeOrder` validates order-type-dependent fields, threads all params to the broker, persists them; `_saveOrder` writes the new columns with a graceful fallback if the migration hasn't run. Added `getCharges`. `getOrders` now returns a **normalized order book** (status buckets + filled qty / avg price / broker id) by merging the live Upstox order book with the DB audit. |
| `backend/src/controllers/liveController.js` | `placeOrder` accepts the full param set; added `getCharges`; broker status now reports `sandbox`. |
| `backend/src/routes/live.js` | Added `POST /live/charges`. |
| `backend/scripts/migrate-live-orders-phase2.sql` | **New.** Additive columns on `live_orders`. |

### Frontend
| File | Change |
|---|---|
| `frontend/src/components/LiveOrderPanel.jsx` | **New.** Real-money order ticket: BUY/SELL, order type, qty, price, trigger, disclosed qty, product, validity, est. value; hands a normalized order up via `onReview`. |
| `frontend/src/components/LiveOrderModal.jsx` | **Rewritten.** Fetches a live charge preview and shows Stock/Exchange/Side/Qty/Type/Value + Brokerage/Exchange/GST/STT/SEBI/Stamp Duty/Total + Approx Total + Margin + risk warning; **Confirm Order** submits. |
| `frontend/src/pages/LiveOrders.jsx` | **New.** Live Order Book: filter by Pending/Completed/Partial/Cancelled/Rejected, avg price, filled qty, broker order id, cancel action, 5s auto-refresh. |
| `frontend/src/pages/Trade.jsx` | In LIVE mode renders `LiveOrderPanel` (paper still uses `TradePanel`); confirm flow sends the full order + shows SANDBOX tag. |
| `frontend/src/components/Sidebar.jsx` | Added **Live Orders** nav item (`/orders`). |
| `frontend/src/App.jsx` | Registered `/orders` route. |
| `frontend/src/services/api.js` | Added `liveAPI.charges`. |

---

## 2. Database Changes

**One additive migration — run before using Phase 2:** `backend/scripts/migrate-live-orders-phase2.sql`

Adds to `live_orders`: `product`, `validity`, `trigger_price`, `disclosed_qty`,
`is_amo`, `filled_qty`, `avg_price`, `exchange`, `exchange_time`, `sandbox`.

All nullable / defaulted → backward compatible. The code **also self-protects**: if the
migration hasn't run yet, `_saveOrder` detects the missing columns and falls back to the
original insert, so nothing breaks — you just don't persist the extra fields until you migrate.

Apply with your existing migrate runner or directly:
```
mysql <conn> < backend/scripts/migrate-live-orders-phase2.sql
```

---

## 3. API Changes (`/api/live`, `requireAuth`)

| Method | Path | Change |
|---|---|---|
| POST | `/live/order` | Now accepts `product, validity, triggerPrice, disclosedQty, isAmo` in addition to `symbol, side, qty, price, orderType, confirmed, currentPrice`. Returns `{ orderId, brokerOrderId, status, orderType, product, sandbox, … }`. |
| POST | `/live/charges` | **New.** Body `{ symbol, side, qty, price, product }` → `{ charges: { source, brokerage, exchange, gst, stt, sebi, stampDuty, total } }`. |
| GET | `/live/orders` | Now returns the **normalized order book** (status buckets, `filledQty`, `avgPrice`, `brokerOrderId`, `sandbox`). |
| GET | `/live/broker/status` | Now includes `sandbox: true|false`. |

---

## 4. Security / Safety Invariants

- **Sandbox isolation.** Order placement/cancel/positions/order-book use `ORDER_BASE`; when `UPSTOX_SANDBOX=true` these hit the sandbox host (and an optional `UPSTOX_SANDBOX_TOKEN`). Market-data reads stay on the live host.
- **Confirmation is mandatory.** `liveTradingService` still requires `confirmed:true`; the UI only sends it after the charges modal's **Confirm Order**.
- **Pre-trade guards (existing, retained + extended):** kill switch, market-hours, max qty (`LIVE_MAX_QTY`), max order value (`LIVE_MAX_ORDER_VAL`), duplicate-order guard, plus new order-type field validation (LIMIT/SL need price, SL/SL-M need trigger, qty>0).
- **Audit trail.** Every attempt (success *and* broker rejection) is written to `live_orders` with the raw broker response; `auditLog('live.order_placed', …)` records placement.
- **Paper isolation.** LIVE order code paths are gated on `tradingMode === 'LIVE'` and a connected broker; PAPER continues to use the sim engine / `manualTradeAPI` untouched.

---

## 5. Risk Controls

- **Present now:** confirmation modal, qty/value caps, duplicate guard, market-hours + kill-switch checks, sandbox routing, full audit.
- **Deferred to Phase 3:** daily-loss limit enforcement on live P&L, max exposure / max open positions / max orders-per-day, kill-switch **UI**, emergency square-off / cancel-all. Backend `riskManager.js` already has the sizing + `validateTrade` primitives to wire in.

---

## 6. Testing Steps (sandbox)

1. **Migrate:** run `migrate-live-orders-phase2.sql`.
2. **Enable sandbox:** set `UPSTOX_SANDBOX=true` (+ `UPSTOX_SANDBOX_TOKEN` if you have a sandbox token) and restart backend. `GET /api/live/broker/status` → `sandbox:true`.
3. **Charges preview:** `POST /api/live/charges { "symbol":"RELIANCE","side":"BUY","qty":1,"price":2900,"product":"CNC" }` → breakdown with `source: UPSTOX` (or `ESTIMATE` if the charges API is unavailable).
4. **Place (sandbox):** switch UI to LIVE, search a symbol, fill the order ticket, click **Review** → confirm. Expect a success toast with **(SANDBOX)** and a row in **Live Orders**.
   - ⚠️ **Verify the broker order-book field names** against your sandbox response. `getOrders` reads `order_id`, `status`, `filled_quantity`, `average_price`, `exchange`, `exchange_timestamp`. If your payload differs, send me one order object and I'll adjust the mapping.
5. **Order book:** `/orders` shows the order; filters and Cancel (on PENDING) work.
6. **Rejection path:** place an invalid order (e.g. qty over `LIVE_MAX_QTY`) → rejected, and it still appears in the book with status REJECTED.
7. **Paper regression:** switch to PAPER → the ticket reverts to the normal paper `TradePanel`; place a paper order, reset portfolio — unchanged.

**Automated checks run:** backend `node --check` (pass), ESLint (0 errors), `vite build` (pass).

---

## 7. Deployment Instructions

**Render (backend) env — Phase 2 additions:**
```
UPSTOX_SANDBOX=true                     # flip to false only after sandbox sign-off
UPSTOX_SANDBOX_BASE=https://api-sandbox.upstox.com/v2   # default; override if needed
UPSTOX_SANDBOX_TOKEN=<sandbox token>    # optional; else the normal token is used
# risk caps (optional overrides)
LIVE_MAX_QTY=500
LIVE_MAX_ORDER_VAL=500000
```
(Phase 1 vars `UPSTOX_API_KEY/SECRET/REDIRECT_URI` still required for auth + market data.)

1. Run the migration on your TiDB/MySQL database.
2. Deploy backend + frontend from `main`.
3. Keep `UPSTOX_SANDBOX=true` until you've completed the sandbox test checklist above.
4. **Go-live:** set `UPSTOX_SANDBOX=false`, restart. From that point every confirmed order is a **real trade**.

**Git:** committed locally — run `git push origin main` (no push credentials in this environment).

---

## 8. Deferred to Phase 3

Live positions page (current qty, avg, LTP, day/overall P&L, MTM, exit), Upstox
portfolio/holdings sync, funds page (cash/used margin/collateral/buying power), full
risk engine + kill-switch UI, and the emergency panel (stop / exit-all / cancel-all /
square-off). Say the word and I'll take it.
