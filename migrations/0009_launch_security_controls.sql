-- Launch-security controls.  These records never contain plaintext email or
-- result tokens; hashes and diagnosis IDs are the only identifiers retained.
ALTER TABLE diagnosis_orders ADD COLUMN draft_expires_at TEXT;
UPDATE diagnosis_orders
  SET draft_expires_at=datetime(created_at,'+7 days')
  WHERE payment_status='pending' AND draft_expires_at IS NULL;
CREATE INDEX IF NOT EXISTS diagnosis_orders_draft_expiry
  ON diagnosis_orders(payment_status, draft_expires_at);

ALTER TABLE diagnosis_delivery ADD COLUMN resend_cooldown_until TEXT;
ALTER TABLE diagnosis_delivery ADD COLUMN resend_window_started_at TEXT;
ALTER TABLE diagnosis_delivery ADD COLUMN resend_window_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS diagnosis_daily_limits (
  scope TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, day)
);

-- A request is queued before the completed-order lookup.  This makes the
-- public response independent of whether the submitted email has a result.
CREATE TABLE IF NOT EXISTS result_resend_requests (
  email_lookup_hash TEXT PRIMARY KEY,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  available_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS result_resend_requests_expiry
  ON result_resend_requests(expires_at);

-- One durable reservation per provider attempt.  Failed attempts retain their
-- conservative reservation so a Queue retry cannot create unbounded spend.
CREATE TABLE IF NOT EXISTS diagnosis_measurement_attempts (
  id TEXT PRIMARY KEY,
  diagnosis_id TEXT NOT NULL REFERENCES diagnosis_orders(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  reserved_cost_usd REAL NOT NULL,
  actual_cost_usd REAL,
  status TEXT NOT NULL CHECK (status IN ('reserved','completed','failed')),
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finalized_at TEXT,
  UNIQUE (diagnosis_id, question_id, channel, attempt_number)
);
CREATE INDEX IF NOT EXISTS diagnosis_measurement_attempts_budget
  ON diagnosis_measurement_attempts(diagnosis_id, status);
