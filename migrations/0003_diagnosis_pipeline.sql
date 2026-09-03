ALTER TABLE diagnosis_orders ADD COLUMN pipeline_state TEXT NOT NULL DEFAULT 'pending'
  CHECK (pipeline_state IN ('pending','queued','measuring','completed','failed','paused_cost_limit'));
ALTER TABLE diagnosis_orders ADD COLUMN completed_measurements INTEGER NOT NULL DEFAULT 0;
ALTER TABLE diagnosis_orders ADD COLUMN total_measurements INTEGER NOT NULL DEFAULT 30;
ALTER TABLE diagnosis_orders ADD COLUMN entity_json TEXT;
ALTER TABLE diagnosis_orders ADD COLUMN locale TEXT NOT NULL DEFAULT 'ja-JP';
ALTER TABLE diagnosis_orders ADD COLUMN location TEXT;
ALTER TABLE diagnosis_orders ADD COLUMN report_json TEXT;
ALTER TABLE diagnosis_orders ADD COLUMN pipeline_error_code TEXT;
ALTER TABLE diagnosis_orders ADD COLUMN runner_lock_token TEXT;
ALTER TABLE diagnosis_orders ADD COLUMN runner_lock_until TEXT;

CREATE TABLE IF NOT EXISTS diagnosis_questions (
  diagnosis_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  question_order INTEGER NOT NULL CHECK (question_order BETWEEN 1 AND 10),
  question_text TEXT NOT NULL,
  intent TEXT NOT NULL,
  selection_reason TEXT NOT NULL,
  source_signals_json TEXT NOT NULL DEFAULT '[]',
  question_kind TEXT NOT NULL CHECK (question_kind IN ('nonbrand','branded')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (diagnosis_id, question_id),
  UNIQUE (diagnosis_id, question_order),
  FOREIGN KEY (diagnosis_id) REFERENCES diagnosis_orders(id)
);
CREATE INDEX IF NOT EXISTS diagnosis_questions_order ON diagnosis_questions(diagnosis_id, question_order);
