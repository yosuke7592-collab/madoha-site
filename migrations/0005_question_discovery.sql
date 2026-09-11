ALTER TABLE diagnosis_orders ADD COLUMN question_discovery_json TEXT;
ALTER TABLE diagnosis_questions ADD COLUMN discovery_evidence_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE diagnosis_questions ADD COLUMN generation_source TEXT;
ALTER TABLE diagnosis_questions ADD COLUMN generation_rule TEXT;
