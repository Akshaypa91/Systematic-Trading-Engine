-- migrate-position-targets.sql — per-position exit intents (SL/TP/trailing)
-- monitored by the live execution engine. Idempotent / re-runnable.
CREATE TABLE IF NOT EXISTS live_position_targets (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id      BIGINT       NOT NULL,
  symbol       VARCHAR(32)  NOT NULL,
  side         VARCHAR(4)   NOT NULL DEFAULT 'BUY',
  stop_loss    DECIMAL(12,4) NULL,
  take_profit  DECIMAL(12,4) NULL,
  trailing_pct DECIMAL(8,5)  NULL,
  trail_ref    DECIMAL(12,4) NULL,   -- high-water (long) / low-water (short)
  active       BOOLEAN      NOT NULL DEFAULT true,
  created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_target (user_id, symbol),
  KEY idx_target_user (user_id, active)
);
