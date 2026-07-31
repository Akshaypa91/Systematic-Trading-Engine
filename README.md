# SYSTRA — Systematic Trading Engine

A full-stack, **mathematics-first** algorithmic trading platform for the Indian market (NSE/BSE). Every signal is derived from statistics and rules — no black-box AI. It runs two fully isolated modes:

- **Paper Trading** — a built-in simulation engine and virtual portfolio (no broker required).
- **Live Trading** — real-money execution through **Upstox** (OAuth), with sandbox-first order placement, charges preview, order book, positions, funds, risk limits, and emergency controls.

> ⚠️ **Real money is involved in LIVE mode.** See the Disclaimer at the bottom. Keep `UPSTOX_SANDBOX=true` until you have verified order placement end-to-end.

Live demo (frontend): `systematic-trading-engine.vercel.app` · Backend: Render · Database: TiDB Cloud.

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React + Vite (SPA), deployed on Vercel |
| Backend | Node.js + Express, WebSocket (`/ws`), deployed on Render |
| Database | TiDB Cloud (MySQL-compatible) via `mysql2` |
| Auth | Google login + JWT |
| Broker | Upstox v2 (OAuth, orders, funds, positions, holdings) |
| Market data | Upstox REST poller → Upstox REST snapshot → NSE → TwelveData/Finnhub → `UNAVAILABLE` |
| Tests | 25 offline suites, 358 assertions, gated in CI (`npm run test:unit`) |

---

## Architecture

```
                         React SPA (Vite / Vercel)
   Dashboard · Trade · Paper Engine · Live Orders · Portfolio · Signals
   Screener · Backtest · Analytics · Swing · Spread · Scalper
   Journal · Execution · Diagnostics
                    │  REST (axios)          │  WebSocket  /ws
        ┌───────────▼────────────────────────▼───────────┐
        │              Express API (Render)               │
        │  auth · data · signal · backtest · trade · sim  │
        │  live (broker/orders/positions/risk) · screener │
        └───────┬───────────────────────┬────────────────┘
                │                        │
   ┌────────────▼─────────┐   ┌──────────▼───────────────────────┐
   │   Strategy Engine     │   │        Market Data               │
   │   Mean Reversion      │   │  upstoxRestFeed (batch poller)   │
   │   MA Crossover        │   │  instrumentMaster (full NSE map) │
   │   RSI (Wilder)        │   │  marketDataService (provider     │
   │   Bollinger Bands     │   │   priority + cache)              │
   │   Aggregator          │   │  liveDataFeed (WS broadcast)     │
   └────────────┬──────────┘   └──────────────────────────────────┘
                │
   ┌────────────▼──────────────────────────────────────────────┐
   │                     Execution Layer                        │
   │  Paper: autoPaperTrader on the DB portfolio                │
   │  Live:  brokerAdapter (Upstox) + liveExecutionEngine       │
   │  orderLifecycle (state machine) · positionSizing           │
   │  requireBrokerOwner · riskLimits · auditLog · scheduler    │
   └────────────┬──────────────────────────────────────────────┘
                │
        ┌───────▼────────┐
        │  TiDB (MySQL)  │
        └────────────────┘
```

---

## Market data — provider priority

**Prices are never fabricated.** Resolution order per symbol:

1. **Upstox WebSocket cache** (primary, when the WS is streaming)
2. **Upstox REST poller** (`upstoxRestFeed`) — batch `market-quote/quotes` every ~1.5s (the reliable primary in practice)
3. **Upstox REST snapshot** — on-demand `market-quote/ltp`
4. **NSE** direct
5. **TwelveData / Finnhub** (if API keys set)
6. **Cached** last-known real value, flagged `stale`
7. **`UNAVAILABLE`** — the chain ends here. No synthetic price is produced.

Every price carries a source, and the UI renders it: `LIVE` (real-time quote), `STALE` (real but the feed has stopped updating), `LAST_CLOSE` (computed on the last stored close — no broker connected), or `NO DATA`. `POST /api/signal/:symbol` returns **503 `NO_MARKET_DATA`** rather than a signal when fewer than 60 real bars exist, and symbols with no stored history are excluded from the signal loop and listed under **Data Gaps** in `/diagnostics`.

<details>
<summary><b>Why this is worth calling out</b></summary>

An earlier build had three independent fallbacks that generated prices — a random walk in `marketDataService`, a 250-bar generated history per symbol in `simulationEngine`, and a `SIM_FALLBACK` branch in the signal controller that returned a complete indicator set computed over that walk. With Upstox disconnected the dashboard showed RELIANCE at ₹2,845.25, RSI 100.0, and a Bollinger band of ₹516–₹2,379, while the stock actually traded near ₹1,293. Each number was correctly computed and entirely fictional, and the only marker was a small `SIM` badge.

