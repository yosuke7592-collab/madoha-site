import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { createSalesDraft } from '../../worker/sales-flow.mjs';
import { D1MeasurementStore, PaidAdapter, runPaidMeasurements } from '../../measurement/paid-pipeline.mjs';

const fixture = JSON.parse(await readFile(new URL('../../data/fixtures/question-discovery/kyoudo.json', import.meta.url), 'utf8'));
const entity = { id: 'target', name: '株式会社テスト', official_url: 'https://example.com/' };
const questions = [{ id: 'q1', order: 1, query: '質問', kind: 'nonbrand' }];

test('F-04: unpaid draft creation has a persistent daily budget and expiry', async t => {
  const db = await sqliteD1(); t.after(() => db.close());
  const env = { DB: db, MADOHA_PAID_DIAGNOSIS_MAX_COST_USD: '.70', MADOHA_DRAFT_DAILY_LIMIT: '1' };
  const first = await createSalesDraft(env, fixture);
  const order = await db.prepare('SELECT draft_expires_at FROM diagnosis_orders WHERE id=?').bind(first.id).first();
  assert.ok(order.draft_expires_at);
  await assert.rejects(() => createSalesDraft(env, fixture), error => error.status === 429);
});

test('F-05: durable reservations stop retries at the configured attempt and cost budget', async t => {
  const db = await sqliteD1(); t.after(() => db.close());
  const orderId = '12121212-1212-4121-8121-121212121212';
  await db.prepare("INSERT INTO diagnosis_orders (id,target_url,amount_jpy,payment_status,diagnosis_status,created_at,updated_at) VALUES (?,'https://example.com',9800,'paid','paid',datetime('now'),datetime('now'))").bind(orderId).run();
  class Retryable extends PaidAdapter {
    estimateCost() { return .3; }
    async execute() { const error = new Error('temporary'); error.code = 'network'; error.retryable = true; throw error; }
  }
  const adapter = new Retryable({ channel: 'chatgpt', sleepImpl: async () => {} });
  const adapters = { chatgpt: adapter, gemini: adapter, google_ai_mode: adapter };
  const result = await runPaidMeasurements({ diagnosis: { id: orderId, entity }, questions, adapters, store: new D1MeasurementStore(db), maxCost: .7 });
  assert.equal(result.status, 'stopped');
  assert.equal(result.stopped.code, 'cost_cap_exceeded');
  const attempts = await db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(reserved_cost_usd),0) AS total FROM diagnosis_measurement_attempts WHERE diagnosis_id=?').bind(orderId).first();
  assert.equal(attempts.n, 2); assert.equal(attempts.total, .6);
});
