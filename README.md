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
| Market data | Upstox REST poller → Upstox REST snapshot → NSE → TwelveData/Finnhub → SIM |

---

## Architecture

```
                         React SPA (Vite / Vercel)
   Dashboard · Trade · Live Trading · Live Orders · Portfolio · Signals
   Screener · Backtest · Analytics · Journal · Diagnostics
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
   │  Paper: simulationEngine + virtual portfolio               │
   │  Live:  brokerAdapter (Upstox) + liveTradingService        │
   │  riskManager · riskLimits · auditLog · scheduler · alerts  │
   └────────────┬──────────────────────────────────────────────┘
                │
        ┌───────▼────────┐
        │  TiDB (MySQL)  │
        └────────────────┘
```

---

## Market data — provider priority

When a broker session is live, **simulated prices are never shown**. Resolution order per symbol:

1. **Upstox WebSocket cache** (primary, when the WS is streaming)
2. **Upstox REST poller** (`upstoxRestFeed`) — batch `market-quote/quotes` every ~1.5s (the reliable primary in practice)
3. **Upstox REST snapshot** — on-demand `market-quote/ltp`
4. **NSE** direct
5. **TwelveData / Finnhub** (if API keys set)
6. **Cached** last-known real value
7. **SIM** — *only* when no broker session exists (paper / logged-out demo)

A **full NSE instrument master** (`instrumentMaster.js`) is loaded at boot so any NSE equity symbol resolves to its Upstox `instrument_key`, not just a hardcoded shortlist.

> Note on the Upstox WebSocket: the v2 market-data WS requires an `/authorize` handshake + Protobuf decoding. This build drives live prices from **REST polling** instead (uses the same token as funds/profile), which is why the `Diagnostics` page reports the active provider as `UPSTOX_REST`.

---

## Live trading (Upstox)

- **Broker connection** — OAuth login, encrypted token persistence (AES-256-GCM in `system_flags`) so a restart keeps the session; Broker Status Card with client ID, account, segment, funds, token expiry.
- **Mode selector** — global PAPER (blue) / LIVE (green); LIVE is disabled unless the broker is connected.
- **Order entry** — Market / Limit / SL / SL-M, product (CNC/MIS/NRML), validity (DAY/IOC/AMO), trigger + disclosed qty, with a **charges confirmation modal** (brokerage, exchange, GST, STT, SEBI, stamp duty, approx total, margin).
- **Order book** — pending / completed / partial / cancelled / rejected with avg price, filled qty, broker order id, and cancel.
- **Portfolio** — live positions (with one-tap exit), funds (cash/margin/collateral/buying power), holdings + allocation.
- **Risk & emergency** — configurable limits (daily loss, max exposure, max position size, max orders/day), kill switch, and Exit All / Cancel All / Emergency Stop.
- **Diagnostics** — `/diagnostics` page + `GET /api/live/diagnostics`: WS/REST status, tick rate, latency, subscribed symbols, reconnect count, active provider.
- **Audit** — every order request/response, exit, cancel, risk change, and kill-switch toggle is recorded.

**Paper trading is fully isolated** — it uses the simulation engine and virtual portfolio, and is never touched by the live path.

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
npm run dev                   # http://localhost:3000  (WS: /ws)

# Frontend (separate terminal)
cd ../frontend
npm install
npm run dev                   # http://localhost:5173
```

---

## Selected API (all under `/api`)

**Auth / broker:** `GET /auth/upstox/login`, `GET /auth/upstox/callback`, `POST /auth/upstox/logout`

**Market data:** `GET /data/quote/:symbol`, `/data/historical/:symbol`, `/data/nifty50`, `/data/market-status`, `/data/health`

**Signals / research:** `GET /signal/:symbol?strategy=AGGREGATED`, `POST /backtest`, `GET /screener`, `POST /analytics/optimize`

**Paper trading:** `POST /trade/order`, `GET /trade/portfolio`, `GET /sim/signals`, `GET /sim/portfolio`

**Live trading:**
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/live/broker/status` | Broker card (profile, funds, WS, token) |
| POST | `/live/broker/reconnect` \| `/disconnect` \| `/refresh` | Connection mgmt |
| POST | `/live/order` | Place order (real / sandbox) |
| POST | `/live/charges` | Brokerage/tax preview |
| GET | `/live/orders` | Normalized order book |
| GET | `/live/positions` · `POST /live/positions/exit` | Positions + square-off one |
| GET | `/live/funds/normalized` · `/live/holdings` | Funds + holdings |
| GET/PUT | `/live/risk` | Risk limits |
| POST | `/live/kill-switch` · `/live/emergency/{stop,square-off,cancel-all}` | Safety controls |
| GET | `/live/diagnostics` | Real-time market-data diagnostics |

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
UPSTOX_TOKEN_SECRET=<random>        # encrypts the persisted token (falls back to JWT_SECRET)

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
- Upstox tokens expire ~03:30 IST; re-run `/api/auth/upstox/login` each trading day (the encrypted token then persists across restarts). Flip `UPSTOX_SANDBOX=false` only after sandbox sign-off.

---

## Project layout

```
backend/src/
  app.js                     entry (boots WS feed, sim engine, Upstox feed)
  config/         constants, database, logger, symbols, instrument map
  data/           liveDataFeed (WS), upstoxRestFeed, instrumentMaster,
                  nseFetcher, dataStore
  services/       marketDataService, brokerAdapter, liveTradingService,
                  upstoxAuth (encrypted token persistence)
  engine/         simulationEngine, signalEngine, backtester, ...
  risk/           riskManager, riskLimits
  ws/             upstoxWS (v2 scaffold)
  controllers/ routes/ middleware/   REST layer + auth + rate limiting
  scripts/        schema.sql, migrate.js, run-sql.js, migrate-live-orders-phase2.sql
frontend/src/
  pages/          Dashboard, Trade, LiveTrading, LiveOrders, LivePortfolio,
                  Signals, Screener, Backtest, Analytics, Diagnostics, ...
  components/     BrokerStatusCard, LiveOrderPanel/Modal, RiskEmergencyPanel,
                  TradingModeToggle, Sidebar, StatusBar, ...
  context/        AuthContext, WSContext, TradingModeContext
  services/api.js hooks/  utils/
```

----

## Disclaimer

**LIVE mode executes real-money orders through your connected Upstox account.** This software is provided for educational and research purposes, without warranty of any kind. Charges shown are estimates and may differ from your broker's contract note. Always validate against the Upstox **sandbox** before trading live. The authors are not registered investment advisors; nothing here is financial advice. Trading involves substantial risk of loss — you are solely responsible for orders placed through this system.
