-- Preserve legacy states and add a separate sales stage for the 9 + 21 flow.
ALTER TABLE diagnosis_orders ADD COLUMN sales_stage TEXT;
ALTER TABLE diagnosis_orders ADD COLUMN access_token_hash TEXT;
ALTER TABLE diagnosis_orders ADD COLUMN free_question_ids_json TEXT;
ALTER TABLE diagnosis_orders ADD COLUMN free_report_json TEXT;
ALTER TABLE diagnosis_orders ADD COLUMN free_source_id TEXT;
ALTER TABLE diagnosis_orders ADD COLUMN identity_key TEXT;
ALTER TABLE diagnosis_orders ADD COLUMN cost_cap_usd REAL;
ALTER TABLE diagnosis_orders ADD COLUMN free_budget_day TEXT;
ALTER TABLE diagnosis_orders ADD COLUMN checkout_attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE diagnosis_orders ADD COLUMN checkout_expires_at INTEGER;
CREATE TABLE free_identity_cache (
 identity_key TEXT PRIMARY KEY, diagnosis_id TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE TABLE free_budget (
 diagnosis_id TEXT PRIMARY KEY, day TEXT NOT NULL,
 reserved_usd REAL NOT NULL DEFAULT 0
);
CREATE INDEX free_budget_day ON free_budget(day);
CREATE TABLE free_requests (
 diagnosis_id TEXT PRIMARY KEY, ip_hash TEXT NOT NULL, identity_key TEXT NOT NULL,
 started_at INTEGER NOT NULL, turnstile_verified INTEGER NOT NULL CHECK(turnstile_verified=1)
);
CREATE INDEX free_requests_ip_time ON free_requests(ip_hash,started_at);
CREATE TABLE diagnosis_events (
 diagnosis_id TEXT NOT NULL, event_name TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(diagnosis_id,event_name)
);
CREATE TABLE diagnosis_outbox (
 diagnosis_id TEXT PRIMARY KEY, stage TEXT NOT NULL,
 created_at TEXT NOT NULL, sent_at TEXT
);
