# Systematic Trading Engine — NSE/BSE

Production-grade rule-based trading system in Node.js.

## Quick Start

```bash
cp .env.example .env          # fill in DB credentials
npm install
npm run db:migrate            # create schema
npm run db:seed               # seed synthetic GBM price data
npm test                      # run 56-test suite (no DB/network needed)
npm run dev                   # start API server on :3000
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/data/quote/:symbol | Live NSE quote |
| GET | /api/data/historical/:symbol?from=DD-MM-YYYY&to=DD-MM-YYYY | Historical OHLCV |
| POST | /api/data/fetch-and-store/:symbol | Fetch + persist to DB |
| GET | /api/data/prices/:symbol?limit=200 | Stored prices |
| GET | /api/signal/:symbol?strategy=AGGREGATED | Trading signal |
| GET | /api/signal/describe | Strategy descriptions |
| POST | /api/backtest | Run backtest |
| GET | /api/backtest/runs | Previous runs |
| POST | /api/trade/order | Place paper trade |
| GET | /api/trade/portfolio | Portfolio state |
| POST | /api/trade/size | Compute position size |
| GET | /api/screener?topN=20&filter=BUY_CANDIDATES | Screen stocks |

## Strategies

| Strategy | Logic | Regime |
|----------|-------|--------|
| Mean Reversion | Z-score ±2σ on 20-day rolling window | Range-bound |
| MA Crossover | 50/200 SMA Golden/Death Cross | Trending |
| RSI | Wilder RSI(14), oversold <30 / overbought >70 | Counter-trend |
| Aggregated | Weighted score: MR×0.35 + MA×0.35 + RSI×0.30 | Any |

## Risk Management

- **Fixed Fractional**: risk exactly N% of capital per trade
- **Kelly Criterion**: size by edge (half-Kelly for safety)
- **Stop-loss**: configurable % below entry (default 2%)
- **Take-profit**: configurable % above entry (default 4%)
- **Max daily loss**: halts trading when 5% portfolio loss hit
- **Max open positions**: configurable limit (default 10)

## Backtest Sample Request

```bash
curl -X POST http://localhost:3000/api/backtest \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "RELIANCE",
    "strategy": "AGGREGATED",
    "initialCapital": 1000000,
    "stopLossPct": 0.02,
    "takeProfitPct": 0.04,
    "riskPerTrade": 0.02
  }'
```

## Architecture

```
src/
├── config/       # DB, logger, constants
├── data/         # NSE fetcher + MySQL store
├── strategies/   # meanReversion, maCrossover, rsiStrategy, aggregator
├── engine/       # backtester, executionEngine
├── risk/         # riskManager (sizing, SL/TP, daily limits)
├── screener/     # stock ranking engine
├── routes/       # Express router bindings
└── controllers/  # Request handlers
```
