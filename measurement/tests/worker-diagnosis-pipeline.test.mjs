import test from 'node:test';
import assert from 'node:assert/strict';
import { FixturePaidAdapter, MemoryMeasurementStore, PaidAdapter } from '../paid-pipeline.mjs';
import { getBuyerDiagnosis, processDiagnosisQueueMessage } from '../../worker/diagnosis-pipeline.mjs';

const entity = { id: 'kyoudo', name: '株式会社協同住宅', official_url: 'https://www.kyoudo.jp/', aliases: ['協同住宅'], category: '不動産・建築' };
const questionRows = Array.from({ length: 10 }, (_, index) => ({ question_id: `q${index + 1}`, question_order: index + 1, question_text: `質問${index + 1}`, intent: `意図${index + 1}`, selection_reason: '利用場面から選定', source_signals_json: '["official_site"]', question_kind: index < 6 ? 'nonbrand' : 'branded' }));

class FakeDb {
  constructor(questions = questionRows) {
    this.questions = questions; this.measurements = new MemoryMeasurementStore();
    this.order = { id: 'd1', target_url: entity.official_url, payment_status: 'paid', diagnosis_status: 'queued', pipeline_state: 'queued', completed_measurements: 0, total_measurements: 30, entity_json: JSON.stringify(entity), locale: 'ja-JP', location: '千葉県浦安市', run_id: 'run-1', runner_lock_token: null, runner_lock_until: null };
  }
  prepare(sql) {
    const db = this;
    return { bind(...args) { return {
      async first() {
        if (sql.includes('FROM diagnosis_orders')) return db.order?.id === args[0] ? { ...db.order } : null;
        return null;
      },
      async all() { return sql.includes('FROM diagnosis_questions') ? { results: db.questions.map(row => ({ ...row })) } : { results: [] }; },
      async run() {
        if (sql.includes('runner_lock_token=?') && sql.includes("'+2 minutes'")) {
          if (db.order.runner_lock_token) return { meta: { changes: 0 } };
          db.order.runner_lock_token = args[0]; db.order.diagnosis_status = 'running'; db.order.pipeline_state = 'measuring'; return { meta: { changes: 1 } };
        }
        if (sql.includes('completed_measurements=(SELECT COUNT')) {
          const rows = await db.measurements.list(db.order.id); db.order.completed_measurements = rows.filter(row => !row.error && !row.provider_metadata?.pending).length; return { meta: { changes: 1 } };
        }
        if (sql.includes("pipeline_state='paused_cost_limit'")) { db.order.pipeline_state = 'paused_cost_limit'; db.order.pipeline_error_code = args[0]; db.order.runner_lock_token = null; return { meta: { changes: 1 } }; }
        if (sql.includes("pipeline_state='failed'")) { db.order.diagnosis_status = 'failed'; db.order.pipeline_state = 'failed'; db.order.pipeline_error_code = args[0]; db.order.error_message = args[1]; db.order.runner_lock_token = null; return { meta: { changes: 1 } }; }
        if (sql.includes("pipeline_state='completed'")) { db.order.diagnosis_status = 'complete'; db.order.pipeline_state = 'completed'; db.order.completed_measurements = 30; db.order.report_json = args[0]; db.order.runner_lock_token = null; return { meta: { changes: 1 } }; }
        if (sql.includes("pipeline_state='measuring'")) { db.order.diagnosis_status = 'running'; db.order.pipeline_state = 'measuring'; db.order.runner_lock_token = null; return { meta: { changes: 1 } }; }
        return { meta: { changes: 1 } };
      }
    }; } };
  }
}

const fixture = input => ({ raw_answer: `1. ${input.entity.name} — おすすめです。\n2. 比較対象株式会社`, sources: [{ url: entity.official_url, title: '公式', evidence: 'citation' }], usage: { mock: true }, raw_response_ref: `mock-${input.question_id}-${input.channel}` });
const createAdapters = calls => Object.fromEntries(['chatgpt', 'gemini', 'google_ai_mode'].map(channel => [channel, new FixturePaidAdapter({ channel, registry: [entity], fixtures: input => { calls.push(`${input.question_id}|${channel}`); return fixture(input); } })]));
const createEnv = db => ({ DB: db, DIAGNOSIS_QUEUE: { sent: [], async send(body, options) { this.sent.push({ body, options }); } }, MADOHA_MEASUREMENT_MODE: 'mock', MADOHA_ENABLE_LIVE_MEASUREMENT: 'false', MADOHA_PAID_DIAGNOSIS_MAX_COST_USD: '1' });

test('existing queue completes 30 mock measurements in bounded three-measurement steps', async () => {
  const db = new FakeDb(); const env = createEnv(db); const calls = []; const adapters = createAdapters(calls);
  let result;
  for (let turn = 0; turn < 10; turn += 1) result = await processDiagnosisQueueMessage(env, { orderId: 'd1' }, { adapters, store: db.measurements });
  assert.equal(result.state, 'completed'); assert.equal((await db.measurements.list('d1')).length, 30); assert.equal(db.order.completed_measurements, 30); assert.equal(calls.length, 30);
  assert.ok(JSON.parse(db.order.report_json).queries.every(query => query.channels.length === 3));
  const buyer = await getBuyerDiagnosis(db, 'd1'); assert.deepEqual(buyer.progress, { completed: 30, total: 30 }); assert.equal(buyer.pipeline_state, 'completed');
});

