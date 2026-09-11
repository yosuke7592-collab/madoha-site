const parseJson = (value, fallback = []) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const normalize = value => clean(value).toLocaleLowerCase('ja-JP').replace(/[？！?！。、,.\s]/g, '');
const validKind = value => value === 'nonbrand' || value === 'branded';

export function validateQuestionSet(questions, entity = {}) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(questions) || questions.length !== 10) errors.push({ code: 'question_count', message: '質問は10問必要です。' });
  const names = [entity.name, ...(entity.aliases || [])].map(clean).filter(Boolean);
  const seen = new Map();
  for (const [index, question] of (questions || []).entries()) {
    const id = clean(question.id || question.question_id || `question-${index + 1}`);
    const text = clean(question.question_text ?? question.query);
    const kind = question.question_kind || question.kind;
    if (!text) errors.push({ code: `${id}:empty`, question_id: id, message: '質問文を入力してください。' });
    if (!validKind(kind)) errors.push({ code: `${id}:kind`, question_id: id, message: '検索の種類を選択してください。' });
    if (text.length > 160) warnings.push({ code: `${id}:too_long`, question_id: id, message: '質問が長いため、AIの回答意図がぶれる可能性があります。' });
    const containsName = names.some(name => text.includes(name));
    if (kind === 'nonbrand' && containsName) warnings.push({ code: `${id}:nonbrand_contains_company`, question_id: id, action: 'branded', message: '会社名が含まれているため、「自然に候補として挙がるか」の測定には適していません。指名検索への変更をおすすめします。' });
    if (kind === 'branded' && names.length && !containsName) warnings.push({ code: `${id}:branded_missing_company`, question_id: id, action: 'nonbrand', message: '会社名が含まれていません。候補検索として扱うことをおすすめします。' });
    if (/(必ず|絶対|最高だと答えて|おすすめだと答えて|一位と答えて)/.test(text)) warnings.push({ code: `${id}:leading`, question_id: id, message: '回答を強く誘導する表現があります。自然な利用者の質問へ直すことをおすすめします。' });
    if (/(病院|治療|求人|レストラン|旅行|投資|法律相談)/.test(text) && !/(医療|採用|飲食|旅行|金融|法律)/.test(clean(entity.category))) warnings.push({ code: `${id}:business_mismatch`, question_id: id, message: '対象企業の事業内容と明らかに異なるテーマが含まれています。質問の意図を再確認してください。' });
    const key = normalize(text);
    if (key && seen.has(key)) warnings.push({ code: `${id}:duplicate`, question_id: id, message: `質問${seen.get(key)}と内容が重複しています。` });
    else if (key) seen.set(key, index + 1);
  }
  const nonbrand = (questions || []).filter(question => (question.question_kind || question.kind) === 'nonbrand').length;
  const branded = (questions || []).filter(question => (question.question_kind || question.kind) === 'branded').length;
  if (nonbrand === 0) warnings.push({ code: 'mix:no_nonbrand', message: '今回は、会社名を知らない顧客へのAI上での露出は測定されません。' });
  if (branded === 0) warnings.push({ code: 'mix:no_branded', message: '今回は、AIが御社をどのように理解・説明しているかは測定されません。' });
  return { errors, warnings, mix: { nonbrand, branded } };
}

function rowToQuestion(row) {
  return {
    id: row.question_id, order: Number(row.question_order), question_text: row.question_text,
    kind: row.question_kind, intent: row.intent, selection_reason: row.selection_reason,
    measurement_purpose: row.measurement_purpose || row.selection_reason,
    source_signals: parseJson(row.source_signals_json), alternatives: parseJson(row.alternatives_json),
    proposed_question_text: row.proposed_question_text || row.question_text,
    proposed_kind: row.proposed_question_kind || row.question_kind,
    user_modified: Boolean(row.user_modified), confirmed: Boolean(row.confirmed)
  };
}

