CREATE TABLE IF NOT EXISTS diagnosis_orders (
  id TEXT PRIMARY KEY,
  target_url TEXT NOT NULL,
  amount_jpy INTEGER NOT NULL CHECK (amount_jpy = 4980),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('pending','paid','refunded')),
  diagnosis_status TEXT NOT NULL CHECK (diagnosis_status IN ('locked','paid','queued','running','complete','failed')),
  stripe_session_id TEXT UNIQUE,
  report_markdown TEXT,
  provider_response_id TEXT,
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 2),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paid_at TEXT,
  started_at TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS diagnosis_orders_payment_status ON diagnosis_orders(payment_status, diagnosis_status);
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL
);