The failure mode is that a system which always produces an answer cannot tell you when it doesn't have one. Fabricated data also propagates: the auto-trader marked positions against it, the equity curve moved on it, and P&L was computed from it. The fix was to make "I don't know" a first-class return value throughout — `{ price: null, source: 'UNAVAILABLE' }` — and let every consumer handle it explicitly. `ALLOW_SIM_PRICES=true` re-enables generation for offline UI work only; it is off by default and `scripts/test-no-fake-prices.js` pins the behaviour in CI.

</details>

A **full NSE instrument master** (`instrumentMaster.js`) is loaded at boot so any NSE equity symbol resolves to its Upstox `instrument_key`, not just a hardcoded shortlist.

> Note on the Upstox WebSocket: the v2 market-data WS requires an `/authorize` handshake + Protobuf decoding. This build drives live prices from **REST polling** instead (uses the same token as funds/profile), which is why the `Diagnostics` page reports the active provider as `UPSTOX_REST`.

---

## Security — the broker session has an owner

Every route that touches the **linked broker account** — funds, holdings, positions, order book, order placement, exits, cancels — is gated behind `requireBrokerOwner`, which checks that the caller *is the user who linked that account*. Authentication and authorisation are separate questions, and only the second one protects money.

- The Upstox OAuth flow carries an **HMAC-signed `state`** (10-minute TTL) binding the link to the user who started it. Tampering with the encoded user id or replaying an old `state` both fail verification.
- The access token is persisted **with its owner** (AES-256-GCM, in `system_flags`).
- **Fail-closed by construction:** no token → `409`; a token with no recorded owner (env-injected, or persisted before ownership tracking existed) → `403` for *everyone*; a mismatched user → `403`. The refusal body contains neither the token nor the owner's id.
- `GET /live/broker/status` reports `connected: false` to non-owners plus a `linkedByOther` flag, so the UI can say "someone else has linked a broker here" without leaking whose or what is in it.
- Market-data routes are deliberately **not** gated — a price is not account data, and background jobs have no request context.

<details>
<summary><b>The bug this closes</b></summary>

The Upstox token was a single process-wide value with no recorded owner, and the `/api/live` routes only applied `requireAuth` — i.e. *"is somebody logged in"*, never *"is this their account"*. Two different logins therefore rendered the same client ID, the same account-holder name and the same ₹ balance, and `POST /api/live/order` would have placed a **real order on whoever linked Upstox last**.

The root cause was in the UI, not the API: "Connect Upstox" was a plain `<a href=".../upstox/login">`. An anchor sends no `Authorization` header, so the server never knew who was linking, and the resulting session belonged to nobody. Raising checks inside the controllers would not have fixed that — the identity had to be established at the start of the OAuth flow, which is why the connect button now goes through an authenticated request that returns a signed authorize URL.

`scripts/test-broker-ownership.js` pins the behaviour with 42 assertions, including that a non-owner is blocked at the route boundary and that the 403 leaks nothing. One of those tests caught a bug in the fix itself: `Number(null)` is `0` and `Number.isFinite(0)` is `true`, so a naive coercion quietly turned "no owner" into "user 0".

</details>

---

## Live trading (Upstox)

- **Broker connection** — OAuth login with signed, user-bound `state`; encrypted token persistence (AES-256-GCM in `system_flags`) so a restart keeps the session; Broker Status Card with client ID, account, segment, funds, token expiry.
- **Mode selector** — global PAPER (blue) / LIVE (green); LIVE is disabled unless the broker is connected.
- **Order entry** — Market / Limit / SL / SL-M, product (CNC/MIS/NRML), validity (DAY/IOC/AMO), trigger + disclosed qty, with a **charges confirmation modal** (brokerage, exchange, GST, STT, SEBI, stamp duty, approx total, margin).
- **Order book** — pending / completed / partial / cancelled / rejected with avg price, filled qty, broker order id, and cancel.
- **Portfolio** — live positions (with one-tap exit), funds (cash/margin/collateral/buying power), holdings + allocation.
- **Risk & emergency** — configurable limits (daily loss, max exposure, max position size, max orders/day), kill switch, and Exit All / Cancel All / Emergency Stop.
- **Diagnostics** — `/diagnostics` page + `GET /api/live/diagnostics`: WS/REST status, tick rate, latency, subscribed symbols, reconnect count, active provider.
- **Audit** — every order request/response, exit, cancel, risk change, and kill-switch toggle is recorded.

