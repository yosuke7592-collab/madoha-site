import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { createSalesDraft } from '../../worker/sales-flow.mjs';
import { cleanupExpiredDeliverySecurityRows, processQueuedResultResends, queueResultResend, storeBuyerEmail } from '../../worker/result-delivery.mjs';
import { D1MeasurementStore, FixturePaidAdapter, PaidAdapter, runPaidMeasurements } from '../../measurement/paid-pipeline.mjs';
import { GeminiPaidAdapter } from '../../measurement/gemini.mjs';
import { OpenAiPaidAdapter } from '../../measurement/openai-paid.mjs';
import { GoogleAiModePaidAdapter } from '../../measurement/google-ai-mode.mjs';

const fixture = JSON.parse(await readFile(new URL('../../data/fixtures/question-discovery/kyoudo.json', import.meta.url), 'utf8'));
const entity = { id: 'target', name: '株式会社テスト', official_url: 'https://example.com/' };
const questions = [{ id: 'q1', order: 1, query: '質問', kind: 'nonbrand' }];
const secrets = {
  MADOHA_EMAIL_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  MADOHA_EMAIL_LOOKUP_SECRET: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  MADOHA_RESULT_TOKEN_SECRET: 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
  RESEND_API_KEY: 're_test', PUBLIC_SITE_URL: 'https://madoha.jp'
};
const live = { MADOHA_ENABLE_LIVE_MEASUREMENT: 'true', OPENAI_API_KEY: 'test', GEMINI_API_KEY: 'test' };
const order = async (db, id) => db.prepare("INSERT INTO diagnosis_orders (id,target_url,amount_jpy,payment_status,diagnosis_status,created_at,updated_at) VALUES (?,'https://example.com',9800,'paid','paid',datetime('now'),datetime('now'))").bind(id).run();

test('F-04: foreign-key-enabled cleanup deletes a normal expired draft and keeps resend cleanup independent', async t => {
  const db = await sqliteD1(); t.after(() => db.close());
  await db.applySchema('PRAGMA foreign_keys=ON;');
  const env = { DB: db, MADOHA_PAID_DIAGNOSIS_MAX_COST_USD: '.70' };
  const draft = await createSalesDraft(env, fixture);
  await db.prepare("UPDATE diagnosis_orders SET draft_expires_at=datetime('now','-1 day') WHERE id=?").bind(draft.id).run();
  await db.prepare("INSERT INTO result_resend_requests (email_lookup_hash,requested_at,available_at,expires_at) VALUES ('expired-ok',datetime('now'),datetime('now'),datetime('now','-1 day'))").run();
  await cleanupExpiredDeliverySecurityRows(env);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM diagnosis_orders WHERE id=?').bind(draft.id).first()).n, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM diagnosis_questions WHERE diagnosis_id=?').bind(draft.id).first()).n, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM result_resend_requests WHERE email_lookup_hash='expired-ok'").first()).n, 0);

  const blocked = await createSalesDraft(env, fixture);
  await db.prepare("UPDATE diagnosis_orders SET draft_expires_at=datetime('now','-1 day') WHERE id=?").bind(blocked.id).run();
  await db.applySchema("CREATE TRIGGER block_question_cleanup BEFORE DELETE ON diagnosis_questions BEGIN SELECT RAISE(ABORT, 'test child failure'); END;");
  await db.prepare("INSERT INTO result_resend_requests (email_lookup_hash,requested_at,available_at,expires_at) VALUES ('expired-independent',datetime('now'),datetime('now'),datetime('now','-1 day'))").run();
  await assert.rejects(() => cleanupExpiredDeliverySecurityRows(env), /test child failure/);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM result_resend_requests WHERE email_lookup_hash='expired-independent'").first()).n, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM diagnosis_orders WHERE id=?').bind(blocked.id).first()).n, 1);
});

test('F-04: a draft paid after selection keeps every child row during cleanup', async t => {
  const db = await sqliteD1(); t.after(() => db.close()); await db.applySchema('PRAGMA foreign_keys=ON;');
  const draft = await createSalesDraft({ DB: db }, fixture);
  await db.prepare("UPDATE diagnosis_orders SET draft_expires_at=datetime('now','-1 day') WHERE id=?").bind(draft.id).run();
  await db.prepare("INSERT INTO diagnosis_outbox VALUES (?,'paid',datetime('now'),NULL)").bind(draft.id).run();
  let upgraded = false;
  const env = { DB: { ...db, batch: async statements => {
    if (!upgraded) { upgraded = true; await db.prepare("UPDATE diagnosis_orders SET payment_status='paid',diagnosis_status='paid' WHERE id=?").bind(draft.id).run(); }
    return db.batch(statements);
  } } };
  await cleanupExpiredDeliverySecurityRows(env);
  assert.equal((await db.prepare('SELECT payment_status FROM diagnosis_orders WHERE id=?').bind(draft.id).first()).payment_status, 'paid');
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM diagnosis_questions WHERE diagnosis_id=?').bind(draft.id).first()).n, 10);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM diagnosis_outbox WHERE diagnosis_id=?').bind(draft.id).first()).n, 1);
});

