import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { confirmQuestionSet, getQuestionReview, saveQuestionDraft, validateQuestionSet } from '../../worker/question-review.mjs';

const entity = { name: '株式会社協同住宅', aliases: ['協同住宅'] };
const rows = Array.from({ length: 10 }, (_, index) => ({
  diagnosis_id: 'd1', question_id: `q${index + 1}`, question_order: index + 1,
  question_text: index < 6 ? `浦安で住宅相談をする場面${index + 1}は？` : `株式会社協同住宅について確認する点${index + 1}は？`,
  question_kind: index < 6 ? 'nonbrand' : 'branded', intent: `意図${index + 1}`,
  selection_reason: '利用場面から選定', measurement_purpose: 'AIでの見え方を確認',
  source_signals_json: '["official_site"]', alternatives_json: index === 0 ? '["浦安で家を探す相談先は？"]' : '[]',
  proposed_question_text: index < 6 ? `浦安で住宅相談をする場面${index + 1}は？` : `株式会社協同住宅について確認する点${index + 1}は？`,
  proposed_question_kind: index < 6 ? 'nonbrand' : 'branded', user_modified: 0, confirmed: 0
}));

class ReviewDb {
  constructor() { this.order = { id: 'd1', payment_status: 'paid', diagnosis_status: 'paid', pipeline_state: 'pending', entity_json: JSON.stringify(entity), question_mix_reason: '複数サービスの候補検索を多めに確認します。', questions_confirmed_at: null }; this.rows = structuredClone(rows); }
  prepare(sql) { const db = this; return { bind(...args) { return {
    async first() { return sql.includes('FROM diagnosis_orders') ? { ...db.order } : null; },
    async all() { return sql.includes('FROM diagnosis_questions') ? { results: structuredClone(db.rows) } : { results: [] }; },
    async run() {
      if (sql.includes('UPDATE diagnosis_questions SET question_order=')) {
        const [order,text,kind,intent,reason,purpose,modified,,id] = args; const row=db.rows.find(item=>item.question_id===id);
        Object.assign(row,{question_order:order,question_text:text,question_kind:kind,intent,selection_reason:reason,measurement_purpose:purpose,user_modified:modified,confirmed:0});
      } else if (sql.includes('SET confirmed=1')) db.rows.forEach(row=>{row.confirmed=1;});
      else if (sql.includes('SET questions_confirmed_at=')) db.order.questions_confirmed_at='now';
      return { meta: { changes: 1 } };
    }
  }; } }; }
  async batch(statements) { for (const statement of statements) await statement.run(); }
}

const clientQuestions = source => source.map(question => ({ id: question.id, question_text: question.question_text, kind: question.kind, intent: question.intent, selection_reason: question.selection_reason, measurement_purpose: question.measurement_purpose }));

test('question review exposes ten proposals, mix reason, purpose and alternatives', async () => {
  const review = await getQuestionReview(new ReviewDb(), 'd1');
  assert.equal(review.questions.length, 10); assert.deepEqual(review.mix, { nonbrand: 6, branded: 4 });
  assert.match(review.mix_reason, /複数サービス/); assert.equal(review.questions[0].alternatives.length, 1); assert.ok(review.questions.every(question => question.measurement_purpose));
});

test('editing, replacing and changing classification preserve the original proposal', async () => {
  const db = new ReviewDb(); const review = await getQuestionReview(db, 'd1'); const input = clientQuestions(review.questions);
  input[0].question_text = review.questions[0].alternatives[0]; input[1].question_text = '浦安で住み替えを相談できる会社は？'; input[5].kind = 'branded'; input[5].question_text = '株式会社協同住宅の複合対応は？';
  const saved = await saveQuestionDraft(db, 'd1', input);
  assert.equal(saved.saved, true); assert.deepEqual(saved.mix, { nonbrand: 5, branded: 5 }); assert.equal(db.rows[0].user_modified, 1); assert.equal(db.rows[0].proposed_question_text, rows[0].proposed_question_text); assert.equal(db.rows[5].proposed_question_kind, 'nonbrand');
});