**Paper trading is fully isolated** — it uses the simulation engine and virtual portfolio, and is never touched by the live path.

---

## Strategy scoring — does the scanner actually work?

The swing scanner records every breakout it finds (entry / SL / T1 / T2, deduped per day). `swingOutcomes.js` then walks the **real daily bars that came after** each signal and scores it, so the strategy can be measured instead of admired. `GET /api/swing/performance` returns monthly win rate, expectancy and open counts; a scheduler job re-checks unresolved signals every 12h.

Two decisions here matter more than the code:

**Win rate is never shown alone.** These signals run a reward:risk below 1 (roughly 0.87:1), which needs a **53.6% win rate just to break even**. A "60% win rate" headline would be actively misleading, so every view pairs win rate with the breakeven rate implied by the actual payoff, and with **expectancy in R** — the number that decides whether the strategy makes money.

**Same-bar ambiguity resolves against us.** When a single daily bar's high reaches the target *and* its low reaches the stop, daily data cannot prove which came first. Those are always scored as **stops**. Assuming the target is exactly how a backtest manufactures an edge that dies in production.

**The holding window is one trading week** (`SWING_HORIZON_BARS=5`). A fresh-breakout setup is a momentum bet: if the move has not started within days, the reason for the entry is gone. A longer window flatters the strategy by letting stale positions wander into their targets weeks later — returns nobody following the rules would have captured.

Signals still inside that window are counted separately and **excluded from win rate** — neither banked as wins nor written off as losses. Below 30 resolved trades the UI states plainly that the sample is too small to conclude anything, rather than printing a percentage to one decimal place. Changing the horizon invalidates previously recorded outcomes, so the **Re-score** button rebuilds the whole table rather than topping up undecided rows.

---

## Quick start (local)

```bash
git clone <repo> && cd "Systematic Trading Engine"

# Backend
cd backend
npm install
cp .env.example .env          # fill DB + Upstox vars (see below)
node scripts/migrate.js       # base schema
node scripts/run-sql.js scripts/migrate-live-orders-phase2.sql   # live-orders columns
node scripts/backfill-history.js   # REAL 5y daily OHLCV (Yahoo, no broker needed)
npm run dev                   # http://localhost:3000  (WS: /ws)

# Frontend (separate terminal)
cd ../frontend
npm install
npm run dev                   # http://localhost:5173
```

**Run the backfill.** Signals, backtests and the paper trader all compute on stored closes, so with an empty `daily_prices` the app correctly reports `NO_MARKET_DATA` and shows empty states — it will not invent numbers to fill the screen. `backfill-history.js` is idempotent (upsert on `symbol, exchange, date`), so re-running it refreshes rather than duplicates.

> `scripts/reseed-prices.js` is retired and refuses to run. It used to seed a generated random walk, which was survivable when stored prices were demo dressing and is poison now that they are treated as ground truth.

### Tests

```bash
cd backend && npm run test:unit    # 25 suites · 358 assertions · no network, no DB
```

Every money-path guard is covered: order lifecycle transitions, position sizing, live-order risk checks, the arm interlock, broker ownership, price fabrication, and swing scoring. They run offline so CI never depends on a broker session or market hours.

---

## Selected API (all under `/api`)

**Auth / broker:** `GET /auth/upstox/link` *(authenticated — returns a signed authorize URL)*, `GET /auth/upstox/callback`, `POST /auth/upstox/logout`

**Market data:** `GET /data/quote/:symbol`, `/data/historical/:symbol`, `/data/indices` *(NIFTY/SENSEX/BANKNIFTY)*, `/data/last-closes?symbols=` *(watchlist from stored closes + day change)*, `/data/nifty50`, `/data/market-status`, `/data/health`

**Signals / research:** `GET /signal/:symbol?strategy=AGGREGATED` *(503 `NO_MARKET_DATA` below 60 real bars)*, `POST /backtest`, `GET /screener`, `POST /analytics/optimize`, `GET /swing/performance?refresh=1` *(monthly win rate + expectancy)*

**Paper trading:** `POST /trade/order`, `GET /trade/portfolio`, `GET /sim/signals`, `GET /sim/portfolio`