test('F-04: cleanup batch configuration is clamped to fifty orders', async t => {
  const db = await sqliteD1(); t.after(() => db.close());
  for (let index = 0; index < 52; index += 1) {
    const draft = await createSalesDraft({ DB: db }, fixture);
    await db.prepare("UPDATE diagnosis_orders SET draft_expires_at=datetime('now','-1 day') WHERE id=?").bind(draft.id).run();
  }
  await cleanupExpiredDeliverySecurityRows({ DB: db, MADOHA_DELIVERY_CLEANUP_BATCH: '1000' });
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM diagnosis_orders WHERE payment_status='pending'").first()).n, 2);
});

test('F-05: atomic reservations enforce one shared cap under concurrent stores', async t => {
  const db = await sqliteD1(); t.after(() => db.close()); const id = '11111111-1111-4111-8111-111111111111'; await order(db, id);
  const [a, b] = await Promise.all([
    new D1MeasurementStore(db).reserveAttempt({ diagnosisId: id, questionId: 'q1', channel: 'chatgpt', estimate: .4, cap: .7 }),
    new D1MeasurementStore(db).reserveAttempt({ diagnosisId: id, questionId: 'q2', channel: 'gemini', estimate: .4, cap: .7 })
  ]);
  assert.equal([a, b].filter(Boolean).length, 1);
  const total = await new D1MeasurementStore(db).budgetUsed(id); assert.equal(total, .4);
});

test('F-05A: conservative OpenAI reservation stops a multi-search response before fetch at the cap', async t => {
  const db = await sqliteD1(); t.after(() => db.close()); const id = 'openai-cap'; await order(db, id);
  await db.prepare(`INSERT INTO diagnosis_measurement_attempts (id,diagnosis_id,question_id,channel,attempt_phase,attempt_number,reserved_cost_usd,status)
    VALUES ('prior',?,'prior','chatgpt','request',1,.6839,'completed')`).bind(id).run();
  let calls = 0; const openai = new OpenAiPaidAdapter({ fetchImpl: async () => { calls += 1; return Response.json({ output_text: 'should not run' }); } });
  const fixtures = channel => new FixturePaidAdapter({ channel, fixtures: () => ({ raw_answer: 'unused', estimated_cost: 0 }) });
  const result = await runPaidMeasurements({ diagnosis: { id, entity, run_id: id }, questions, adapters: { chatgpt: openai, gemini: fixtures('gemini'), google_ai_mode: fixtures('google_ai_mode') }, store: new D1MeasurementStore(db), env: live, maxCost: .7, maxMeasurements: 1 });
  assert.equal(calls, 0); assert.equal(result.stopped.code, 'cost_cap_exceeded');
  assert.equal(await new D1MeasurementStore(db).budgetUsed(id), .6839);
});

test('N-01: normal maximum-token Gemini and OpenAI answers are saved within the reserved cap', async t => {
  const db = await sqliteD1(); t.after(() => db.close());
  const fixtureAdapter = channel => new FixturePaidAdapter({ channel, fixtures: () => ({ raw_answer: '補完回答', estimated_cost: 0 }) });
  for (const [channel, Adapter, payload] of [
    ['gemini', GeminiPaidAdapter, { candidates: [{ content: { parts: [{ text: '正常な回答' }] }, groundingMetadata: {} }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2000 } }],
    ['chatgpt', OpenAiPaidAdapter, { id: 'ok', output_text: '正常な回答', output: [{ type: 'web_search_call' }], usage: { input_tokens: 1, output_tokens: 2000 } }]
  ]) {
    const id = `${channel}-normal`; await order(db, id);
    const measured = new Adapter({ fetchImpl: async () => Response.json(payload) });
    const adapters = { chatgpt: fixtureAdapter('chatgpt'), gemini: fixtureAdapter('gemini'), google_ai_mode: fixtureAdapter('google_ai_mode'), [channel]: measured };
    const result = await runPaidMeasurements({ diagnosis: { id, entity, run_id: `run-${id}` }, questions, adapters, store: new D1MeasurementStore(db), env: live, maxCost: .7, maxMeasurements: 3 });
    assert.notEqual(result.status, 'stopped');
    const row = await new D1MeasurementStore(db).get(id, 'q1', channel); assert.equal(row.raw_answer, '正常な回答'); assert.equal(row.error, null);
    const settled = await db.prepare('SELECT reserved_cost_usd,actual_cost_usd FROM diagnosis_measurement_attempts WHERE diagnosis_id=? AND channel=?').bind(id, channel).first();
    assert.equal(settled.reserved_cost_usd, row.estimated_cost); assert.equal(settled.actual_cost_usd, row.estimated_cost);
  }
});

