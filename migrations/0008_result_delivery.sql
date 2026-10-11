-- Buyer delivery data is isolated from diagnosis content. Email addresses are
-- encrypted by the Worker; lookup values and access tokens are one-way hashes.
CREATE TABLE IF NOT EXISTS diagnosis_delivery (
  diagnosis_id TEXT PRIMARY KEY REFERENCES diagnosis_orders(id) ON DELETE CASCADE,
  buyer_email_ciphertext TEXT NOT NULL,
  buyer_email_lookup_hash TEXT NOT NULL,
  result_token_hash TEXT,
  result_token_nonce TEXT,
  pending_result_token_hash TEXT,
  pending_result_token_nonce TEXT,
  completion_email_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (completion_email_status IN ('pending','sent')),
  completion_email_sent_at TEXT,
  resend_lock_until TEXT,
  last_email_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS diagnosis_delivery_email_lookup
  ON diagnosis_delivery(buyer_email_lookup_hash, diagnosis_id);
CREATE INDEX IF NOT EXISTS diagnosis_delivery_completion_status
  ON diagnosis_delivery(completion_email_status, diagnosis_id);
