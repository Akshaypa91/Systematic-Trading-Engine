-- Phase 2 — Live order execution: additive columns on live_orders.
-- Safe to run on an existing table; all columns are nullable / defaulted so
-- existing rows and Phase 1 code keep working. TiDB / MySQL compatible.

ALTER TABLE live_orders ADD COLUMN product        VARCHAR(10)   NULL AFTER order_type;
ALTER TABLE live_orders ADD COLUMN validity       VARCHAR(10)   NULL AFTER product;
ALTER TABLE live_orders ADD COLUMN trigger_price  DECIMAL(12,4) NULL AFTER price;
ALTER TABLE live_orders ADD COLUMN disclosed_qty  INT           NULL AFTER trigger_price;
ALTER TABLE live_orders ADD COLUMN is_amo         BOOLEAN       NOT NULL DEFAULT false AFTER validity;
ALTER TABLE live_orders ADD COLUMN filled_qty     INT           NULL;
ALTER TABLE live_orders ADD COLUMN avg_price      DECIMAL(12,4) NULL;
ALTER TABLE live_orders ADD COLUMN exchange       VARCHAR(12)   NULL;
ALTER TABLE live_orders ADD COLUMN exchange_time  VARCHAR(40)   NULL;
ALTER TABLE live_orders ADD COLUMN sandbox        BOOLEAN       NOT NULL DEFAULT false;

-- Note: order_type is already VARCHAR(10) which fits 'MARKET','LIMIT','SL','SL-M'.
