import { generateQuestionDiscovery } from '../measurement/question-discovery.mjs';

export async function generateAndSaveQuestionDiscovery(db, diagnosisId, rawInput) {
  const order = await db.prepare('SELECT id,diagnosis_status,questions_confirmed_at FROM diagnosis_orders WHERE id=?').bind(diagnosisId).first();
  if (!order) throw Object.assign(new Error('診断申込が見つかりません。'), { status: 404 });
  if (order.questions_confirmed_at || order.diagnosis_status !== 'paid') throw Object.assign(new Error('確定済み、または測定開始後の質問は再生成できません。'), { status: 409 });
  const discovery = generateQuestionDiscovery(rawInput);
  const statements = [db.prepare('DELETE FROM diagnosis_questions WHERE diagnosis_id=?').bind(diagnosisId)];
  for (const question of discovery.questions) statements.push(db.prepare(`INSERT INTO diagnosis_questions
    (diagnosis_id,question_id,question_order,question_text,question_kind,intent,selection_reason,source_signals_json,measurement_purpose,alternatives_json,proposed_question_text,proposed_question_kind,user_modified,confirmed,discovery_evidence_json,generation_source,generation_rule)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,0,?,?,?)`).bind(diagnosisId, question.id, question.order, question.question_text, question.kind, question.intent, question.selection_reason, JSON.stringify(question.source_signals), question.measurement_purpose, JSON.stringify(question.alternatives), question.question_text, question.kind, JSON.stringify(question.discovery_evidence), question.generation_source, question.generation_rule));
  statements.push(db.prepare("UPDATE diagnosis_orders SET entity_json=?,question_mix_reason=?,question_discovery_json=?,updated_at=datetime('now') WHERE id=?").bind(JSON.stringify(discovery.entity), discovery.mix.reason, JSON.stringify(discovery), diagnosisId));
  await db.batch(statements);
  return discovery;
}