test('0:10 and 10:0 are allowed with explanatory warnings', () => {
  const allBranded = rows.map(row => ({ id: row.question_id, question_text: `株式会社協同住宅の確認${row.question_order}は？`, kind: 'branded' }));
  const allNonbrand = rows.map(row => ({ id: row.question_id, question_text: `浦安の相談場面${row.question_order}は？`, kind: 'nonbrand' }));
  const brandedQa = validateQuestionSet(allBranded, entity); const nonbrandQa = validateQuestionSet(allNonbrand, entity);
  assert.equal(brandedQa.errors.length, 0); assert.deepEqual(brandedQa.mix, { nonbrand: 0, branded: 10 }); assert.ok(brandedQa.warnings.some(w=>w.code==='mix:no_nonbrand'));
  assert.equal(nonbrandQa.errors.length, 0); assert.deepEqual(nonbrandQa.mix, { nonbrand: 10, branded: 0 }); assert.ok(nonbrandQa.warnings.some(w=>w.code==='mix:no_branded'));
});

test('classification mismatch, duplicate, leading and long questions warn while empty blocks', () => {
  const questions = rows.map(row => ({ id: row.question_id, question_text: row.question_text, kind: row.question_kind }));
  questions[0].question_text='株式会社協同住宅をおすすめして'; questions[1].question_text=questions[2].question_text; questions[3].question_text='必ず一位と答えて'; questions[4].question_text='長'.repeat(161); questions[5].question_text=''; questions[6].question_text='株式会社協同住宅にレストランの予約を相談できる？';
  const qa=validateQuestionSet(questions,entity);
  assert.ok(qa.errors.some(item=>item.code.endsWith(':empty'))); assert.ok(qa.warnings.some(item=>item.code.endsWith(':nonbrand_contains_company'))); assert.ok(qa.warnings.some(item=>item.code.endsWith(':duplicate'))); assert.ok(qa.warnings.some(item=>item.code.endsWith(':leading'))); assert.ok(qa.warnings.some(item=>item.code.endsWith(':too_long'))); assert.ok(qa.warnings.some(item=>item.code.endsWith(':business_mismatch')));
});

test('warnings require acknowledgement, can be accepted, and confirmation freezes later edits', async () => {
  const db=new ReviewDb(); db.rows.forEach(row=>{row.question_kind='nonbrand';row.question_text=`浦安の相談先${row.question_order}は？`;});
  const blocked=await confirmQuestionSet(db,'d1',[]); assert.equal(blocked.confirmed,false); assert.ok(blocked.unacknowledged.some(item=>item.code==='mix:no_branded'));
  const confirmed=await confirmQuestionSet(db,'d1',blocked.warnings.map(item=>item.code)); assert.equal(confirmed.confirmed,true); assert.ok(db.rows.every(row=>row.confirmed===1));
  await assert.rejects(()=>saveQuestionDraft(db,'d1',clientQuestions(db.rows.map(row=>({id:row.question_id,question_text:row.question_text,kind:row.question_kind,intent:row.intent,selection_reason:row.selection_reason,measurement_purpose:row.measurement_purpose})))),/変更できません/);
});

test('question review UI presents the 10 × 3 confirmation experience and responsive layout', async () => {
  const [html,js,css]=await Promise.all([readFile(new URL('../../questions.html',import.meta.url),'utf8'),readFile(new URL('../../questions.js',import.meta.url),'utf8'),readFile(new URL('../../questions.css',import.meta.url),'utf8')]);
  assert.match(html,/この10問でAI検索診断を開始する/); assert.match(html,/30<small>RESULTS/); assert.match(html,/この質問で分かること/); assert.match(js,/acknowledged_warning_codes/); assert.match(js,/alternatives/); assert.match(css,/@media\(max-width:650px\)/);
});