test('F-05: all paid-provider fetches carry an abortable timeout', async () => {
  const hangsUntilAbort = async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
  const input = { diagnosis_id: 'timeout', entity, question_id: 'q1', question_text: '質問', channel: 'chatgpt', run_id: 'timeout', max_cost: .7, locale: 'ja-JP' };
  await assert.rejects(() => new OpenAiPaidAdapter({ fetchImpl: hangsUntilAbort, timeoutMs: 1 }).execute(input, live), error => error.code === 'timeout' && error.retryable);
  await assert.rejects(() => new GeminiPaidAdapter({ fetchImpl: hangsUntilAbort, timeoutMs: 1 }).execute({ ...input, channel: 'gemini' }, live), error => error.code === 'timeout' && error.retryable);
  await assert.rejects(() => new GoogleAiModePaidAdapter({ fetchImpl: hangsUntilAbort, timeoutMs: 1 }).execute({ ...input, channel: 'google_ai_mode' }, { ...live, DATAFORSEO_LOGIN: 'test', DATAFORSEO_PASSWORD: 'test' }), error => error.code === 'timeout' && error.retryable);
});

test('F-05: pending polls are durable and stop after a finite cross-queue limit', async t => {
  const db = await sqliteD1(); t.after(() => db.close()); const id = '22222222-2222-4222-8222-222222222222'; await order(db, id);
  let calls = 0;
  class PendingAdapter extends PaidAdapter {
    estimateCost(input) { return input.existing_measurement?.provider_metadata?.pending ? 0 : .0012; }
    async execute(input) { calls += 1; return this.normalize(input, { raw_answer: '', estimated_cost: input.existing_measurement?.estimated_cost || .0012, raw_response_ref: 'pending-task', provider_metadata: { pending: true } }); }
  }
  let result;
  for (let i = 0; i < 7; i += 1) result = await runPaidMeasurements({ diagnosis: { id, entity, run_id: `run-${id}` }, questions, adapters: { chatgpt: new PendingAdapter({ channel: 'chatgpt' }), gemini: new PendingAdapter({ channel: 'gemini' }), google_ai_mode: new PendingAdapter({ channel: 'google_ai_mode' }) }, store: new D1MeasurementStore(db), env: live, maxCost: .7, maxMeasurements: 1 });
  assert.equal(result.status, 'stopped'); assert.equal(result.stopped.code, 'pending_poll_limit_exceeded'); assert.equal(calls, 6);
  const attempts = await db.prepare("SELECT attempt_phase,COUNT(*) n FROM diagnosis_measurement_attempts WHERE diagnosis_id=? GROUP BY attempt_phase ORDER BY attempt_phase").bind(id).all();
  assert.deepEqual(attempts.results, [{ attempt_phase: 'poll', n: 5 }, { attempt_phase: 'request', n: 1 }]);
});

test('F-05B: DataForSEO task POST is charged once and pending GET polls settle at zero', async t => {
  const db = await sqliteD1(); t.after(() => db.close()); const id = 'dataforseo-poll'; await order(db, id);
  let posts = 0; let gets = 0;
  const google = new GoogleAiModePaidAdapter({ retrievalMode: 'standard', fetchImpl: async url => {
    if (url.includes('/locations/')) return Response.json({ status_code: 20000, tasks: [{ result: [{ location_code: 2392, location_name: 'Japan' }] }] });
    if (url.endsWith('/languages')) return Response.json({ status_code: 20000, tasks: [{ result: [{ language_code: 'ja' }] }] });
    if (url.endsWith('/task_post')) { posts += 1; return Response.json({ status_code: 20000, tasks: [{ id: 'task-one', cost: .0012 }] }); }
    gets += 1; return Response.json({ status_code: 20000, tasks: [{ id: 'task-one', cost: .0012, result: [] }] });
  } });
  const fixtures = channel => new FixturePaidAdapter({ channel, fixtures: () => ({ raw_answer: 'saved', estimated_cost: 0 }) });
  let result;
  for (let index = 0; index < 7; index += 1) result = await runPaidMeasurements({ diagnosis: { id, entity, run_id: id }, questions, adapters: { chatgpt: fixtures('chatgpt'), gemini: fixtures('gemini'), google_ai_mode: google }, store: new D1MeasurementStore(db), env: { ...live, DATAFORSEO_LOGIN: 'x', DATAFORSEO_PASSWORD: 'y' }, maxCost: .7, maxMeasurements: 3 });
  assert.equal(posts, 1); assert.equal(gets, 5); assert.equal(result.stopped.code, 'pending_poll_limit_exceeded');
  assert.equal(await new D1MeasurementStore(db).budgetUsed(id), .0012);
});

