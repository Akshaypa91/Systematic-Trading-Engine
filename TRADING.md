# SYSTRA — Live Trading Operations

> **Read this before enabling anything that can place a real order.**
> Every autonomous capability ships **OFF** behind an environment flag. Nothing
> trades real money until *you* deliberately turn flags on, in the order below.
> This file is the single source of truth for flags, rollout, emergency stops,
> and troubleshooting.

⚠️ **Real money is at risk in LIVE mode.** Operational reference only — not
financial or legal advice. Verify your SEBI algo-trading obligations
independently before automating orders for anyone but yourself.

---

## 1. The one rule

**Three independent gates** stand between the code and a real order. All must be
open before an autonomous order can reach the exchange:

1. `UPSTOX_SANDBOX=false` — orders hit the *real* Upstox API (otherwise sandbox).
2. `LIVE_EXECUTION_ENABLED=true` — the OMS loop runs at all.
3. `LIVE_AUTO_ENTRIES_ENABLED=true` — the loop may *open* new positions.

Runtime guards that must also pass on every tick: **kill switch released**,
**market open** (09:15–15:30 IST, Mon–Fri), **broker authenticated**, and every
**risk limit** satisfied. Manual live orders additionally require the in-app
**arm gate** (type `CONFIRM`, once per browser session).

---

## 2. Environment flags

### Master safety switches
| Flag | Default | Effect |
|------|---------|--------|
| `UPSTOX_SANDBOX` | `true` | `true` = Upstox sandbox (no real money). `false` = **real orders**. |
| `LIVE_EXECUTION_ENABLED` | *(off)* | Master switch for the OMS loop (reconcile + exits + entries). Off = no-op. |
| `LIVE_AUTO_ENTRIES_ENABLED` | *(off)* | Second gate — lets the loop **open** positions. Requires the master switch too. |
| `LIVE_EXECUTION_USER_ID` | *(unset)* | User id the scheduler runs the loop for (single-user mode). Unset = loop skipped. |

### Entry behaviour
| Flag | Default | Effect |
|------|---------|--------|
| `LIVE_AUTO_MIN_CONFIDENCE` | `0.6` | Minimum signal confidence to act on a BUY. |
| `LIVE_AUTO_MAX_NEW_PER_TICK` | `1` | Max new positions opened per tick. |
| `LIVE_AUTO_SL_PCT` | `0.02` | Auto-bracket stop-loss distance (2%). |
| `LIVE_AUTO_TP_PCT` | `0.04` | Auto-bracket take-profit distance (4%). |

### Position sizing
| Flag | Default | Effect |
|------|---------|--------|
| `LIVE_SIZING_METHOD` | `fixed` | `fixed` \| `risk` \| `voltarget`. |
| `LIVE_AUTO_QTY` | `1` | Share qty for `fixed` sizing. |
| `LIVE_RISK_PER_TRADE` | `0.01` | Capital fraction risked per trade (`risk`). |
| `LIVE_TARGET_VOL` | `0.02` | Target per-position volatility (`voltarget`). |
| `LIVE_SIZING_CAPITAL` | `0` | Fallback capital if broker funds can't be read. |
| `LIVE_MAX_CONCURRENT_POSITIONS` | `5` | Portfolio cap — no new entries beyond this. |

### Execution algos
| Flag | Default | Effect |
|------|---------|--------|
| `LIVE_EXEC_MAX_CHILD_QTY` | `0` | `0` = off. Entries above this are sliced into child orders. |
| `LIVE_EXEC_CHILD_INTERVAL_MS` | `1500` | Pause between child slices. |

