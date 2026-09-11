ALTER TABLE diagnosis_orders ADD COLUMN question_mix_reason TEXT;
ALTER TABLE diagnosis_orders ADD COLUMN questions_confirmed_at TEXT;

ALTER TABLE diagnosis_questions ADD COLUMN measurement_purpose TEXT;
ALTER TABLE diagnosis_questions ADD COLUMN alternatives_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE diagnosis_questions ADD COLUMN proposed_question_text TEXT;
ALTER TABLE diagnosis_questions ADD COLUMN proposed_question_kind TEXT;
ALTER TABLE diagnosis_questions ADD COLUMN user_modified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE diagnosis_questions ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE diagnosis_questions ADD COLUMN confirmed_at TEXT;
ALTER TABLE diagnosis_questions ADD COLUMN warning_acknowledgements_json TEXT NOT NULL DEFAULT '[]';

-- Existing diagnoses already used these rows as confirmed input. Preserve that meaning.
UPDATE diagnosis_questions
SET proposed_question_text=question_text,
    proposed_question_kind=question_kind,
    measurement_purpose=COALESCE(NULLIF(measurement_purpose,''), selection_reason),
    confirmed=1,
    confirmed_at=COALESCE(confirmed_at, datetime('now'));

UPDATE diagnosis_orders
SET questions_confirmed_at=COALESCE(questions_confirmed_at, datetime('now'))
WHERE EXISTS (SELECT 1 FROM diagnosis_questions q WHERE q.diagnosis_id=diagnosis_orders.id)
  AND (SELECT COUNT(*) FROM diagnosis_questions q WHERE q.diagnosis_id=diagnosis_orders.id AND q.confirmed=1)=10;
