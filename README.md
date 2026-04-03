# Systematic Trading Engine — NSE/BSE

A production-grade, **mathematics-first** algorithmic trading engine for the Indian stock market, built in Node.js. Every signal is derived from statistics and rules — no black-box AI, no speculation.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   REST API  (Express)                │
│         30 endpoints  +  WebSocket /ws               │
└──────────────┬──────────────────────┬───────────────┘
               │                      │
    ┌──────────▼──────┐    ┌─────────▼──────────┐
    │  Strategy Engine│    │   Data Engine       │
    │  ─────────────  │    │  ──────────────     │
    │  Mean Reversion │    │  NSE Fetcher        │
    │  MA Crossover   │    │  (cookie + retry +  │
    │  RSI (Wilder)   │    │   token bucket)     │
    │  Bollinger Bands│    │  MySQL DataStore    │
    │  Aggregator     │    │  Live WS Feed       │
    └──────────┬──────┘    └─────────────────────┘
               │
    ┌──────────▼──────────────────────────────────┐
    │              Execution Layer                  │
    │  Risk Manager   Backtester   Paper Trader    │
    │  Walk-Forward   Alerts       Scheduler       │
    │  Portfolio Analytics  Correlation Analysis   │
    └─────────────────────────────────────────────┘
               │
    ┌──────────▼──────────┐
    │   MySQL Database     │
    │  9 tables, IST TZ    │
    └─────────────────────┘
```

---

## Quick Start

```bash
# 1. Clone and install
git clone <repo>
cd trading-engine
npm install

# 2. Configure
cp .env.example .env
# Edit .env — set DB_HOST, DB_USER, DB_PASSWORD

# 3. Create database tables
node scripts/migrate.js

# 4. Seed sample data (GBM synthetic — no NSE login needed)
node scripts/seed-sample-data.js
node sc
# 5. Verify everything works
node tests/run-tests.js       # 131 tests, 0 external deps

# 6. Run the sample backtest report
node scripts/run-sample-backtest.js

# 7. Start the server
node src/app.js
# → HTTP:  http://localhost:3000/health
# → WS:    ws://localhost:3000/ws
# → Docs:  http://localhost:3000/api/info
```

---

## API Reference

### Data
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/data/quote/:symbol` | Live quote from NSE |
| GET | `/api/data/historical/:symbol?from=DD-MM-YYYY&to=DD-MM-YYYY` | Historical OHLCV |
| POST | `/api/data/fetch-and-store/:symbol` | Fetch + persist to DB |
| GET | `/api/data/prices/:symbol?limit=200` | Prices from DB |
| GET | `/api/data/nifty50` | All NIFTY 50 quotes |
| GET | `/api/data/market-status` | NSE market open/closed |

### Signals
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/signal/:symbol?strategy=AGGREGATED` | Generate signal |
| GET | `/api/signal/describe` | Strategy parameter docs |
| GET | `/api/signal/history/:symbol` | Past signals from DB |

Supported strategies: `AGGREGATED`, `MEAN_REVERSION`, `MA_CROSSOVER`, `RSI`, `BB`

### Backtesting
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/backtest` | Run backtest |
| GET | `/api/backtest/runs` | List past runs |
| GET | `/api/backtest/runs/:runId/trades` | Trades for a run |

**Backtest request body:**
```json
{
  "symbol": "RELIANCE",
  "strategy": "AGGREGATED",
  "initialCapital": 1000000,
  "stopLossPct": 0.02,
  "takeProfitPct": 0.04,
  "riskPerTrade": 0.01,
  "aggrMethod": "weighted"
}
```

### Paper Trading
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/trade/order` | Place paper order |
| GET | `/api/trade/portfolio` | Current positions |
| GET | `/api/trade/orders` | Order history |
| POST | `/api/trade/check-exits` | Check SL/TP hits |
| POST | `/api/trade/size` | Compute position size |

### Screener
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/screener?topN=10&filter=BUY_CANDIDATES` | Screen NIFTY 50 |
| GET | `/api/screener/score/:symbol` | Score single symbol |

### Analytics & Optimiser
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/analytics/backtest/:runId` | Deep trade analytics |
| GET | `/api/analytics/portfolio` | Live P&L analytics |
| POST | `/api/analytics/optimize` | Walk-forward optimisation |
| GET | `/api/analytics/optimizer/grids` | Parameter grids |
| POST | `/api/analytics/alerts` | Create alert rule |
| GET | `/api/analytics/alerts/recent` | Recent fired alerts |
| GET | `/api/scheduler/status` | Scheduler job status |

### WebSocket — `ws://host/ws`
```json
// Subscribe
{ "action": "SUBSCRIBE", "symbols": ["RELIANCE", "INFY"] }

// Get signal on demand
{ "action": "GET_SIGNAL", "symbol": "RELIANCE" }

// Heartbeat
{ "action": "PING" }
```
Server pushes: `PRICE`, `SIGNAL`, `ALERT`, `POSITION_CLOSED`, `PONG`

---

## Mathematics

### Mean Reversion
```
Z = (P_t − μ_N) / σ_N
BUY  when Z < −2  (price 2σ below 20-day mean)
SELL when Z > +2  (price 2σ above 20-day mean)
Confidence = min(|Z| / 3, 1.0)
```

### MA Crossover
```
SMA_N(t) = (1/N) Σ P_{t-i}
Golden Cross: SMA_50 crosses above SMA_200 → BUY
Death  Cross: SMA_50 crosses below SMA_200 → SELL
Confidence = clamp(|gap%| / 5%, 0, 1)
```

