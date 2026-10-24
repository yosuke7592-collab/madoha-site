#!/usr/bin/env node
/**
 * One-shot, operator-only queue publisher for a confirmed Production diagnosis.
 *
 * This script is deliberately not part of the Worker or public HTTP surface. It
 * requires an explicitly supplied diagnosis id, a Cloudflare API token with
 * Queues Write, and --execute. Without --execute it only performs a read-only
 * eligibility check.
 */
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
export const PRODUCTION = Object.freeze({
  accountId: '357839a4f2db9b6d7f0bf39f60d53bad',
  database: 'madoha-paid-diagnosis-production',
  queueId: '6b0e5585ec29403d856325adb5f747b3'
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseArgs(argv) {
  const idIndex = argv.indexOf('--diagnosis-id');
  const diagnosisId = idIndex >= 0 ? argv[idIndex + 1] : null;
  return { diagnosisId, execute: argv.includes('--execute') };
}

export function assertDiagnosisId(value) {
  if (!UUID.test(value || '')) throw new Error('診断IDはUUID形式で指定してください。');
  return value;
}

export function eligibility(row) {
  if (!row) return { ok: false, reason: '診断が見つかりません。' };
  if (!row.questions_confirmed_at || Number(row.question_count) < 1 || Number(row.question_count) > 10 || Number(row.confirmed_question_count) !== Number(row.question_count)) {
    return { ok: false, reason: '確定済みの質問（1〜10問）を確認できません。' };
  }
  if (Number(row.completed_measurements) !== 0) return { ok: false, reason: '測定済みの診断は管理投入できません。' };
  if (Number(row.outbox_count) !== 0) return { ok: false, reason: '既にQueue投入済みまたは投入準備中です。' };
  if (row.payment_status !== 'pending' || row.sales_stage !== 'checkout_ready' || row.diagnosis_status !== 'locked' || row.pipeline_state !== 'pending') {
    return { ok: false, reason: '新規の確定済み診断だけが管理投入の対象です。' };
  }
  return { ok: true };
}

export function readSql(id) {
  return `SELECT o.id,o.payment_status,o.sales_stage,o.diagnosis_status,o.pipeline_state,o.completed_measurements,o.questions_confirmed_at,\
    (SELECT COUNT(*) FROM diagnosis_questions q WHERE q.diagnosis_id=o.id) AS question_count,\
    (SELECT COUNT(*) FROM diagnosis_questions q WHERE q.diagnosis_id=o.id AND q.confirmed=1) AS confirmed_question_count,\
    (SELECT COUNT(*) FROM diagnosis_outbox x WHERE x.diagnosis_id=o.id) AS outbox_count\
    FROM diagnosis_orders o WHERE o.id='${id}';`;
}

export function transitionSql(id) {
  return `BEGIN;\
    UPDATE diagnosis_orders SET payment_status='paid',sales_stage='paid',diagnosis_status='queued',pipeline_state='queued',paid_at=datetime('now'),updated_at=datetime('now')\
    WHERE id='${id}' AND payment_status='pending' AND sales_stage='checkout_ready' AND diagnosis_status='locked' AND pipeline_state='pending'\
      AND completed_measurements=0 AND questions_confirmed_at IS NOT NULL\
      AND (SELECT COUNT(*) FROM diagnosis_questions WHERE diagnosis_id='${id}')BETWEEN 1 AND 10\
      AND (SELECT COUNT(*) FROM diagnosis_questions WHERE diagnosis_id='${id}' AND confirmed=1)=(SELECT COUNT(*) FROM diagnosis_questions WHERE diagnosis_id='${id}')\
      AND NOT EXISTS(SELECT 1 FROM diagnosis_outbox WHERE diagnosis_id='${id}');\
    INSERT INTO diagnosis_outbox(diagnosis_id,stage,created_at,sent_at)\
      SELECT id,'admin_live_run',datetime('now'),NULL FROM diagnosis_orders\
      WHERE id='${id}' AND payment_status='paid' AND sales_stage='paid' AND diagnosis_status='queued' AND pipeline_state='queued'\
        AND completed_measurements=0;\
    INSERT OR IGNORE INTO diagnosis_events(diagnosis_id,event_name,created_at)\
      SELECT id,'admin_live_measurement_authorized',datetime('now') FROM diagnosis_orders WHERE id='${id}' AND payment_status='paid' AND sales_stage='paid';\
  COMMIT;`;
}

export function sentSql(id) {
  return `UPDATE diagnosis_outbox SET sent_at=datetime('now') WHERE diagnosis_id='${id}' AND stage='admin_live_run' AND sent_at IS NULL;`;
}

export function rollbackSql(id) {
  return `BEGIN;\
    DELETE FROM diagnosis_outbox WHERE diagnosis_id='${id}' AND stage='admin_live_run' AND sent_at IS NULL;\
    DELETE FROM diagnosis_events WHERE diagnosis_id='${id}' AND event_name='admin_live_measurement_authorized';\
    UPDATE diagnosis_orders SET payment_status='pending',sales_stage='checkout_ready',diagnosis_status='locked',pipeline_state='pending',paid_at=NULL,updated_at=datetime('now')\
      WHERE id='${id}' AND payment_status='paid' AND sales_stage='paid' AND diagnosis_status='queued' AND pipeline_state='queued' AND completed_measurements=0;\
  COMMIT;`;
}

export async function publishQueueMessage({ apiToken, diagnosisId, fetchImpl = fetch, production = PRODUCTION }) {
  if (!apiToken) throw new Error('CLOUDFLARE_API_TOKEN が必要です。');
  const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${production.accountId}/queues/${production.queueId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ body: { orderId: diagnosisId }, content_type: 'json' })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success !== true) throw new Error(`Queue投入に失敗しました（HTTP ${response.status}）。`);
  return result;
}

async function d1(sql) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const { stdout } = await execFile(npx, ['wrangler', 'd1', 'execute', PRODUCTION.database, '--remote', '--json', '--command', sql], { windowsHide: true, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout);
}
const firstRow = output => output?.[0]?.results?.[0] || null;

export async function main({ argv = process.argv.slice(2), env = process.env, runD1 = d1, publish = publishQueueMessage } = {}) {
  const { diagnosisId, execute } = parseArgs(argv);
  assertDiagnosisId(diagnosisId);
  const check = eligibility(firstRow(await runD1(readSql(diagnosisId))));
  if (!check.ok) throw new Error(check.reason);
  if (!execute) return { diagnosisId, mode: 'dry-run', eligible: true };
  if (!env.CLOUDFLARE_API_TOKEN) throw new Error('CLOUDFLARE_API_TOKEN が必要です。');
  await runD1(transitionSql(diagnosisId));
  try {
    await publish({ apiToken: env.CLOUDFLARE_API_TOKEN, diagnosisId });
    await runD1(sentSql(diagnosisId));
    return { diagnosisId, mode: 'executed', queued: true };
  } catch (error) {
    // Do not retry or roll back an ambiguous HTTP publish: a timeout might still
    // have delivered the message. The unsent outbox row remains a hard stop for
    // an operator to inspect before any manual recovery.
    throw new Error(`Queue投入の成否を確認できません。再実行せずoutboxを確認してください: ${error.message}`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href) {
  main().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