### Hard risk limits (also editable in UI: Portfolio → Risk & Emergency)
| Flag | Default | Effect |
|------|---------|--------|
| `LIVE_MAX_QTY` | `500` | Reject any single order above this qty. |
| `LIVE_MAX_ORDER_VAL` | `500000` | Reject any single order above ₹5L. |
| `LIVE_DAILY_LOSS_LIMIT` | `25000` | Block new risk at ₹25k daily loss; loop also **auto-halts**. |
| `LIVE_MAX_EXPOSURE` | `1000000` | Cap total open exposure. |
| `LIVE_MAX_POSITION_SIZE` | `200000` | Cap per-position value. |
| `LIVE_MAX_ORDERS_PER_DAY` | `50` | Cap daily order count. |
| `LIVE_DEADMAN_MAX_ERRORS` | `3` | Consecutive failed ticks before the dead-man switch halts trading. |

### Data / feed / infra
| Flag | Default | Effect |
|------|---------|--------|
| `UPSTOX_WS_ENABLED` | *(off)* | Streaming protobuf WebSocket. Keep OFF until a live tick is verified; REST poller is used meanwhile. |
| `UPSTOX_WS_MODE` | `ltpc` | WS subscription mode. |
| `CORP_ACTION_ADJUST` | `true` | Back-adjust history for splits/bonuses. Off only if your source is pre-adjusted. |
| `ALLOWED_ORIGINS` | *(unset)* | Extra CORS origins (comma-separated). `*.vercel.app` + localhost are always allowed. |
| `API_RATE_LIMIT` | `600` | General API req / 15 min / IP. Auth + status polls are exempt. |
| `AUTH_RATE_LIMIT` | `40` | Auth attempts / 15 min / IP. |
| `MARKET_DATA_RATE_LIMIT` | `150` | Market-data req / min. |

---

## 3. Safe rollout sequence

Advance **one step at a time**, staying at each for several full market sessions
and reviewing `/diagnostics` + logs before moving on.

**Step 0 — Migrations** (once):
```bash
cd backend
node scripts/run-sql.js scripts/migrate-live-orders-phase2.sql
node scripts/run-sql.js scripts/migrate-corp-actions.sql
node scripts/run-sql.js scripts/migrate-exec-quality.sql
node scripts/run-sql.js scripts/migrate-position-targets.sql
node scripts/load-corp-actions.js        # optional: backfill splits/bonuses
```

**Step 1 — Sandbox: reconcile + exits only.**
`UPSTOX_SANDBOX=true`, `LIVE_EXECUTION_ENABLED=true`, entries **off**,
`LIVE_EXECUTION_USER_ID` set. Place a manual sandbox order; confirm the loop
reconciles its status. Nothing opens automatically.

**Step 2 — Sandbox exit management.** Open a sandbox position, set a target
(`POST /api/live/targets` with `stopLoss`/`takeProfit`), confirm the engine
auto-exits on breach. Review `/api/live/execution-quality`.

**Step 3 — Sandbox autonomous entries.** `LIVE_AUTO_ENTRIES_ENABLED=true`,
`LIVE_SIZING_METHOD=fixed`, `LIVE_AUTO_QTY=1`, low `LIVE_MAX_CONCURRENT_POSITIONS`.
Let it open → bracket → exit on real signals for several sessions.

**Step 4 — Real money, manual only.** `UPSTOX_SANDBOX=false`, entries **off**.
Fund the Upstox account. Place a **1-share** manual order via the Trade page
(arm gate → charges confirm). Verify order → fill → position → auto-exit.

**Step 5 — Real money, autonomous, minimal.** Entries on with `LIVE_AUTO_QTY=1`
(or `risk` sizing with a small `LIVE_RISK_PER_TRADE`) and conservative limits.
Scale only after the live record matches the backtest.

> Backtest first: `POST /api/backtest/portfolio` runs the **same** signal →
> sizing → exit logic across a basket with shared capital, so it's a faithful
> preview of live behaviour.

---

## 4. Emergency controls

