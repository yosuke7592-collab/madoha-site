-- Preserve historical 4,980-yen orders while allowing the v2 initial diagnosis price.
-- D1 enforces foreign keys inside implicit transactions. Defer validation until the
-- replacement table has been renamed to the original name.
PRAGMA defer_foreign_keys=ON;
CREATE TABLE diagnosis_orders_v2 (
  id TEXT PRIMARY KEY,
  target_url TEXT NOT NULL,
  amount_jpy INTEGER NOT NULL CHECK (amount_jpy IN (4980,9800)),
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
  checkout_attempt INTEGER NOT NULL DEFAULT 0, checkout_expires_at INTEGER
);
INSERT INTO diagnosis_orders_v2 (
  id,target_url,amount_jpy,payment_status,diagnosis_status,stripe_session_id,report_markdown,
  provider_response_id,error_message,attempt_count,created_at,updated_at,paid_at,started_at,
  completed_at,pipeline_state,completed_measurements,total_measurements,entity_json,locale,
  location,report_json,pipeline_error_code,runner_lock_token,runner_lock_until,
  question_mix_reason,questions_confirmed_at,question_discovery_json,sales_stage,
  access_token_hash,free_question_ids_json,free_report_json,free_source_id,identity_key,
  cost_cap_usd,free_budget_day,checkout_attempt,checkout_expires_at
)
SELECT
  id,target_url,amount_jpy,payment_status,diagnosis_status,stripe_session_id,report_markdown,
  provider_response_id,error_message,attempt_count,created_at,updated_at,paid_at,started_at,
  completed_at,pipeline_state,completed_measurements,total_measurements,entity_json,locale,
  location,report_json,pipeline_error_code,runner_lock_token,runner_lock_until,
  question_mix_reason,questions_confirmed_at,question_discovery_json,sales_stage,
  access_token_hash,free_question_ids_json,free_report_json,free_source_id,identity_key,
  cost_cap_usd,free_budget_day,checkout_attempt,checkout_expires_at
FROM diagnosis_orders;
DROP TABLE diagnosis_orders;
ALTER TABLE diagnosis_orders_v2 RENAME TO diagnosis_orders;
CREATE INDEX diagnosis_orders_payment_status ON diagnosis_orders(payment_status, diagnosis_status);
PRAGMA defer_foreign_keys=OFF;