test('F-05C: malformed DataForSEO JSON is a durable failure and never creates an unreserved pending POST', async t => {
  const db = await sqliteD1(); t.after(() => db.close()); const id = 'dataforseo-parse'; await order(db, id);
  let posts = 0;
  const google = new GoogleAiModePaidAdapter({ retrievalMode: 'standard', fetchImpl: async url => {
    if (url.includes('/locations/')) return Response.json({ status_code: 20000, tasks: [{ result: [{ location_code: 2392, location_name: 'Japan' }] }] });
    if (url.endsWith('/languages')) return Response.json({ status_code: 20000, tasks: [{ result: [{ language_code: 'ja' }] }] });
    posts += 1; return { ok: true, status: 200, json: async () => { throw new SyntaxError('bad JSON'); } };
  } });
  const fixtures = channel => new FixturePaidAdapter({ channel, fixtures: () => ({ raw_answer: 'saved', estimated_cost: 0 }) });
  for (let index = 0; index < 6; index += 1) await runPaidMeasurements({ diagnosis: { id, entity, run_id: id }, questions, adapters: { chatgpt: fixtures('chatgpt'), gemini: fixtures('gemini'), google_ai_mode: google }, store: new D1MeasurementStore(db), env: { ...live, DATAFORSEO_LOGIN: 'x', DATAFORSEO_PASSWORD: 'y' }, maxCost: .7, maxMeasurements: 3 });
  const attempts = await db.prepare("SELECT reserved_cost_usd,status,error_code FROM diagnosis_measurement_attempts WHERE diagnosis_id=? AND channel='google_ai_mode' ORDER BY attempt_number").bind(id).all();
  const row = await new D1MeasurementStore(db).get(id, 'q1', 'google_ai_mode');
  assert.equal(posts, 3); assert.deepEqual(attempts.results.map(item => item.reserved_cost_usd), [.0012, .0012, .0012]);
  assert.ok(attempts.results.every(item => item.status === 'failed' && item.error_code === 'malformed_response'));
  assert.equal(row.error.code, 'malformed_response'); assert.equal(row.provider_metadata.pending, undefined);
});

test('N-02: processed rows cannot be reactivated past the queue ceiling', async t => {
  const db = await sqliteD1(); t.after(() => db.close()); const env = { DB: db, ...secrets, MADOHA_RESULT_RESEND_QUEUE_LIMIT: '100' };
  for (let index = 0; index < 100; index += 1) await db.prepare("INSERT INTO result_resend_requests (email_lookup_hash,requested_at,available_at,processed_at,expires_at) VALUES (?,datetime('now','-1 hour'),datetime('now','-1 hour'),datetime('now'),datetime('now','+1 day'))").bind(`old-${index}`).run();
  for (let index = 0; index < 100; index += 1) await queueResultResend(env, `new${index}@example.invalid`);
  for (let index = 0; index < 100; index += 1) await queueResultResend(env, `old${index}@example.invalid`);
  const counts = await db.prepare("SELECT COUNT(*) total,SUM(CASE WHEN processed_at IS NULL THEN 1 ELSE 0 END) pending FROM result_resend_requests").first();
  assert.equal(counts.total, 100); assert.equal(counts.pending, 100);
});

test('N-02: unknown flood never evicts an already accepted purchaser request', async t => {
  const db = await sqliteD1(); t.after(() => db.close()); const id = '33333333-3333-4333-8333-333333333333';
  await db.prepare(`INSERT INTO diagnosis_orders (id,target_url,amount_jpy,payment_status,diagnosis_status,created_at,updated_at,sales_stage,pipeline_state,completed_measurements,entity_json)
    VALUES (?,'https://example.com',9800,'paid','complete',datetime('now'),datetime('now'),'completed','completed',30,'{}')`).bind(id).run();
  const sent = []; const env = { DB: db, ...secrets, MADOHA_RESULT_RESEND_QUEUE_LIMIT: '5', RESULT_EMAIL_FETCH: async (_url, init) => { sent.push(JSON.parse(init.body)); return Response.json({ id: 'mail' }); } };
  await storeBuyerEmail(env, id, 'buyer@example.invalid');
  await queueResultResend(env, 'buyer@example.invalid');
  for (let i = 0; i < 10; i += 1) await queueResultResend(env, `unknown${i}@example.invalid`);
  const pending = await db.prepare("SELECT COUNT(*) n FROM result_resend_requests WHERE processed_at IS NULL").first(); assert.equal(pending.n, 5);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM result_resend_requests WHERE email_lookup_hash=(SELECT buyer_email_lookup_hash FROM diagnosis_delivery WHERE diagnosis_id=?)").bind(id).first()).n, 1);
  await processQueuedResultResends(env, 1); assert.equal(sent.length, 1);
});