test('worker interruption resumes remaining measurements and duplicate delivery makes no extra calls', async () => {
  const db = new FakeDb(); const env = createEnv(db); const calls = []; const adapters = createAdapters(calls);
  await processDiagnosisQueueMessage(env, { orderId: 'd1' }, { adapters, store: db.measurements, maxMeasurements: 1 });
  assert.equal(db.order.completed_measurements, 1);
  for (let turn = 0; turn < 29; turn += 1) await processDiagnosisQueueMessage(env, { orderId: 'd1' }, { adapters, store: db.measurements, maxMeasurements: 1 });
  const before = calls.length; const duplicate = await processDiagnosisQueueMessage(env, { orderId: 'd1' }, { adapters, store: db.measurements, maxMeasurements: 1 });
  assert.equal(duplicate.state, 'completed'); assert.equal(calls.length, before);
});

test('missing confirmed questions fails before any provider call', async () => {
  const db = new FakeDb(questionRows.slice(0, 9)); const env = createEnv(db); const calls = [];
  const result = await processDiagnosisQueueMessage(env, { orderId: 'd1' }, { adapters: createAdapters(calls), store: db.measurements });
  assert.equal(result.state, 'failed'); assert.equal(db.order.pipeline_error_code, 'confirmed_questions_incomplete'); assert.equal(calls.length, 0);
});

test('permanent Gemini authentication error marks diagnosis failed', async () => {
  const db = new FakeDb(); const env = createEnv(db); const calls = []; const adapters = createAdapters(calls);
  class Fatal extends PaidAdapter { estimateCost() { return 0; } async execute() { const error = new Error('auth'); error.code = 'authentication'; error.fatal = true; throw error; } }
  adapters.gemini = new Fatal({ channel: 'gemini', registry: [entity] });
  const result = await processDiagnosisQueueMessage(env, { orderId: 'd1' }, { adapters, store: db.measurements });
  assert.equal(result.state, 'failed'); assert.equal(db.order.pipeline_error_code, 'authentication'); assert.equal(db.order.completed_measurements, 1);
});

test('cost cap pauses diagnosis and preserves completed work', async () => {
  const db = new FakeDb(); const env = createEnv(db); env.MADOHA_PAID_DIAGNOSIS_MAX_COST_USD = '.15';
  class Cost extends PaidAdapter { estimateCost() { return .1; } async execute(input) { return this.normalize(input, { raw_answer: entity.name, estimated_cost: .1 }); } }
  const adapters = Object.fromEntries(['chatgpt', 'gemini', 'google_ai_mode'].map(channel => [channel, new Cost({ channel, registry: [entity] })]));
  const result = await processDiagnosisQueueMessage(env, { orderId: 'd1' }, { adapters, store: db.measurements });
  assert.equal(result.state, 'paused_cost_limit'); assert.equal(db.order.completed_measurements, 1); assert.equal((await db.measurements.list('d1')).length, 1);
});

test('temporary OpenAI failure retries and continues', async () => {
  const db = new FakeDb(); const env = createEnv(db); const calls = []; const adapters = createAdapters(calls); let attempts = 0;
  class Temporary extends FixturePaidAdapter { async execute(input) { attempts += 1; if (attempts < 3) { const error = new Error('temporary'); error.retryable = true; throw error; } return super.execute(input); } }
  adapters.chatgpt = new Temporary({ channel: 'chatgpt', registry: [entity], fixtures: fixture });
  const result = await processDiagnosisQueueMessage(env, { orderId: 'd1' }, { adapters, store: db.measurements });
  assert.equal(result.state, 'measuring'); assert.equal(attempts, 3); assert.equal(db.order.completed_measurements, 3);
});

test('provider submitted state is not failed and is polled on the next queue run', async () => {
  const db = new FakeDb(); const env = createEnv(db); const calls = []; const adapters = createAdapters(calls); let aiCalls = 0;
  class Waiting extends PaidAdapter {
    estimateCost(input) { return input.existing_measurement ? 0 : .0012; }
    async execute(input) { aiCalls += 1; return this.normalize(input, input.existing_measurement ? { raw_answer: entity.name, estimated_cost: .0012, raw_response_ref: 'task-1' } : { raw_answer: '', estimated_cost: .0012, raw_response_ref: 'task-1', provider_metadata: { pending: true, state: 'submitted' } }); }
  }
  adapters.google_ai_mode = new Waiting({ channel: 'google_ai_mode', registry: [entity] });
  const first = await processDiagnosisQueueMessage(env, { orderId: 'd1' }, { adapters, store: db.measurements });
  assert.equal(first.state, 'measuring'); assert.equal((await db.measurements.get('d1', 'q1', 'google_ai_mode')).provider_metadata.state, 'submitted');
  await processDiagnosisQueueMessage(env, { orderId: 'd1' }, { adapters, store: db.measurements });
  assert.equal(aiCalls, 2); assert.equal((await db.measurements.get('d1', 'q1', 'google_ai_mode')).target_present, true);
});

test('concurrent duplicate queue delivery cannot acquire the active diagnosis lease', async () => {
  const db = new FakeDb(); const env = createEnv(db); db.order.runner_lock_token = 'active-lock';
  const result = await processDiagnosisQueueMessage(env, { orderId: 'd1' }, { adapters: createAdapters([]), store: db.measurements });
  assert.equal(result.state, 'already_processing'); assert.equal((await db.measurements.list('d1')).length, 0);
});
