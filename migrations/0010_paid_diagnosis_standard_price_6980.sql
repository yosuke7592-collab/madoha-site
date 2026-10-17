-- Preserve all historical orders while allowing the current standard price.
-- Rebuild only the CHECK constraint; no existing order value is changed.
PRAGMA defer_foreign_keys=ON;
CREATE TABLE diagnosis_orders_price_6980 (
  id TEXT PRIMARY KEY,
  target_url TEXT NOT NULL,
  amount_jpy INTEGER NOT NULL CHECK (amount_jpy IN (4980,6980,9800)),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('pending','paid','refunded')),
  diagnosis_status TEXT NOT NULL CHECK (diagnosis_status IN ('locked','paid','queued','running','complete','failed')),
  stripe_session_id TEXT UNIQUE, report_markdown TEXT, provider_response_id TEXT, error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 2),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, paid_at TEXT, started_at TEXT, completed_at TEXT,
  pipeline_state TEXT NOT NULL DEFAULT 'pending' CHECK (pipeline_state IN ('pending','queued','measuring','completed','failed','paused_cost_limit')),
  completed_measurements INTEGER NOT NULL DEFAULT 0, total_measurements INTEGER NOT NULL DEFAULT 30,
  entity_json TEXT, locale TEXT NOT NULL DEFAULT 'ja-JP', location TEXT, report_json TEXT, pipeline_error_code TEXT,
  runner_lock_token TEXT, runner_lock_until TEXT, question_mix_reason TEXT, questions_confirmed_at TEXT,
  question_discovery_json TEXT, sales_stage TEXT, access_token_hash TEXT, free_question_ids_json TEXT,
  free_report_json TEXT, free_source_id TEXT, identity_key TEXT, cost_cap_usd REAL, free_budget_day TEXT,
  checkout_attempt INTEGER NOT NULL DEFAULT 0, checkout_expires_at INTEGER, draft_expires_at TEXT
);
INSERT INTO diagnosis_orders_price_6980 SELECT * FROM diagnosis_orders;
DROP TABLE diagnosis_orders;
ALTER TABLE diagnosis_orders_price_6980 RENAME TO diagnosis_orders;
CREATE INDEX diagnosis_orders_payment_status ON diagnosis_orders(payment_status, diagnosis_status);
CREATE INDEX diagnosis_orders_draft_expiry ON diagnosis_orders(payment_status, draft_expires_at);
PRAGMA defer_foreign_keys=OFF;
