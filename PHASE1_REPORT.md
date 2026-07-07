# SYSTRA v2.0 — Phase 1 Report (Security & Architecture)

Branch: `v2-improvements` (created off `main`, not merged — review before merging)
Scope: security hardening + architecture cleanup, as agreed. UI/dashboard/backtesting/DevOps/docs work is deferred to later phases (see Roadmap below).

All fixes below were verified against the actual codebase (not assumed) — each finding was traced to the specific line(s) responsible, and each fix was smoke-tested by booting the app and hitting the affected endpoints. See "Verification" section.

---

## Files modified

| File | Change |
|---|---|
| `backend/src/app.js` | Mounted `helmet`; wired the real `validateEnv` module in place of a weaker inline duplicate; moved `requestTrace` to before the routes (it was previously dead — registered after the error handler); mounted the orphaned `routes/portfolio.js` |
| `backend/src/config/validateEnv.js` | Rewritten: now checks `DATABASE_URL` (what the app actually uses) instead of stale `DB_HOST/PORT/USER/PASSWORD/NAME`; fails fast in production on missing/weak/placeholder `JWT_SECRET`, warns (doesn't block) in development |
| `backend/src/config/database.js` | SSL cert validation (`rejectUnauthorized`) is now controlled by `DB_SSL_REJECT_UNAUTHORIZED` env var instead of being hardcoded off |
| `backend/src/middleware/auditLog.js` | Added an explicit-`userId` override so pre-auth actions (signup/login) can be logged before `req.user` exists |
| `backend/src/controllers/authController.js` | Calls `auditLog` on signup, login, failed login, and password reset |
| `backend/src/controllers/liveController.js` | Calls `auditLog` on live order placement, kill-switch toggle, and PAPER/LIVE mode changes |
| `backend/src/routes/live.js` | Kill-switch endpoint now also enforced by `requireAdmin` middleware at the route level (previously only an inline check inside the controller) |
| `backend/src/routes/index.js` | Removed ~21 duplicate route definitions that were dead code (shadowed by dedicated routers mounted earlier in `app.js`); added `requireAdmin` to `POST /api/scheduler/job/:name/stop` |
| `backend/src/routes/portfolio.js` | Added `requireAuth` (was completely unauthenticated) and the existing `backtestLimiter` for the CPU-heavy endpoint |
| `.env.example`, `backend/.env.example` | Replaced stale MySQL-style DB vars with the `DATABASE_URL` the app actually reads; documented `DB_SSL_REJECT_UNAUTHORIZED` |
| `.gitignore` | Added `logs/`, `backend/logs/`, `*.log`, `.DS_Store` (all were being tracked in git — see Known Issues) |

## Files created

| File | Purpose |
|---|---|
| `PHASE1_REPORT.md` | This report |

No new source files were needed — this phase activated and fixed existing infrastructure rather than adding new modules.

---

## Security improvements

1. **Security headers were never sent.** `helmet` was a listed dependency but never mounted — no CSP, HSTS, `X-Frame-Options`, etc. Now applied globally in `app.js`.
2. **Env/secret validation was dead code.** A proper fail-fast validator (`validateEnv.js`) existed with a comment saying to wire it in, but `app.js` had its own weaker copy that only logged warnings — and even that copy would never catch a missing `JWT_SECRET` in a way that blocks boot. The real module is now wired in and also fixed to check the env vars the app actually uses (see next point).
3. **Env docs didn't match reality.** `validateEnv.js`, `.env.example`, and `backend/.env.example` all referenced `DB_HOST`/`DB_PORT`(3306, MySQL)/`DB_USER`/`DB_PASSWORD`/`DB_NAME`. The app hasn't used those in a while — `config/database.js` connects via a single `DATABASE_URL` to a Postgres-wire-compatible database (the boot log identifies it as CockroachDB). A developer following the old `.env.example` would set variables the app silently ignores. Fixed across all three files.
4. **Any authenticated user could stop background jobs.** `POST /api/scheduler/job/:name/stop` (market data refresh, signal generation, etc. — shared across all users) only required login, not an admin role, despite an unused `requireAdmin`/RBAC module already existing in the codebase. Now admin-only.
5. **No audit trail was actually being written.** An `auditLog()` helper and its `audit_logs` table existed but were never called anywhere. Wired into signup, login (success and failure), password reset, live order placement, live kill-switch, and live trading-mode changes.
6. **Kill-switch relied on a single inline check.** `liveController.killSwitch` only had a manual `req.user.role !== 'admin'` check; the route itself had no `requireAdmin`. Not an active bypass (the check worked), but fragile — a future edit to the controller could silently drop it. Added `requireAdmin` at the route level as defense-in-depth, and made the RBAC module actually used for the first time.
7. **DB SSL certificate validation was hardcoded off** (`rejectUnauthorized: false`), which accepts unverified certs. Left as the default (to avoid breaking the live DB connection without being able to test against it), but now configurable via `DB_SSL_REJECT_UNAUTHORIZED=true` — recommended once the DB host's cert chain is confirmed to validate.
8. **Request tracing was silently broken.** `requestTrace` (assigns a trace ID to every request, logs method/path/status/timing) was registered *after* the error handler in the middleware stack, so it never actually ran on any request. Moved before the routes; confirmed via `curl` that `x-trace-id` now appears on every response.

## Architecture improvements

1. **~21 lines of dead route definitions removed.** `routes/index.js` (mounted last, as a catch-all) redefined `/data/*`, `/signal/*`, `/backtest/*`, `/trade/*`, and `/screener/*` routes that were already handled by dedicated router files mounted earlier in `app.js` — Express never reached them. Confirmed unreachable before removing, confirmed the real routes still work after.
2. **A whole feature was orphaned.** `routes/portfolio.js` and `controllers/portfolioController.js` implement multi-asset backtesting, ranked portfolio signals, and capital allocation — but the router was never `require`d/mounted in `app.js`, and had no auth guard even in its own file. Mounted at `/api/portfolio` with `requireAuth` added.
3. **Repo hygiene:** 13 log files and 3 `.DS_Store` files were tracked in git, meaning every local run pollutes the diff. `.gitignore` updated to stop new pollution (existing tracked files still need one `git rm --cached` to fully untrack — see Known Issues, this needs to be run from your machine).

## Performance / UI improvements

None in this phase by design — Phase 1 was scoped to security + architecture per your earlier choice. Dashboard/Trading page/Signal engine/Backtesting UI, React rendering optimization, and DB indexing are Phase 2+ (see Roadmap).

---

## Verification

- `node -c` syntax-checked every modified backend file.
- Booted the app locally (offline mode, no real DB) and confirmed via `curl`:
  - `helmet` headers (CSP, HSTS, X-Frame-Options, etc.) present on every response.
  - `x-trace-id` header present (proves `requestTrace` now actually runs).
  - `validateEnv` logs `[Config] ✅ Environment validated` at boot.
  - `POST /api/portfolio/backtest` → `401` with no token (previously would have been `404`, since the route didn't exist at all).
  - `POST /api/scheduler/job/:name/stop` → `403` as a regular user, `200` as admin.
  - `POST /api/live/admin/kill-switch` → `403` as a regular user (unchanged behavior, now also enforced at the route).
  - `GET /api/data/quote/RELIANCE` still works (confirms the dead-route cleanup in `routes/index.js` didn't affect the real, dedicated router).
- Ran the existing test suite: **140/140 passing**, including a pre-existing test asserting scheduler routes aren't dead code (still true — I only removed the genuinely unreachable ones).

---

## Known issues found but not fixed (flagged for your attention)

- **I could not create a git commit.** `.git/index.lock` exists and can't be removed from this sandbox (`Operation not permitted` — looks like something on your machine, e.g. a Git GUI, VS Code, or a crashed git process, is holding the repo). All the file changes above are saved to disk on the `v2-improvements` branch already checked out; you'll need to close whatever's holding the lock and run `git add -A && git commit` yourself, or ask me to retry.
- **Real `.env` files still use the old MySQL-style DB vars in some places** — I only fixed the `.env.example` templates (docs), not your real `backend/.env`/`.env`, since I can't see whether you already have a working `DATABASE_URL` set there. Worth a quick check.
- Tracked log files (`logs/`, `backend/logs/`) and `.DS_Store` need `git rm -r --cached logs backend/logs .DS_Store backend/.DS_Store frontend/.DS_Store` to fully untrack, once the lock clears.
- `validateBody`/`validateQuery`/`asyncHandler` helpers exist in `errorHandler.js` but are unused anywhere — left alone this phase since existing manual validation (e.g. `executionEngine._validateOrder`) already covers the same ground; adopting them project-wide is a reasonable Phase 2 code-quality task, not a bug fix.
- Comments and docs (test suite, scripts) still reference "MySQL" in places — cosmetic, matches the stale `.env.example` issue above, low priority.

---

## Roadmap — remaining phases

Everything below is *not yet started*. Suggested order, roughly by risk/impact:

1. **Frontend UI/UX pass** — dashboard, trading page, signal cards, backtesting results, responsive/empty/loading/error states (Zerodha/TradingView/Linear-inspired polish).
2. **Performance** — React memoization/code-splitting, bundle size, DB indexes on the tables in `initDB.js`, query optimization.
3. **Market data reliability** — the boot log already shows the multi-provider fallback (NSE → TwelveData → Finnhub) works, but circuit-breaker/retry tuning and WebSocket reconnect logic are worth a dedicated pass.
4. **DevOps** — Dockerfile/docker-compose review, CI (`.github/`), health checks, structured monitoring.
5. **Documentation** — README/architecture/API docs, once the above settles (writing docs against code that's about to change is wasted effort).
6. **Broader code-quality pass** — adopt `asyncHandler`/`validateBody` project-wide, naming consistency, remove remaining stale MySQL references.

Happy to start on any of these next — just say which.
