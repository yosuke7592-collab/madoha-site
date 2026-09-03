CREATE TABLE IF NOT EXISTS paid_measurements (
  diagnosis_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('chatgpt','gemini','google_ai_mode')),
  question_order INTEGER,
  channel_order INTEGER,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('complete','failed')),
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  measurement_json TEXT NOT NULL,
  measured_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (diagnosis_id, question_id, channel),
  FOREIGN KEY (diagnosis_id) REFERENCES diagnosis_orders(id)
);
CREATE INDEX IF NOT EXISTS paid_measurements_run ON paid_measurements(diagnosis_id, run_id, status);
