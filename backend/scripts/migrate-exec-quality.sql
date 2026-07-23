-- migrate-exec-quality.sql — execution-quality columns on live_orders.
-- Additive + nullable, safe to re-run (run-sql.js ignores "duplicate column").
--   expected_price : LTP/limit captured at submit time (the reference price)
--   slippage_bps   : signed slippage vs expected, in basis points (cost view)
-- Actual fill price already lives in avg_price / filled_qty (Phase 2).

ALTER TABLE live_orders ADD COLUMN expected_price DECIMAL(12,4) NULL AFTER price;
ALTER TABLE live_orders ADD COLUMN slippage_bps   DECIMAL(10,2) NULL;