### RSI (Wilder)
```
AvgGain_t = (AvgGain_{t-1} × 13 + Gain_t) / 14
RS = AvgGain / AvgLoss
RSI = 100 − 100 / (1 + RS)
BUY  when RSI < 30,   SELL when RSI > 70
Confidence = |RSI − 50| / 30
```

### Bollinger Bands
```
MB = SMA_20,   UB = MB + 2σ,   LB = MB − 2σ
%B = (Price − LB) / (UB − LB)
BUY when Price ≤ LB (%B ≤ 0),  SELL when Price ≥ UB (%B ≥ 1)
```

### Aggregator (Weighted Score)
```
score = Σ (direction_i × confidence_i × weight_i) / Σ weight_i
BUY  when score > 0.20
SELL when score < −0.20
Weights: MeanReversion=0.35, MACrossover=0.35, RSI=0.30
```

### Position Sizing
```
Fixed Fractional:
  qty = floor((capital × riskPct) / (entryPrice × stopLossPct))

Kelly Criterion (half-Kelly):
  f* = (p × B − q) / B   where B = avgWin/avgLoss
  qty = floor(capital × f* × 0.5 / entryPrice)
```

### Backtest Metrics
| Metric | Formula |
|--------|---------|
| CAGR | `(finalCapital/initialCapital)^(1/years) − 1` |
| Sharpe | `(Ē[r−rƒ] / σ[r−rƒ]) × √252` |
| Sortino | `(Ē[r−rƒ] / σ_down) × √252` |
| Calmar | `CAGR / MaxDrawdown` |
| Max Drawdown | `max((peak − trough) / peak)` |
| Profit Factor | `grossProfit / grossLoss` |

---

## Walk-Forward Optimisation

Prevents curve-fitting by testing parameters only on data they were never optimised on:

```
Total data: ───────────────────────────────────────────
Window 1:   [─── IS (70%) ───|─ OOS (30%) ─]
Window 2:             [─── IS (70%) ───|─ OOS (30%) ─]
             ...
Concatenate OOS results → unbiased performance estimate
```

```bash
curl -X POST http://localhost:3000/api/analytics/optimize \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "RELIANCE",
    "strategy": "MEAN_REVERSION",
    "windows": 3,
    "metric": "sharpe"
  }'
```

---

## Database Schema

9 tables in `trading_engine` database:

| Table | Purpose |
|-------|---------|
| `instruments` | Master symbol list |
| `daily_prices` | EOD OHLCV (unique per symbol+date) |
| `intraday_prices` | 1-min bars |
| `signals` | Generated signals log |
| `backtest_runs` | Backtest metadata + summary metrics |
| `backtest_trades` | Individual trades per backtest |
| `paper_trades` | Paper trading orders |
| `portfolio` | Aggregated positions |
| `data_fetch_log` | Audit trail for data fetches |

---

## Risk Management

- **Per-trade risk**: 1–2% of capital (configurable)
- **Stop-loss**: 2% below entry (configurable)
- **Take-profit**: 4% above entry → Risk/Reward = 2:1
- **Daily loss limit**: 5% of capital — blocks all trades once hit
- **Max open positions**: 10 simultaneous positions
- **Commission model**: 0.03% per side + 0.05% slippage

---

## Environment Variables

```bash
# Server
PORT=3000
NODE_ENV=development

# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=trading_engine

# Risk
DEFAULT_CAPITAL=1000000
MAX_RISK_PER_TRADE_PCT=0.02
MAX_DAILY_LOSS_PCT=0.05
DEFAULT_STOP_LOSS_PCT=0.02
DEFAULT_TAKE_PROFIT_PCT=0.04

# Strategy weights (must sum to 1)
WEIGHT_MEAN_REVERSION=0.35
WEIGHT_MA_CROSSOVER=0.35
WEIGHT_RSI=0.30
```

---

## Project Structure

```
trading-engine/
├── src/
│   ├── app.js                    Entry point
│   ├── config/                   constants, database, logger
│   ├── data/                     nseFetcher, dataStore, liveDataFeed
│   ├── strategies/               meanReversion, maCrossover, rsiStrategy,
│   │                             bollingerBands, aggregator
│   ├── engine/                   backtester, executionEngine,
│   │                             portfolioAnalytics, walkForwardOptimizer,
│   │                             alertEngine, scheduler
│   ├── risk/                     riskManager
│   ├── screener/                 screener, correlationAnalysis
│   ├── controllers/              6 controllers
│   ├── routes/                   6 route files
│   ├── middleware/               errorHandler, rateLimiter
│   └── utils/                    mathUtils
├── scripts/
│   ├── schema.sql                MySQL schema
│   ├── migrate.js                Run migrations
│   ├── seed-sample-data.js       GBM synthetic data
│   └── run-sample-backtest.js    Multi-symbol comparison
├── tests/
│   └── run-tests.js              131 tests, no external deps
└── .env.example
```

---

## Disclaimer

This system is for **educational and research purposes only**. Paper trading simulation only — no real-money execution capability. Past backtest performance does not guarantee future results. All trading involves substantial risk of loss.





kill -9 $(lsof -ti :3000) 2>/dev/null; echo "killed"
pkill -f "node src/app.js" 2>/dev/null; echo "pkilled"
sleep 2
lsof -i :3000
node src/app.js