**Live trading** — 🔒 marks routes that additionally require `requireBrokerOwner`; being logged in is not enough.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/live/broker/status` | Broker card; reports `connected:false` + `linkedByOther` to non-owners |
| POST | 🔒 `/live/broker/reconnect` \| `/disconnect` \| `/refresh` | Connection mgmt |
| POST | 🔒 `/live/order` | Place order (real / sandbox) |
| POST | `/live/charges` | Brokerage/tax preview (pure calculator, no account data) |
| GET | 🔒 `/live/orders` | Normalized order book |
| GET | 🔒 `/live/positions` · `POST 🔒 /live/positions/exit` | Positions + square-off one |
| GET | 🔒 `/live/funds/normalized` · 🔒 `/live/holdings` | Funds + holdings |
| GET/PUT | `/live/risk` | Risk limits (deployment-wide; tightening can only reduce risk) |
| POST | `/live/kill-switch` · 🔒 `/live/emergency/{square-off,cancel-all}` | Safety controls |
| GET | `/live/diagnostics` | Market-data diagnostics, latency budget, **Data Gaps** |

**WebSocket** `ws://host/ws` — subscribe `{ "action":"SUBSCRIBE", "symbols":["RELIANCE"] }`; server pushes `PRICE`, `SIM_TICK`, `SIM_TRADE`, `LIVE_SIGNAL`, `ALERT`.

---

## Strategy mathematics

**Mean Reversion** — `Z = (P − μ₂₀)/σ₂₀`; BUY `Z < −2`, SELL `Z > +2`; confidence `min(|Z|/3, 1)`.
**MA Crossover** — Golden/Death cross of SMA(50)/SMA(200); confidence `clamp(|gap%|/5%, 0, 1)`.
**RSI (Wilder, 14)** — BUY `RSI < 30`, SELL `RSI > 70`; confidence `|RSI−50|/30`.
**Bollinger Bands (20, 2σ)** — BUY at/below lower band, SELL at/above upper band.
**Aggregator** — `score = Σ(dir·conf·w)/Σw`; BUY `> 0.20`, SELL `< −0.20` (weights MR .35 / MA .35 / RSI .30).

**Position sizing** — Fixed-fractional `qty = ⌊(capital·riskPct)/(entry·slPct)⌋`; half-Kelly optional.

**Backtest metrics** — CAGR, Sharpe, Sortino, Calmar, Max Drawdown, Profit Factor. Walk-forward optimisation (IS/OOS windows) guards against curve-fitting.

**Costs are modelled, not waved away** — brokerage, STT, exchange charges, GST 18%, stamp duty, and 20% STCG on intraday. Backtests report **gross → cost drag → net**, because a strategy that only works before frictions does not work.

---

## Research findings

The point of building this was to find out whether the strategies work. Two results are worth stating plainly, because both are negative and both changed what got built:

**Walk-forward validation: buy & hold won 3 of 3 out-of-sample folds.** None of the tested strategies — mean reversion, MA crossover, RSI, trend following, cross-sectional momentum — beat holding the index once tested on data they were not fitted on. Test enough strategies and one will look profitable by chance; rolling out-of-sample folds are how you tell the difference. The finding is reported rather than tuned away (`scripts/walk-forward.js`).

**Measured reaction latency: ~4.9 seconds.** Feed staleness + signal compute + order round-trip, instrumented end to end (`utils/latencyMonitor`, surfaced on `/diagnostics`). That is roughly five orders of magnitude off real HFT, which is why the "microsecond execution" idea was formally ruled out instead of half-built. The NSE–BSE spread monitor that came out of that work is read-only: it measures the gap and the round-trip cost required to capture it, and places no orders.

---

## Environment variables

```bash
# ── Server ──
PORT=3000
NODE_ENV=production
FRONTEND_URL=https://systematic-trading-engine.vercel.app
JWT_SECRET=<random>

# ── Database (TiDB / MySQL) ──
TIDB_HOST=...      TIDB_PORT=4000     TIDB_USERNAME=...
TIDB_PASSWORD=...  TIDB_DATABASE=...  TIDB_SSL_CA=...
# or DATABASE_URL=mysql://...

# ── Upstox (live trading + market data) ──
UPSTOX_API_KEY=...
UPSTOX_API_SECRET=...
UPSTOX_REDIRECT_URI=https://<backend>/api/auth/upstox/callback
UPSTOX_SANDBOX=true                 # keep true until sandbox-verified
UPSTOX_SANDBOX_TOKEN=               # optional dedicated sandbox token
UPSTOX_TOKEN_SECRET=<random>        # encrypts the persisted token + signs OAuth state (falls back to JWT_SECRET)

# ── Data integrity ──
ALLOW_SIM_PRICES=false              # leave false. true generates synthetic prices
                                    # that are visually indistinguishable from quotes;
                                    # for offline UI work only.
CORP_ACTION_ADJUST=true             # back-adjust bonuses/splits at the data layer

# ── Live risk limits (defaults; overridable in the UI) ──
LIVE_MAX_QTY=500
LIVE_MAX_ORDER_VAL=500000
LIVE_MAX_POSITION_SIZE=200000
LIVE_MAX_EXPOSURE=1000000
LIVE_DAILY_LOSS_LIMIT=25000
LIVE_MAX_ORDERS_PER_DAY=50

# ── Frontend (Vite) ──
VITE_API_URL=https://<backend>/api
VITE_WS_URL=wss://<backend>
```

