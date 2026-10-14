import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDiagnosisId, eligibility, main, parseArgs, publishQueueMessage, transitionSql } from '../../scripts/enqueue-production-diagnosis.mjs';

const id = '33d7c542-fbea-4a3f-8183-e096bc844020';
const eligible = { id, payment_status: 'pending', sales_stage: 'checkout_ready', diagnosis_status: 'locked', pipeline_state: 'pending', completed_measurements: 0, questions_confirmed_at: '2026-10-14', question_count: 10, confirmed_question_count: 10, outbox_count: 0 };

test('admin queue CLI requires a UUID diagnosis id', () => {
  assert.deepEqual(parseArgs(['--diagnosis-id', id]), { diagnosisId: id, execute: false });
  assert.equal(assertDiagnosisId(id), id);
  assert.throws(() => assertDiagnosisId('not-an-id'), /UUID/);
});

test('admin queue CLI accepts only a fresh confirmed ten-question diagnosis', () => {
  assert.deepEqual(eligibility(eligible), { ok: true });
  assert.equal(eligibility({ ...eligible, confirmed_question_count: 9 }).ok, false);
  assert.equal(eligibility({ ...eligible, completed_measurements: 1 }).ok, false);
  assert.equal(eligibility({ ...eligible, outbox_count: 1 }).ok, false);
  assert.equal(eligibility({ ...eligible, sales_stage: 'paid_measuring' }).ok, false);
  assert.match(transitionSql(id), /NOT EXISTS\(SELECT 1 FROM diagnosis_outbox/);
  assert.doesNotMatch(transitionSql(id), /admin_live_run'.*NOT EXISTS/s);
});

test('dry-run never transitions or publishes', async () => {
  let calls = 0;
  const result = await main({ argv: ['--diagnosis-id', id], runD1: async () => { calls += 1; return [{ results: [eligible] }]; }, publish: async () => assert.fail('must not publish') });
  assert.deepEqual(result, { diagnosisId: id, mode: 'dry-run', eligible: true });
  assert.equal(calls, 1);
});

test('execute publishes one message only after the guarded transition and marks it sent', async () => {
  const sql = [];
  const result = await main({
    argv: ['--diagnosis-id', id, '--execute'],
    env: { CLOUDFLARE_API_TOKEN: 'token' },
    runD1: async query => { sql.push(query); return [{ results: [eligible] }]; },
    publish: async input => assert.deepEqual(input, { apiToken: 'token', diagnosisId: id })
  });
  assert.deepEqual(result, { diagnosisId: id, mode: 'executed', queued: true });
  assert.equal(sql.length, 3);
  assert.match(sql[1], /admin_live_measurement_authorized/);
  assert.match(sql[2], /sent_at=datetime/);
});

test('publish posts only the one orderId through Cloudflare Queue HTTP API', async () => {
  let request;
  await publishQueueMessage({ apiToken: 'token', diagnosisId: id, fetchImpl: async (url, init) => { request = { url, init }; return new Response(JSON.stringify({ success: true }), { status: 200 }); } });
  assert.match(request.url, /\/queues\/6b0e5585ec29403d856325adb5f747b3\/messages$/);
  assert.deepEqual(JSON.parse(request.init.body), { body: { orderId: id }, content_type: 'json' });
});