| Control | How | Effect |
|---------|-----|--------|
| **Kill switch** | Portfolio → Risk & Emergency → *Engage*, or `POST /api/live/kill-switch {"engaged":true}` | Blocks **all** live order placement immediately. |
| **Emergency Stop** | Portfolio → *Emergency Stop* | Kill switch + cancel all orders + square off all positions + force PAPER. |
| **Exit All** | Portfolio → *Exit All* | Market-exits every open position. |
| **Cancel All** | Portfolio → *Cancel All* | Cancels every open/pending order. |
| **Instant off** | Unset `LIVE_EXECUTION_ENABLED` / `LIVE_AUTO_ENTRIES_ENABLED`, redeploy | Stops the loop / entries at the source. |

**Automatic halts (no action needed):**
- **Daily-loss auto-halt** — engages the kill switch once today's loss ≥ `LIVE_DAILY_LOSS_LIMIT`.
- **Dead-man switch** — engages the kill switch after `LIVE_DEADMAN_MAX_ERRORS` consecutive failed ticks (broker/data unreachable).

After any auto-halt the kill switch **stays engaged until you release it**. That's
deliberate — investigate the logs before resuming.

---

## 5. Pre-session checklist

Before each trading day you intend to run live:

- [ ] `GET /api/live/broker/status` → connected, token not expiring today, funds positive.
- [ ] `/diagnostics` → provider shows a live feed, tick rate > 0, **Last feed error: —**.
- [ ] Kill switch **released** (Portfolio → Risk & Emergency).
- [ ] Risk limits set to today's appetite (daily loss, max exposure, position size).
- [ ] Confirm which flags are on — sandbox vs real, entries on vs off.

---

## 6. Troubleshooting (seen in production)

| Symptom | Cause | Fix |
|---------|-------|-----|
| Tick rate 0, "Last feed error: 401" | Upstox token expired/revoked. The feed now clears the token and stops. | Reconnect Upstox (Trade → Broker card → Reconnect, or re-run OAuth). |
| "WS (backend→Upstox): DISABLED" | Expected — `UPSTOX_WS_ENABLED` is off; REST poller serves prices. | Nothing. Enable only after verifying a live tick. |
| Funds show `—` / 423 error | Upstox locks funds during nightly settlement (~12am–5:30am IST). | Wait for market hours. |
| 429 on login | Rate limiter. Auth + status polls are now exempt from the general limiter. | Raise `API_RATE_LIMIT` / `AUTH_RATE_LIMIT` if a real user is hitting it. |
| CORS "No Access-Control-Allow-Origin" | Origin not allowed, or the backend never responded (cold start). | `*.vercel.app` is allowed by default; add others to `ALLOWED_ORIGINS`. Check the instance is awake. |
| First request takes ~50s | Render free tier spins down on inactivity. | Upgrade the instance — a cold start during market hours is unacceptable for live trading. |
| Order rejected `KILL_SWITCH` (503) | Kill switch engaged (possibly by an auto-halt). | Investigate, then release it in Portfolio → Risk & Emergency. |
| Order rejected `MARKET_CLOSED` | Outside 09:15–15:30 IST, Mon–Fri. | Wait for market hours. |
| Ticks increment after 15:30 | Poller keeps polling; Upstox returns last traded price. | Harmless (burns API quota). |

---

## 7. Verify state — quick reference

- `GET /api/live/broker/status` — connection, profile, funds, token expiry.
- `GET /api/live/diagnostics` — feed status, tick rate, active provider, errors.
- `GET /api/live/execution-quality` — slippage vs expected + suggested backtest slippage.
- `GET /api/live/risk` — limits + kill-switch state.
- `GET /api/live/targets` — active SL/TP/trailing exit intents.
- `GET /api/live/orders` · `/positions` · `/holdings` — book and portfolio.
- Loop activity: log line `[Scheduler] Live OMS tick: …`.

Offline test suite (no DB/network): `cd backend && npm run test:unit`. The money
path fails the build if a safety guard breaks.

---

## 8. Division of responsibility

The engine, its safety rails, and this document were built and tested for you.
**Arming the flags, funding the account, and placing real trades are your
actions alone** — no assistant will flip these switches or move your money.