async function loadOrderAndRows(db, diagnosisId) {
  const [order, result] = await Promise.all([
    db.prepare('SELECT id,payment_status,diagnosis_status,pipeline_state,entity_json,question_mix_reason,questions_confirmed_at FROM diagnosis_orders WHERE id=?').bind(diagnosisId).first(),
    db.prepare('SELECT * FROM diagnosis_questions WHERE diagnosis_id=? ORDER BY question_order').bind(diagnosisId).all()
  ]);
  if (!order) throw Object.assign(new Error('診断申込が見つかりません。'), { status: 404 });
  return { order, questions: (result.results || []).map(rowToQuestion), entity: parseJson(order.entity_json, {}) };
}

export async function getQuestionReview(db, diagnosisId) {
  const data = await loadOrderAndRows(db, diagnosisId);
  const qa = validateQuestionSet(data.questions, data.entity);
  return { diagnosis_id: diagnosisId, locked: Boolean(data.order.questions_confirmed_at) || data.order.diagnosis_status !== 'paid', mix_reason: data.order.question_mix_reason || '対象企業のサービス、対応地域、実際の利用場面から、候補検索と会社名検索を組み合わせました。', ...qa, questions: data.questions };
}

export async function saveQuestionDraft(db, diagnosisId, inputQuestions) {
  const data = await loadOrderAndRows(db, diagnosisId);
  if (data.order.questions_confirmed_at || data.order.diagnosis_status !== 'paid') throw Object.assign(new Error('確定済み、または測定開始後の質問は変更できません。'), { status: 409 });
  const proposed = new Map(data.questions.map(question => [question.id, question]));
  const questions = (inputQuestions || []).map((question, index) => ({
    ...proposed.get(question.id), ...question, order: index + 1,
    question_text: clean(question.question_text), kind: question.kind
  }));
  const qa = validateQuestionSet(questions, data.entity);
  if (qa.errors.length) return { saved: false, ...qa, questions };
  if (questions.some(question => !proposed.has(question.id)) || new Set(questions.map(question => question.id)).size !== 10) {
    return { saved: false, errors: [{ code: 'question_identity', message: '質問の識別情報が正しくありません。' }], warnings: qa.warnings, mix: qa.mix, questions };
  }
  await db.batch(questions.map(question => {
    const original = proposed.get(question.id);
    const modified = question.question_text !== original.proposed_question_text || question.kind !== original.proposed_kind;
    return db.prepare(`UPDATE diagnosis_questions SET question_order=?,question_text=?,question_kind=?,intent=?,selection_reason=?,measurement_purpose=?,user_modified=?,confirmed=0,confirmed_at=NULL,warning_acknowledgements_json='[]' WHERE diagnosis_id=? AND question_id=?`)
      .bind(question.order, question.question_text, question.kind, clean(question.intent), clean(question.selection_reason), clean(question.measurement_purpose), modified ? 1 : 0, diagnosisId, question.id);
  }));
  return { saved: true, ...qa, questions };
}

export async function confirmQuestionSet(db, diagnosisId, acknowledgedCodes = []) {
  const data = await loadOrderAndRows(db, diagnosisId);
  if (data.order.questions_confirmed_at || data.order.diagnosis_status !== 'paid') throw Object.assign(new Error('質問はすでに確定され、変更できません。'), { status: 409 });
  const qa = validateQuestionSet(data.questions, data.entity);
  if (qa.errors.length) return { confirmed: false, ...qa };
  const accepted = new Set(acknowledgedCodes || []);
  const missing = qa.warnings.filter(warning => !accepted.has(warning.code));
  if (missing.length) return { confirmed: false, errors: [], warnings: qa.warnings, unacknowledged: missing, mix: qa.mix };
  const ackJson = JSON.stringify([...accepted]);
  await db.batch([
    db.prepare("UPDATE diagnosis_questions SET confirmed=1,confirmed_at=datetime('now'),warning_acknowledgements_json=? WHERE diagnosis_id=?").bind(ackJson, diagnosisId),
    db.prepare("UPDATE diagnosis_orders SET questions_confirmed_at=datetime('now'),updated_at=datetime('now') WHERE id=? AND diagnosis_status='paid'").bind(diagnosisId)
  ]);
  return { confirmed: true, warnings: qa.warnings, mix: qa.mix };
}
