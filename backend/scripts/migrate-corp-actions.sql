-- migrate-corp-actions.sql
-- Corporate-actions table for split/bonus/dividend adjustment of historical
-- prices. Idempotent — safe to re-run (run-sql.js ignores "already exists").
--
-- `factor` is the multiplier applied to raw prices ON OR BEFORE ex_date to make
-- the series continuous with post-action prices (back-adjustment). Volume is
-- divided by the same factor. Examples:
--   1:1 bonus  -> price halves after ex-date -> factor 0.5
--   1:5 split  -> price /5 after ex-date     -> factor 0.2
--   dividend D -> factor (close - D)/close on the ex-date close
--
-- For bonus a:b (a new shares per b held): factor = b / (a + b)
-- For split old_fv->new_fv:                factor = new_fv / old_fv

CREATE TABLE IF NOT EXISTS corporate_actions (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  symbol       VARCHAR(32)  NOT NULL,
  exchange     VARCHAR(8)   NOT NULL DEFAULT 'NSE',
  ex_date      DATE         NOT NULL,
  action_type  VARCHAR(16)  NOT NULL,          -- SPLIT | BONUS | DIVIDEND
  numerator    INT          NULL,              -- a (bonus) / new_fv (split)
  denominator  INT          NULL,              -- b (bonus) / old_fv (split)
  factor       DECIMAL(14,8) NOT NULL,         -- price multiplier for dates <= ex_date
  ratio_text   VARCHAR(32)  NULL,              -- human label e.g. "1:1 bonus"
  notes        VARCHAR(255) NULL,
  created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_corp_action (symbol, ex_date, action_type),
  KEY idx_corp_symbol (symbol)
);

-- Seed: Reliance Industries 1:1 bonus (ex-date 28 Oct 2024). This is the action
-- behind the RELIANCE entry ₹2,606 vs LTP ~₹1,327 artifact. VERIFY the ex-date
-- against your data source before relying on it for live P&L.
INSERT INTO corporate_actions (symbol, exchange, ex_date, action_type, numerator, denominator, factor, ratio_text, notes)
VALUES ('RELIANCE', 'NSE', '2024-10-28', 'BONUS', 1, 1, 0.50000000, '1:1 bonus', 'RIL 1:1 bonus issue')
ON DUPLICATE KEY UPDATE factor = VALUES(factor), ratio_text = VALUES(ratio_text), notes = VALUES(notes);
