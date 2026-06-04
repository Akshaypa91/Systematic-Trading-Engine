# SYSTRA Production Audit Report

## Architecture Review

| Severity | Location | Issue | Fix Implemented |
| --- | --- | --- | --- |
| High | `backend/src/engine/executionEngine.js` | Paper trading state was process-global, so authenticated users could share in-memory positions, capital, dedupe, cooldown, and recent orders. | Added per-user execution state, per-user dedupe/cooldowns, user-scoped order persistence, and user-scoped order reads. |
| High | `backend/src/controllers/backtestController.js` | Backtest runs and trades were globally readable by any authenticated user. | Added `user_id` persistence for runs and filtered run/trade queries by `req.user.id`. |
| Medium | `backend/src/config/initDB.js` | Core trading tables lacked user ownership metadata and journal/watchlist tables were absent. | Added user ownership columns/indexes and created `watchlists` and `trade_journal` tables with constraints. |
| Medium | `frontend/src/App.jsx` | All pages were included in the initial bundle. | Added route-level `React.lazy`/`Suspense` splitting. |

## Security Review

| Severity | Location | Issue | Fix Implemented |
| --- | --- | --- | --- |
| High | Backend trade/backtest analytics | Authenticated endpoints did not consistently enforce row-level ownership. | Scoped paper trades, analytics, backtest runs, and backtest trades to the authenticated user. |
| Medium | `backend/src/middleware/auditLog.js` | Audit logging only recognized `req.user.userId`, while other code also uses `req.user.id`. | Normalized audit user lookup to support both fields. |
| Medium | `.github/workflows/ci.yml` | No automated CI gate existed for tests/build/lint. | Added CI for backend tests, frontend lint, and frontend production build. |

## Performance Review

| Severity | Location | Issue | Fix Implemented |
| --- | --- | --- | --- |
| Medium | `frontend/src/App.jsx` | Large frontend bundle loaded routes users may never visit. | Added route code splitting. |
| Low | `frontend/eslint.config.js` | Lint tooling was unusable with ESLint 9. | Added a flat ESLint config so performance and code-quality checks can run in CI. |

## UX Review

| Severity | Location | Issue | Fix Implemented |
| --- | --- | --- | --- |
| Medium | Trade Journal | No frontend workflow existed for recording trade reasoning, screenshots, tags, confidence, or lessons learned. | Added `/journal` page with summary stats, entry form, tag analytics, mobile-friendly cards, and sidebar/bottom-nav access. |
| Low | `frontend/src/pages/Trade.jsx` | Live order toast used `message` while the renderer expected `msg`, producing blank feedback. | Normalized toast state keys. |

## Scalability Review

| Severity | Location | Issue | Fix Implemented |
| --- | --- | --- | --- |
| High | `backend/src/config/initDB.js` | User-facing tables needed indexes for user-scoped queries. | Added indexes for user/date and user/symbol access paths. |
| Medium | `backend/src/controllers/dataController.js` | Search endpoint referenced `stockMaster` without importing it, causing search failures. | Added the missing import. |

## Technical Debt Report

| Severity | Location | Issue | Fix Implemented |
| --- | --- | --- | --- |
| Medium | `backend/src/engine/executionEngine.js` | BUY path assigned stop-loss fields to `order` before `order` existed, which could crash execution. | Moved stop/take-profit assignment after order creation. |
| Medium | Frontend lint | Duplicate style keys and empty catches prevented lint from passing. | Removed duplicate keys and replaced empty catches with explicit handling/comments. |
| Low | Frontend lint | 19 warnings remain, mostly unused render-prop variables and hook dependency guidance. | Lint now exits successfully; warnings are documented for future cleanup. |

## Remaining Risks

- The database dialect is PostgreSQL/CockroachDB, not MySQL. The audit preserved the actual working dialect.
- Some legacy tables may still contain historical global rows with `user_id = NULL`; production migration/backfill policy should decide whether to archive or map them.
- Refresh-token cookies and CSRF are not fully implemented in this pass.
- Live broker order state should be load-tested with a real broker sandbox before production trading.
- Remaining frontend lint warnings are non-blocking but should be cleaned gradually.