Optional market-data keys: `TWELVEDATA_API_KEY`, `FINNHUB_API_KEY`.

---

## Deployment

- **Frontend → Vercel:** set `VITE_API_URL` / `VITE_WS_URL`; auto-deploys from `main`.
- **Backend → Render:** set all server + Upstox + DB env vars; auto-deploys from `main`. Run the `live_orders` migration once (`scripts/run-sql.js`).
- **Database → TiDB Cloud.**
- Upstox tokens expire ~03:30 IST; reconnect from the app each trading day using the **Connect Upstox** button (the encrypted token then persists across restarts). Do not bookmark the raw `/auth/upstox/login` URL — it carries no user identity and is refused. Flip `UPSTOX_SANDBOX=false` only after sandbox sign-off.
- Run `node scripts/backfill-history.js` against the deployed database once, or signals and backtests will correctly report no data.

---

## Known limitations

- **One broker session per deployment.** The token is a single owned value, not a per-user table. A second user cannot see or use the first user's account (that is enforced), but they cannot link their own alongside it either — they must wait for the session to be cleared. Per-user `broker_accounts` rows are the next step; the table already exists.
- **SEBI's retail algo framework** (mandatory from 1 April 2026) requires exchange-issued Algo IDs, broker registration and static IP whitelisting. This build satisfies none of those, so LIVE mode is for personal sandbox/manual use, not distribution.
- **Free-tier hosting sleeps.** Render cold starts reset in-memory tick counters and pause the execution loop; `/diagnostics` surfaces process uptime so a restart is visible rather than inferred.
- **No strategy here has a demonstrated edge.** See Research findings. Paper trading is the intended use.

---

## Project layout

```
backend/src/
  app.js                     entry (boots WS feed, sim engine, Upstox feed)
  config/         constants, database, logger, symbols, instrument map
  data/           liveDataFeed (WS), upstoxRestFeed, instrumentMaster,
                  nseFetcher, dataStore
  services/       marketDataService, brokerAdapter, liveTradingService,
                  upstoxAuth (encrypted token + ownership + signed OAuth state),
                  swingScanService, swingOutcomes (strategy scoring),
                  crossExchangeSpread, executionQuality
  engine/         strategyCore (one evaluation path for backtest/paper/live),
                  simulationEngine, signalEngine, backtester,
                  liveExecutionEngine, orderLifecycle, autoPaperTrader,
                  intradayBacktester, portfolioBacktester, scheduler
  risk/           riskManager, riskLimits, positionSizing, positionTargets
  ws/             upstoxWS (v2 + protobuf decode)
  middleware/     authMiddleware, brokerOwner (account authorisation), rbac,
                  rateLimiter
  controllers/ routes/            REST layer
  scripts/        migrate.js, run-sql.js, backfill-history.js,
                  walk-forward.js, ci-tests.js + 25 offline test suites
frontend/src/
  pages/          Dashboard, Trade, LiveTrading, LiveOrders, LivePortfolio,
                  Signals, Screener, Backtest, Analytics, SwingStrategy,
                  SpreadMonitor, IntradayScalper, TradeJournal, Diagnostics
  components/     BrokerStatusCard, ConnectUpstoxButton, LiveOrderPanel/Modal,
                  RiskEmergencyPanel, IndicesStrip, MarketWatch,
                  SwingPerformance, SignalsPanel, Sidebar, StatusBar, ...
  context/        AuthContext, WSContext, TradingModeContext, ThemeContext
  services/api.js hooks/  utils/
```

----

## Disclaimer

**LIVE mode executes real-money orders through your connected Upstox account.** This software is provided for educational and research purposes, without warranty of any kind. Charges shown are estimates and may differ from your broker's contract note. Always validate against the Upstox **sandbox** before trading live. The authors are not registered investment advisors; nothing here is financial advice. Trading involves substantial risk of loss — you are solely responsible for orders placed through this system.

## Author

**Akshay Pagare** — creator of SYSTRA and the ADP Way swing strategy.

- GitHub: [github.com/Akshaypa91](https://github.com/Akshaypa91)
- LinkedIn: [linkedin.com/in/akshaypagare](https://www.linkedin.com/in/akshaypagare91)
